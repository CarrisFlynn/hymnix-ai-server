import {execFile, spawn, type ChildProcess} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import type {AppBootstrap, GatewayRestartResult} from "../shared/protocol";

export const DEFAULT_GATEWAY_PORT = 11435;
const baseForPort = (port: number) => "http://127.0.0.1:" + port;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const compatibleVersion = (value: unknown) => typeof value === "string" && /^1\.3(?:\.|$)/.test(value);

type ManagedGateway = {
  dir: string;
  child: ChildProcess;
  exited: Promise<void>;
  failure?: string;
};

type GatewayOptions = {
  command: string;
  args: string[];
  requiredPath: string;
  cwd: string;
  log: (message: string) => void;
  defaultPort?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

async function probeExternal(base: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(base + "/health", {signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]), redirect: "error"});
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.ok === true && compatibleVersion(payload.gateway);
  } catch {
    return false;
  }
}

function forceStop(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // PyInstaller one-file executables use a bootloader and a separate Python process.
    execFile("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {windowsHide: true, timeout: 1500}, (error) => {
      if (error && child.exitCode === null && child.signalCode === null) child.kill();
    });
  } else {
    child.kill("SIGKILL");
  }
}

export class GatewayLifecycle {
  private state: AppBootstrap["state"] = "idle";
  private port: number;
  private external = false;
  private error = "";
  private owned: ManagedGateway | undefined;
  private operation: Promise<GatewayRestartResult> | undefined;
  private readonly shutdown = new AbortController();
  private shutdownOperation: Promise<void> | undefined;

  private readonly options: GatewayOptions;

  constructor(options: GatewayOptions) {
    this.options = options;
    this.port = options.defaultPort ?? DEFAULT_GATEWAY_PORT;
  }

  snapshot(): AppBootstrap {
    return {base: baseForPort(this.port), port: this.port, external: this.external, ready: this.state === "ready",
      state: this.state, error: this.error || (this.state === "ready" ? "" : "gateway not ready")};
  }

  async bootstrap(): Promise<AppBootstrap> {
    if (this.state === "idle") await this.start();
    else if (this.operation) await this.operation;
    return this.snapshot();
  }

  start(): Promise<GatewayRestartResult> {
    if (this.state === "ready") return Promise.resolve(this.result());
    return this.run(false);
  }

  restart(): Promise<GatewayRestartResult> {
    return this.run(true);
  }

  stop(): Promise<void> {
    if (!this.shutdownOperation) {
      this.state = "stopping";
      this.shutdown.abort();
      this.shutdownOperation = this.finishStop();
    }
    return this.shutdownOperation;
  }

  private async finishStop(): Promise<void> {
    try {
      await this.operation;
      await this.stopOwned();
    } finally {
      this.state = "stopped";
    }
  }

  private result(): GatewayRestartResult {
    const snapshot = this.snapshot();
    return {...snapshot, ok: snapshot.ready};
  }

  private run(restart: boolean): Promise<GatewayRestartResult> {
    if (this.shutdown.signal.aborted) return Promise.resolve(this.result());
    if (this.operation) return this.operation;
    const probe = !this.owned && (!restart || this.external || this.state === "idle");
    const operation = this.launch(probe);
    this.operation = operation;
    void operation.then(() => { if (this.operation === operation) this.operation = undefined; });
    return operation;
  }

  private async launch(probe: boolean): Promise<GatewayRestartResult> {
    this.state = "starting";
    this.error = "";
    this.external = false;
    const signal = this.shutdown.signal;
    try {
      await this.stopOwned();
      signal.throwIfAborted();
      const defaultPort = this.options.defaultPort ?? DEFAULT_GATEWAY_PORT;
      if (probe && await probeExternal(baseForPort(defaultPort), signal)) {
        signal.throwIfAborted();
        this.port = defaultPort;
        this.external = true;
      } else {
        signal.throwIfAborted();
        if (!existsSync(this.options.requiredPath)) throw new Error("Missing server gateway: " + this.options.requiredPath);
        this.port = await this.launchOwned(signal);
        signal.throwIfAborted();
        if (this.owned?.failure) throw new Error(this.owned.failure);
      }
      this.state = "ready";
      this.options.log("gateway ready port=" + this.port + " external=" + this.external);
    } catch (error) {
      if (!signal.aborted) {
        this.state = "failed";
        this.error = messageOf(error);
        this.options.log("gateway failed: " + this.error);
      }
      try { await this.stopOwned(); } catch (stopError) { this.options.log(messageOf(stopError)); }
    }
    return this.result();
  }

  private async launchOwned(signal: AbortSignal): Promise<number> {
    const dir = mkdtempSync(join(tmpdir(), "hymnix-gateway-"));
    let child: ChildProcess;
    try {
      child = spawn(this.options.command, this.options.args, {cwd: this.options.cwd, windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"], env: {...process.env, ...this.options.env, HYMNIX_DESKTOP_CONTROL_DIR: dir}});
    } catch (error) {
      rmSync(dir, {recursive: true, force: true});
      throw error;
    }
    child.stdout?.on("data", (chunk: Buffer) => this.options.log("backend: " + chunk.toString().trim().slice(0, 300)));
    child.stderr?.on("data", (chunk: Buffer) => this.options.log("backend error: " + chunk.toString().trim().slice(0, 300)));
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => { resolveExit = resolve; });
    const managed: ManagedGateway = {dir, child, exited};
    this.owned = managed;
    const closed = (reason: string) => {
      managed.failure = reason;
      resolveExit();
      if (this.owned === managed && this.state === "ready") {
        this.state = "failed";
        this.error = reason;
        this.options.log(reason);
      }
    };
    child.once("error", (error) => {
      if (!child.pid) closed("Unable to start headless gateway: " + error.message);
    });
    child.once("exit", (code, exitSignal) => closed("Headless gateway exited (" + (exitSignal ?? "code " + code) + ")"));
    const deadline = performance.now() + (this.options.startupTimeoutMs ?? 60000);
    const readyPath = join(dir, "ready.json");
    while (performance.now() < deadline) {
      signal.throwIfAborted();
      if (managed.failure) {
        try { this.options.log(readFileSync(join(dir, "error.log"), "utf8").slice(-1000)); } catch { /* no Python traceback */ }
        throw new Error(managed.failure);
      }
      if (existsSync(readyPath)) {
        const payload = JSON.parse(readFileSync(readyPath, "utf8"));
        if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535 || !compatibleVersion(payload.version)) {
          throw new Error("Invalid headless gateway readiness record");
        }
        return payload.port;
      }
      await delay(100, undefined, {signal});
    }
    throw new Error("Headless gateway did not become ready before the startup deadline");
  }

  private async stopOwned(): Promise<void> {
    const managed = this.owned;
    if (!managed) return;
    const waitForExit = async (timeout: number) => {
      const timer = new AbortController();
      try {
        return await Promise.race([managed.exited.then(() => true), delay(timeout, false, {signal: timer.signal})]);
      } finally { timer.abort(); }
    };
    if (!managed.failure) {
      try { writeFileSync(join(managed.dir, "stop"), ""); } catch (error) { this.options.log(messageOf(error)); }
      if (!await waitForExit(this.options.shutdownTimeoutMs ?? 3500)) {
        forceStop(managed.child);
        if (!await waitForExit(2000)) throw new Error("Timed out stopping the headless gateway");
      }
    }
    this.owned = undefined;
    try { rmSync(managed.dir, {recursive: true, force: true}); } catch (error) { this.options.log(messageOf(error)); }
  }
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { TerminalBridgeCommand, TerminalBridgeResult, TerminalBridgeReply } from "../shared/protocol";

const HOST = "127.0.0.1";
const LIMIT = 64 * 1024;
const MAX_REPLIES = 8;
const DEADLINE = 5000;

function respond(response: ServerResponse, status: number) {
  response.writeHead(status, { Connection: "close", "Cache-Control": "no-store", "Content-Length": 0 });
  response.end();
}

function header(request: IncomingMessage, name: string) {
  const values = request.headersDistinct[name];
  return values?.length === 1 ? values[0] : undefined;
}

function replyFromBody(chunks: Buffer[]): TerminalBridgeReply {
  const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
  const { provider, text } = input as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || (provider !== "gpt" && provider !== "gemini" && provider !== "other") || typeof text !== "string") throw new Error();
  const clean = text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  if (!clean) throw new Error();
  return { provider, text: clean, receivedAt: new Date().toISOString() };
}

export class TerminalBridge {
  private active?: { server: ReturnType<typeof createServer>; ready: Promise<void>; token: string; endpoint: string; inbox: TerminalBridgeReply[] };

  stop(): void {
    const active = this.active;
    this.active = undefined;
    if (!active) return;
    active.inbox.length = 0;
    // If binding was still pending, its listening callback closes the listener.
    if (active.server.listening) {
      active.server.close();
      active.server.closeAllConnections();
    }
  }

  async run(command: TerminalBridgeCommand): Promise<TerminalBridgeResult> {
    if (command === "off") this.stop();
    if (command === "on" && !this.active) this.start();
    const active = this.active;
    if (!active) return { enabled: false };
    await active.ready;
    if (this.active !== active) return { enabled: false };
    const result: TerminalBridgeResult = { enabled: true, endpoint: active.endpoint, pending: active.inbox.length };
    if (command === "on") result.token = active.token;
    if (command === "inbox") {
      result.replies = active.inbox.splice(0);
      result.pending = 0;
    }
    return result;
  }

  private start(): void {
    const token = randomBytes(32).toString("hex");
    const authorization = Buffer.from("Bearer " + token);
    const inbox: TerminalBridgeReply[] = [];
    let host = "";
    const server = createServer({ headersTimeout: DEADLINE, requestTimeout: DEADLINE, keepAliveTimeout: 1, maxHeaderSize: 4096 }, (request, response) => {
      if (this.active?.server !== server) return respond(response, 503);
      if (request.method !== "POST" || request.url !== "/reply") return respond(response, 404);
      if (request.socket.remoteAddress !== HOST || header(request, "host") !== host || request.headers.origin !== undefined || request.headers["sec-fetch-site"] !== undefined) return respond(response, 403);
      const supplied = Buffer.from(header(request, "authorization") ?? "");
      if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) return respond(response, 401);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(request, "content-type") ?? "") || request.headers["content-encoding"] !== undefined || request.headers["transfer-encoding"] !== undefined) return respond(response, 415);
      const length = Number(header(request, "content-length"));
      if (!Number.isSafeInteger(length) || length < 1) return respond(response, 411);
      if (length > LIMIT) return respond(response, 413);
      if (inbox.length >= MAX_REPLIES) return respond(response, 429);
      const chunks: Buffer[] = [];
      let bytes = 0;
      request.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > length) request.destroy();
        else chunks.push(chunk);
      });
      request.on("error", () => {});
      request.on("end", () => {
        if (this.active?.server !== server) return respond(response, 503);
        if (inbox.length >= MAX_REPLIES) return respond(response, 429);
        try {
          if (bytes !== length) return respond(response, 400);
          inbox.push(replyFromBody(chunks));
        } catch { return respond(response, 400); }
        respond(response, 202);
      });
    });
    server.maxConnections = 8;
    server.maxRequestsPerSocket = 1;
    server.on("connection", (socket) => {
      const timer = setTimeout(() => socket.destroy(), DEADLINE);
      timer.unref();
      socket.once("close", () => clearTimeout(timer));
    });
    // Windows PowerShell 5.1 sends "Expect: 100-continue" for byte-array bodies. Accept the
    // expectation and then run the same single request handler; all checks still apply.
    server.on("checkContinue", (request, response) => {
      response.writeContinue();
      server.emit("request", request, response);
    });
    const active = { server, token, endpoint: "", inbox, ready: Promise.resolve() };
    this.active = active;
    active.ready = new Promise<void>((resolve, reject) => {
      server.on("error", () => {
        if (this.active === active) this.stop();
        reject(new Error("Could not start the local reply bridge."));
      });
      server.listen(0, HOST, () => {
        if (this.active !== active) {
          server.close();
          server.closeAllConnections();
        } else {
          const address = server.address();
          if (!address || typeof address === "string") {
            this.stop();
            reject(new Error("Could not bind the local reply bridge."));
            return;
          }
          host = HOST + ":" + address.port;
          active.endpoint = "http://" + host + "/reply";
        }
        resolve();
      });
    });
  }
}

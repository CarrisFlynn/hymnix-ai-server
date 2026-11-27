/**
 * The interactive half of the terminal page.
 *
 * The page around it is unchanged: same header pills, same palette, same fonts.
 * Only the middle changes — a real VT screen instead of a line log — because
 * Claude Code and every other Ink TUI needs cursor addressing and raw keys,
 * which a line list cannot express.
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { t } from "./i18n";

declare const __DEV_BUILD__: boolean;

type Profile = { id: string; label: string; available: boolean; detail: string };

/** Colours come from the page's own tokens so the screen matches the cockpit. */
function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => (css.getPropertyValue(name) || "").trim() || fallback;
  return {
    background: pick("--term-bg", "#0b0d10"),
    foreground: pick("--term-fg", "#d7dbe0"),
    cursor: pick("--accent", "#d33"),
    selectionBackground: pick("--accent-soft", "#3a1d1d"),
    black: "#11151a", red: "#e05252", green: "#79b86b", yellow: "#d7b45a",
    blue: "#5b8fd6", magenta: "#b07fd0", cyan: "#57b3b8", white: "#c9d1d9",
    brightBlack: "#5a6570", brightRed: "#f07070", brightGreen: "#96d488",
    brightYellow: "#e8ca78", brightBlue: "#7aa9e8", brightMagenta: "#c99ae0",
    brightCyan: "#72ccd0", brightWhite: "#eef2f6",
  };
}

export function TerminalPane({ cwd, lang, onSessionChange }: { cwd: string; lang?: "zh" | "en"; onSessionChange?: (sessionId: string | null) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string>("");
  /**
   * A resize makes ConPTY clear and repaint, which drops the prompt in the middle of
   * a fresh screen. The pane is still settling for a moment after it opens, so
   * resizes are ignored until it has stopped moving.
   */
  const settleUntilRef = useRef(0);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState("pwsh");
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");

  // One xterm instance for the life of the pane.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontFamily: "var(--font-mono, Consolas, monospace)",
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      fontWeight: 400,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 50_000,
      convertEol: false,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    // Probe hook: xterm 6 has no DOM text layer, so tests read the buffer.
    if (typeof __DEV_BUILD__ !== "undefined" && __DEV_BUILD__) (window as any).__ptyTerm = term;
    fitRef.current = fit;

    const sendResize = () => {
      if (!sessionRef.current || Date.now() < settleUntilRef.current) return;
      const before = { cols: term.cols, rows: term.rows };
      try { fit.fit(); } catch { return; }
      if (term.cols === before.cols && term.rows === before.rows) return;
      try { window.hymnix.pty.resize(sessionRef.current, term.cols, term.rows); } catch { /* pane hidden */ }
    };
    const observer = new ResizeObserver(() => sendResize());
    observer.observe(host);

    const offData = window.hymnix.pty.onData(({ id, data }) => {
      if (id === sessionRef.current) term.write(data);
    });
    const offExit = window.hymnix.pty.onExit(({ id, exitCode }) => {
      if (id !== sessionRef.current) return;
      sessionRef.current = "";
      setRunning(false);
      onSessionChange?.(null);
      term.write("\r\n\x1b[2m[process exited: " + exitCode + "]\x1b[0m\r\n");
    });

    return () => {
      offData();
      offExit();
      observer.disconnect();
      if (sessionRef.current) window.hymnix.pty.close(sessionRef.current);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Key presses go to the PTY exactly as typed; xterm owns the encoding.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const sub = term.onData((data) => {
      if (sessionRef.current) window.hymnix.pty.write(sessionRef.current, data);
    });
    return () => sub.dispose();
  }, []);

  useEffect(() => {
    void window.hymnix.pty.profiles().then((result) => {
      if (!result.ok) return;
      setProfiles(result.profiles);
      const firstAvailable = result.profiles.find((row) => row.id === "pwsh" && row.available)
        || result.profiles.find((row) => row.available);
      if (firstAvailable) setProfile(firstAvailable.id);
    }).catch(() => undefined);
  }, []);

  function start(): void {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    if (sessionRef.current) { stop(); }
    fit.fit();
    const id = "pty-" + Math.random().toString(36).slice(2, 10);
    settleUntilRef.current = Date.now() + 1500;
    void window.hymnix.pty.open({ id, profile, cwd, cols: term.cols, rows: term.rows , lang }).then((result) => {
      if (!result.ok) { setNote(t("Could not start this program") + ": " + (result.error || "")); return; }
      sessionRef.current = id;
      term.reset();

      setRunning(true);
      setNote("");
      onSessionChange?.(id);
      term.focus();
    }).catch((error: unknown) => setNote(String(error)));
  }

  function stop(): void {
    if (!sessionRef.current) return;
    window.hymnix.pty.close(sessionRef.current);
    sessionRef.current = "";
    setRunning(false);
    onSessionChange?.(null);
  }

  const current = profiles.find((row) => row.id === profile);

  return <div className="pty-pane">
    <div className="pty-bar">
      <select value={profile} onChange={(event) => setProfile(event.target.value)} aria-label={t("Program")} disabled={running}>
        {profiles.map((row) => <option key={row.id} value={row.id} disabled={!row.available}>{row.label}{row.available ? "" : " (" + t("not installed") + ")"}</option>)}
      </select>
      <button type="button" className="term-btn" onClick={running ? stop : start}>{running ? "■ STOP" : "▶ RUN"}</button>
      <span className="term-dim">{(current && current.detail) || ""}</span>
      {note && <span className="term-dim" role="alert">{note}</span>}
    </div>
    <div className="pty-screen" ref={hostRef} />
  </div>;
}

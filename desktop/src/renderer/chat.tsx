import { useState, type ReactElement } from "react";
import { t, tf } from "./i18n";
import brandIcon from "./assets/hymnix-red-white-star.png";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at?: string;
  reasoning?: string;
  /** How long the reasoning stream took, shown as "Thought for 8 s". */
  reasoningMs?: number;
  /** Kept when a stream fails so the partial reply stays on screen. */
  error?: string;
  /** Set when the user stopped the stream; the bubble keeps what arrived. */
  stopped?: boolean;
  tokensPerSecond?: number;
};

export function formatMessageTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function messageDay(value?: string): { key: string; label: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  const label = key === todayKey ? t("Today") : key === yesterdayKey ? t("Yesterday") : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(date);
  return { key, label };
}

const FENCE = "```";
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

const EXTENSIONS: Record<string, string> = {
  python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx",
  json: "json", html: "html", css: "css", bash: "sh", sh: "sh", shell: "sh", powershell: "ps1", sql: "sql",
  java: "java", rust: "rs", go: "go", csharp: "cs", "c++": "cpp", yaml: "yml", markdown: "md",
};

export function renderInline(text: string): Array<string | ReactElement> {
  const out: Array<string | ReactElement> = [];
  text.split(INLINE_RE).filter((part) => part !== "").forEach((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) out.push(<strong key={"b" + index}>{part.slice(2, -2)}</strong>);
    else if (part.startsWith("`") && part.endsWith("`")) out.push(<code key={"c" + index}>{part.slice(1, -1)}</code>);
    else out.push(part);
  });
  return out;
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const language = (lang || "code").trim();
  function save() {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hymnix-code.${EXTENSIONS[language.toLowerCase()] || "txt"}`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return <div className="code-block">
    <div className="code-head">
      <span>{language}</span>
      <span className="code-actions">
        <button className="code-copy" onClick={() => { void navigator.clipboard?.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }} aria-live="polite">{copied ? t("Copied") : t("Copy")}</button>
        <button className="code-copy" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>{wrap ? t("No wrap") : t("Wrap")}</button>
        <button className="code-copy" onClick={save}>{t("Save as file")}</button>
      </span>
    </div>
    <pre className={wrap ? "wrap" : ""}>{code}</pre>
  </div>;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactElement[] = [];
  const segments = text.split(FENCE);
  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      const lines = segment.split("\n");
      const lang = (lines[0] || "").trim() || "code";
      const code = lines.slice(1).join("\n").replace(/\n$/, "");
      blocks.push(<CodeBlock key={"code" + index} lang={lang} code={code} />);
      return;
    }
    segment.split("\n").forEach((raw, lineIndex) => {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) return;
      const key = "md" + index + "-" + lineIndex;
      if (/^###\s+/.test(line)) blocks.push(<h5 key={key}>{line.replace(/^###\s+/, "")}</h5>);
      else if (/^#{1,2}\s+/.test(line)) blocks.push(<h4 key={key}>{line.replace(/^#{1,2}\s+/, "")}</h4>);
      else if (/^\s*[-*]\s+/.test(line)) blocks.push(<div className="md-li" key={key}>• {renderInline(line.replace(/^\s*[-*]\s+/, ""))}</div>);
      else if (/^\s*\d+[.)]\s+/.test(line)) blocks.push(<div className="md-li" key={key}>• {renderInline(line.replace(/^\s*\d+[.)]\s+/, ""))}</div>);
      else blocks.push(<p key={key}>{renderInline(line)}</p>);
    });
  });
  return <>{blocks}</>;
}

export function Bubble({ message, turnIndex, messageIndex, busy = false, generating = false, onEdit, onRegenerate, onDelete, onBranch, onRetry }: {
  message: ChatMessage; turnIndex?: number; messageIndex: number; busy?: boolean; generating?: boolean;
  onEdit?: (index: number) => void; onRegenerate?: (index: number) => void; onDelete?: (index: number) => void;
  onBranch?: (index: number) => void; onRetry?: (index: number) => void;
}) {
  const user = message.role === "user";
  const [copied, setCopied] = useState(false);
  async function copyMessage() {
    try { await navigator.clipboard?.writeText(message.content); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }
    catch { /* clipboard may be unavailable in the current window context */ }
  }
  const thinkingSeconds = message.reasoningMs ? Math.max(1, Math.round(message.reasoningMs / 1000)) : null;
  return <article className={(user ? "bubble user" : "bubble assistant") + (generating ? " generating" : "")} data-chat-turn={turnIndex}>
    {!user && <img className="bubble-avatar brand-avatar" src={brandIcon} alt="" />}
    <div className="bubble-card">
      {!user && <div className="bubble-meta"><strong>Hymnix Orbit</strong><span>{formatMessageTime(message.at)}</span>{message.tokensPerSecond ? <span className="bubble-rate" data-no-translate>{message.tokensPerSecond.toFixed(1)} tok/s</span> : null}</div>}
      {message.reasoning ? <details className="bubble-think">
        <summary>{thinkingSeconds ? tf("Thought for {seconds} s", { seconds: String(thinkingSeconds) }) : t("Thinking process")} · {message.reasoning.length} {t("chars")}</summary>
        <pre>{message.reasoning}</pre>
      </details> : null}
      <div className="bubble-body">{message.content ? <Markdown text={message.content} /> : message.error ? null : <p className="bubble-thinking">{t("Thinking...")}</p>}</div>
      {message.stopped && !message.error && <div className="bubble-stopped" role="status">
        <strong>{t("Stopped")}</strong>
        <span>{t("This reply was stopped before it finished.")}</span>
        {onRetry && <button type="button" className="panel-link" onClick={() => onRetry(messageIndex)}>{t("Retry")}</button>}
      </div>}
      {message.error && <div className="bubble-error" role="alert">
        <span><strong>{t("Connection lost")}</strong>{message.error}</span>
        {onRetry && <button type="button" className="btn" onClick={() => onRetry(messageIndex)}>{t("Retry")}</button>}
        <button type="button" className="panel-link" onClick={() => void navigator.clipboard?.writeText(message.error || "")}>{t("Copy details")}</button>
      </div>}
      {(message.content || message.error) && <div className="bubble-actions" aria-label={t("Message actions")}>
        {user && onEdit && <button type="button" data-tip={t("Edit prompt")} aria-label={t("Edit prompt")} onClick={() => onEdit(messageIndex)}>✎</button>}
        <button type="button" data-tip={t(copied ? "Copied" : "Copy")} aria-label={t(copied ? "Copied" : "Copy message")} onClick={() => void copyMessage()}>{copied ? "✓" : "▢"}</button>
        {!user && onRegenerate && <button type="button" data-tip={t("Regenerate")} aria-label={t("Regenerate response")} disabled={busy} onClick={() => onRegenerate(messageIndex)}>↻</button>}
        {!user && onBranch && <button type="button" data-tip={t("Branch from here")} aria-label={t("Branch from here")} disabled={busy} onClick={() => onBranch(messageIndex)}>⑂</button>}
        {onDelete && <button type="button" className="danger" data-tip={t("Delete turn")} aria-label={t("Delete turn")} onClick={() => onDelete(messageIndex)}>×</button>}
      </div>}
      {user && message.at && <span className="bubble-time">{formatMessageTime(message.at)}</span>}
    </div>
  </article>;
}

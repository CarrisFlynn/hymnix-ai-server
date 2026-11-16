import { useState, type ReactElement } from "react";
import { t } from "./i18n";

export type ChatMessage = { role: "user" | "assistant"; content: string; at?: string; reasoning?: string };

const FENCE = "```";
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

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
  return <div className="code-block">
    <div className="code-head">
      <span>{lang || "code"}</span>
      <button className="code-copy" onClick={() => { void navigator.clipboard?.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? t("Copied") : t("Copy")}</button>
    </div>
    <pre>{code}</pre>
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

export function Bubble({ message }: { message: ChatMessage }) {
  const user = message.role === "user";
  return <article className={user ? "bubble user" : "bubble assistant"}>
    <span className="bubble-avatar" aria-hidden="true">{user ? "U" : "H"}</span>
    <div className="bubble-card">
      <div className="bubble-meta"><strong>{user ? t("You") : "Hymnix Orbit"}</strong><span>{message.at || ""}</span></div>
      {message.reasoning ? <details className="bubble-think" open>
        <summary>{t("Thinking process")} · {message.reasoning.length} {t("chars")}</summary>
        <pre>{message.reasoning}</pre>
      </details> : null}
      <div className="bubble-body">{message.content ? <Markdown text={message.content} /> : <p className="bubble-thinking">{t("Thinking...")}</p>}</div>
    </div>
  </article>;
}

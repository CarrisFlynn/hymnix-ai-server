import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bubble, messageDay, type ChatMessage } from "./chat";
import { t, tf } from "./i18n";

const BOTTOM_GAP = 32;
const TURN_OFFSET = 16;

export function ChatViewport({ messages, empty, footer, followSignal, busy = false, onEditMessage, onRegenerateMessage, onDeleteMessage, onBranchMessage, onRetryMessage }: {
  messages: readonly ChatMessage[];
  empty: ReactNode;
  footer?: ReactNode;
  followSignal: number;
  busy?: boolean;
  onEditMessage?: (index: number) => void;
  onRegenerateMessage?: (index: number) => void;
  onDeleteMessage?: (index: number) => void;
  onBranchMessage?: (index: number) => void;
  onRetryMessage?: (index: number) => void;
}) {
  const canvas = useRef<HTMLElement>(null);
  const following = useRef(true);
  const jump = useRef<{ index: number; top: number } | null>(null);
  const seen = useRef(messages.length);
  const [atLatest, setAtLatest] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<number>();
  const [announcement, setAnnouncement] = useState("");
  const turns = messages.flatMap((message, index) => message.role === "user" ? [{ message, index }] : []);

  function updatePosition(view: HTMLElement) {
    if (jump.current && Math.abs(view.scrollTop - jump.current.top) <= 1) {
      setCurrentTurn(jump.current.index);
      setAtLatest(false);
      return;
    }
    jump.current = null;
    const atBottom = view.scrollHeight - view.clientHeight - view.scrollTop <= BOTTOM_GAP;
    following.current = atBottom;
    setAtLatest(atBottom);
    if (atBottom) setHasNew(false);
    const nodes = view.querySelectorAll<HTMLElement>("[data-chat-turn]");
    let low = 0;
    let high = nodes.length;
    const threshold = view.getBoundingClientRect().top + TURN_OFFSET + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (nodes[middle].getBoundingClientRect().top <= threshold) low = middle + 1;
      else high = middle;
    }
    const current = nodes[atBottom ? nodes.length - 1 : Math.max(0, low - 1)];
    setCurrentTurn(current ? Number(current.dataset.chatTurn) : undefined);
  }

  function goToLatest() {
    const view = canvas.current;
    if (!view) return;
    jump.current = null;
    following.current = true;
    view.scrollTop = view.scrollHeight;
    setHasNew(false);
    updatePosition(view);
  }

  function goToTurn(index: number) {
    const view = canvas.current;
    const turn = view?.querySelector<HTMLElement>('[data-chat-turn="' + index + '"]');
    if (!view || !turn) return;
    following.current = false;
    view.scrollTop += turn.getBoundingClientRect().top - view.getBoundingClientRect().top - TURN_OFFSET;
    jump.current = { index, top: view.scrollTop };
    updatePosition(view);
  }

  useLayoutEffect(goToLatest, [followSignal]);
  useLayoutEffect(() => {
    const view = canvas.current;
    if (!view) return;
    if (messages.length > seen.current && !following.current) setHasNew(true);
    seen.current = messages.length;
    if (following.current || messages.length === 0) goToLatest();
    else updatePosition(view);
  }, [messages]);

  // Announce completion once, not once per token: screen readers get a single
  // polite message when the stream ends (plan §10.11).
  useEffect(() => {
    if (busy) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.content) setAnnouncement(tf("Reply complete, {count} characters", { count: String(last.content.length) }));
  }, [busy]);

  useLayoutEffect(() => {
    const view = canvas.current;
    if (!view) return;
    const observer = new ResizeObserver(() => {
      if (following.current) goToLatest();
      else updatePosition(view);
    });
    observer.observe(view);
    return () => observer.disconnect();
  }, []);

  return <div className="chat-viewport">
    <section ref={canvas} className="canvas" onScroll={(event) => updatePosition(event.currentTarget)}>
      {messages.length === 0 ? empty : messages.map((message, index) => {
        const day = messageDay(message.at);
        const previousDay = index > 0 ? messageDay(messages[index - 1].at) : null;
        return <div className="chat-message-group" key={index}>
          {day && day.key !== previousDay?.key && <div className="chat-date-separator"><span>{day.label}</span></div>}
          <Bubble message={message} messageIndex={index} busy={busy} generating={busy && index === messages.length - 1} onEdit={onEditMessage} onRegenerate={onRegenerateMessage} onDelete={onDeleteMessage} onBranch={onBranchMessage} onRetry={onRetryMessage} turnIndex={message.role === "user" ? index : undefined} />
        </div>;
      })}
      {footer}
    </section>
    <span className="sr-only" aria-live="polite" role="status">{announcement}</span>
    {turns.length > 0 && <nav className="chat-turn-rail" aria-label={t("Conversation turns")}>
      {turns.map(({ message, index }, position) => {
        const snippet = message.content.replace(/\s+/g, " ").trim().slice(0, 80);
        const label = tf("Turn {number}", { number: String(position + 1) }) + (snippet ? " · " + snippet : "");
        return <button key={index} type="button" className="chat-turn-mark" title={label} aria-label={label}
          aria-current={currentTurn === index ? "location" : undefined} onClick={() => goToTurn(index)} />;
      })}
    </nav>}
    {!atLatest && <button type="button" className={"btn chat-latest" + (hasNew ? " has-new" : "")} onClick={goToLatest}>{hasNew ? t("New content") : t("Back to latest")} ↓</button>}
  </div>;
}

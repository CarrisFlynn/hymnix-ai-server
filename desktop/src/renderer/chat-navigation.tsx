import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bubble, type ChatMessage } from "./chat";
import { t, tf } from "./i18n";

const BOTTOM_GAP = 32;
const TURN_OFFSET = 16;

export function ChatViewport({ messages, empty, followSignal }: {
  messages: readonly ChatMessage[];
  empty: ReactNode;
  followSignal: number;
}) {
  const canvas = useRef<HTMLElement>(null);
  const following = useRef(true);
  const jump = useRef<{ index: number; top: number } | null>(null);
  const [atLatest, setAtLatest] = useState(true);
  const [currentTurn, setCurrentTurn] = useState<number>();
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
    if (following.current || messages.length === 0) goToLatest();
    else updatePosition(view);
  }, [messages]);

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
    <section ref={canvas} className="canvas" aria-live="polite" onScroll={(event) => updatePosition(event.currentTarget)}>
      {messages.length === 0 ? empty : messages.map((message, index) =>
        <Bubble key={index} message={message} turnIndex={message.role === "user" ? index : undefined} />)}
    </section>
    {turns.length > 0 && <nav className="chat-turn-rail" aria-label={t("Conversation turns")}>
      {turns.map(({ message, index }, position) => {
        const snippet = message.content.replace(/\s+/g, " ").trim().slice(0, 80);
        const label = tf("Turn {number}", { number: String(position + 1) }) + (snippet ? " · " + snippet : "");
        return <button key={index} type="button" className="chat-turn-mark" title={label} aria-label={label}
          aria-current={currentTurn === index ? "location" : undefined} onClick={() => goToTurn(index)} />;
      })}
    </nav>}
    {!atLatest && <button type="button" className="btn chat-latest" onClick={goToLatest}>{t("Back to latest")} ↓</button>}
  </div>;
}

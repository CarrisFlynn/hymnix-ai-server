import { useEffect, useMemo, useRef, useState } from "react";
import { t, tf } from "./i18n";
import { qrSvg } from "./qr";
import { MODEL_CATALOG } from "./model-catalog-data";
import { estimateVramGiB } from "./model-catalog";
import { passwordStrength } from "./lib/pure.js";

/* ---------------------------------------------------------------- tooltip */

type TipState = { label: string; x: number; y: number } | null;

/**
 * One delegated tooltip layer for the whole app: appears after 400 ms on hover,
 * instantly when moving between neighbouring targets, and on keyboard focus.
 * Targets opt in with `data-tip="Label"` (and optionally `data-tip-key="Ctrl K"`).
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastTarget = useRef<Element | null>(null);

  useEffect(() => {
    const target = (node: EventTarget | null): HTMLElement | null => {
      const element = node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;
      return element && !element.hasAttribute("disabled") ? element : null;
    };
    const show = (element: HTMLElement, immediate: boolean) => {
      const label = element.dataset.tip || "";
      if (!label) return;
      window.clearTimeout(timer.current);
      const place = () => {
        const box = element.getBoundingClientRect();
        setTip({ label: label + (element.dataset.tipKey ? ` · ${element.dataset.tipKey}` : ""), x: box.left + box.width / 2, y: box.top });
      };
      if (immediate) place();
      else timer.current = window.setTimeout(place, 400);
      lastTarget.current = element;
    };
    const hide = () => { window.clearTimeout(timer.current); setTip(null); lastTarget.current = null; };

    const onOver = (event: PointerEvent) => {
      const element = target(event.target);
      if (!element || element === lastTarget.current) return;
      show(element, lastTarget.current != null && lastTarget.current.closest("[data-tip-group]") === element.closest("[data-tip-group]"));
    };
    const onFocus = (event: FocusEvent) => {
      const element = target(event.target);
      if (element) show(element, true);
    };
    const onOut = (event: PointerEvent) => {
      if (!target(event.target)) return;
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-tip]")) return;
      hide();
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip) return null;
  const below = tip.y < 64;
  // Keep the tooltip inside the viewport. It is centred on the anchor, so a button
  // near the right edge used to lose about 120px of its hint to overflow: hidden.
  // The half-width is estimated from the label because this renders before layout.
  const half = Math.min(140, Math.max(56, tip.label.length * 3.5));
  const margin = 8;
  const left = Math.max(margin + half, Math.min(window.innerWidth - margin - half, tip.x));
  return <div className="tooltip" role="tooltip" style={{ left, top: below ? tip.y + 38 : tip.y - 10, transform: "translate(-50%, -100%)" }} data-flip={below ? "down" : "up"}>{tip.label}</div>;
}

/* --------------------------------------------------------------- skeleton */

export function Skeleton({ rows = 3, width = "100%" }: { rows?: number; width?: string }) {
  return <div className="skeleton" aria-hidden="true" style={{ width }}>
    {Array.from({ length: rows }, (_, index) => <span key={index} style={{ width: index === rows - 1 ? "62%" : "100%" }} />)}
  </div>;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton-list" role="status" aria-label={t("Loading...")}>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton-dot" /><Skeleton rows={2} /></div>)}
  </div>;
}

/* -------------------------------------------------------------- combobox */

export type ModelOption = { name: string; loaded?: boolean; size?: number };

type CatalogMeta = { vram: number; capabilities: string[] };

const CATALOG_META: Record<string, CatalogMeta> = Object.fromEntries(
  MODEL_CATALOG.map((entry) => {
    const capabilities = [entry.use];
    return [entry.name, { vram: Math.round(estimateVramGiB(entry) * 10) / 10, capabilities }];
  })
);

function modelMeta(name: string): CatalogMeta | null {
  if (CATALOG_META[name]) return CATALOG_META[name];
  const base = name.replace(/:latest$/, "");
  return CATALOG_META[base] || CATALOG_META[base + ":latest"] || null;
}

export function ModelCombobox({ value, options, gpuGb, onChange, onDownload, disabled = false }: {
  value: string;
  options: ModelOption[];
  gpuGb?: number | null;
  onChange: (name: string) => void;
  onDownload?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = options.map((option) => ({
      ...option,
      meta: modelMeta(option.name),
      fits: !!(gpuGb && modelMeta(option.name) && modelMeta(option.name)!.vram <= gpuGb),
    }));
    if (!needle) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
  }, [options, query, gpuGb]);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    window.setTimeout(() => input.current?.focus(), 0);
  }, [open, query]);

  function commit(name: string) {
    onChange(name);
    setOpen(false);
    setQuery("");
  }

  return <div className="combobox" ref={wrap} onBlur={(event) => { if (!wrap.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" className="combobox-trigger" role="combobox" aria-expanded={open} aria-haspopup="listbox" disabled={disabled}
      data-tip={t("Choose a model")} onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(true); }
      }}>
      <span className="combobox-value">{value || t("Choose a model")}</span>
      <span className="combobox-caret" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="combobox-pop">
      <input ref={input} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search models")}
        aria-label={t("Search models")} aria-controls="model-combobox-list" aria-autocomplete="list"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => filtered.length ? (index + 1) % filtered.length : 0); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => filtered.length ? (index - 1 + filtered.length) % filtered.length : 0); }
          else if (event.key === "Enter" && filtered.length) { event.preventDefault(); commit(filtered[Math.min(active, filtered.length - 1)].name); }
          else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        }} />
      <div className="combobox-list" role="listbox" id="model-combobox-list" aria-label={t("Models")}>
        {filtered.length ? filtered.map((row, index) => <button type="button" role="option" aria-selected={row.name === value} key={row.name}
          className={"combobox-option" + (index === active ? " active" : "") + (row.name === value ? " selected" : "")}
          onMouseEnter={() => setActive(index)} onClick={() => commit(row.name)}>
          <span className="combobox-option-main"><strong>{row.name}</strong><small>{row.loaded ? t("Loaded") : t("Installed")}{row.meta ? ` · ~${row.meta.vram} GiB` : ""}</small></span>
          <span className="combobox-tags">
            {row.meta?.capabilities.slice(0, 2).map((cap) => <span className="chip" key={cap}>{t(cap)}</span>)}
            {row.fits && <span className="chip accent">{tf("Fits your {gb} GB GPU", { gb: String(gpuGb) })}</span>}
          </span>
        </button>) : <div className="combobox-empty"><span>{t("No matching models")}</span>{onDownload && <button type="button" className="btn ghost" onClick={() => { setOpen(false); onDownload(); }}>{t("Download a model")}</button>}</div>}
      </div>
    </div>}
  </div>;
}

/* --------------------------------------------------------------- password */

export { passwordStrength } from "./lib/pure.js";

export function PasswordMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  return <div className="password-meter" data-score={score} role="status" aria-live="polite">
    <span className="password-meter-bars">{[0, 1, 2, 3].map((index) => <i key={index} className={index < score ? "on" : ""} />)}</span>
    <span className="password-meter-label">{t(label === "empty" ? "No password yet" : label === "weak" ? "Weak password" : label === "fair" ? "Fair password" : label === "good" ? "Good password" : "Strong password")}</span>
  </div>;
}

/* --------------------------------------------------------------------- QR */

export function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const svg = useMemo(() => {
    try { return qrSvg(text); } catch { return null; }
  }, [text]);
  if (!svg) return null;
  return <div className="qr-code" role="img" aria-label={t("QR code for the public link")}>
    <svg viewBox={svg.viewBox} width={size} height={size} shapeRendering="crispEdges"><path d={svg.path} fill="currentColor" /></svg>
  </div>;
}

/* --------------------------------------------------------------- error UI */

export function ErrorPanel({ title, cause, fix, onFix, details }: {
  title: string; cause?: string; fix?: string; onFix?: () => void; details?: string;
}) {
  return <div className="error-panel" role="alert">
    <span className="error-panel-icon" aria-hidden="true">!</span>
    <div className="error-panel-copy">
      <strong>{title}</strong>
      {cause && <span>{cause}</span>}
    </div>
    {fix && onFix && <button type="button" className="btn" onClick={onFix}>{fix}</button>}
    {details && <button type="button" className="panel-link" onClick={() => void navigator.clipboard?.writeText(details)}>{t("Copy details")}</button>}
  </div>;
}

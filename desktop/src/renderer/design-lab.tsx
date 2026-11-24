import { useState } from "react";
import { t } from "./i18n";
import { PasswordMeter, QrCode, Skeleton, SkeletonList, ErrorPanel, ModelCombobox, TooltipLayer } from "./components";

/**
 * Dev-only component gallery (plan §13.1). Renders every component in every state
 * against the active theme, with Light/Dark and 中文/English switches, and doubles
 * as the target for the Playwright visual baselines.
 */
export function DesignLab({ lang, mode, onLang, onMode, onTheme, themes }: {
  lang: "en" | "zh";
  mode: "light" | "dark";
  onLang: (lang: "en" | "zh") => void;
  onMode: (mode: "light" | "dark") => void;
  onTheme: (id: string) => void;
  themes: Array<{ id: string; mode: "light" | "dark"; label: string }>;
}) {
  const [demo, setDemo] = useState("qwen3:8b");
  const [password, setPassword] = useState("hymnix-orbit-2026");
  const [toggle, setToggle] = useState(true);
  const [segment, setSegment] = useState("local");
  const [progress, setProgress] = useState(64);

  return <section className="view-page design-lab">
    <div className="view-heading">
      <div><label>DESIGN LAB</label><h2>{t("Component gallery")}</h2><p>{t("Every component in every state, in every theme.")}</p></div>
      <div className="header-actions">
        <div className="segmented" role="group" aria-label={t("Theme mode")}>
          <button className={mode === "light" ? "active" : ""} onClick={() => onMode("light")}>{t("Light")}</button>
          <button className={mode === "dark" ? "active" : ""} onClick={() => onMode("dark")}>{t("Dark")}</button>
        </div>
        <div className="segmented" role="group" aria-label={t("Language")}>
          <button className={lang === "zh" ? "active" : ""} onClick={() => onLang("zh")}>中文</button>
          <button className={lang === "en" ? "active" : ""} onClick={() => onLang("en")}>English</button>
        </div>
      </div>
    </div>

    <div className="lab-themes">{themes.map((theme) => <button key={theme.id} className={"chip" + (theme.mode === mode ? "" : " muted")} onClick={() => onTheme(theme.id)}>{t(theme.label)}</button>)}</div>

    <div className="lab-grid">
      <section className="card lab-section">
        <h3 className="card-title">{t("Buttons")}</h3>
        <div className="lab-row">
          <button className="btn primary">{t("Primary")}</button>
          <button className="btn">{t("Secondary")}</button>
          <button className="btn tonal">{t("Tonal")}</button>
          <button className="btn ghost">{t("Ghost")}</button>
          <button className="btn danger">{t("Danger")}</button>
          <button className="btn link">{t("Link")}</button>
        </div>
        <div className="lab-row">
          <button className="btn primary" disabled>{t("Disabled")}</button>
          <button className="btn loading" aria-busy="true"><span className="orbit-loader" aria-hidden="true" />{t("Starting...")}</button>
          <button className="btn success">✓ {t("Copied")}</button>
          <button className="btn primary pressed">{t("Pressed")}</button>
          <button className="btn icon" data-tip={t("Tooltip")} data-tip-key="Ctrl K" aria-label={t("Tooltip")}>⌕</button>
        </div>
        <div className="lab-row"><select className="btn"><option>{t("Select")}</option></select><input placeholder={t("Text input")} /><input type="password" placeholder={t("Password")} /></div>
      </section>

      <section className="card lab-section">
        <h3 className="card-title">{t("Status")}</h3>
        <div className="lab-row">
          <span className="status-pill success"><span className="status-dot" />{t("Ready")}</span>
          <span className="status-pill accent"><span className="orbit-loader" aria-hidden="true" />{t("Starting")}</span>
          <span className="status-pill warning"><span className="status-dot" />{t("Limited")}</span>
          <span className="status-pill neutral"><span className="status-dot" />{t("Off")}</span>
          <span className="status-pill danger"><span className="status-dot" />{t("Error")}</span>
        </div>
        <div className="lab-row"><span className="chip">{t("Vision")}</span><span className="chip">{t("Tools")}</span><span className="chip accent">{t("Fits your 8 GB GPU")}</span><span className="chip warning">{t("Restart needed")}</span><span className="chip">{t("Beta")}</span></div>
        <div className="lab-row"><span className="avatar">U</span><span className="avatar brand">✦</span><span className="model-chip">qwen3:8b</span><kbd>Ctrl K</kbd></div>
      </section>

      <section className="card lab-section">
        <h3 className="card-title">{t("Controls")}</h3>
        <div className="setting-row"><label>{t("Toggle")}</label><div className="controls"><button className={"switch" + (toggle ? " on" : "")} aria-pressed={toggle} aria-label={t("Toggle")} onClick={() => setToggle((value) => !value)}><span /></button></div></div>
        <div className="setting-row"><label>{t("Segmented")}</label><div className="controls"><div className="segmented">{[["local", t("Local model")], ["cloud", t("Cloud API")]].map(([value, label]) => <button key={value} className={segment === value ? "active" : ""} onClick={() => setSegment(value)}>{label}</button>)}</div></div></div>
        <div className="setting-row"><label>{t("Slider")}</label><div className="controls scale-control"><input type="range" min={0} max={100} value={progress} onChange={(event) => setProgress(Number(event.target.value))} aria-label={t("Slider")} /><output>{progress}%</output></div></div>
        <div className="setting-row"><label>{t("Model")}</label><div className="controls"><ModelCombobox value={demo} options={[{ name: "qwen3:8b", loaded: true }, { name: "qwen3:14b" }, { name: "llama3.2:3b" }]} gpuGb={8} onChange={setDemo} /></div></div>
        <div className="setting-row"><label>{t("Password")}</label><div className="controls"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-label={t("Password")} /></div></div>
        <PasswordMeter password={password} />
      </section>

      <section className="card lab-section">
        <h3 className="card-title">{t("Feedback")}</h3>
        <div className="inline-alert"><span aria-hidden="true">✦</span><div><strong>{t("Inline alert")}</strong><small>{t("One line of help and a single action.")}</small></div><button className="btn">{t("Action")}</button></div>
        <ErrorPanel title={t("Can't reach the model service")} cause={t("It may not be running.")} fix={t("Start Ollama")} onFix={() => undefined} details="gateway=off" />
        <div className="lab-progress"><div className="progress"><i style={{ width: progress + "%" }} /></div><span>{progress}% · 12.4 MB/s · 18s left</span></div>
        <div className="progress indeterminate"><i /></div>
        <div className="lab-row"><div className="toast static"><span>{t("Conversation cleared")}</span><button type="button">{t("Undo")}</button></div></div>
        <Skeleton rows={3} />
        <SkeletonList rows={2} />
        <div className="empty-state lab-empty"><strong>{t("No model installed yet.")}</strong><span>{t("Choose a model that fits your hardware.")}</span><button className="btn primary">{t("Discover models")}</button></div>
      </section>

      <section className="card lab-section">
        <h3 className="card-title">{t("Overlays")}</h3>
        <div className="lab-overlay-preview">
          <div className="confirm-dialog static"><div className="dialog-icon">!</div><h2>{t("Delete model")}</h2><p>{t("This cannot be undone.")}</p><div className="dialog-actions"><button className="btn">{t("Cancel")}</button><button className="btn danger">{t("Delete model")}</button></div></div>
          <div className="status-popover static"><strong>{t("Ready")}</strong><span>gateway 1.3.3</span><button type="button">{t("View monitor")}</button></div>
        </div>
      </section>

      <section className="card lab-section">
        <h3 className="card-title">{t("QR code")}</h3>
        <QrCode text="https://example.trycloudflare.com" size={140} />
      </section>

      <section className="card lab-section">
        <h3 className="card-title">{t("Typography")}</h3>
        <p className="lab-type"><span style={{ fontSize: 28 }}>{t("Welcome to Hymnix Orbit")}</span><span style={{ fontSize: 20 }}>{t("Page title")}</span><span style={{ fontSize: 15 }}>{t("Chat message body at 15px with 1.65 line height.")}</span><span style={{ fontSize: 13 }}>{t("Secondary text")}</span><span style={{ fontSize: 12 }}>{t("Caption · 0123456789")}</span><code>const orbit = "mono";</code></p>
      </section>
    </div>
    <TooltipLayer />
  </section>;
}

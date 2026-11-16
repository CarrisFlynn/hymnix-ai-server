import fs from "node:fs";
const file="src/renderer/main.tsx";
let s=fs.readFileSync(file,"utf8");

// 1) extra state
s=s.replace('const [startupNote, setStartupNote] = useState("");',
`const [startupNote, setStartupNote] = useState("");
  const [role, setRole] = useState<"host" | "guest">("host");
  const [serverBase, setServerBase] = useState("http://127.0.0.1:11435");
  const [hostName, setHostName] = useState("");
  const [hostPassword, setHostPassword] = useState("");
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [netBusy, setNetBusy] = useState(false);
  const [netError, setNetError] = useState("");`);

// 2) helpers before renderSettings
s=s.replace('  function renderSettings() {',
`  async function loadNetwork() {
    try { const info: any = await window.hymnix.network.info(); setHostName(String(info?.host_name || "")); setHostPassword(String(info?.host_password || "")); setTunnelUrl(String(info?.tunnel || "")); }
    catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function toggleTunnel(start: boolean) {
    setNetBusy(true); setNetError("");
    try { const result: any = await window.hymnix.network.tunnel(start ? "start" : "stop"); setTunnelUrl(String(result?.tunnel || "")); }
    catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setNetBusy(false); }
  }
  async function guestConnect(): Promise<boolean> {
    setNetBusy(true); setNetError("");
    try { const result: any = await window.hymnix.network.login(serverBase.trim(), guestName.trim(), guestPassword); setApiKey(String(result?.token || "")); setMode("remote"); return true; }
    catch (reason) { setNetError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setNetBusy(false); }
  }
  function renderSettings() {`);

// 3) replace welcome body
const startMarker='  function renderWelcome() {';
const endMarker='  function renderSettings() {';
const a=s.indexOf(startMarker), b=s.indexOf(endMarker,a);
const welcome=`  function renderWelcome() {
    const finish = async () => { if (role === "guest") { const ok = await guestConnect(); if (!ok) return; } finishWelcome(); };
    return <div className="welcome-mask" role="dialog" aria-modal="true" aria-label={t("Welcome")}>
      <div className="welcome-card">
        <div className="welcome-brand"><img src={brandIcon} alt="" /><div><strong>Hymnix Orbit</strong><small>1.3.0</small></div></div>
        <h2>{t("Welcome to Hymnix Orbit")}</h2>
        <p>{t("Share this machine's models with friends, or connect to a friend's machine.")}</p>
        <div className="setting-row"><label>{t("Language")}</label><div className="controls segmented"><button className={lang === "en" ? "active" : ""} onClick={() => changeLang("en")}>English</button><button className={lang === "zh" ? "active" : ""} onClick={() => changeLang("zh")}>中文</button></div></div>
        <div className="setting-row"><label>{t("This device")}</label><div className="controls segmented"><button className={role === "host" ? "active" : ""} onClick={() => setRole("host")}>{t("Host a server")}</button><button className={role === "guest" ? "active" : ""} onClick={() => setRole("guest")}>{t("Connect to a friend")}</button></div></div>
        {role === "host" ? <div className="card" style={{ margin: "0 0 12px" }}>
          <div className="setting-row"><label>{t("Share name")}</label><div className="controls"><input value={hostName} onChange={(event) => setHostName(event.target.value)} placeholder="Hymnix Orbit" /><button className="btn" onClick={() => void loadNetwork()}>{t("Refresh")}</button></div></div>
          <div className="setting-row"><label>{t("Share password")}<span className="hint">{t("friends type this")}</span></label><div className="controls"><input readOnly value={hostPassword} /><button className="btn" onClick={() => void navigator.clipboard?.writeText(hostPassword)}>{t("Copy")}</button></div></div>
          <div className="setting-row"><label>{t("Public tunnel")}</label><div className="controls"><input readOnly value={tunnelUrl || t("Not started")} /><button className="btn primary" onClick={() => void toggleTunnel(!tunnelUrl)} disabled={netBusy}>{tunnelUrl ? t("Stop tunnel") : t("Start tunnel")}</button></div></div>
          <p className="subtitle">{t("Friends connect with this address, name and password. Their chats run on your hardware.")}</p>
        </div> : <div className="card" style={{ margin: "0 0 12px" }}>
          <div className="setting-row"><label>{t("Server address")}</label><div className="controls"><input value={serverBase} onChange={(event) => setServerBase(event.target.value)} placeholder="https://xxxx.trycloudflare.com" /></div></div>
          <div className="setting-row"><label>{t("Share name")}</label><div className="controls"><input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Hymnix Orbit" /></div></div>
          <div className="setting-row"><label>{t("Share password")}</label><div className="controls"><input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} /></div></div>
          <p className="subtitle">{t("Your chats will run on the friend's hardware.")}</p>
        </div>}
        {netError && <p className="error">{netError}</p>}
        <div className="welcome-actions"><button className="btn primary" onClick={() => void finish()} disabled={netBusy}>{netBusy ? t("Working...") : role === "guest" ? t("Connect") : t("Start using Hymnix Orbit")}</button></div>
      </div>
    </div>;
  }
`;
s=s.slice(0,a)+welcome+s.slice(b);
fs.writeFileSync(file,s);
console.log("welcome_replaced");

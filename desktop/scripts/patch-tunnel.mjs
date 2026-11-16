import fs from "node:fs";
const file="server/gateway_core.py";
let s=fs.readFileSync(file,"utf8");
const a=s.indexOf("    def _admin_tunnel(self):");
const b=s.indexOf("    def do_OPTIONS(self):",a);
if(a<0||b<0) throw new Error("markers");
const block=`
    def _admin_tunnel(self):
        body = self._read_body()
        try:
            payload = json.loads(body.decode("utf-8", "ignore") or "{}")
        except Exception:
            payload = {}
        action = str((payload or {}).get("action") or "start").strip().lower()
        if action == "stop":
            stop_tunnel()
            return self._admin_tunnel_status()
        if action == "restart":
            stop_tunnel()
        state = start_tunnel()
        return self._json(200, state)

    def _admin_tunnel_status(self):
        return self._json(200, tunnel_status())

`;
s=s.slice(0,a)+block+s.slice(b);

// add tunnel machinery after TUNNEL_STATE definition
s=s.replace('TUNNEL_STATE = {"proc": None}', `TUNNEL_STATE = {"proc": None, "state": "off", "url": "", "started_ever": False, "stopped": False, "log": [], "watchdog": False}
TUNNEL_LOG = []


def _tunnel_note(text):
    TUNNEL_LOG.append("[%s] %s" % (time.strftime("%H:%M:%S"), text))
    if len(TUNNEL_LOG) > 60:
        del TUNNEL_LOG[: len(TUNNEL_LOG) - 60]
    TUNNEL_STATE["log"] = list(TUNNEL_LOG)


def _cloudflared_path():
    here = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
    candidates = [
        os.path.join(here, "cloudflared.exe"),
        os.path.join(BASE_DIR, "cloudflared.exe"),
        os.path.join(os.path.dirname(here), "cloudflared.exe"),
        os.path.join(os.path.dirname(BASE_DIR), "cloudflared.exe"),
    ]
    for item in candidates:
        if os.path.exists(item):
            return item
    return ""


def _tunnel_pump(proc):
    import re as _re
    pattern = _re.compile(r"https://[a-z0-9-]+\\.trycloudflare\\.com")
    try:
        for raw in iter(proc.stdout.readline, b""):
            if not raw:
                break
            line = raw.decode("utf-8", "ignore").strip()
            if not line:
                continue
            _tunnel_note(line[:200])
            match = pattern.search(line)
            if match:
                TUNNEL_STATE["url"] = match.group(0)
                TUNNEL_STATE["state"] = "up"
                try:
                    with open(TUNNEL_FILE, "w", encoding="utf-8") as handle:
                        handle.write(TUNNEL_STATE["url"])
                except Exception:
                    pass
                _tunnel_note("ready: " + TUNNEL_STATE["url"])
    except Exception as exc:
        _tunnel_note("pump error: %s" % exc)


def _tunnel_watchdog():
    time.sleep(30)
    while True:
        try:
            if TUNNEL_STATE.get("started_ever") and not TUNNEL_STATE.get("stopped"):
                proc = TUNNEL_STATE.get("proc")
                if proc is None or proc.poll() is not None:
                    _tunnel_note("tunnel lost, reconnecting")
                    start_tunnel()
        except Exception:
            pass
        time.sleep(20)


def start_tunnel():
    proc = TUNNEL_STATE.get("proc")
    if proc is not None and proc.poll() is None:
        return tunnel_status()
    exe = _cloudflared_path()
    if not exe:
        TUNNEL_STATE["state"] = "failed"
        _tunnel_note("cloudflared.exe not found")
        return tunnel_status()
    port = int(CFG.get("listen_port") or 11435)
    try:
        proc = subprocess.Popen(
            [exe, "tunnel", "--url", "http://127.0.0.1:%d" % port, "--no-autoupdate"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as exc:
        TUNNEL_STATE["state"] = "failed"
        _tunnel_note("spawn failed: %s" % exc)
        return tunnel_status()
    TUNNEL_STATE["proc"] = proc
    TUNNEL_STATE["state"] = "starting"
    TUNNEL_STATE["url"] = ""
    TUNNEL_STATE["started_ever"] = True
    TUNNEL_STATE["stopped"] = False
    _tunnel_note("spawned cloudflared pid=%s" % proc.pid)
    threading.Thread(target=_tunnel_pump, args=(proc,), daemon=True).start()
    if not TUNNEL_STATE.get("watchdog"):
        TUNNEL_STATE["watchdog"] = True
        threading.Thread(target=_tunnel_watchdog, daemon=True).start()
    return tunnel_status()


def stop_tunnel():
    proc = TUNNEL_STATE.get("proc")
    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
    TUNNEL_STATE["proc"] = None
    TUNNEL_STATE["state"] = "off"
    TUNNEL_STATE["url"] = ""
    TUNNEL_STATE["stopped"] = True
    try:
        if os.path.exists(TUNNEL_FILE):
            os.remove(TUNNEL_FILE)
    except Exception:
        pass
    _tunnel_note("stopped")
    return tunnel_status()


def tunnel_status():
    proc = TUNNEL_STATE.get("proc")
    alive = proc is not None and proc.poll() is None
    state = TUNNEL_STATE.get("state") or "off"
    if state == "up" and not alive:
        state = "lost"
    return {
        "ok": True,
        "state": state,
        "url": TUNNEL_STATE.get("url") or "",
        "pid": getattr(proc, "pid", None) if alive else None,
        "log": TUNNEL_STATE.get("log") or [],
    }`);
fs.writeFileSync(file,s);
console.log("tunnel_rewritten");

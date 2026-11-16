import fs from "node:fs";
const file="src/renderer/main.tsx";
let s=fs.readFileSync(file,"utf8");
const a=s.indexOf("  async function runTerm() {");
const b=s.indexOf("  async function copyLastReply() {",a);
if(a<0||b<0) throw new Error("markers");
const block=`
  function termOut(tag: "sys" | "out" | "err", text: string) {
    setTermEntries((current) => [...current, { time: stamp(), tag, text }]);
  }

  async function runTerm() {
    const raw = termCmd.trim();
    if (!raw || termBusy) return;
    termOut("sys", "> " + raw);
    setTermCmd("");
    termHistory.current = [...termHistory.current, raw];
    termCursor.current = termHistory.current.length;
    const [cmd, ...args] = raw.split(/\\s+/);
    const name = cmd.toLowerCase();
    try {
      switch (name) {
        case "help":
          termOut("sys", "help · status · version · models · model <name> · start <name> · stop <name> · pull <name>");
          termOut("sys", "tunnel on|off|restart|status · hardware · ps · dir · logtail · export · open <url>");
          termOut("sys", "config · get <key> · set <key> <value> · quota <n> · billing on|off · lang en|zh · clear");
          termOut("sys", "其它命令交给工作区 shell 执行");
          return;
        case "clear":
          setTermEntries([]);
          return;
        case "status":
          termOut("sys", "gateway=" + state + " models=" + models.length + " model=" + (model || "-") + " cwd=" + (filesRoot || "-"));
          termOut("sys", "tunnel=" + tunnelState + " url=" + (tunnelUrl || "-"));
          return;
        case "version":
          termOut("sys", "Hymnix Orbit 1.3.0 · gateway " + (health?.gateway || "-") + " · electron " + (navigator.userAgent.match(/Electron\/([0-9.]+)/)?.[1] || "-"));
          return;
        case "models":
          termOut("sys", models.length ? models.map((item) => item.name + (item.loaded ? "*" : "")).join("  ") : "没有已安装模型");
          return;
        case "model": {
          if (!args[0]) { termOut("err", "usage: model <name>"); return; }
          setModel(args[0]);
          termOut("sys", "current model = " + args[0]);
          return;
        }
        case "start":
        case "stop": {
          if (!args[0]) { termOut("err", "usage: " + name + " <name>"); return; }
          await modelAction(name === "start" ? "start" : "stop", args[0]);
          termOut("sys", name + " " + args[0] + " -> done");
          return;
        }
        case "pull": {
          if (!args[0]) { termOut("err", "usage: pull <name>"); return; }
          setPullName(args[0]);
          await pullModel();
          termOut("sys", "pull " + args[0] + " -> requested");
          return;
        }
        case "tunnel": {
          const action = (args[0] || "status").toLowerCase();
          if (action === "status") { termOut("sys", "tunnel=" + tunnelState + " url=" + (tunnelUrl || "-")); return; }
          if (action === "on" || action === "start") { applyTunnel(await window.hymnix.network.tunnel("start")); termOut("sys", "tunnel starting"); return; }
          if (action === "off" || action === "stop") { applyTunnel(await window.hymnix.network.tunnel("stop")); termOut("sys", "tunnel stopped"); return; }
          if (action === "restart") { applyTunnel(await window.hymnix.network.tunnel("restart")); termOut("sys", "tunnel restarted"); return; }
          termOut("err", "usage: tunnel on|off|restart|status");
          return;
        }
        case "hardware":
          termOut("sys", "gpu=" + (stats?.gpu ?? "-") + "% vram=" + (stats?.vramUsed ?? "-") + "/" + (stats?.vramTotal ?? "-") + "G ram=" + (stats ? (stats.ramUsed / 1024).toFixed(1) : "-") + "/" + (stats ? (stats.ramTotal / 1024).toFixed(1) : "-") + "G");
          return;
        case "ps": {
          const result = await window.hymnix.terminal.start({ command: "tasklist /FO CSV /NH | findstr /I \"ollama cloudflared hymnix\"", cwd: filesRoot || undefined, policy: "workspace" });
          termId.current = result.id;
          setTermBusy(true);
          return;
        }
        case "dir": {
          const result = await window.hymnix.terminal.start({ command: "dir", cwd: filesRoot || undefined, policy: "workspace" });
          termId.current = result.id;
          setTermBusy(true);
          return;
        }
        case "logtail":
          if (!tunnelLog.length) { termOut("sys", "隧道日志为空（先 tunnel on）"); return; }
          tunnelLog.slice(-12).forEach((line) => termOut("out", line));
          return;
        case "config": {
          if (args[0] === "set") {
            const key = args[1];
            const value = args.slice(2).join(" ");
            if (!key || value === "") { termOut("err", "usage: set <key> <value>"); return; }
            const parsed = value === "true" ? true : value === "false" ? false : /^-?\\d+$/.test(value) ? Number(value) : value;
            const result: any = await window.hymnix.config.set({ [key]: parsed });
            termOut(result?.ok ? "sys" : "err", "set " + key + " = " + JSON.stringify((result?.changed || {})[key] ?? value) + (result?.rejected?.length ? " rejected=" + result.rejected.join(",") : ""));
            return;
          }
          const info: any = await window.hymnix.config.get();
          Object.entries(info?.values || {}).forEach(([key, value]) => termOut("out", key + " = " + JSON.stringify(value)));
          return;
        }
        case "get": {
          if (!args[0]) { termOut("err", "usage: get <key>"); return; }
          const info: any = await window.hymnix.config.get();
          const value = (info?.values || {})[args[0]];
          termOut(value === undefined ? "err" : "sys", args[0] + " = " + JSON.stringify(value ?? null));
          return;
        }
        case "quota": {
          if (!args[0]) { termOut("err", "usage: quota <n>"); return; }
          const result: any = await window.hymnix.config.set({ daily_quota_tokens: Number(args[0]) });
          termOut("sys", "daily_quota_tokens = " + (result?.changed?.daily_quota_tokens ?? "?"));
          return;
        }
        case "billing": {
          const on = (args[0] || "on").toLowerCase() !== "off";
          const result: any = await window.hymnix.config.set({ billing_enabled: on });
          termOut("sys", "billing_enabled = " + String(result?.changed?.billing_enabled));
          return;
        }
        case "lang": {
          const next = (args[0] || "zh").toLowerCase() === "en" ? "en" : "zh";
          changeLang(next as Lang);
          termOut("sys", "lang = " + next);
          return;
        }
        case "open": {
          if (!args[0]) { termOut("err", "usage: open <url>"); return; }
          await window.hymnix.system.openExternal(args[0]);
          termOut("sys", "opened " + args[0]);
          return;
        }
        case "export": {
          const text = messages.map((item) => (item.role === "user" ? "You" : "Hymnix Orbit") + " [" + (item.at || "") + "]\\n" + item.content).join("\\n\\n");
          const blob = new Blob([text || "empty"], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url; link.download = "hymnix-chat.txt"; link.click();
          URL.revokeObjectURL(url);
          termOut("sys", "exported hymnix-chat.txt");
          return;
        }
        default: {
          setTermBusy(true);
          const result = await window.hymnix.terminal.start({ command: raw, cwd: filesRoot || undefined, policy: "workspace" });
          termId.current = result.id;
          return;
        }
      }
    } catch (reason) {
      termOut("err", reason instanceof Error ? reason.message : String(reason));
    }
  }

`;
s=s.slice(0,a)+block+s.slice(b);
fs.writeFileSync(file,s);
console.log("runterm_replaced");

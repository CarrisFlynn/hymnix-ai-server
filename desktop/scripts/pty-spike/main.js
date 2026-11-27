const { app } = require("electron");

/** Throwaway spike: can Electron 45 load node-pty and open a real ConPTY? */
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  let pty;
  try {
    pty = require("node-pty");
    console.log("SPIKE_LOAD ok");
  } catch (error) {
    console.log("SPIKE_LOAD failed: " + (error && error.message ? error.message : error));
    app.exit(2);
    return;
  }
  let term;
  try {
    term = pty.spawn("cmd.exe", [], { name: "xterm-256color", cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
    console.log("SPIKE_SPAWN pid=" + term.pid);
  } catch (error) {
    console.log("SPIKE_SPAWN failed: " + (error && error.message ? error.message : error));
    app.exit(3);
    return;
  }
  let buffer = "";
  let answered = false;
  term.onData((data) => {
    buffer += data;
    if (!answered && /hello-from-pty/i.test(buffer)) { answered = true; console.log("SPIKE_OUTPUT ok"); }
  });
  setTimeout(() => term.write("echo hello-from-pty\r"), 400);
  setTimeout(() => {
    console.log("SPIKE_ANSI " + (/\x1b\[/.test(buffer) ? "has-escapes" : "no-escapes"));
    console.log("SPIKE_RESIZE " + (typeof term.resize === "function" ? "supported" : "missing"));
    try { term.resize(120, 40); console.log("SPIKE_RESIZE ok"); } catch (e) { console.log("SPIKE_RESIZE failed"); }
    console.log("SPIKE_RESULT " + (answered ? "PASS" : "NO-OUTPUT"));
    try { term.kill(); } catch {}
    app.exit(answered ? 0 : 4);
  }, 2200);
});

import fs from "node:fs";
const css=`
.panel-card i, .context-card i {
  display: inline-block; width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%;
  background: #c0aeb2; vertical-align: middle; margin-right: 6px;
}
.panel-card i.ready { background: #1f8a5f; }
.panel-card i.error { background: #cc3348; }
.panel-card i.connecting { background: #d09128; }
.panel-card i.degraded { background: #d09128; }
.shell.terminal-mode .main.terminal-main { display: flex; overflow: hidden; }
.terminal-main .term-shell { flex: 1 1 auto; }
`;
fs.appendFileSync("src/renderer/styles.css", css);
console.log("css_ok");

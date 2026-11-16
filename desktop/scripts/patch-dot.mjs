import fs from "node:fs";
fs.appendFileSync("src/renderer/styles.css", `
.dot { display: inline-block; width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #c0aeb2; margin-right: 6px; vertical-align: middle; }
.dot.ready { background: #1f8a5f; }
.dot.connecting { background: #d09128; }
.dot.degraded { background: #d09128; }
.dot.error { background: #cc3348; }
`);
console.log("dot_css_ok");

import fs from "node:fs";
fs.appendFileSync("src/renderer/styles.css", `
.dot { display: inline-block; width: 7px; height: 7px; min-width: 7px; flex: 0 0 7px; border-radius: 50%; background: #c0aeb2; margin-right: 6px; font-size: 0; line-height: 0; }
.dot[data-state="ready"] { background: #1f8a5f; }
.dot[data-state="connecting"] { background: #d09128; }
.dot[data-state="degraded"] { background: #d09128; }
.dot[data-state="error"] { background: #cc3348; }
.conn-chip .dot { margin-right: 4px; }
`);
console.log("dot2_ok");

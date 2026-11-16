import fs from "node:fs";
fs.appendFileSync("src/renderer/styles.css", `
/* terminal mode hides the inspector column entirely */
.shell.terminal-mode { grid-template-columns: 264px minmax(0, 1fr) !important; }
.shell.terminal-mode .inspect { display: none !important; }
.side-status .dot, .connection .dot, .inline-status .dot, .panel-card .dot {
  display: inline-block !important; width: 7px !important; height: 7px !important;
  min-width: 7px !important; flex: 0 0 7px !important; border-radius: 50% !important;
  background: #c0aeb2; margin-right: 6px; padding: 0; line-height: 0;
}
.side-status .dot.ready, .connection .dot.ready, .panel-card .dot.ready { background: #1f8a5f; }
.side-status .dot.error, .connection .dot.error, .panel-card .dot.error { background: #cc3348; }
.side-status .dot.connecting, .side-status .dot.degraded { background: #d09128; }
`);
console.log("css3_ok");

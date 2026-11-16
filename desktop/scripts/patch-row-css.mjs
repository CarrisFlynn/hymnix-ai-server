import fs from "node:fs";
fs.appendFileSync("src/renderer/styles.css", `
.setting-row .controls { flex-wrap: nowrap; }
.setting-row .controls input { min-width: 0; }
.setting-row .controls .btn { white-space: nowrap; }
`);
console.log("row_css_ok");

import fs from "node:fs";
const file = "src/renderer/i18n.ts";
const src = fs.readFileSync(file, "utf8");
const start = src.indexOf("export const zh: Record<string, string> = {");
const open = src.indexOf("{", start);
const end = src.indexOf("\n};", open);
const body = src.slice(open + 1, end);
let obj;
try { obj = eval("({" + body + "})"); } catch (error) { console.error("PARSE_FAILED", String(error).slice(0,200)); process.exit(1); }
const keys = Object.keys(obj).sort();
const rendered = keys.map((k) => "  " + JSON.stringify(k) + ": " + JSON.stringify(obj[k])).join(",\n");
const rebuilt = src.slice(0, open + 1) + "\n" + rendered + src.slice(end);
fs.writeFileSync(file, rebuilt);
console.log("keys=" + keys.length);

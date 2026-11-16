import fs from "node:fs";
import path from "node:path";
const file = path.resolve(process.argv[2] || "dist/renderer/index.html");
let html = fs.readFileSync(file, "utf8");
const before = html;
html = html.replace(/<script type="module" crossorigin /g, "<script defer ").replace(/<script type="module" /g, "<script defer ");
html = html.replace(/<script (?![^>]*\bdefer\b)(?![^>]*\btype=)/g, "<script defer ");
if (html === before) console.log("fix-renderer-html: html already classic+deferred");
else { fs.writeFileSync(file, html); console.log("fix-renderer-html: rewrote script tags to classic+defer"); }
if (/"\/assets\//.test(html)) throw new Error("fix-renderer-html: absolute asset path found; base must stay './'");
if (!/<script defer id=|\bsrc="\.\/assets\//.test(html)) throw new Error("fix-renderer-html: expected relative deferred script tag");

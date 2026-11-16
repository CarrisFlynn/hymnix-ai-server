import fs from "node:fs";
const file="src/renderer/i18n.ts";
let src=fs.readFileSync(file,"utf8");
if(!src.includes('["Error invoking remote method"')) {
  src=src.replace('const prefixes = [','const prefixes = [\n  ["Error invoking remote method", "调用本机服务失败"],');
  fs.writeFileSync(file,src);
}
console.log("prefix_ok="+src.includes('Error invoking remote method'));

import fs from "node:fs";
const file="src/renderer/main.tsx";
const lines=fs.readFileSync(file,"utf8").split("\n");
const i=lines.findIndex((l)=>l.includes("const delta = part?.choices?.[0]?.delta?.content"));
if(i<0) throw new Error("delta line missing");
lines[i]='        const payload = part?.choices?.[0]?.delta || {};';
lines[i+1]='        const content = payload.content || ""; const thinking = payload.reasoning_content || payload.reasoning || "";';
lines.splice(i+2, 0,
  '        if (!content && !thinking) return;',
  '        setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: item.content + content, reasoning: (item.reasoning || "") + thinking } : item));'
);
// remove the old one-line setMessages that followed
const j=lines.findIndex((l,k)=>k>i+3 && l.includes("if (delta) setMessages"));
if(j>0) lines.splice(j,1);
fs.writeFileSync(file,lines.join("\n"));
console.log("delta_patched");

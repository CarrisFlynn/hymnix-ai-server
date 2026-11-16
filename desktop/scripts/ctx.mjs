import fs from "node:fs";
const s=fs.readFileSync("src/renderer/main.tsx","utf8");
for (const key of ["General","lang===\"en\"","t(\"Theme\")","settingsTab"]) {
  let i=-1, n=0;
  while ((i=s.indexOf(key,i+1))>=0 && n<3){ console.log("=== "+key+" @"+i); console.log(s.slice(Math.max(0,i-260), i+260).replace(/\n/g," ")); n++; }
}

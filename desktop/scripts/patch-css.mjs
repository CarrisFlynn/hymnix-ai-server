import fs from "node:fs";
const css=`
/* ---------- full-bleed terminal console (08c style) ---------- */
.term-shell {
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
  background: #07090b; color: #cfd7dc;
  border-top: 1px solid #1b2228;
}
.term-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px; background: #0b0f12; border-bottom: 1px solid #1b2228;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; letter-spacing: .08em; color: #e8f1f6;
}
.term-title i { color: #4aa3c7; font-style: normal; }
.term-clock { display: flex; align-items: center; gap: 10px; color: #9fb4c0; }
.term-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
.term-bars b { display: block; width: 3px; background: #4aa3c7; }
.term-bars b:nth-child(1){height:4px} .term-bars b:nth-child(2){height:7px}
.term-bars b:nth-child(3){height:10px} .term-bars b:nth-child(4){height:6px}
.term-status, .term-model {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 8px 18px; background: #0a0e11; border-bottom: 1px solid #141b20;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; color: #8fa3ae;
}
.term-key { color: #6f8794; letter-spacing: .1em; }
.term-pill { display: inline-flex; gap: 8px; padding: 2px 8px; border: 1px solid #1f2a31; border-radius: 3px; }
.term-pill b { color: #e6f2f8; font-weight: 600; }
.term-model select {
  height: 26px; padding: 0 8px; border: 1px solid #1f2a31; border-radius: 3px;
  background: #0d1317; color: #e6f2f8; font-family: inherit; font-size: 12px;
}
.term-btn, .term-exec {
  height: 26px; padding: 0 10px; border: 1px solid #24404d; border-radius: 3px;
  background: #10222b; color: #bfe3f2; font-family: inherit; font-size: 12px;
}
.term-btn:hover { background: #16303c; }
.term-dim { color: #5d727d; }
.term-logbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 18px; background: #0a0e11; border-bottom: 1px solid #141b20;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; color: #7c93a0; letter-spacing: .08em;
}
.term-logactions { display: flex; gap: 14px; }
.term-link { border: 0; background: transparent; color: #4aa3c7; font-family: inherit; font-size: 12px; letter-spacing: .08em; }
.term-link:hover { color: #7cc7e3; }
.term-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 18px; background: #07090b; }
.term-line {
  display: grid; grid-template-columns: 104px 48px minmax(0, 1fr); gap: 12px;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 12.5px; line-height: 1.85;
}
.term-time { color: #6f8794; }
.term-tag { font-weight: 700; }
.term-tag.sys { color: #56b893; }
.term-tag.out { color: #d7e3ea; }
.term-tag.err { color: #ff8fa3; }
.term-text { color: #d7e3ea; white-space: pre-wrap; overflow-wrap: anywhere; }
.term-text.dim { color: #5d727d; }
.term-input {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 18px; background: #0a0e11; border-top: 1px solid #141b20;
}
.term-caret { color: #56b893; font-family: "Cascadia Mono", Consolas, monospace; }
.term-input input {
  flex: 1 1 auto; height: 30px; padding: 0 10px;
  border: 1px solid #1f2a31; border-radius: 3px; background: #07090b;
  color: #e6f2f8; font-family: "Cascadia Mono", Consolas, monospace; font-size: 12.5px;
}
.term-exec { background: #1d7a5f; border-color: #24906f; color: #eafff7; }
.term-exec:disabled { opacity: .5; }
.term-foot {
  padding: 6px 18px; background: #0a0e11; border-top: 1px solid #141b20;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; color: #6f8794;
}
.term-hint {
  padding: 6px 18px 10px; background: #07090b;
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; color: #566873;
}
`;
fs.appendFileSync("src/renderer/styles.css", css);
console.log("css_appended");

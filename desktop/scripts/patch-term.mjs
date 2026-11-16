import fs from "node:fs";
const file="src/renderer/main.tsx";
let s=fs.readFileSync(file,"utf8");
const a=s.indexOf("function renderTerminal(){");
const b=s.indexOf("function renderFiles(){",a);
const now=`function renderTerminal(){
  const hints=[t("↑ history"),"Tab "+t("complete"),t("scroll to inspect")].join(" · ");
  return <section className="term-shell">
    <div className="term-head"><span className="term-title">HYMNIX ORBIT <i>//</i> TERMINAL</span><span className="term-clock">{stamp()}<i className="term-bars"><b/><b/><b/><b/></i></span></div>
    <div className="term-status"><span className="term-key">STATUS</span><span className="term-pill">LINK <b>{t(state)}</b></span><span className="term-pill">CWD <b>{filesRoot || "-"}</b></span><span className="term-pill">PROC <b>{termBusy ? "running" : "idle"}</b></span></div>
    <div className="term-model"><span className="term-key">MODEL</span><select value={model} onChange={(event)=>setModel(event.target.value)}>{models.length===0&&<option value="-">{t("No model list loaded")}</option>}{models.map((item)=><option key={item.name} value={item.name}>{item.name}</option>)}</select><button className="term-btn" onClick={()=>setActive("Models")}>APPLY</button><span className="term-dim">BILL</span><span className="term-dim">QUOTA {models.length}</span><button className="term-btn" onClick={()=>void loadModels()}>SAVE</button></div>
    <div className="term-logbar"><span>SYS.LOG</span><span className="term-logactions"><button className="term-link" onClick={()=>void navigator.clipboard?.writeText(termEntries.map((item)=>item.time+"  "+item.tag.toUpperCase()+"  "+item.text).join("\n"))}>{t("Copy")}</button><button className="term-link" onClick={()=>setTermEntries([])}>{t("Clear")}</button></span></div>
    <div className="term-body">{termEntries.length===0?<div className="term-line"><span className="term-time">--:--:--.---</span><span className="term-tag sys">SYS</span><span className="term-text dim">{t("No output yet")}</span></div>:termEntries.map((item,index)=><div className="term-line" key={index}><span className="term-time">{item.time}</span><span className={"term-tag "+item.tag}>{item.tag.toUpperCase()}</span><span className="term-text">{item.text}</span></div>)}</div>
    <form className="term-input" onSubmit={(event)=>{event.preventDefault();void runTerm()}}><span className="term-caret">&gt;</span><input value={termCmd} onChange={(event)=>setTermCmd(event.target.value)} onKeyDown={(event)=>{if(event.key==="ArrowUp"&&termHistory.current.length){event.preventDefault();const next=Math.max(0,termCursor.current-1);termCursor.current=next;setTermCmd(termHistory.current[next]||"")}if(event.key==="ArrowDown"&&termHistory.current.length){event.preventDefault();const next=Math.min(termHistory.current.length,termCursor.current+1);termCursor.current=next;setTermCmd(termHistory.current[next]||"")}if(event.key==="Tab"){event.preventDefault();const builtins=["help","status","models","clear"];const match=builtins.find((name)=>name.startsWith(termCmd.trim())&&termCmd.trim());if(match)setTermCmd(match)}}} placeholder={t("Type a command…")}/><button className="term-exec" type="submit" disabled={termBusy}>EXEC</button></form>
    <div className="term-foot"><span>UPTIME {health?.uptime_s?health.uptime_s+"s":"-"}   LOG N {termEntries.length}</span></div>
    <div className="term-hint">{hints}</div>
  </section>;
 }
 `;
s=s.slice(0,a)+now+s.slice(b);
fs.writeFileSync(file,s);
console.log("terminal_replaced");

# -*- coding: utf-8 -*-
"""Terminal themes and ANSI SGR parser."""
from __future__ import annotations
import json, os, re
THEMES={"neon":{"bg":"#0A0E14","panel":"#0D1117","fg":"#D7F9FF","muted":"#6B8293","divider":"#20313D","stripe":"#0C141C","accent":"#22D3EE","sys":"#67E8F9","success":"#34D399","warn":"#FBBF24","error":"#FB7185","magenta":"#F472B6"},"matrix":{"bg":"#07100D","panel":"#0B1611","fg":"#D7FFE9","muted":"#668A76","divider":"#1C3A2B","stripe":"#0A1B13","accent":"#34D399","sys":"#22D3EE","success":"#34D399","warn":"#FBBF24","error":"#FB7185","magenta":"#86EFAC"},"amber":{"bg":"#120E08","panel":"#19130A","fg":"#FFF4D6","muted":"#9A8157","divider":"#493719","stripe":"#1D160B","accent":"#FBBF24","sys":"#38BDF8","success":"#A3E635","warn":"#FBBF24","error":"#FB7185","magenta":"#F472B6"}}
THEME_PATH=os.path.join(os.environ.get("LOCALAPPDATA",os.path.expanduser("~")),"Hymnix","term_theme.json"); _current="neon"
def _apply():
 c=THEMES[_current]; globals()["COLORS"]={"bg":c["bg"],"panel":c["panel"],"fg":c["fg"],"ts":c["muted"],"stripe":c["stripe"],"divider":c["divider"],"ghost_border":c["divider"],"ghost_hover":c["divider"],"link":c["accent"],"muted":c["muted"]}; globals()["LEVELS"]={"SYS":c["sys"],"REQ":c["magenta"],"PATH":c["muted"],"OK":c["success"],"WARN":c["warn"],"ERR":c["error"],"ERROR":c["error"]}
def load_theme():
 global _current
 try:
  with open(THEME_PATH,encoding="utf-8") as f: n=json.load(f).get("theme","neon")
  if n in THEMES:_current=n
 except (OSError,ValueError,TypeError):pass
 _apply(); return _current
def set_theme(name):
 global _current
 if str(name).lower() not in THEMES:return _current
 _current=str(name).lower()
 try:
  os.makedirs(os.path.dirname(THEME_PATH),exist_ok=True)
  with open(THEME_PATH,"w",encoding="utf-8") as f:json.dump({"theme":_current},f)
 except OSError:pass
 _apply(); return _current
load_theme()
BASE_SIZES={"body":10,"chip":9,"topbar":10,"line_spacing":1.0,"pad":10,"font":"Consolas"}
SIZES=dict(BASE_SIZES)
def set_dpi_scale(scale=1.0):
 global SIZES
 try: scale=max(1.0,float(scale))
 except (TypeError,ValueError): scale=1.0
 SIZES=dict(BASE_SIZES)
 for key in ("body","chip","topbar","pad"): SIZES[key]=max(1,int(round(BASE_SIZES[key]*scale)))
 SIZES["line_spacing"]=BASE_SIZES["line_spacing"]
 return SIZES
JUMP_LABEL="JUMP TO LATEST"; BACK_TO_LATEST="回到最新"
_LINE=re.compile(r"^(?P<ts>(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}\.\d{3}))\s+(?P<level>[A-Za-z]+)\s+·\s+(?P<body>.*)$")
_BASE=["#000000","#CD3131","#0DBC79","#E5E510","#2472C8","#BC3FBC","#11A8CD","#E5E5E5","#666666","#F14C4C","#23D18B","#F5F543","#3B8EEA","#D670D6","#29B8DB","#FFFFFF"]
_SGR=re.compile(r"\x1b\[([0-9;]*)m")
def ansi_to_fragments(text):
 s=str(text or ""); out=[]; state={"fg":None,"bg":None,"bold":False,"underline":False,"reverse":False}; pos=0
 for m in _SGR.finditer(s):
  if m.start()>pos:out.append((s[pos:m.start()],dict(state)))
  nums=[int(x or 0) for x in m.group(1).split(";")] or [0]; i=0
  while i<len(nums):
   n=nums[i]; i+=1
   if n==0:state={"fg":None,"bg":None,"bold":False,"underline":False,"reverse":False}
   elif n==1:state["bold"]=True
   elif n==22:state["bold"]=False
   elif n==4:state["underline"]=True
   elif n==24:state["underline"]=False
   elif n==7:state["reverse"]=True
   elif n==27:state["reverse"]=False
   elif 30<=n<=37:state["fg"]=_BASE[n-30]
   elif 40<=n<=47:state["bg"]=_BASE[n-40]
   elif n in (39,49):state["fg" if n==39 else "bg"]=None
   elif n in (38,48) and i<len(nums):
    key="fg" if n==38 else "bg"; mode=nums[i]; i+=1
    if mode==5 and i<len(nums):
     q=max(0,min(255,nums[i])); i+=1
     if q<16:state[key]=_BASE[q]
     elif q<232: q-=16; state[key]="#%02X%02X%02X"%((q//36)*51,((q%36)//6)*51,(q%6)*51)
     else:state[key]="#%02X%02X%02X"%((q-232)*10+8,)*3
    elif mode==2 and i+2<len(nums):state[key]="#%02X%02X%02X"%tuple(nums[i:i+3]); i+=3
  pos=m.end()
 if pos<len(s):out.append((s[pos:],dict(state)))
 return out
def color_for(level):return LEVELS.get(str(level).upper(),COLORS["fg"])
def classify(line):
 raw=str(line or "");m=_LINE.match(raw)
 if not m or m.group("level").upper() not in LEVELS:return {"ts":"","level":"","body":raw,"color":COLORS["fg"]}
 l=m.group("level").upper();return {"ts":m.group("ts"),"level":l,"body":m.group("body"),"color":color_for(l)}
def row_bg(index):return COLORS["stripe"] if int(index)%2 else ""
def sections():return [dict(x,divider=COLORS["divider"]) for x in [{"key":"topbar"},{"key":"chips"},{"key":"config"},{"key":"log"},{"key":"telemetry"},{"key":"command"},{"key":"footer"}]]
def scanline(density=.035):return {"color":"#FFF","alpha":max(.03,min(.04,float(density))),"step":3}
def status_chip(label,level):return {"label":str(label or ""),"fg":color_for(level),"bg":COLORS["panel"],"border":COLORS["divider"],"size":10}
if __name__=="__main__":
 assert ansi_to_fragments(chr(27)+"[31mred"+chr(27)+"[0m")[0][1]["fg"]=="#CD3131"
 assert classify("2026-11-15T06:25:29.698 SYS · boot")["level"]=="SYS"
 assert classify("2026-11-15 06:25:29.698+08:00 ERR · bad")["level"]=="ERR"
 print("SELFTEST OK")

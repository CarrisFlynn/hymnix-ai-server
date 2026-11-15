# -*- coding: utf-8 -*-
"""Optional OCR helpers, including virtual-screen geometry and line formatting."""
from __future__ import annotations
import os, shutil, subprocess, tempfile, time
from typing import Any
_MAX_CHARS=100_000
_LAST_ERROR=""
def _set_error(value:str)->None:
    global _LAST_ERROR; _LAST_ERROR=str(value or "")
def last_error()->str:
    return _LAST_ERROR
def _monitor_rect(m:Any):
    if isinstance(m,dict):
        if "rect" in m: return _monitor_rect(m["rect"])
        x,y=m.get("x",0),m.get("y",0); w,h=m.get("width",m.get("w",0)),m.get("height",m.get("h",0)); return (int(x),int(y),int(w),int(h))
    if isinstance(m,(tuple,list)) and len(m)>=4: return tuple(map(int,m[:4]))
    return None
def union_rects(rects):
    """Return the bounding (x1,y1,x2,y2) union of rectangle tuples."""
    vals=[]
    for r in rects or []:
        q=_monitor_rect(r)
        if q:
            x,y,a,b=q; vals.append((x,y,x+a,y+b) if a>=0 and b>=0 else (x,y,a,b))
    if not vals:return None
    return (min(v[0] for v in vals),min(v[1] for v in vals),max(v[2] for v in vals),max(v[3] for v in vals))
def virtual_screen_rect(monitors=None):
    """Return virtual desktop as (x,y,width,height), preserving negative origins."""
    if monitors is not None:
        u=union_rects(monitors)
        return (u[0],u[1],u[2]-u[0],u[3]-u[1]) if u else None
    # Windows exposes the complete virtual desktop, including negative origins.
    try:
        import ctypes
        user32 = ctypes.windll.user32
        x = int(user32.GetSystemMetrics(76)); y = int(user32.GetSystemMetrics(77))
        w = int(user32.GetSystemMetrics(78)); h = int(user32.GetSystemMetrics(79))
        if w > 0 and h > 0:
            return (x, y, w, h)
    except Exception:
        pass
    try:
        import tkinter as tk
        existing = getattr(tk, "_default_root", None)
        root = existing if existing is not None else tk.Tk()
        own = existing is None
        try:
            return (int(root.winfo_vrootx()), int(root.winfo_vrooty()), int(root.winfo_vrootwidth()), int(root.winfo_vrootheight()))
        finally:
            if own:
                try: root.destroy()
                except Exception: pass
    except Exception:
        _set_error("no_tk"); return None
def normalize_rect(rect,bounds=None):
    """Normalize (x1,y1,x2,y2), sorting and clipping; explicit {x,y,w,h} dicts are also accepted."""
    if isinstance(rect,dict) and all(k in rect for k in ("x","y","w","h")):
        try:
            x,y,w,h=(int(round(float(rect[k]))) for k in ("x","y","w","h"))
            if w<=0 or h<=0: raise ValueError
            rect=(x,y,x+w,y+h)
        except Exception:
            _set_error("bad_rect"); return None
    if not isinstance(rect,(tuple,list)) or len(rect)!=4:
        _set_error("bad_rect"); return None
    try:
        a,b,c,d=(int(round(float(x))) for x in rect)
        x1,x2=sorted((a,c)); y1,y2=sorted((b,d))
        if bounds is None: bounds=virtual_screen_rect()
        if bounds:
            bx,by,bw,bh=map(int,bounds); x1=max(x1,bx); y1=max(y1,by); x2=min(x2,bx+bw); y2=min(y2,by+bh)
        if x2<=x1 or y2<=y1: raise ValueError
        _set_error(""); return (x1,y1,x2,y2)
    except Exception:
        _set_error("bad_rect"); return None
def engines():
    found=[]
    try:
        import pytesseract
        if getattr(pytesseract,"get_tesseract_version",None): pytesseract.get_tesseract_version(); found.append("tesseract")
    except Exception: pass
    if not found and shutil.which("tesseract"): found.append("tesseract")
    return found
def available():
    try:return bool(engines())
    except Exception:return False
def info():
    try:
        a=available(); return {"engines":engines(),"available":a,"note":("Tesseract ready / 已检测到 Tesseract" if a else "No OCR engine detected; 未检测到 OCR 引擎，请安装 Tesseract 后重试")}
    except Exception as e: _set_error("info_error"); return {"engines":[],"available":False,"note":str(e)}
def format_lines(data=None,text=""):
    """Format OCR data as lines 'text\tx,y,w,h'; fallback is plain text lines."""
    out=[]
    try:
        if isinstance(data,dict) and data.get("text") is not None:
            keys=("block_num","par_num","line_num"); groups={}
            n=len(data.get("text",[]))
            for i in range(n):
                word=str(data["text"][i] or "").strip()
                if not word: continue
                key=tuple(data.get(k,[0]*n)[i] for k in keys); x=int(data.get("left",[0]*n)[i]); y=int(data.get("top",[0]*n)[i]); w=int(data.get("width",[0]*n)[i]); h=int(data.get("height",[0]*n)[i])
                if key in groups:
                    g=groups[key]; g[0]+=" "+word; x0,y0,x1,y1=g[1]; g[1]=(min(x0,x),min(y0,y),max(x1,x+w),max(y1,y+h))
                else: groups[key]=[word,(x,y,x+w,y+h)]
            for word,(x0,y0,x1,y1) in groups.values(): out.append(f"{word}\t{x0},{y0},{x1-x0},{y1-y0}")
    except Exception: out=[]
    return out or [line for line in str(text or "").splitlines()]
def _result(ok,text="",engine="",lang="",error="",started=0.0,**extra):
    value=str(text or "")[:_MAX_CHARS];
    if error:_set_error(error)
    else:_set_error("")
    r={"ok":bool(ok),"text":value,"engine":engine,"lang":lang or "","chars":len(value),"ms":round(max(0,(time.perf_counter()-started)*1000),3),"error":error or ""}; r.update(extra); return r
def _ocr_image(image,lang,started):
    try:
        import pytesseract
        text=pytesseract.image_to_string(image,lang=lang or None)
        try: lines=format_lines(pytesseract.image_to_data(image,lang=lang or None,output_type=pytesseract.Output.DICT),text)
        except Exception: lines=format_lines(text=text)
        return _result(True,text,"tesseract",lang,started=started,lines=lines)
    except Exception: pass
    executable=shutil.which("tesseract")
    if not executable:return _result(False,engine="",lang=lang,error="no_engine",started=started,lines=format_lines(text=""))
    temp=""
    try:
        fd,temp=tempfile.mkstemp(suffix=".png"); os.close(fd); image.save(temp); cmd=[executable,temp,"stdout"]+(["-l",lang] if lang else []); p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,timeout=30)
        if p.returncode:return _result(False,engine="tesseract",lang=lang,error="engine_error",started=started)
        text=p.stdout.decode("utf-8",errors="replace"); return _result(True,text,"tesseract",lang,started=started,lines=format_lines(text=text))
    except Exception:return _result(False,engine="tesseract",lang=lang,error="engine_error",started=started)
    finally:
        if temp:
            try: os.remove(temp)
            except Exception: pass
def image_to_text(path,lang=None):
    started=time.perf_counter(); language=str(lang or "")
    try:
        if not isinstance(path,(str,os.PathLike)) or not os.path.isfile(path): return _result(False,lang=language,error="not_found",started=started)
        try: from PIL import Image
        except Exception:return _result(False,lang=language,error="no_pillow",started=started)
        try:
            with Image.open(path) as image:
                image.load(); return _ocr_image(image,language,started) if available() else _result(False,lang=language,error="no_engine",started=started)
        except Exception:return _result(False,lang=language,error="bad_image",started=started)
    except Exception:return _result(False,lang=language,error="ocr_error",started=started)
def screenshot_to_text(rect=None,lang=None):
    """Grab normalized rect and return result including rect and virtual monitors."""
    started=time.perf_counter(); language=str(lang or ""); bounds=virtual_screen_rect(); norm=normalize_rect(rect,bounds) if rect is not None else None
    if rect is not None and norm is None:return _result(False,lang=language,error="bad_rect",started=started,rect=None,monitors=bounds)
    try:
        from PIL import ImageGrab
        image=ImageGrab.grab(bbox=norm)
        try:return (_ocr_image(image,language,started) if available() else _result(False,lang=language,error="no_engine",started=started,rect=list(norm) if norm else None,monitors=bounds)) | {"rect":list(norm) if norm else None,"monitors":bounds}
        finally:
            try:image.close()
            except Exception:pass
    except ImportError:return _result(False,lang=language,error="no_pillow",started=started,rect=list(norm) if norm else None,monitors=bounds)
    except Exception:return _result(False,lang=language,error="screenshot_error",started=started,rect=list(norm) if norm else None,monitors=bounds)
def _selftest():
    m=[(-1920,0,1920,1080),(0,0,2560,1440)]; assert virtual_screen_rect(m)==(-1920,0,4480,1440); assert normalize_rect((-2000,10,-1000,100),virtual_screen_rect(m))==(-1920,10,-1000,100); assert normalize_rect((1,1,1,20),virtual_screen_rect(m)) is None; assert format_lines(text="a\nb")==["a","b"]; print("SELFTEST PASS")
if __name__=="__main__": _selftest()

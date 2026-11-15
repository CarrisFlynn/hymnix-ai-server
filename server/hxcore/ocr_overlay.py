"""Tk screen-region overlay; geometry helpers remain usable without Tk."""
from __future__ import annotations
_LAST_ERROR=""
def _set_error(v):
    global _LAST_ERROR; _LAST_ERROR=str(v or "")
def last_error(): return _LAST_ERROR
def _rect(m):
    if isinstance(m,dict): return (int(m.get("x",0)),int(m.get("y",0)),int(m.get("width",m.get("w",0))),int(m.get("height",m.get("h",0))))
    if isinstance(m,(list,tuple)) and len(m)>=4:return tuple(map(int,m[:4]))
    return None
def overlay_geometry(monitors):
    """Return one (x,y,w,h) Toplevel geometry per monitor, including negative origins."""
    return [q for m in (monitors or []) if (q:=_rect(m)) and q[2]>0 and q[3]>0]
def select_region(root=None,monitors=None,on_done=None):
    """Show cross-monitor overlay and return normalized (x1,y1,x2,y2), or None."""
    wins=[]; sentinel=None; timer=[None]; result=[None]; cleaned=[False]; callback=[False]
    def cleanup():
        if cleaned[0]: return
        cleaned[0]=True
        if timer[0]:
            try: root.after_cancel(timer[0])
            except Exception: pass
            timer[0]=None
        for w in wins:
            try: w.destroy()
            except Exception: pass
        wins.clear()
        if sentinel is not None:
            try: sentinel.destroy()
            except Exception: pass
    def notify():
        if callback[0] or on_done is None: return
        callback[0]=True
        try: on_done(None if result[0] is False else result[0])
        except Exception: pass
    def finish(rect=None):
        if result[0] is not None: return
        result[0]=rect if rect is not None else False
        cleanup(); notify()
    try:
        import tkinter as tk
        own=False
        if root is None:
            root=tk._default_root
            if root is None: root=tk.Tk(); own=True
        if monitors is None:
            try:
                from .ocr import virtual_screen_rect
                v=virtual_screen_rect(); monitors=[v] if v else []
            except Exception: monitors=[]
        geoms=overlay_geometry(monitors)
        if not geoms: _set_error("no_monitors"); return None
        sentinel=tk.Toplevel(root); sentinel.withdraw()
        def timeout(): finish(None)
        timer[0]=root.after(25000,timeout)
        state={"sx":0,"sy":0,"active":False,"marks":[]}
        def press(e): state.update(sx=e.x_root,sy=e.y_root,active=True)
        def motion(e):
            if not state["active"]: return
            x1,x2=sorted((state["sx"],e.x_root)); y1,y2=sorted((state["sy"],e.y_root))
            for w,cv,label,box in state["marks"]:
                try:
                    wx,wy=w.winfo_x(),w.winfo_y(); cv.coords(box,x1-wx,y1-wy,x2-wx,y2-wy)
                    label.configure(text=f"{x2-x1} x {y2-y1}"); label.place(x=max(0,x1-wx),y=max(0,y1-wy))
                except Exception: pass
        def release(e):
            if state["active"]:
                state["active"]=False; x1,x2=sorted((state["sx"],e.x_root)); y1,y2=sorted((state["sy"],e.y_root))
                if x2>x1 and y2>y1: finish((x1,y1,x2,y2))
        for x,y,w,h in geoms:
            win=tk.Toplevel(root); wins.append(win); win.overrideredirect(True); win.geometry(f"{int(w)}x{int(h)}+{int(x)}+{int(y)}"); win.attributes("-topmost",True); win.attributes("-alpha",0.25); win.configure(bg="black")
            cv=tk.Canvas(win,bg="black",highlightthickness=0); cv.pack(fill="both",expand=True); box=cv.create_rectangle(0,0,0,0,outline="#00e5ff",width=2); label=tk.Label(win,text="",bg="#111",fg="white"); label.place_forget(); state["marks"].append((win,cv,label,box))
            for seq,fn in (("<Button-1>",press),("<B1-Motion>",motion),("<ButtonRelease-1>",release),("<Escape>",lambda e:finish(None)),("<Button-3>",lambda e:finish(None))): win.bind(seq,fn); cv.bind(seq,fn)
        root.update_idletasks(); root.wait_window(sentinel)
        return None if result[0] is False or result[0] is None else result[0]
    except Exception:
        _set_error("tk_error"); result[0]=False
        return None
    finally:
        cleanup()
        if result[0] is not None: notify()

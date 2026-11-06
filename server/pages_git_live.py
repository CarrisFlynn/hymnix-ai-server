# -*- coding: utf-8 -*-
"""Git proxy and mirror configuration wizard."""
from __future__ import annotations
import os, sys, threading, queue, tkinter as tk
from tkinter import messagebox
_COMPONENT_ERROR = ""
try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, _page_header, _label
except Exception as exc:
    _UI=ScrollPage=RoundedCard=PillButton=_page_header=_label=None
    _COMPONENT_ERROR = str(exc)
try:
    from hxcore import gitproxy
except Exception:
    gitproxy=None

def _t(ui, zh, en):
    try:
        if ui is not None: return ui.t(zh, en)
        func = getattr(sys.modules.get("__main__"), "T", None)
        if callable(func): return func(zh, en)
    except Exception:
        pass
    return en

def _call(fn, default):
    try: return fn()
    except Exception: return default

def _confirm(ui, zh, en):
    try: return messagebox.askyesno(_t(ui,"确认","Confirm"),_t(ui,zh,en))
    except Exception: return False

def _err(ui, text):
    try: messagebox.showerror(_t(ui,"操作失败","Operation failed"),str(text))
    except Exception: pass

def _button(parent,ui,text,command,state=None):
    try: return PillButton(parent,ui,text,command=command,kind="ghost",bg=ui.theme["card"],state=state)
    except Exception: return tk.Button(parent,text=text,command=command,state=state or "normal")

def _card(host,ui,title,row):
    c=RoundedCard(host,ui,fill=ui.theme["card"],pad=12,radius=12); c.grid(row=row,column=0,sticky="ew",pady=(0,ui.px(10)))
    _label(c.body,text=title,font=ui.font_obj(11,"bold"),fg=ui.theme["text"],bg=ui.theme["card"]).pack(anchor="w",pady=(0,ui.px(7))); return c.body

def _root(app):
    return getattr(app,"root",None) or getattr(app,"tk",None)

def _selftest():
    assert isinstance(_t(None,"中文","English"),str)
    assert gitproxy is None or hasattr(gitproxy,"status")
    class Root:
        def after(self, delay, callback):
            threading.Timer(max(0.01, delay / 1000.0), callback).start()
    seen=[]; finished=threading.Event()
    _run_async(Root(),lambda: 3,lambda value,error: (seen.append((value,error)), finished.set()))
    assert finished.wait(2) and seen == [(3,None)]
    print("SELFTEST OK")

def _run_async(root, work, done, busy=None):
    results=queue.Queue(maxsize=1)
    if busy: busy(True)
    def poll():
        try: result,error=results.get_nowait()
        except queue.Empty:
            try: root.after(60,poll)
            except Exception:
                if busy: busy(False)
            return
        if busy: busy(False)
        done(result,error)
    try:
        root.after(60,poll)
    except Exception as exc:
        if busy: busy(False)
        done(None,exc)
        return
    def runner():
        try: results.put((work(),None))
        except Exception as exc: results.put((None,exc))
    threading.Thread(target=runner,daemon=True).start()

def build_git_page(app,parent):
    root=_root(app)
    if _UI is None:
        reason=_COMPONENT_ERROR or "pages_modern components unavailable"
        try:
            box=tk.Frame(parent); box.pack(fill="both",expand=True)
            tk.Label(box,text=_t(None, "界面组件缺失", "UI components missing"),anchor="w").pack(fill="x",padx=16,pady=(20,6))
            tk.Label(box,text=reason,anchor="w",justify="left",wraplength=720,fg="#B42318").pack(fill="x",padx=16)
            return box
        except Exception: return None
    ui=_UI(app,parent); page=ScrollPage(parent,ui); page.pack(fill="both",expand=True); content=page.content; content.columnconfigure(0,weight=1)
    header=_page_header(content,ui,"GIT",_t(ui,"Git 加速与代理","Git proxy"),_t(ui,"只改当前项目仓库的本地配置，改动前自动备份。","Only changes local config for this repository; backups are automatic.")); header.grid(row=0,column=0,sticky="ew",pady=(0,ui.px(12)))
    host=tk.Frame(content,bg=ui.theme["bg"]); host.grid(row=1,column=0,sticky="ew"); host.columnconfigure(0,weight=1)
    busy_widgets=[]
    def set_busy(value):
        for button,label in list(busy_widgets):
            try:
                button.configure(state="disabled" if value else "normal")
                label.configure(text=_t(ui,"处理中…","Working…") if value else "")
            except Exception: pass
    def add_action(parent_widget,text,fn,side="left"):
        wrap=tk.Frame(parent_widget,bg=ui.theme["card"]); wrap.pack(side=side,padx=(4,0))
        button=_button(wrap,ui,text,fn); button.pack(side="left")
        label=tk.Label(wrap,text="",bg=ui.theme["card"],fg=ui.theme["text_muted"],font=ui.font_obj(8)); label.pack(side="left",padx=4)
        busy_widgets.append((button,label)); return button
    def report(result,error):
        if error: _err(ui,error); return
        if isinstance(result,dict) and not result.get("ok",False): _err(ui,result.get("error","Operation failed")); return
        refresh()
    def write(work,confirm_zh,confirm_en):
        if not _confirm(ui,confirm_zh,confirm_en): return
        _run_async(root,work,report,set_busy)
    def refresh_view(st, candidates, env):
        for x in host.winfo_children(): x.destroy()
        busy_widgets.clear(); th=ui.theme
        body=_card(host,ui,_t(ui,"状态","Status"),0)
        vals=[("Git",st.get("git_version") or st.get("git") or "-"),("Repo",st.get("repo") or "-"),("Is repository",st.get("is_repo",False)),("http.proxy",st.get("proxy") or "-"),("Mirror",st.get("mirror") or "-")]
        for k,v in vals: _label(body,text=f"{k}: {v}",font=ui.font_obj(9),fg=th["err"] if k=="Git" and not st.get("git") else th["text_muted"],bg=th["card"],anchor="w").pack(anchor="w")
        if st.get("error") or not st.get("git"):
            _label(body,text=str(st.get("error") or _t(ui,"未检测到 Git","Git not installed")),font=ui.font_obj(9,"bold"),fg=th["err"],bg=th["card"],anchor="w").pack(anchor="w")
        pb=_card(host,ui,_t(ui,"代理设置","Proxy"),1); entry=tk.Entry(pb); entry.pack(side="left",fill="x",expand=True,padx=(0,ui.px(6))); entry.insert(0,env.get("https_proxy") or st.get("proxy") or "")
        def apply_proxy():
            value=entry.get().strip()
            write(lambda:gitproxy.apply_proxy(value,scope="local"),"应用代理并自动备份？","Apply proxy and create backup?")
        add_action(pb,_t(ui,"应用","Apply"),apply_proxy)
        add_action(pb,_t(ui,"清除","Clear"),lambda: write(lambda:gitproxy.apply_proxy("",scope="local"),"清除代理并自动备份？","Clear proxy and create backup?"))
        mb=_card(host,ui,_t(ui,"镜像规则","Mirrors"),2)
        for cand in candidates:
            row=tk.Frame(mb,bg=th["card"]); row.pack(fill="x",pady=2); name=str(cand.get("name","")); url=str(cand.get("url","")); note=str(cand.get("note", ""))
            add_action(row,_t(ui,"应用","Apply"),lambda u=url: write(lambda:gitproxy.apply_mirror("",u,scope="local"),"应用镜像规则并自动备份？","Apply mirror and create backup?"),side="right")
            _label(row,text=f"{name}  {url}",font=ui.font_obj(9),fg=th["text"],bg=th["card"]).pack(side="left")
            warn=_t(ui,"第三方镜像，可能不稳定","Third-party mirror; may be unstable")
            _label(row,text=(note if warn in note else (note+" · "+warn if note else warn)),font=ui.font_obj(8),fg=th["text_muted"],bg=th["card"],wraplength=ui.px(320),justify="left").pack(side="left",padx=8)
        eb=_card(host,ui,_t(ui,"环境代理","Environment proxy"),3)
        _label(eb,text=f"HTTP_PROXY={os.environ.get('HTTP_PROXY','-')}  HTTPS_PROXY={os.environ.get('HTTPS_PROXY','-')}  ALL_PROXY={os.environ.get('ALL_PROXY','-')}  ({env.get('from','unknown')})",font=ui.font_obj(9),fg=th["text_muted"],bg=th["card"],wraplength=ui.px(700),justify="left").pack(anchor="w")
        db=_card(host,ui,_t(ui,"危险区","Danger zone"),4)
        _button(db,ui,""+_t(ui,"证书安装需要管理员权限，未实现","Certificate install requires admin; not implemented"),lambda:None,state="disabled").pack(anchor="w")
        rb=tk.Frame(db,bg=th["card"]); rb.pack(fill="x",pady=(8,0)); re=tk.Entry(rb); re.pack(side="left",fill="x",expand=True)
        def revert_backup():
            backup=re.get().strip()
            if not backup:
                _err(ui,_t(ui,"请输入备份路径","Enter a backup path")); return
            write(lambda:gitproxy.revert(backup),"回滚最近一次备份？","Revert the selected backup?")
        add_action(rb,_t(ui,"回滚最近一次备份","Revert latest backup"),revert_backup)
        for button,label in busy_widgets:
            _button # preserve original state; initial state is normal
    def load_done(result,error):
        if error:
            _err(ui,error); st={"error":str(error)}; candidates=[]; env={}
        else: st,candidates,env=result
        refresh_view(st or {},candidates or [],env or {})
    def refresh():
        for x in host.winfo_children(): x.destroy()
        loading=tk.Label(host,text=_t(ui,"正在读取 Git 状态…","Loading Git status…"),bg=ui.theme["bg"],fg=ui.theme["text_muted"]); loading.grid(row=0,column=0,sticky="w")
        def work():
            if gitproxy is None: raise RuntimeError(_t(ui,"Git 代理模块未就绪","Git proxy module not ready"))
            st=gitproxy.status() or {}; candidates=gitproxy.candidates() or []; env=gitproxy.detect_proxy() or {}; return st,candidates,env
        _run_async(root,work,load_done)
    refresh(); return page

if __name__ == "__main__" and "--selftest" in sys.argv: _selftest()

# -*- coding: utf-8 -*-
"""Live plugin center and permission market."""
from __future__ import annotations
import os, sys, tkinter as tk
from tkinter import filedialog, messagebox
try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, ToggleSwitch, _page_header, _label, _tag
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = ToggleSwitch = _page_header = _label = _tag = None
try:
    from hxcore import plugins
except Exception:
    plugins = None
PERMISSIONS = ("fs.read", "fs.write", "net.http", "ui.toast", "tools.register", "log.write")
REQUIRED = ("id", "name", "version", "apiVersion", "entry")

def _t(ui, zh, en):
    try: return ui.t(zh, en)
    except Exception: return zh

def _call(fn, default):
    try: return fn()
    except Exception: return default

def _grants(pid):
    getter = getattr(plugins, "granted", None)
    if callable(getter):
        try: return set(getter(pid) or [])
        except Exception: pass
    for item in (_call(plugins.discover, []) if plugins is not None else []):
        if isinstance(item, dict) and item.get("id") == pid:
            return set(item.get("grantedPermissions") or item.get("granted") or [])
    return set()

def _button(parent, ui, text, command, kind="ghost"):
    try: return PillButton(parent, ui, text, command=command, kind=kind, bg=ui.theme["card"])
    except Exception: return tk.Button(parent, text=text, command=command)

def _clear(widget):
    try:
        for child in widget.winfo_children(): child.destroy()
    except Exception: pass

def _manifest_check(item):
    missing = [key for key in REQUIRED if not item.get(key)]
    api_ok = str(item.get("apiVersion") or "") == "1"
    if missing: return False, "missing: " + ", ".join(missing)
    if not api_ok: return False, "apiVersion must be 1"
    return True, "OK"

def _permission_badge(parent, ui, pid, permission, granted, refresh):
    theme = ui.theme
    if granted:
        badge = _tag(parent, ui, permission, theme["card"], fill=theme["accent"], fg="#FFFFFF")
    else:
        font = ui.font_obj(8, "bold", mono=True)
        width = font.measure(permission) + ui.px(18); height = ui.px(22)
        badge = tk.Canvas(parent, width=width, height=height, bg=theme["card"],
                          highlightthickness=0, bd=0, takefocus=0)
        badge.create_rectangle(2, 3, width-2, height-3, outline=theme["text_muted"],
                               width=1, dash=(3, 2))
        badge.create_text(width/2, height/2, text=permission, fill=theme["text_muted"], font=font)
    badge.pack(side="left", padx=(0, ui.px(5)))
    def change(value):
        try:
            fn = getattr(plugins, "grant" if value else "revoke", None)
            if not callable(fn): raise RuntimeError("permission API unavailable")
            result = fn(pid, permission)
            if isinstance(result, dict) and not result.get("ok", True): raise RuntimeError(str(result.get("error", "failed")))
            refresh()
        except Exception as exc:
            try: messagebox.showerror(_t(ui, "授权失败", "Permission failed"), str(exc))
            except Exception: pass
    ToggleSwitch(parent, ui, value=granted, command=change, bg=theme["card"]).pack(side="left", padx=(0, ui.px(8)))

def _plugin_card(host, app, ui, item, refresh, row):
    theme = ui.theme; card = RoundedCard(host, ui, fill=theme["card"], pad=14, radius=14)
    card.grid(row=row, column=0, sticky="ew", pady=(0, ui.px(10))); body=card.body; body.columnconfigure(0,weight=1)
    pid=str(item.get("id") or ""); title=str(item.get("name") or pid or "Unnamed plugin")
    _label(body,text=title,font=ui.font_obj(12,"bold"),fg=theme["text"],bg=theme["card"]).grid(row=0,column=0,sticky="w")
    _label(body,text="v"+str(item.get("version") or "-"),font=ui.font_obj(9,mono=True),fg=theme["text_muted"],bg=theme["card"]).grid(row=0,column=1,sticky="e")
    valid, reason = _manifest_check(item); check_fg=theme["ok"] if valid else theme["err"]
    _label(body,text=_t(ui,"Manifest：通过","Manifest: valid") if valid else _t(ui,"Manifest：错误 · ","Manifest: error · ")+reason,font=ui.font_obj(9,"bold"),fg=check_fg,bg=theme["card"],anchor="w").grid(row=1,column=0,columnspan=2,sticky="ew",pady=(ui.px(5),0))
    if item.get("error"):
        _label(body,text=_t(ui,"错误：","Error: ")+str(item.get("error")),font=ui.font_obj(9),fg=theme["err"],bg=theme["card"],wraplength=ui.px(680),justify="left").grid(row=2,column=0,columnspan=2,sticky="ew",pady=(ui.px(4),0))
    _label(body,text=str(item.get("description") or _t(ui,"无描述","No description")),font=ui.font_obj(9),fg=theme["text_muted"],bg=theme["card"],wraplength=ui.px(680),justify="left").grid(row=3,column=0,columnspan=2,sticky="ew",pady=(ui.px(5),0))
    perms=tk.Frame(body,bg=theme["card"]); perms.grid(row=4,column=0,columnspan=2,sticky="w",pady=(ui.px(8),0))
    granted=_grants(pid)
    for permission in PERMISSIONS: _permission_badge(perms,ui,pid,permission,permission in granted,refresh)
    controls=tk.Frame(body,bg=theme["card"]); controls.grid(row=5,column=0,columnspan=2,sticky="w",pady=(ui.px(9),0))
    def toggle(value):
        try: plugins.set_enabled(pid,value)
        except Exception: pass
        refresh()
    ToggleSwitch(controls,ui,value=bool(item.get("enabled")),command=toggle,bg=theme["card"]).pack(side="left")
    _label(controls,text=_t(ui,"启用","Enabled"),font=ui.font_obj(9),fg=theme["text_muted"],bg=theme["card"]).pack(side="left",padx=(ui.px(6),ui.px(14)))
    _button(controls,ui,_t(ui,"重新加载","Reload"),lambda: (_call(lambda: plugins.unload(pid),False),_call(lambda: plugins.load(pid),{}),refresh()),"ghost").pack(side="left",padx=(0,ui.px(6)))
    _button(controls,ui,_t(ui,"卸载","Uninstall"),lambda: (_call(lambda: plugins.uninstall(pid),False),refresh()),"ghost").pack(side="left")

def build_plugins_page(app, parent) -> None:
    if _UI is None: return None
    try:
        ui=_UI(app,parent); page=ScrollPage(parent,ui); page.pack(fill="both",expand=True); content=page.content; content.columnconfigure(0,weight=1)
        header=_page_header(content,ui,"EXTENSIONS",_t(ui,"插件中心","Plugin center"),_t(ui,"管理插件、Manifest 与权限授予。","Manage plugins, manifests, and permissions.")); header.grid(row=0,column=0,sticky="ew",pady=(0,ui.px(12)))
        host=tk.Frame(content,bg=ui.theme["bg"]); host.grid(row=1,column=0,sticky="ew"); host.columnconfigure(0,weight=1)
        def refresh():
            _clear(host)
            if plugins is None:
                c=RoundedCard(host,ui,fill=ui.theme["card"],pad=22,radius=14); c.grid(row=0,column=0,sticky="ew"); _label(c.body,text=_t(ui,"内核未就绪","Plugin kernel is not ready"),font=ui.font_obj(14,"bold"),fg=ui.theme["text"],bg=ui.theme["card"]).pack(anchor="w"); return
            items=_call(plugins.discover,[]); status=_call(plugins.status,{})
            granted=sum(len(x.get("grantedPermissions") or x.get("granted") or []) for x in items if isinstance(x,dict))
            bar=RoundedCard(host,ui,fill=ui.theme["card"],pad=12,radius=12); bar.grid(row=0,column=0,sticky="ew",pady=(0,ui.px(10)))
            _label(bar.body,text=_t(ui,"已装 {0} · 已启用 {1} · 权限已授予 {2}","Installed {0} · Enabled {1} · Permissions granted {2}").format(len(items),status.get("enabled",0),granted),font=ui.font_obj(10,"bold"),fg=ui.theme["text"],bg=ui.theme["card"]).pack(anchor="w")
            _button(bar.body,ui,_t(ui,"刷新","Refresh"),refresh,"ghost").pack(anchor="e")
            if not items: _label(host,text=_t(ui,"暂无插件","No plugins installed"),font=ui.font_obj(11),fg=ui.theme["text_muted"],bg=ui.theme["bg"]).grid(row=1,column=0,sticky="w")
            for index,item in enumerate(items,1): _plugin_card(host,app,ui,item,refresh,index)
        refresh(); page.bind_wheel(); return page
    except Exception:
        try: tk.Label(parent,text=_t(ui,"模块未就绪","Module not ready")).pack(fill="both",expand=True)
        except Exception: pass
        return None

def _selftest():
    assert _manifest_check({"id":"x","name":"x","version":"1","apiVersion":"1","entry":"main.py"}) == (True,"OK")
    assert _manifest_check({"id":"x","apiVersion":"2"})[0] is False
    assert _manifest_check({"id":"x","name":"x","version":"1"})[0] is False
    assert len(PERMISSIONS) == 6
    print("SELFTEST OK")

if __name__ == "__main__" and "--selftest" in sys.argv: _selftest()

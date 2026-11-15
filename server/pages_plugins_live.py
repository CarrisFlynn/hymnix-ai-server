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

def _grants_state(pid):
    """Return granted permissions and whether their state was actually readable."""
    if plugins is None:
        return set(), False
    def checked(value):
        if not isinstance(value, (list, tuple)) or any(not isinstance(perm, str) for perm in value):
            return set(), False
        return set(value), True
    try:
        getter = getattr(plugins, "granted", None)
        if callable(getter):
            return checked(getter(pid))
        discover = getattr(plugins, "discover", None)
        if not callable(discover):
            return set(), False
        rows = discover()
        if not isinstance(rows, list):
            return set(), False
        for item in rows:
            if isinstance(item, dict) and item.get("id") == pid:
                for key in ("grantedPermissions", "granted"):
                    if key in item:
                        return checked(item[key])
                return set(), False
    except Exception:
        return set(), False
    return set(), False


def _grants(pid):
    return _grants_state(pid)[0]

def _button(parent, ui, text, command, kind="ghost"):
    try: return PillButton(parent, ui, text, command=command, kind=kind, bg=ui.theme["card"])
    except Exception: return tk.Button(parent, text=text, command=command)

def _clear(widget):
    try:
        for child in widget.winfo_children(): child.destroy()
    except Exception: pass

def _manifest_check(item):
    if item.get("error"): return False, str(item["error"])
    if plugins is not None and item.get("path") and hasattr(plugins,"validate_manifest"):
        _, errors = plugins.validate_manifest(item["path"])
        return not errors, ", ".join(errors) if errors else "OK"
    missing = [key for key in REQUIRED if not item.get(key)]
    api_ok = str(item.get("apiVersion") or "") == "1"
    if missing: return False, "missing: " + ", ".join(missing)
    if not api_ok: return False, "apiVersion must be 1"
    return True, "OK"

def _permission_badge(parent, ui, pid, permission, granted, refresh, notify=None):
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
            if notify: notify("")
            refresh()
        except Exception as exc:
            if notify: notify(_t(ui,"授权失败：","Permission denied: ")+str(exc))
    ToggleSwitch(parent, ui, value=granted, command=change, bg=theme["card"]).pack(side="left", padx=(0, ui.px(8)))

def _plugin_card(host, app, ui, item, refresh, row, notify=None):
    theme = ui.theme; card = RoundedCard(host, ui, fill=theme["card"], pad=14, radius=14)
    card.grid(row=row, column=0, sticky="ew", pady=(0, ui.px(10))); body=card.body; body.columnconfigure(0,weight=1)
    pid=str(item.get("id") or ""); title=str(item.get("name") or pid or "Unnamed plugin")
    _label(body,text=title,font=ui.font_obj(12,"bold"),fg=theme["text"],bg=theme["card"]).grid(row=0,column=0,sticky="w")
    _label(body,text="v"+str(item.get("version") or "-"),font=ui.font_obj(9,mono=True),fg=theme["text_muted"],bg=theme["card"]).grid(row=0,column=1,sticky="e")
    valid, reason = _manifest_check(item); check_fg=theme["ok"] if valid else theme["err"]
    _label(body,text=_t(ui,"Manifest：通过","Manifest: valid") if valid else _t(ui,"Manifest：错误 · ","Manifest: error · ")+reason,font=ui.font_obj(9,"bold"),fg=check_fg,bg=theme["card"],anchor="w").grid(row=1,column=0,columnspan=2,sticky="ew",pady=(ui.px(5),0))
    source=str(item.get("source") or "unknown")
    digest=str(item.get("manifest_sha256") or "")
    source_meaning={"bundled":_t(ui,"内置示例","built-in example"),"trusted":_t(ui,"已认可的本地来源","approved local source"),"unknown":_t(ui,"来源未经核实","unverified source")}.get(source,"")
    origin="Source: "+source+(" ("+source_meaning+")" if source_meaning else "")+"  ·  SHA-256: "+(digest[:12] if digest else "—")
    if item.get("installed_at"): origin+="\nInstalled: "+str(item["installed_at"])
    _label(body,text=origin,font=ui.font_obj(9,mono=True),fg=theme["text_muted"],bg=theme["card"],wraplength=ui.px(680),justify="left").grid(row=2,column=0,columnspan=2,sticky="w",pady=(ui.px(4),0))
    if item.get("error"):
        _label(body,text=_t(ui,"错误：","Error: ")+str(item.get("error")),font=ui.font_obj(9),fg=theme["err"],bg=theme["card"],wraplength=ui.px(680),justify="left").grid(row=3,column=0,columnspan=2,sticky="ew",pady=(ui.px(4),0))
    _label(body,text=str(item.get("description") or _t(ui,"无描述","No description")),font=ui.font_obj(9),fg=theme["text_muted"],bg=theme["card"],wraplength=ui.px(680),justify="left").grid(row=4,column=0,columnspan=2,sticky="ew",pady=(ui.px(5),0))
    caps=tk.Frame(body,bg=theme["card"]); caps.grid(row=5,column=0,columnspan=2,sticky="w",pady=(ui.px(6),0))
    for capability in (item.get("capabilities") or []): _tag(caps,ui,str(capability),theme["card"],fill=theme["accent"],fg="#FFFFFF").pack(side="left",padx=(0,ui.px(5)))
    if item.get("legacy"): _tag(caps,ui,"legacy",theme["card"],fill=theme["text_muted"],fg="#FFFFFF").pack(side="left",padx=(0,ui.px(5)))
    perms=tk.Frame(body,bg=theme["card"]); perms.grid(row=6,column=0,columnspan=2,sticky="w",pady=(ui.px(8),0))
    granted=_grants(pid)
    for permission in (item.get("permissions") or []): _permission_badge(perms,ui,pid,permission,permission in granted,refresh,notify)
    controls=tk.Frame(body,bg=theme["card"]); controls.grid(row=7,column=0,columnspan=2,sticky="w",pady=(ui.px(9),0))
    def toggle(value):
        try:
            if not plugins.set_enabled(pid,value): raise RuntimeError("permission_not_granted or invalid manifest")
            if notify: notify("")
        except Exception as exc:
            if notify: notify(_t(ui,"无法启用：","Enable denied: ")+str(exc))
        refresh()
    ToggleSwitch(controls,ui,value=bool(item.get("enabled")),command=toggle,bg=theme["card"]).pack(side="left")
    _label(controls,text=_t(ui,"启用","Enabled"),font=ui.font_obj(9),fg=theme["text_muted"],bg=theme["card"]).pack(side="left",padx=(ui.px(6),ui.px(14)))
    def reload_plugin():
        plugins.unload(pid)
        result=plugins.load(pid)
        if notify: notify("" if result.get("ok") else _t(ui,"加载失败：","Load denied: ")+str(result.get("detail") or result.get("error")))
        refresh()
    _button(controls,ui,_t(ui,"重新加载","Reload"),reload_plugin,"ghost").pack(side="left",padx=(0,ui.px(6)))
    _button(controls,ui,_t(ui,"卸载","Uninstall"),lambda: (_call(lambda: plugins.uninstall(pid),False),refresh()),"ghost").pack(side="left")

def build_plugins_page(app, parent) -> None:
    if _UI is None: return None
    try:
        ui=_UI(app,parent); page=ScrollPage(parent,ui); page.pack(fill="both",expand=True); content=page.content; content.columnconfigure(0,weight=1)
        header=_page_header(content,ui,"EXTENSIONS",_t(ui,"插件中心","Plugin center"),_t(ui,"管理插件、Manifest 与权限授予。","Manage plugins, manifests, and permissions.")); header.grid(row=0,column=0,sticky="ew",pady=(0,ui.px(12)))
        feedback=tk.StringVar(value="")
        _label(content,textvariable=feedback,font=ui.font_obj(9),fg=ui.theme["err"],bg=ui.theme["bg"],wraplength=ui.px(680)).grid(row=1,column=0,sticky="ew")
        host=tk.Frame(content,bg=ui.theme["bg"]); host.grid(row=2,column=0,sticky="ew"); host.columnconfigure(0,weight=1)
        def notify(message): feedback.set(message)
        def refresh():
            _clear(host)
            if plugins is None:
                c=RoundedCard(host,ui,fill=ui.theme["card"],pad=22,radius=14); c.grid(row=0,column=0,sticky="ew"); _label(c.body,text=_t(ui,"内核未就绪","Plugin kernel is not ready"),font=ui.font_obj(14,"bold"),fg=ui.theme["text"],bg=ui.theme["card"]).pack(anchor="w"); return
            try:
                items=plugins.discover()
                if not isinstance(items,list): raise TypeError("invalid plugin discovery result")
                discovery_ok=True
            except Exception:
                items=[]; discovery_ok=False
            status=_call(plugins.status,{})
            grants=[_grants_state(x["id"]) for x in items if isinstance(x,dict) and x.get("id")]
            granted=sum(len(values) for values,ok in grants)
            count_ok=discovery_ok and all(isinstance(x,dict) and x.get("id") for x in items) and all(ok for values,ok in grants)
            count_text=(_t(ui,"权限已授予 {0}","Permissions granted {0}").format(granted) if count_ok
                        else _t(ui,"权限状态不可用","Permission state unavailable"))
            bar=RoundedCard(host,ui,fill=ui.theme["card"],pad=12,radius=12); bar.grid(row=0,column=0,sticky="ew",pady=(0,ui.px(10)))
            _label(bar.body,text=_t(ui,"已装 {0} · 已启用 {1} · {2}","Installed {0} · Enabled {1} · {2}").format(len(items),status.get("enabled",0),count_text),font=ui.font_obj(10,"bold"),fg=ui.theme["text"],bg=ui.theme["card"]).pack(anchor="w")
            _button(bar.body,ui,_t(ui,"刷新","Refresh"),refresh,"ghost").pack(side="right")
            def install():
                folder=filedialog.askdirectory(parent=parent,title=_t(ui,"选择本地插件文件夹","Choose local plugin folder"))
                if not folder: return
                manifest,errors=plugins.validate_manifest(folder)
                if errors:
                    notify(_t(ui,"安装拒绝：","Install denied: ")+", ".join(errors)); return
                source="trusted" if plugins._source_is_trusted(os.path.realpath(folder)) else "unknown"
                details="Source: "+source+"\nPermissions: "+(", ".join(manifest["permissions"]) or "none")
                if not messagebox.askyesno(_t(ui,"确认安装","Confirm installation"),details,parent=parent): return
                result=plugins.install_from_folder(folder)
                notify("" if result.get("ok") else _t(ui,"安装拒绝：","Install denied: ")+str(result.get("error")))
                refresh()
            _button(bar.body,ui,_t(ui,"安装本地插件","Install local plugin"),install,"ghost").pack(side="right",padx=(0,ui.px(8)))
            if not items: _label(host,text=_t(ui,"暂无插件","No plugins installed"),font=ui.font_obj(11),fg=ui.theme["text_muted"],bg=ui.theme["bg"]).grid(row=1,column=0,sticky="w")
            for index,item in enumerate(items,1): _plugin_card(host,app,ui,item,refresh,index,notify)
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

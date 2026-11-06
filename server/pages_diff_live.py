# -*- coding: utf-8 -*-
"""Diff preview, apply and rollback page."""
from __future__ import annotations
import json, sys, tkinter as tk
from tkinter import filedialog, messagebox
try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, Tag, _page_header, _label, _separator
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = Tag = _page_header = _label = _separator = None
__all__ = ["build_diff_page"]

def _pretty(v):
    try: return json.dumps(v, ensure_ascii=False, indent=2, default=str)
    except Exception: return str(v)

def _backend():
    try:
        from hxcore import diffx
        return diffx
    except Exception:
        return None

def build_diff_page(app, parent) -> None:
    try:
        ui = _UI(app, parent); theme = ui.theme; t = ui.t
        page = ScrollPage(parent, ui); page.pack(fill="both", expand=True)
        content = page.content; content.columnconfigure(0, weight=1)
        header = _page_header(content, ui, "DIFF", t("差异预览", "Diff preview"), t("检查补丁后再应用或回滚。", "Review a patch before applying or reverting it."))
        header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(10)))
        card = RoundedCard(content, ui, pad=12, radius=8, shadow=False); card.grid(row=1,column=0,sticky="ew")
        body=card.body; body.columnconfigure(0,weight=1)
        status=_label(body,text="",font=ui.font_obj(9),fg=theme["text_muted"],bg=theme["card"],anchor="w"); status.grid(row=0,column=0,sticky="w")
        target=tk.StringVar()
        target_entry=tk.Entry(body,textvariable=target,relief="flat",font=ui.font_obj(9),bg=theme["input_bg"],fg=theme["text"])
        target_entry.grid(row=1,column=0,sticky="ew",pady=(ui.px(6),ui.px(4)),ipadx=ui.px(6),ipady=ui.px(4))
        patch=tk.Text(body,height=10,wrap="none",font=ui.font_obj(9,mono=True),bg=theme["input_bg"],fg=theme["text"],relief="flat"); patch.grid(row=2,column=0,sticky="ew",pady=(ui.px(4),ui.px(8)))
        stats=_label(body,text=t("尚未预览", "Not previewed"),font=ui.font_obj(9),fg=theme["text_muted"],bg=theme["card"],anchor="w"); stats.grid(row=3,column=0,sticky="w")
        hunks=tk.Frame(body,bg=theme["card"]); hunks.grid(row=4,column=0,sticky="ew",pady=(ui.px(8),0))
        actions=tk.Frame(body,bg=theme["card"]); actions.grid(row=5,column=0,sticky="w",pady=(ui.px(8),0))
        state={"backup":""}
        def show_hunks(parsed):
            for c in hunks.winfo_children(): c.destroy()
            for h in parsed or []:
                c=RoundedCard(hunks,ui,pad=8,radius=6,shadow=False); c.pack(fill="x",pady=(0,ui.px(6)))
                txt='\n'.join(str(x) for x in h.get("lines",[])); _label(c.body,text=txt,font=ui.font_obj(8,mono=True),fg=theme["text"],bg=theme["card"],anchor="w",justify="left",wraplength=700).pack(fill="x")
        def preview():
            api=_backend()
            if api is None: status.configure(text=t("模块未就绪", "Module not ready")); return
            try:
                raw=patch.get("1.0","end-1c"); info=api.preview(raw); stats.configure(text=t("文件 %(files)s · 新增 %(added)s · 删除 %(removed)s · 块 %(hunks)s", "Files %(files)s · Added %(added)s · Removed %(removed)s · Hunks %(hunks)s") % info); show_hunks(api.parse(raw)); status.configure(text=t("预览完成", "Preview ready"))
            except Exception as exc: status.configure(text=t("预览失败：", "Preview failed: ")+str(exc))
        def load_file():
            try:
                path=filedialog.askopenfilename(filetypes=[("Patch","*.patch *.diff"),("All files","*.*")])
                if path:
                    with open(path,"r",encoding="utf-8") as f: patch.delete("1.0","end"); patch.insert("1.0",f.read())
            except Exception as exc: status.configure(text=t("读取失败：", "Read failed: ")+str(exc))
        def apply_patch():
            api=_backend()
            if api is None: status.configure(text=t("模块未就绪", "Module not ready")); return
            try:
                if not messagebox.askyesno(t("确认应用", "Confirm apply"), t("确定应用此补丁？会先创建备份。", "Apply this patch? A backup will be created first."), parent=ui.root): return
                result=api.apply(target.get().strip(),patch.get("1.0","end-1c"),backup=True); state["backup"]=result.get("backup",""); status.configure(text=t("已应用，备份：", "Applied, backup: ")+state["backup"] if result.get("ok") else t("应用失败：", "Apply failed")+str(result.get("error","")))
            except Exception as exc: status.configure(text=t("应用失败：", "Apply failed")+str(exc))
        def revert():
            api=_backend()
            if api is None: status.configure(text=t("模块未就绪", "Module not ready")); return
            try:
                if not state["backup"]: status.configure(text=t("没有可回滚的备份", "No backup to revert")); return
                if messagebox.askyesno(t("确认回滚", "Confirm revert"), t("确定回滚最近一次应用？", "Revert the latest apply?"), parent=ui.root): status.configure(text=_pretty(api.revert(state["backup"])))
            except Exception as exc: status.configure(text=t("回滚失败：", "Revert failed")+str(exc))
        for text,cmd in ((t("打开补丁", "Open patch"),load_file),(t("预览", "Preview"),preview),(t("应用", "Apply"),apply_patch),(t("回滚最近一次", "Revert latest"),revert)):
            PillButton(actions,ui,text,command=cmd,kind="primary" if text in (t("预览","Preview"),t("应用","Apply")) else "ghost",bg=theme["card"]).pack(side="left",padx=(0,ui.px(6)))
        if _backend() is None: status.configure(text=t("模块未就绪", "Module not ready"))
        page.bind_wheel()
    except Exception:
        try: tk.Label(parent,text=t("模块未就绪", "Module not ready")).pack(fill="both",expand=True)
        except Exception: pass

def _selftest():
    assert _pretty({"ok":True}).startswith("{")
    assert _backend() is None or hasattr(_backend(), "preview")
    assert isinstance(_pretty(None),str)
    print("SELFTEST OK")
if __name__ == "__main__" and "--selftest" in sys.argv: _selftest()
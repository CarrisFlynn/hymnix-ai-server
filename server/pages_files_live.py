# -*- coding: utf-8 -*-
"""File tree and repository search page."""
from __future__ import annotations

import fnmatch
import os
import tkinter as tk
from tkinter import ttk

try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, _page_header, _separator
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = _page_header = _separator = None

try:
    from hxcore import fstree
except Exception:
    fstree = None


def _t(ui, zh, en):
    try:
        return ui.t(zh, en)
    except Exception:
        return zh


def _call(fn, default):
    try:
        return fn()
    except Exception:
        return default


def _safe_text(value):
    return str(value or "").replace("\x00", "")


def _format_size(size):
    try:
        value = float(size)
    except Exception:
        return "-"
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return "-"


def _format_mtime(value):
    try:
        import datetime
        return datetime.datetime.fromtimestamp(float(value)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return "-"


def visible_slice(items, shown=200):
    """Return visible prefix and remaining count."""
    values = list(items or [])
    limit = max(0, int(shown))
    return values[:limit], max(0, len(values) - limit)


def _matches_type(rel, mode):
    if mode == "all":
        return None
    code = {".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".css", ".html", ".yaml", ".yml"}
    text = {".md", ".txt", ".rst", ".csv", ".log", ".ini", ".cfg"}
    ext = os.path.splitext(str(rel))[1].lower()
    return ext in (code if mode == "code" else text)


def _tree_rows(ui, parent, root_path, on_open):
    frame = tk.Frame(parent, bg=ui.theme["card"])
    tree = ttk.Treeview(frame, show="tree headings", columns=("size", "mtime", "rel"), selectmode="browse")
    tree.heading("#0", text="Name")
    tree.heading("size", text=_t(ui, "大小", "Size"))
    tree.heading("mtime", text=_t(ui, "修改时间", "Modified"))
    tree.heading("rel", text="", anchor="w")
    tree.column("#0", minwidth=150, width=230, stretch=True)
    tree.column("size", minwidth=65, width=80, stretch=False)
    tree.column("mtime", minwidth=120, width=135, stretch=False)
    tree.column("rel", width=0, minwidth=0, stretch=False)
    scroll = tk.Scrollbar(frame, orient="vertical", command=tree.yview)
    tree.configure(yscrollcommand=scroll.set)
    tree.pack(side="left", fill="both", expand=True)
    scroll.pack(side="right", fill="y")
    def add(path, parent_id, depth=0):
        rows = _call(lambda: fstree.tree(path, depth=depth, limit=300), []) if fstree else []
        for row in rows:
            rel = _safe_text(row.get("rel"))
            name = _safe_text(row.get("name") or rel.rsplit("/", 1)[-1])
            iid = tree.insert(parent_id, "end", text=name, values=(_format_size(row.get("size")), _format_mtime(row.get("mtime")), rel))
            if row.get("is_dir"):
                tree.insert(iid, "end", text="…", values=("", ""))
    add(root_path, "", 1)
    def expand(event=None):
        item = tree.focus()
        if not item:
            return
        values = tree.item(item, "values")
        rel = values[2] if len(values) > 2 else tree.item(item, "text")
        try:
            children = tree.get_children(item)
            if len(children) == 1 and tree.item(children[0], "text") == "…":
                tree.delete(children[0])
                path = rel
                add(path, item, 1)
        except Exception:
            pass
        on_open(rel)
    tree.bind("<Double-1>", expand)
    return frame


def _render_search(ui, parent, root_path, status_label):
    theme = ui.theme
    query = tk.StringVar()
    mode = tk.StringVar(value="all")
    results = tk.Listbox(parent, bg=theme["card"], fg=theme["text"], selectbackground=theme["accent_soft"],
                         highlightthickness=1, highlightbackground=theme["sep"], activestyle="none")
    results.grid(row=1, column=0, sticky="nsew", pady=(ui.px(8), 0))
    pending = {"id": None}
    state = {"hits": [], "shown": 200}
    def run(reset=True):
        pending["id"] = None
        results.delete(0, "end")
        if reset:
            state["shown"] = 200
        text = query.get().strip()
        if not text or fstree is None:
            if fstree is None:
                results.insert("end", _t(ui, "模块未就绪 / Module not ready", "Module not ready"))
            return
        include = None if mode.get() == "all" else ("py,js,ts,tsx,jsx,json,css,html,yaml,yml" if mode.get() == "code" else "md,txt,rst,csv,log,ini,cfg")
        hits = _call(lambda: fstree.search_text(text, path=root_path, include=include, limit=10000), [])
        state["hits"] = list(hits or [])
        visible, remaining = visible_slice(state["hits"], state["shown"])
        for hit in visible:
            rel = _safe_text(hit.get("rel"))
            line = hit.get("line", "?")
            snippet = _safe_text(hit.get("text"))[:180]
            results.insert("end", f"{rel}:{line}  {snippet}")
        status_label.configure(text=_t(ui, "命中 {0} 条", "{0} matches").format(len(state["hits"])))
        if remaining:
            results.insert("end", _t(ui, "加载更多（剩余 {0}）", "Load more ({0} remaining)").format(remaining))
            results.bind("<Double-Button-1>", lambda _e: load_more())
    def load_more():
        state["shown"] += 200
        run(reset=False)
    def schedule(_event=None):
        if pending["id"]:
            try:
                parent.after_cancel(pending["id"])
            except Exception:
                pass
        try:
            pending["id"] = parent.after(300, run)
        except Exception:
            run()
    query.trace_add("write", lambda *_: schedule())
    controls = getattr(parent, "_file_controls", None)
    if controls is not None:
        tk.Entry(controls, textvariable=query, width=28).pack(side="left", padx=(ui.px(8), ui.px(5)))
        for label, value in ((_t(ui, "全部", "All"), "all"), (_t(ui, "代码", "Code"), "code"), (_t(ui, "文本", "Text"), "text")):
            tk.Radiobutton(controls, text=label, variable=mode, value=value, bg=theme["card"], command=run).pack(side="left")
    return results


def build_files_page(app, parent) -> None:
    if _UI is None:
        return None
    try:
        ui = _UI(app, parent)
        page = ScrollPage(parent, ui)
        page.pack(fill="both", expand=True)
        content = page.content
        content.columnconfigure(0, weight=1)
        header = _page_header(content, ui, "WORKSPACE", _t(ui, "文件与检索", "Files & search"), _t(ui, "浏览工作区文件并搜索文本。", "Browse workspace files and search text."))
        header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(12)))
        if fstree is None:
            card = RoundedCard(content, ui, fill=ui.theme["card"], pad=22, radius=14)
            card.grid(row=1, column=0, sticky="ew")
            tk.Label(card.body, text=_t(ui, "模块未就绪 / Module not ready", "Module not ready"), bg=ui.theme["card"], fg=ui.theme["text"]).pack(anchor="w")
            return page
        root_path = _call(fstree.root, os.getcwd())
        split = tk.Frame(content, bg=ui.theme["bg"])
        split.grid(row=1, column=0, sticky="nsew")
        split.columnconfigure(0, weight=1); split.columnconfigure(1, weight=1); split.rowconfigure(0, weight=1)
        left = RoundedCard(split, ui, fill=ui.theme["card"], pad=10, radius=12); left.grid(row=0, column=0, sticky="nsew", padx=(0, ui.px(8)))
        right = RoundedCard(split, ui, fill=ui.theme["card"], pad=10, radius=12); right.grid(row=0, column=1, sticky="nsew")
        left.body.columnconfigure(0, weight=1); left.body.rowconfigure(0, weight=1)
        right.body.columnconfigure(0, weight=1); right.body.rowconfigure(1, weight=1)
        _tree_rows(ui, left.body, root_path, lambda _: None).grid(row=0, column=0, sticky="nsew")
        controls = tk.Frame(right.body, bg=ui.theme["card"]); controls.grid(row=0, column=0, sticky="ew")
        right.body._file_controls = controls
        status = tk.Label(right.body, text=_t(ui, "输入查询开始搜索", "Enter a query to search"), bg=ui.theme["card"], fg=ui.theme["text_muted"], anchor="w")
        status.grid(row=2, column=0, sticky="ew", pady=(ui.px(6), 0))
        _render_search(ui, right.body, root_path, status)
        stats = _call(fstree.stats, {})
        footer = tk.Label(content, text=_t(ui, "扫描 {0} 文件 / {1} 目录", "Scanned {0} files / {1} dirs").format(stats.get("files", 0), stats.get("dirs", 0)), bg=ui.theme["bg"], fg=ui.theme["text_muted"])
        footer.grid(row=2, column=0, sticky="w", pady=(ui.px(8), 0))
        return page
    except Exception as exc:
        import traceback
        traceback.print_exc(limit=2)
        try:
            for child in parent.winfo_children():
                child.destroy()
            tk.Label(parent, text=_t(ui, "模块未就绪", "Module not ready"), anchor="w").pack(fill="both", expand=True)
        except Exception:
            pass
        return None


def _selftest():
    assert _format_size(1024) == "1.0 KB"
    assert _matches_type("a.py", "code") is True
    assert _matches_type("a.md", "text") is True
    assert _matches_type("a.py", "text") is False
    print("SELFTEST OK")


if __name__ == "__main__":
    _selftest()

# -*- coding: utf-8 -*-
"""崩溃报告浏览页。"""
from __future__ import annotations

import ast
import os
import pathlib
import shutil
import subprocess
import sys
import tkinter as tk
import tkinter.font as tkfont

try:
    from i18n import t as _translate
except Exception:
    _translate = None

try:
    from pages_modern import RoundedCard, ScrollPage, PillButton, Tag, _UI, _label, _page_header, _separator
except Exception:
    RoundedCard = ScrollPage = PillButton = Tag = _UI = _label = _page_header = _separator = None


def _t(app, zh: str, en: str) -> str:
    """Return the Chinese or English string for the active UI language."""
    lang = ""
    try:
        lang = str(getattr(app, "LANG", {}).get("cur") or "")
    except Exception:
        lang = ""
    if not lang:
        lang = str(os.environ.get("HYMNIX_LANG") or "")
    if not lang:
        lang = str(getattr(app, "_lang", "") or "")
    if not lang or lang.lower().startswith("zh"):
        return zh
    if lang.lower().startswith("en"):
        return en
    return en

def _fallback_page(parent, text: str) -> None:
    try:
        tk.Label(parent, text=text, anchor="nw", justify="left").pack(fill="both", expand=True, padx=16, pady=16)
    except Exception:
        pass


def _get_backend():
    try:
        from hxcore import crash
        return crash
    except Exception:
        return None


def visible_slice(items, shown=200):
    """Return visible prefix and remaining count."""
    values = list(items or [])
    limit = max(0, int(shown))
    return values[:limit], max(0, len(values) - limit)


def _summary(report: dict) -> tuple[str, str]:
    trace = str(report.get("traceback", "") or "")
    error_type = str(report.get("exception_type", "") or "")
    message = str(report.get("message", "") or "")
    if trace:
        for line in reversed(trace.strip().splitlines()):
            candidate = line.strip()
            if candidate and not candidate.startswith("File ") and not candidate.startswith("^"):
                if not error_type:
                    error_type = candidate.split(":", 1)[0]
                if not message and ":" in candidate:
                    message = candidate.split(":", 1)[1].strip()
                break
    return error_type or "Exception", message or ""


def _make_ui(app, parent):
    if _UI is None:
        return None
    try:
        return _UI(app, parent)
    except Exception:
        return None


def build_crash_page(app, parent) -> None:
    """构建崩溃报告列表；不让后端或控件异常逃逸。"""
    try:
        backend = _get_backend()
        if backend is None:
            _fallback_page(parent, _t(app, "崩溃模块未就绪", "Crash module is not ready"))
            return
        if any(item is None for item in (RoundedCard, ScrollPage, PillButton, Tag, _UI, _label)):
            _fallback_page(parent, _t(app, "崩溃报告页面组件未就绪", "Crash report page components are not ready"))
            return
        try:
            reports = backend.list_reports(1000)
            if not isinstance(reports, list):
                reports = []
        except Exception:
            reports = []
        try:
            session = backend.last_session()
            if not isinstance(session, dict):
                session = {}
        except Exception:
            session = {}
        ui = _make_ui(app, parent)
        if ui is None:
            _fallback_page(parent, _t(app, "崩溃报告页面未能初始化", "Crash report page could not be initialized"))
            return
        theme = ui.theme
        page = ScrollPage(parent, ui)
        page.pack(fill="both", expand=True)
        content = page.content
        header = _page_header(content, ui, "DIAGNOSTICS",
                              _t(app, "崩溃报告", "Crash reports"),
                              _t(app, "查看异常记录与上次会话状态。", "Review exceptions and the previous session status."))
        header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(12)))
        state = {"reports": reports, "shown": 200}
        recent = reports[0] if reports else {}
        recent_time = str(recent.get("timestamp", recent.get("time", "-")) or "-")
        abnormal = bool(session.get("crashed", False)) or (bool(session.get("started")) and not bool(session.get("clean_exit", False)))
        stats = RoundedCard(content, ui, fill=theme["card"], pad=12, radius=12)
        stats.grid(row=1, column=0, sticky="ew", pady=(0, ui.px(12)))
        stats.body.columnconfigure(0, weight=1)
        stats.body.columnconfigure(1, weight=1)
        stats.body.columnconfigure(2, weight=1)
        _label(stats.body, text=_t(app, "报告总数", "Reports") + ": " + str(len(reports)),
               bg=theme["card"], fg=theme["text"], font=ui.font_obj(10, "bold")).grid(row=0, column=0, sticky="w")
        _label(stats.body, text=_t(app, "最近崩溃", "Last crash") + ": " + recent_time,
               bg=theme["card"], fg=theme["text"], font=ui.font_obj(9)).grid(row=0, column=1, sticky="w", padx=(8, 8))
        state_text = _t(app, "异常退出", "Abnormal exit") if abnormal else _t(app, "正常退出", "Clean exit")
        Tag(stats.body, ui, state_text, bg=theme["card"], fill=theme["err"] if abnormal else theme["ok"], fg="#FFFFFF", mono=False).grid(row=0, column=2, sticky="e")
        if not reports:
            _label(content, text=_t(app, "暂无崩溃记录", "No crash reports"),
                   bg=theme["bg"], fg=theme["text_muted"], font=ui.font_obj(11)).grid(row=2, column=0, sticky="w", pady=ui.px(24))
            page.bind_wheel()
            return
        visible, remaining = visible_slice(reports, state["shown"])
        for index, report in enumerate(visible):
            try:
                if not isinstance(report, dict):
                    continue
                card = RoundedCard(content, ui, fill=theme["card"], pad=14, radius=12)
                card.grid(row=index + 2, column=0, sticky="ew", pady=(0, ui.px(10)))
                body = card.body
                body.columnconfigure(0, weight=1)
                timestamp = str(report.get("timestamp", report.get("time", "-")) or "-")
                page_name = str(report.get("page", "-") or "-")
                error_type, message = _summary(report)
                _label(body, text=timestamp + "  ·  " + _t(app, "页面", "Page") + ": " + page_name,
                       bg=theme["card"], fg=theme["text_muted"], font=ui.font_obj(9)).grid(row=0, column=0, sticky="ew")
                _label(body, text=error_type + (": " + message if message else ""),
                       bg=theme["card"], fg=theme["text"], font=ui.font_obj(10, "bold"),
                       justify="left", anchor="w", wraplength=ui.px(900)).grid(row=1, column=0, sticky="ew", pady=(ui.px(5), ui.px(8)))
                detail = tk.Frame(body, bg=theme["card"])
                detail.grid(row=2, column=0, sticky="ew")
                detail.columnconfigure(0, weight=1)
                stack = tk.Text(detail, height=10, wrap="none", state="disabled",
                                font=tkfont.Font(root=ui.root, family=ui.mono, size=9),
                                bg=theme["input_bg"], fg=theme["text"], relief="flat", bd=0)
                scroll = tk.Scrollbar(detail, orient="vertical", command=stack.yview)
                stack.configure(yscrollcommand=scroll.set)
                stack.grid(row=0, column=0, sticky="ew")
                scroll.grid(row=0, column=1, sticky="ns")
                try:
                    stack.configure(state="normal")
                    stack.insert("1.0", str(report.get("traceback", "") or ""))
                    stack.configure(state="disabled")
                except Exception:
                    pass
                detail.grid_remove()
                controls = tk.Frame(body, bg=theme["card"])
                controls.grid(row=3, column=0, sticky="ew", pady=(ui.px(8), 0))
                def toggle(target=detail, button_text=None):
                    try:
                        if target.winfo_manager():
                            target.grid_remove()
                        else:
                            target.grid()
                    except Exception:
                        pass
                expand = PillButton(controls, ui, _t(app, "展开堆栈", "Show stack"), command=toggle, kind="ghost", bg=theme["card"])
                expand.grid(row=0, column=0, sticky="w")
                def copy_stack(value=str(report.get("traceback", "") or "")):
                    try:
                        ui.root.clipboard_clear()
                        ui.root.clipboard_append(value)
                    except Exception:
                        pass
                PillButton(controls, ui, _t(app, "复制", "Copy"), command=copy_stack, kind="ghost", bg=theme["card"]).grid(row=0, column=1, sticky="w", padx=(ui.px(6), 0))
                report_path = pathlib.Path(str(report.get("path", "") or ""))
                def open_folder(path=report_path):
                    try:
                        folder = path.parent if path.is_file() or path.suffix else path
                        if folder.exists():
                            if os.name == "nt":
                                os.startfile(str(folder))
                            elif sys.platform == "darwin":
                                subprocess.Popen(["open", str(folder)])
                            else:
                                subprocess.Popen(["xdg-open", str(folder)])
                    except Exception:
                        pass
                PillButton(controls, ui, _t(app, "打开目录", "Open folder"), command=open_folder, kind="ghost", bg=theme["card"]).grid(row=0, column=2, sticky="w", padx=(ui.px(6), 0))
                def delete_report(path=report_path, holder=card):
                    try:
                        if path.is_file():
                            path.unlink()
                            text_path = path.with_suffix(".txt")
                            if text_path.is_file():
                                text_path.unlink()
                            holder.destroy()
                    except Exception:
                        pass
                PillButton(controls, ui, _t(app, "删除", "Delete"), command=delete_report, kind="ghost", bg=theme["card"]).grid(row=0, column=3, sticky="w", padx=(ui.px(6), 0))
            except Exception:
                continue
        if remaining:
            more = PillButton(content, ui, _t(app, "加载更多（剩余 %d）", "Load more (%d remaining)") % remaining, command=lambda: load_more(), kind="ghost", bg=theme["bg"])
            more.grid(row=202, column=0, sticky="w", pady=(0, ui.px(10)))
        def load_more():
            state["shown"] += 200
            more.destroy()
            visible_more, left = visible_slice(reports, state["shown"])
            start = state["shown"] - 200
            for index, report in enumerate(visible_more[start:], start=202 + start):
                try:
                    card = RoundedCard(content, ui, fill=theme["card"], pad=14, radius=12)
                    card.grid(row=index, column=0, sticky="ew", pady=(0, ui.px(10)))
                    _label(card.body, text=str(report.get("timestamp", report.get("time", "-"))) + "  " + _summary(report)[0] + ": " + _summary(report)[1], bg=theme["card"], fg=theme["text"], font=ui.font_obj(10)).pack(anchor="w")
                except Exception:
                    continue
            if left:
                button = PillButton(content, ui, _t(app, "加载更多（剩余 %d）", "Load more (%d remaining)") % left, command=load_more, kind="ghost", bg=theme["bg"])
                button.grid(row=202 + state["shown"], column=0, sticky="w")
        page.bind_wheel()
    except Exception:
        _fallback_page(parent, _t(app, "崩溃报告页面未能加载", "Crash reports could not be loaded"))


def build(app, parent) -> None:
    """兼容集成端统一的 build 入口。"""
    try:
        return build_crash_page(app, parent)
    except Exception:
        _fallback_page(parent, _t(app, "崩溃报告页面未能加载", "Crash reports could not be loaded"))


def _selftest() -> int:
    path = pathlib.Path(__file__)
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    names = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    required = {"build_crash_page", "build", "_selftest"}
    if not required.issubset(names):
        raise AssertionError("missing required functions: " + repr(sorted(required - names)))
    for symbol in ("list_reports", "last_session", "暂无崩溃记录", "崩溃模块未就绪", "复制", "打开目录", "删除"):
        if symbol not in source:
            raise AssertionError("missing marker: " + symbol)
    import importlib.util
    spec = importlib.util.spec_from_file_location("pages_crash_live_selftest", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not callable(module.build_crash_page) or not callable(module.build):
        raise AssertionError("page entrypoint not callable")
    print("SELFTEST OK")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())

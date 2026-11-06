# -*- coding: utf-8 -*-
"""Live session history search page."""
from __future__ import annotations

import json
import sys
import tkinter as tk
import threading
import queue

try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, Tag, SlimScrollbar, _label, _separator
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = Tag = SlimScrollbar = None
    _label = _separator = None

__all__ = ["build_history_page", "build"]


def _translator(app, ui):
    """Prefer an injected i18n translator, then the shared UI translator."""
    i18n = getattr(app, "i18n", None)
    fn = getattr(i18n, "t", None) if i18n is not None else None
    if callable(fn):
        return lambda zh, en: fn(zh, en)
    return ui.t


def _as_list(value):
    if isinstance(value, dict):
        for key in ("items", "sessions", "messages", "results"):
            if isinstance(value.get(key), list):
                return value[key]
    return list(value) if isinstance(value, (list, tuple)) else []


def visible_slice(items, shown=200):
    """Return visible prefix and remaining count."""
    values = list(items or [])
    limit = max(0, int(shown))
    return values[:limit], max(0, len(values) - limit)


def _session_id(item):
    return str(item.get("id") or item.get("session_id") or item.get("sessionId") or "") if isinstance(item, dict) else str(item)


def _session_title(item):
    if not isinstance(item, dict):
        return str(item)
    return str(item.get("title") or item.get("name") or item.get("subject") or _session_id(item) or "Untitled")


def build_history_page(app, parent) -> None:
    try:
        ui = _UI(app, parent)
        t = _translator(app, ui)
        theme = ui.theme
        page = ScrollPage(parent, ui)
        page.pack(fill="both", expand=True)
        content = page.content
        content.columnconfigure(0, weight=1)
        header = tk.Frame(content, bg=theme["bg"])
        header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(10)))
        header.columnconfigure(0, weight=1)
        _label(header, text=t("会话历史", "Session history"), font=ui.font_obj(20, "bold"), fg=theme["text"], bg=theme["bg"]).grid(row=0, column=0, sticky="w")
        _label(header, text=t("搜索并查看过往消息", "Search and review past messages"), font=ui.font_obj(10), fg=theme["text_muted"], bg=theme["bg"]).grid(row=1, column=0, sticky="w", pady=(ui.px(4), 0))
        stats_var = tk.StringVar(value="")
        stats_label = _label(header, text="", font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["bg"])
        stats_label.grid(row=2, column=0, sticky="w", pady=(ui.px(6), 0))

        def _fmt_size(nbytes):
            try:
                nbytes = int(nbytes)
            except Exception:
                nbytes = 0
            if nbytes >= 1048576:
                return "%.1f MB" % (nbytes / 1048576.0)
            return "%d KB" % max(1, int(nbytes / 1024.0))

        def update_stats():
            try:
                from hxcore import history
                data = history.stats() or {}
                text = "%s %d  ·  %s %d  ·  %s %s" % (
                    t("会话", "Sessions"), int(data.get("sessions") or 0),
                    t("消息", "Messages"), int(data.get("messages") or 0),
                    t("数据量", "Size"), _fmt_size(data.get("bytes") or 0))
            except Exception:
                text = t("统计不可用", "Stats unavailable")
            try:
                stats_label.configure(text=text)
            except Exception:
                pass

        query = tk.StringVar()
        search = tk.Entry(header, textvariable=query, relief="flat", font=ui.font_obj(10), bg=theme["input_bg"], fg=theme["text"])
        search.grid(row=0, column=1, rowspan=3, sticky="e", padx=(ui.px(12), 0), ipadx=ui.px(8), ipady=ui.px(6))

        columns = tk.Frame(content, bg=theme["bg"])
        columns.grid(row=1, column=0, sticky="nsew")
        columns.columnconfigure(0, weight=1, uniform="history")
        columns.columnconfigure(1, weight=2, uniform="history")
        left = RoundedCard(columns, ui, pad=12, radius=8, shadow=False)
        right = RoundedCard(columns, ui, pad=12, radius=8, shadow=False)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, ui.px(6)))
        right.grid(row=0, column=1, sticky="nsew", padx=(ui.px(6), 0))
        lb, rb = left.body, right.body
        lb.columnconfigure(0, weight=1); rb.columnconfigure(0, weight=1)
        _label(lb, text=t("会话", "Sessions"), font=ui.font_obj(12, "bold"), fg=theme["text"], bg=theme["card"]).grid(row=0, column=0, sticky="w")
        _label(rb, text=t("消息", "Messages"), font=ui.font_obj(12, "bold"), fg=theme["text"], bg=theme["card"]).grid(row=0, column=0, sticky="w")
        session_list = tk.Frame(lb, bg=theme["card"]); session_list.grid(row=1, column=0, sticky="nsew", pady=(ui.px(8), 0))
        message_list = tk.Frame(rb, bg=theme["card"]); message_list.grid(row=1, column=0, sticky="nsew", pady=(ui.px(8), 0))
        state = {"sessions": [], "selected": "", "after": None, "shown": 50, "msg_shown": 100, "results": queue.Queue(), "seq": 0, "busy": False}
        def clear(frame):
            for child in frame.winfo_children(): child.destroy()
        def start_worker(kind, **kwargs):
            if state.get("busy"): return
            state["busy"] = True; state["seq"] += 1; seq = state["seq"]
            def run():
                try:
                    from hxcore import history
                    if kind == "messages": value = history.messages(kwargs["sid"])
                    else:
                        value = history.search(kwargs.get("term", "")) if kwargs.get("term") else history.sessions()
                        value = _as_list(value)[:kwargs.get("limit", 50)]
                    state["results"].put((seq, kind, _as_list(value), None))
                except Exception as exc: state["results"].put((seq, kind, [], str(exc)))
            threading.Thread(target=run, daemon=True).start()
        def poll_results():
            try:
                while True:
                    seq, kind, value, error = state["results"].get_nowait()
                    if seq != state["seq"]: continue
                    state["busy"] = False
                    if error: render_sessions([]) if kind == "sessions" else render_messages([])
                    elif kind == "messages": render_messages(value)
                    else: render_sessions(value)
            except queue.Empty: pass
            try: page.after(60, poll_results)
            except tk.TclError: pass

        def show_messages(sid):
            state["selected"] = sid; state["msg_shown"] = 100; clear(message_list)
            _label(message_list, text=t("加载中…", "Loading…"), font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w")
            start_worker("messages", sid=sid, limit=state["msg_shown"])
        def render_messages(rows):
            clear(message_list)
            state["messages"] = _as_list(rows)
            if not state["messages"]:
                _label(message_list, text=t("暂无消息", "No messages"), font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w"); return
            for msg in state["messages"][:state["msg_shown"]]:
                msg = msg if isinstance(msg, dict) else {"content": str(msg)}
                role = str(msg.get("role") or msg.get("sender") or "message").strip() or "message"
                Tag(message_list, ui, role.upper(), bg=theme["card"], fill=theme["chip_bg"], fg=theme["accent"]).pack(anchor="w", pady=(ui.px(4), 0))
                text = msg.get("content") or msg.get("text") or msg.get("message") or ""
                _label(message_list, text=str(text), font=ui.font_obj(9), fg=theme["text"], bg=theme["card"], justify="left", anchor="w", wraplength=500).pack(fill="x", pady=(ui.px(3), ui.px(6)))
            if len(state["messages"]) >= state["msg_shown"]:
                tk.Button(message_list, text=t("加载更多", "Load more"), command=lambda: (state.__setitem__("msg_shown", state["msg_shown"] + 100), start_worker("messages", sid=state["selected"], limit=state["msg_shown"])), relief="flat").pack(anchor="w")
            else:
                _label(message_list, text=t("已全部加载", "All loaded"), font=ui.font_obj(8), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w")

        def render_sessions(rows, reset=True):
            if reset:
                state["shown"] = 50
            state["sessions"] = _as_list(rows); clear(session_list)
            if not state["sessions"]:
                _label(session_list, text=t("暂无历史记录", "No history yet"), font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w")
                _label(session_list, text=t("在对话页发送消息后会自动记录到这里。", "Messages you send in Chat are saved here automatically."), font=ui.font_obj(8), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w", pady=(ui.px(3), 0)); return
            visible, remaining = visible_slice(state["sessions"], state["shown"])
            for item in visible:
                sid = _session_id(item); title = _session_title(item)
                count = item.get("count", item.get("message_count", "")) if isinstance(item, dict) else ""
                stamp = item.get("last_time", item.get("updated_at", item.get("ts", ""))) if isinstance(item, dict) else ""
                row = tk.Frame(session_list, bg=theme["card"]); row.pack(fill="x", pady=(0, ui.px(5)))
                _label(row, text=title, font=ui.font_obj(9, "bold"), fg=theme["text"], bg=theme["card"], anchor="w").pack(fill="x")
                _label(row, text=("%s  %s" % (stamp, count)).strip(), font=ui.font_obj(8), fg=theme["text_muted"], bg=theme["card"], anchor="w").pack(fill="x")
                row.bind("<Button-1>", lambda _e, value=sid: show_messages(value))
                for child in row.winfo_children(): child.bind("<Button-1>", lambda _e, value=sid: show_messages(value))
            if remaining:
                more = tk.Button(session_list, text=t("加载更多（剩余 %d）", "Load more (%d remaining)") % remaining, command=lambda: (state.__setitem__("shown", state["shown"] + 50), start_worker("sessions", term=query.get().strip(), limit=state["shown"])), relief="flat")
                more.pack(anchor="w", pady=(ui.px(6), 0))
        def load(term=""):
            state["shown"] = 50
            start_worker("sessions", term=term, limit=state["shown"])
            try: update_stats()
            except Exception: pass
        def debounce(*_args):
            if state["after"]:
                try: page.after_cancel(state["after"])
                except Exception: pass
            state["after"] = page.after(300, lambda: load(query.get().strip()))
        query.trace_add("write", debounce)
        try:
            refresh_btn = PillButton(header, ui, t("刷新", "Refresh"),
                                     command=lambda: load(query.get().strip()), kind="ghost")
            refresh_btn.grid(row=0, column=2, rowspan=3, sticky="e", padx=(ui.px(8), 0))
        except Exception:
            pass
        page.after(60, poll_results)
        load()
        page.bind_wheel()
    except Exception:
        try: tk.Label(parent, text=t("历史模块未就绪", "History module is not ready")).pack(fill="both", expand=True)
        except Exception: pass


def build(app, parent):
    return build_history_page(app, parent)


def _selftest():
    assert _session_id({"sessionId": "abc"}) == "abc"
    assert _session_title({"title": "Demo"}) == "Demo"
    assert len(_as_list({"items": [1, 2]})) == 2
    assert _as_list(None) == []
    print("SELFTEST OK")

if __name__ == "__main__" and "--selftest" in sys.argv:
    _selftest()

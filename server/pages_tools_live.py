# -*- coding: utf-8 -*-
"""Tools registry and invocation timeline page."""
from __future__ import annotations

import json
import sys
import tkinter as tk
from itertools import islice
from collections.abc import Sequence

try:
    from pages_modern import (
        _UI, ScrollPage, RoundedCard, PillButton, _page_header, _label,
        _tag, _separator,
    )
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = None
    _page_header = _label = _tag = _separator = None

__all__ = ["build_tools_page"]


def _pretty(value):
    """Return readable JSON for values shown in the result and timeline."""
    try:
        return json.dumps(value, ensure_ascii=False, indent=2, default=str)
    except Exception:
        return str(value)


def _events(value):
    """Accept only dictionary timeline entries and cap rendering at 200."""
    if not isinstance(value, (list, tuple)):
        return []
    return [item for item in value[-200:] if isinstance(item, dict)]


def visible_slice(items, shown=100):
    limit = max(0, int(shown))
    if items is None:
        return [], 0
    if isinstance(items, Sequence):
        total = len(items)
        return items[:limit], max(0, total - limit)
    values = list(islice(iter(items), limit + 1))
    return values[:limit], len(values) > limit


def _status(event):
    if event.get("phase") == "begin":
        return "running"
    return "ok" if bool(event.get("ok")) else "fail"


def build_tools_page(app, parent) -> None:
    """Build the tool registry and live call timeline."""
    try:
        ui = _UI(app, parent)
        theme = ui.theme
        page = ScrollPage(parent, ui)
        page.pack(fill="both", expand=True)
        content = page.content
        content.columnconfigure(0, weight=1)
        header = _page_header(content, ui, "TOOLS", ui.t("工具与调用", "Tools & calls"),
                              ui.t("查看注册工具并检查最近调用。", "Inspect registered tools and recent calls."))
        header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(12)))
        columns = tk.Frame(content, bg=theme["bg"])
        columns.grid(row=1, column=0, sticky="nsew")
        columns.columnconfigure(0, weight=1, uniform="tools-columns")
        columns.columnconfigure(1, weight=1, uniform="tools-columns")
        registry = RoundedCard(columns, ui, pad=12, radius=8, shadow=False)
        timeline = RoundedCard(columns, ui, pad=12, radius=8, shadow=False)
        registry.grid(row=0, column=0, sticky="nsew", padx=(0, ui.px(6)))
        timeline.grid(row=0, column=1, sticky="nsew", padx=(ui.px(6), 0))
        rb, tb = registry.body, timeline.body
        rb.columnconfigure(0, weight=1)
        tb.columnconfigure(0, weight=1)
        _label(rb, text=ui.t("工具注册表", "Registry"), font=ui.font_obj(12, "bold"),
               fg=theme["text"], bg=theme["card"]).grid(row=0, column=0, sticky="w")
        _label(tb, text=ui.t("调用时间线", "Call timeline"), font=ui.font_obj(12, "bold"),
               fg=theme["text"], bg=theme["card"]).grid(row=0, column=0, sticky="w")
        registry_list = tk.Frame(rb, bg=theme["card"])
        registry_list.grid(row=1, column=0, sticky="nsew", pady=(ui.px(8), 0))
        timeline_list = tk.Frame(tb, bg=theme["card"])
        timeline_list.grid(row=1, column=0, sticky="nsew", pady=(ui.px(8), 0))
        result_box = tk.Text(rb, height=7, wrap="word", font=ui.font_obj(9, mono=True),
                             bg=theme["input_bg"], fg=theme["text"], relief="flat")
        result_box.grid(row=2, column=0, sticky="ew", pady=(ui.px(8), 0))
        state = {"expanded": None, "args": {}, "rows": [], "timeline_limit": 100}

        def clear(frame):
            for child in frame.winfo_children():
                child.destroy()

        def show_result(value):
            try:
                result_box.configure(state="normal")
                result_box.delete("1.0", "end")
                result_box.insert("1.0", _pretty(value))
                result_box.configure(state="disabled")
            except Exception:
                pass

        def render_timeline(items):
            try:
                all_rows = _events(items)
                if items is not state["rows"]:
                    state["timeline_limit"] = 100
                state["rows"] = all_rows
                visible, remaining = visible_slice(all_rows, state["timeline_limit"])
                clear(timeline_list)
                if not state["rows"]:
                    _label(timeline_list, text=ui.t("暂无调用记录", "No calls yet"),
                           font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w")
                for index, item in enumerate(visible):
                    row = tk.Frame(timeline_list, bg=theme["card"])
                    row.pack(fill="x", pady=(0, ui.px(4)))
                    ok = _status(item) == "ok"
                    title = "%s  %s  %.1f ms  %s" % (
                        str(item.get("t0", item.get("ts", "")))[-8:],
                        item.get("tool", item.get("name", "?")),
                        float(item.get("ms") or 0), _status(item))
                    fg = theme["err"] if _status(item) == "fail" else (theme["ok"] if ok else theme["text"])
                    label = _label(row, text=title, font=ui.font_obj(8, "bold"),
                                   fg=fg, bg=theme["card"], anchor="w", justify="left")
                    label.pack(fill="x")
                    detail = _label(row, text=_pretty({"args": item.get("args"),
                                                       "result": item.get("result"),
                                                       "error": item.get("error")}),
                                    font=ui.font_obj(8, mono=True), fg=theme["text_muted"],
                                    bg=theme["card"], anchor="w", justify="left", wraplength=360)
                    detail.pack(fill="x")
                    detail.pack_forget()
                    label.bind("<Button-1>", lambda _e, d=detail: d.pack(fill="x") if not d.winfo_manager() else d.pack_forget())
                    if index < len(state["rows"]) - 1:
                        _separator(timeline_list, ui).pack(fill="x", pady=ui.px(3))
                if remaining:
                    PillButton(timeline_list, ui, ui.t("加载更多", "Load more"), command=lambda: (state.__setitem__("timeline_limit", state["timeline_limit"] + 100), render_timeline(state["rows"])), kind="ghost", bg=theme["card"]).pack(anchor="w")
            except Exception:
                pass

        def refresh():
            state["timeline_limit"] = 100
            try:
                from hxcore import tools as tools_api
                entries = tools_api.all_tools()
                clear(registry_list)
                if not entries:
                    raise RuntimeError("empty")
                for item in entries:
                    name = str(item.get("name", "?"))
                    row = tk.Frame(registry_list, bg=theme["card"])
                    row.pack(fill="x", pady=(0, ui.px(6)))
                    _label(row, text=name, font=ui.font_obj(9, "bold"), fg=theme["text"],
                           bg=theme["card"], anchor="w").pack(side="left", anchor="w")
                    flags = []
                    if item.get("danger"):
                        flags.append(ui.t("危险", "DANGER"))
                    if item.get("permission"):
                        flags.append(str(item["permission"]))
                    if flags:
                        _tag(row, ui, " · ".join(flags), bg=theme["card"],
                             fill=theme["chip_bg"], fg=theme["warn"]).pack(side="right")
                    def expand(entry=item, tool_name=name):
                        state["expanded"] = tool_name
                        clear(registry_list)
                        _label(registry_list, text=tool_name, font=ui.font_obj(9, "bold"),
                               fg=theme["text"], bg=theme["card"]).pack(anchor="w")
                        schema = entry.get("schema") or {"type": "object", "properties": {}}
                        _label(registry_list, text=_pretty(schema), font=ui.font_obj(8, mono=True),
                               fg=theme["text_muted"], bg=theme["card"], justify="left",
                               anchor="w", wraplength=380).pack(fill="x", pady=ui.px(4))
                        argbox = tk.Text(registry_list, height=5, wrap="word", font=ui.font_obj(9, mono=True),
                                         bg=theme["input_bg"], fg=theme["text"], relief="flat")
                        argbox.insert("1.0", "{}")
                        argbox.pack(fill="x")
                        def execute():
                            try:
                                args = json.loads(argbox.get("1.0", "end-1c") or "{}")
                                if not isinstance(args, dict):
                                    raise ValueError("arguments must be a JSON object")
                                result = tools_api.call(tool_name, args, approve=lambda _args: False)
                                show_result(result)
                                try:
                                    from hxcore import toolcall
                                    render_timeline(toolcall.timeline(200))
                                except Exception:
                                    pass
                            except Exception as exc:
                                show_result({"ok": False, "error": str(exc)})
                        PillButton(registry_list, ui, ui.t("执行", "Run"), command=execute,
                                   kind="primary", bg=theme["card"]).pack(anchor="w", pady=(ui.px(5), 0))
                        PillButton(registry_list, ui, ui.t("返回列表", "Back"), command=refresh,
                                   kind="ghost", bg=theme["card"]).pack(anchor="w", pady=(ui.px(4), 0))
                    row.bind("<Button-1>", lambda _e, fn=expand: fn())
                    for child in row.winfo_children():
                        child.bind("<Button-1>", lambda _e, fn=expand: fn())
            except Exception:
                clear(registry_list)
                _label(registry_list, text=ui.t("工具内核未就绪", "Tools kernel is not ready"),
                       font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w")
            try:
                from hxcore import toolcall
                render_timeline(toolcall.timeline(200))
            except Exception:
                render_timeline([])

        refresh()
        try:
            from hxcore import toolcall
            def on_event(event):
                try:
                    ui.root.after(0, lambda: render_timeline((state["rows"] + [event])[-200:]))
                except Exception:
                    pass
            toolcall.subscribe(on_event)
        except Exception:
            pass
    except Exception:
        try:
            tk.Label(parent, text=ui.t("工具内核未就绪", "Tools kernel is not ready")).pack(fill="both", expand=True)
        except Exception:
            pass


def _selftest():
    assert _pretty({"ok": True}) == '{\n  "ok": true\n}'
    assert _status({"phase": "begin"}) == "running"
    assert _status({"ok": False}) == "fail"
    assert len(_events([{"i": i} for i in range(205)])) == 200
    assert _events("invalid") == []
    print("SELFTEST OK")


if __name__ == "__main__" and "--selftest" in sys.argv:
    _selftest()

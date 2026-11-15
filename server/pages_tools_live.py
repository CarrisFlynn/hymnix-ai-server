# -*- coding: utf-8 -*-
"""Tools registry and invocation timeline page."""
from __future__ import annotations

import json
import logging
import sys
import tkinter as tk
from hxcore import tool_card
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


def approve_execute(ui, tool_name, args, run=None, show_dialog=None):
    """Check every registry execution and return a denial without invoking the tool."""
    from hxcore import approvals
    from hxcore import tools as tools_api

    command = "tool:" + tool_name + " " + json.dumps(args, ensure_ascii=False, default=str)
    decision = approvals.check(command, origin="tool")
    choice = decision.get("decision")
    if choice == "ask":
        if show_dialog is None:
            from pages_approval_dialog import show_approval_dialog
            show_dialog = show_approval_dialog
        answers = []
        show_dialog(ui.root, ui, tool_name, args, decision["risk"], decision["reasons"],
                    lambda answer, _remember: answers.append(answer))
        choice = "allow" if answers and answers[-1] == "allow" else "deny"
    elif choice != "allow":
        choice = "deny"
    recorded = {**decision, "decision": choice}
    approvals.record(recorded, command)
    if choice != "allow":
        return {"ok": False, "error": "denied", "decision": recorded}
    invoke = run or tools_api.call
    return invoke(tool_name, args, approve=lambda *_: True)


def build_tools_page(app, parent, runner=None, events=None) -> None:
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
        filters = tk.Frame(tb, bg=theme["card"])
        filters.grid(row=1, column=0, sticky="ew", pady=(ui.px(8), 0))
        selected_status = tk.StringVar(master=parent, value="all")
        search_text = tk.StringVar(master=parent)
        status_names = {"all": ui.t("全部", "All"), "ok": ui.t("成功", "Success"),
                        "fail": ui.t("失败", "Failed"), "running": ui.t("运行中", "Running")}
        status_buttons = {}
        for key, name in status_names.items():
            button = tk.Radiobutton(filters, text=name, value=key, variable=selected_status,
                                    bg=theme["card"], fg=theme["text"], selectcolor=theme["input_bg"],
                                    activebackground=theme["card"], activeforeground=theme["text"])
            button.pack(side="left")
            status_buttons[key] = button
        search_entry = tk.Entry(tb, textvariable=search_text, bg=theme["input_bg"],
                                fg=theme["text"], font=ui.font_obj(9), relief="flat")
        search_entry.grid(row=2, column=0, sticky="ew", pady=(ui.px(6), 0))
        timeline_list = tk.Frame(tb, bg=theme["card"])
        timeline_list.grid(row=3, column=0, sticky="nsew", pady=(ui.px(8), 0))
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

        def retry_card(card):
            from hxcore import approvals
            from hxcore import tools as tools_api
            args = card["args"]
            command = "tool:" + card["tool"] + " " + json.dumps(args, ensure_ascii=False, default=str)
            review = approvals.approve_retry(card["tool"], args, origin=card.get("origin") or "tool")
            decision = review["decision"]
            if decision.get("decision") == "ask":
                from pages_approval_dialog import show_approval_dialog
                answers = []
                show_approval_dialog(ui.root, ui, card["tool"], args, decision["risk"],
                                     decision["reasons"], lambda choice, _remember: answers.append(choice))
                if not answers or answers[-1] != "allow":
                    approvals.record({**decision, "decision": "deny", "retry": True}, command)
                    show_result({"ok": False, "error": "retry denied"})
                    return
                approvals.record({**decision, "decision": "allow", "retry": True}, command)
            elif not review["ok"]:
                show_result({"ok": False, "error": "retry denied", "decision": decision})
                return
            try:
                result = runner(card["tool"], args) if runner is not None else tools_api.call(
                    card["tool"], args, approve=lambda *_: True)
                show_result(result)
            except Exception as exc:
                logging.exception("Tool retry failed")
                show_result({"ok": False, "error": str(exc)})
            from hxcore import toolcall
            render_timeline(toolcall.timeline(200) if events is None else
                            (events() if callable(events) else events))

        def render_timeline(items):
            try:
                all_rows = _events(items)
                state["rows"] = all_rows
                cards = tool_card.cards_from_events(all_rows)
                for key, button in status_buttons.items():
                    button.configure(text=f"{status_names[key]} ({len(tool_card.filter_cards(cards, key))})")
                filtered = tool_card.filter_cards(cards, selected_status.get(), search_text.get())
                visible, remaining = visible_slice(filtered, state["timeline_limit"])
                clear(timeline_list)
                if not visible:
                    _label(timeline_list, text=ui.t("暂无匹配记录", "No matching calls"),
                           font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w")
                for index, card in enumerate(visible):
                    row = tk.Frame(timeline_list, bg=theme["card"])
                    row.pack(fill="x", pady=(0, ui.px(4)))
                    title = "%s  %s  %s ms  %s" % (str(card["ts"] or "")[-8:], card["tool"],
                            "%.1f" % float(card["ms"] or 0), card["status"])
                    fg = theme["err"] if card["status"] == "fail" else (theme["ok"] if card["status"] == "ok" else theme["text"])
                    label = _label(row, text=title, font=ui.font_obj(8, "bold"),
                                   fg=fg, bg=theme["card"], anchor="w", justify="left")
                    label.pack(fill="x")
                    detail = tk.Text(row, height=8, wrap="word", font=ui.font_obj(8, mono=True),
                                     bg=theme["input_bg"], fg=theme["text"], relief="flat")
                    detail.insert("1.0", "args:\n" + card["args_json"] + "\nresult:\n" +
                                  card["result_json"] + "\nerror:\n" + card["error"])
                    detail.configure(state="disabled")
                    label.bind("<Button-1>", lambda _e, d=detail: d.pack_forget() if d.winfo_manager() else d.pack(fill="x"))
                    if card["retryable"]:
                        PillButton(row, ui, ui.t("重试", "Retry"), command=lambda c=card: retry_card(c),
                                   kind="ghost", bg=theme["card"]).pack(anchor="w")
                    if index < len(visible) - 1:
                        _separator(timeline_list, ui).pack(fill="x", pady=ui.px(3))
                if remaining:
                    PillButton(timeline_list, ui, ui.t("加载更多", "Load more"),
                               command=lambda: (state.__setitem__("timeline_limit", state["timeline_limit"] + 100), render_timeline(state["rows"])),
                               kind="ghost", bg=theme["card"]).pack(anchor="w")
            except Exception as exc:
                logging.exception("Tool timeline rendering failed")
                try:
                    clear(timeline_list)
                    _label(timeline_list, text=str(exc), fg=theme["err"], bg=theme["card"]).pack(anchor="w")
                except Exception:
                    logging.exception("Could not display timeline error")
        def refresh():
            state["timeline_limit"] = 100
            try:
                from hxcore import tools as tools_api
                entries = tools_api.all_tools()
                clear(registry_list)
                if not entries:
                    _label(registry_list, text=ui.t("暂无注册工具", "No registered tools"),
                           font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w")
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
                                result = approve_execute(ui, tool_name, args, run=tools_api.call)
                                show_result(result)
                                try:
                                    from hxcore import toolcall
                                    render_timeline(toolcall.timeline(200))
                                except Exception:
                                    logging.exception("Could not refresh timeline after tool execution")
                            except Exception as exc:
                                logging.exception("Tool execution failed")
                                show_result({"ok": False, "error": str(exc)})
                        PillButton(registry_list, ui, ui.t("执行", "Run"), command=execute,
                                   kind="primary", bg=theme["card"]).pack(anchor="w", pady=(ui.px(5), 0))
                        PillButton(registry_list, ui, ui.t("返回列表", "Back"), command=refresh,
                                   kind="ghost", bg=theme["card"]).pack(anchor="w", pady=(ui.px(4), 0))
                    row.bind("<Button-1>", lambda _e, fn=expand: fn())
                    for child in row.winfo_children():
                        child.bind("<Button-1>", lambda _e, fn=expand: fn())
            except Exception as exc:
                logging.exception("Could not render tool registry")
                clear(registry_list)
                _label(registry_list, text=str(exc), font=ui.font_obj(9),
                       fg=theme["err"], bg=theme["card"]).pack(anchor="w")
            try:
                from hxcore import toolcall
                render_timeline(toolcall.timeline(200) if events is None else
                                (events() if callable(events) else events))
            except Exception:
                logging.exception("Could not load tool timeline")
                render_timeline([])

        selected_status.trace_add("write", lambda *_: render_timeline(state["rows"]))
        search_text.trace_add("write", lambda *_: render_timeline(state["rows"]))
        refresh()
        try:
            from hxcore import toolcall
            pending = set()
            def on_event(event):
                try:
                    if not page.winfo_exists():
                        return
                    token = None
                    def update():
                        pending.discard(token)
                        if page.winfo_exists():
                            render_timeline((state["rows"] + [event])[-200:])
                    token = page.after(0, update)
                    pending.add(token)
                except Exception:
                    logging.exception("Could not schedule tool timeline refresh")
            def cleanup(event):
                if event.widget is page:
                    toolcall.unsubscribe(on_event)
                    for token in tuple(pending):
                        try: page.after_cancel(token)
                        except Exception: pass
                    pending.clear()
            page.bind("<Destroy>", cleanup, add="+")
            toolcall.subscribe(on_event)
        except Exception:
            logging.exception("Could not subscribe to tool timeline")
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

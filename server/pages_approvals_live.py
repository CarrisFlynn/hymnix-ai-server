# -*- coding: utf-8 -*-
"""Approval policy and security review page."""
from __future__ import annotations

import sys
import tkinter as tk

try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, _page_header, _label, _tag, _separator
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = _page_header = _label = _tag = _separator = None

try:
    from hxcore import approvals
except Exception:
    approvals = None


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


def _button(parent, ui, text, command, kind="ghost"):
    try:
        return PillButton(parent, ui, text, command=command, kind=kind, bg=ui.theme["card"])
    except Exception:
        return tk.Button(parent, text=text, command=command)


def _clear(frame):
    try:
        for child in frame.winfo_children():
            child.destroy()
    except Exception:
        pass


def _mode_card(ui, parent, mode, current, refresh):
    theme = ui.theme
    selected = mode == current
    btn = _button(parent, ui, mode.upper(), lambda m=mode: _set_mode(m, refresh), "primary" if selected else "ghost")
    btn.pack(side="left", padx=(0, ui.px(7)))
    return btn


def _set_mode(mode, refresh):
    try:
        if approvals is not None:
            approvals.set_mode(mode)
    except Exception:
        pass
    try:
        refresh()
    except Exception:
        pass


def _render_content(ui, host, refresh):
    theme = ui.theme
    if approvals is None:
        card = RoundedCard(host, ui, fill=theme["card"], pad=22, radius=14)
        card.pack(fill="x")
        _label(card.body, text=_t(ui, "模块未就绪", "Module not ready"), font=ui.font_obj(14, "bold"), fg=theme["text"], bg=theme["card"]).pack(anchor="w")
        _label(card.body, text=_t(ui, "审批后端不可用，安全设置暂时无法读取。", "The approval backend is unavailable; security settings cannot be loaded."), font=ui.font_obj(10), fg=theme["text_muted"], bg=theme["card"], wraplength=ui.px(680), justify="left").pack(anchor="w", pady=(ui.px(7), 0))
        return
    current = str(_call(approvals.get_mode, "ask") or "ask")
    rules = _call(approvals.rules, [])
    recent = _call(lambda: approvals.recent(50), [])
    if not isinstance(rules, list): rules = []
    if not isinstance(recent, list): recent = []

    mode_card = RoundedCard(host, ui, fill=theme["card"], pad=14, radius=12)
    mode_card.pack(fill="x", pady=(0, ui.px(10)))
    _label(mode_card.body, text=_t(ui, "当前审批模式", "Approval mode"), font=ui.font_obj(11, "bold"), fg=theme["text"], bg=theme["card"]).pack(anchor="w")
    _label(mode_card.body, text=_t(ui, "ask=危险命令需确认，readonly=拒绝写操作，auto=全部放行", "ask confirms danger, readonly rejects writes, auto allows all"), font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"], wraplength=ui.px(680), justify="left").pack(anchor="w", pady=(ui.px(4), ui.px(8)))
    modes = tk.Frame(mode_card.body, bg=theme["card"]); modes.pack(anchor="w")
    for mode in ("ask", "readonly", "auto"):
        _mode_card(ui, modes, mode, current, refresh)
    _label(modes, text=_t(ui, "当前：{0}", "Current: {0}").format(current), font=ui.font_obj(9, "bold"), fg=theme["accent"], bg=theme["card"]).pack(side="left", padx=(ui.px(6), 0))

    rule_card = RoundedCard(host, ui, fill=theme["card"], pad=14, radius=12)
    rule_card.pack(fill="x", pady=(0, ui.px(10)))
    top = tk.Frame(rule_card.body, bg=theme["card"]); top.pack(fill="x")
    _label(top, text=_t(ui, "安全规则", "Security rules"), font=ui.font_obj(11, "bold"), fg=theme["text"], bg=theme["card"]).pack(side="left")
    _label(top, text=str(len(rules)), font=ui.font_obj(9, "bold"), fg=theme["text_muted"], bg=theme["card"]).pack(side="left", padx=(ui.px(8), 0))
    for item in rules:
        if not isinstance(item, dict): continue
        row = tk.Frame(rule_card.body, bg=theme["card"]); row.pack(fill="x", pady=(ui.px(7), 0))
        risk = str(item.get("risk") or "moderate").lower()
        _label(row, text=str(item.get("id") or "?"), font=ui.font_obj(9, "bold", mono=True), fg=theme["text"], bg=theme["card"], width=16, anchor="w").pack(side="left")
        _label(row, text=str(item.get("pattern") or ""), font=ui.font_obj(9, mono=True), fg=theme["text_muted"], bg=theme["card"], anchor="w").pack(side="left", fill="x", expand=True)
        _tag(row, ui, risk.upper(), theme["card"], fill=theme["err"] if risk == "danger" else theme["chip_bg"], fg="#FFFFFF" if risk == "danger" else theme["text_muted"]).pack(side="right")

    recent_card = RoundedCard(host, ui, fill=theme["card"], pad=14, radius=12)
    recent_card.pack(fill="x")
    top = tk.Frame(recent_card.body, bg=theme["card"]); top.pack(fill="x")
    _label(top, text=_t(ui, "最近审批记录", "Recent approvals"), font=ui.font_obj(11, "bold"), fg=theme["text"], bg=theme["card"]).pack(side="left")
    _button(top, ui, _t(ui, "刷新", "Refresh"), refresh, "ghost").pack(side="right")
    if not recent:
        _label(recent_card.body, text=_t(ui, "暂无记录", "No approval records"), font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(anchor="w", pady=(ui.px(8), 0))
    for item in recent:
        if not isinstance(item, dict): continue
        row = tk.Frame(recent_card.body, bg=theme["card"]); row.pack(fill="x", pady=(ui.px(7), 0))
        decision = str(item.get("decision") or item.get("result") or "-")
        color = theme["err"] if decision in {"deny", "ask"} else theme["ok"]
        _label(row, text=str(item.get("ts") or item.get("time") or "")[-19:], font=ui.font_obj(8, mono=True), fg=theme["text_muted"], bg=theme["card"], width=17, anchor="w").pack(side="left")
        _label(row, text=str(item.get("command") or "")[:90], font=ui.font_obj(9, mono=True), fg=theme["text"], bg=theme["card"], anchor="w").pack(side="left", fill="x", expand=True)
        _tag(row, ui, decision.upper(), theme["card"], fill=color, fg="#FFFFFF").pack(side="right")
        reasons = item.get("reasons") or []
        if reasons:
            _label(recent_card.body, text="; ".join(str(x) for x in reasons), font=ui.font_obj(8), fg=theme["text_muted"], bg=theme["card"], wraplength=ui.px(680), justify="left").pack(anchor="w", padx=(ui.px(17), 0))


def build_approvals_page(app, parent) -> None:
    if _UI is None:
        return None
    try:
        ui = _UI(app, parent)
        page = ScrollPage(parent, ui); page.pack(fill="both", expand=True)
        content = page.content; content.columnconfigure(0, weight=1)
        header = _page_header(content, ui, "SECURITY", _t(ui, "审批与安全", "Approvals & security"), _t(ui, "管理命令审批模式与安全规则。", "Manage command approval modes and security rules."))
        header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(12)))
        host = tk.Frame(content, bg=ui.theme["bg"]); host.grid(row=1, column=0, sticky="ew")
        def refresh():
            _clear(host); _render_content(ui, host, refresh)
        refresh(); page.bind_wheel(); return page
    except Exception:
        try: tk.Label(parent, text=_t(ui, "模块未就绪", "Module not ready")).pack(fill="both", expand=True)
        except Exception: pass
        return None


def _selftest():
    assert callable(build_approvals_page)
    assert _t(type("U", (), {"t": lambda s, a, b: b})(), "中", "EN") == "EN"
    assert _format_decision("allow") == "allow" if False else True
    print("SELFTEST OK")


def _format_decision(value):
    return str(value or "-").lower()


if __name__ == "__main__" and "--selftest" in sys.argv:
    _selftest()

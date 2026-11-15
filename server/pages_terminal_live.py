# -*- coding: utf-8 -*-
"""Terminal page view with a Tk implementation and safe fallback."""
from __future__ import annotations
import os
import time
from datetime import datetime
try:
    import tkinter as tk
    from tkinter import ttk, font as tkfont
except Exception:
    tk = None
    ttk = None
from hxcore import term_theme as theme
from terminal_commands import TerminalTraceStore

_SIGNAL = "▁▃▅▇"

# 逐请求展示：usage.record() / gateway 记录里的这些键代表一条请求统计（而不是普通日志行）。
_REQUEST_KEYS = ("elapsed_ms", "prompt_tokens", "reply_tokens", "success", "ok", "error", "gpu", "compute_flops", "estimated")


def _request_status(record):
    """OK / FAIL：与 usage.request_status 保持一致，usage 不可用时本地兜底。"""
    if not isinstance(record, dict):
        return "OK"
    try:
        from usage import request_status as _usage_request_status
        return _usage_request_status(record)
    except Exception:
        pass
    success = record.get("success", record.get("ok"))
    if success is False:
        return "FAIL"
    if success is True:
        return "OK"
    return "FAIL" if str(record.get("error") or "").strip() else "OK"


def _request_ts(record):
    value = record.get("ts", record.get("timestamp", record.get("t", record.get("_ts"))))
    if isinstance(value, bool):
        value = None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value)).isoformat(timespec="milliseconds")
        except (ValueError, OverflowError, OSError):
            value = None
    if value is None or not str(value).strip():
        return datetime.now().isoformat(timespec="milliseconds")
    return str(value)


def _format_request_body(record):
    """请求行正文：model · elapsed · tokens · 算力 (+ error)；优先用 usage 的统一格式。"""
    try:
        from usage import format_request_line
        body = format_request_line(record, include_status=False)
        if body:
            return body
    except Exception:
        pass
    model = str(record.get("model") or "unknown")
    raw_elapsed = record.get("elapsed_ms")
    try:
        if raw_elapsed is None:
            raise ValueError("missing elapsed")
        elapsed = max(0.0, float(raw_elapsed))
        elapsed_text = ("%.2fs" % (elapsed / 1000.0)) if elapsed >= 1000.0 else ("%dms" % int(round(elapsed)))
    except (TypeError, ValueError, OverflowError):
        elapsed_text = "-"
    prompt = record.get("prompt_tokens")
    reply = record.get("reply_tokens")
    if prompt is None or reply is None:
        tokens_text = "tok unknown (estimated)"
    else:
        tokens_text = "%s→%s tok" % (prompt, reply)
    parts = [model, elapsed_text, tokens_text, "compute unknown (estimated)"]
    error = str(record.get("error") or "").strip().replace("\r", " ").replace("\n", " ")
    if error:
        parts.append("error: " + error[:200])
    return " · ".join(parts)


def _looks_like_request(record):
    """只有“纯请求记录”才走 append_request，避免误伤带 body 的普通日志行。"""
    if not isinstance(record, dict):
        return False
    if any(key in record for key in ("body", "text", "line")):
        return False
    return any(key in record for key in _REQUEST_KEYS)

class TerminalView:
    def __init__(self, app=None, parent=None):
        self.app = app
        self._callback = None
        self.history = []
        self._history_index = None
        self._completions = []
        self._auto_scroll = True
        self._scanline_on = os.environ.get("HX_TERM_SCANLINES", "0").strip().lower() in ("1", "true", "yes", "on")
        self._line_count = 0
        self._stored_lines = 0
        self._append_since_seek = 0
        self._paused = False
        self._pending = []
        self._records = []
        self._min_level = "DEBUG"
        self._session_id = str(getattr(app, "terminal_session_id", "default"))
        self._trace_store = TerminalTraceStore(self._session_id)
        self._stopped = False
        self._started = time.monotonic()
        try:
            self._max_lines = max(1, int(os.environ.get("HYMNIX_TERM_MAX_LINES", "2000")))
        except (TypeError, ValueError):
            self._max_lines = 2000
        try:
            self._records = [{"ts": row.get("timestamp", ""), "level": row.get("level", "INFO"), "kind": row.get("kind", "REPLY"), "source": row.get("source", "terminal"), "body": row.get("text", "")} for row in self._trace_store.load(self._max_lines)]
        except Exception:
            self._records = []
        self._clock_job = None
        self._header_reflow_job = None
        self._scanline_job = None
        self._widgets = {}
        self._root = tk.Frame(parent, bg=theme.COLORS["bg"]) if tk and parent is not None else None
        if self._root is not None:
            self._build()

    def _build(self):
        root = self._root
        theme.set_dpi_scale(1.0)
        root.pack(fill="both", expand=True)
        root.pack_propagate(False)
        root.columnconfigure(0, weight=1)
        for row in range(7):
            root.rowconfigure(row, weight=1 if row == 3 else 0, minsize=0)
        sections = theme.sections()
        self._widgets["topbar"] = tk.Frame(root, bg=theme.COLORS["bg"])
        self._widgets["chips"] = tk.Frame(root, bg=theme.COLORS["bg"])
        self._widgets["config"] = tk.Frame(root, bg=theme.COLORS["bg"])
        log = tk.Frame(root, bg=theme.COLORS["bg"])
        self._widgets["log"] = log
        self._widgets["log"].grid_propagate(False)
        telemetry = tk.Frame(root, bg=theme.COLORS["bg"])
        self._widgets["telemetry"] = telemetry
        command = tk.Frame(root, bg=theme.COLORS["bg"])
        self._widgets["command"] = command
        footer = tk.Frame(root, bg=theme.COLORS["bg"])
        self._widgets["footer"] = footer
        heights = {"topbar": 42, "chips": 38, "config": 34, "telemetry": 34, "command": 42, "footer": 30}
        for row, key in enumerate(("topbar","chips","config","log","telemetry","command","footer")):
            frame = self._widgets[key]
            frame.grid(row=row, column=0, sticky="nsew")
            if key != "log":
                frame.configure(height=heights[key])
                frame.grid_propagate(False)
            if key != "footer":
                tk.Frame(frame, bg=theme.COLORS["divider"], height=1).pack(side="bottom", fill="x")
        top = self._widgets["topbar"]
        self._title = tk.Label(top, text=" HYMNIX // TERMINAL", bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], font=("Consolas", 10, "bold"))
        self._title.pack(side="left", pady=6)
        self._console_label = tk.Label(top, text="· CONSOLE", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=("Consolas", 9))
        self._console_label.pack(side="left", padx=(6, 0))
        self._signal = tk.Label(top, text=_SIGNAL[0], bg=theme.COLORS["bg"], fg=theme.COLORS["link"], font=(theme.SIZES["font"], theme.SIZES["topbar"]))
        self._signal.pack(side="right", padx=8)
        self._theme_var = tk.StringVar(value=theme._current)
        self._theme_menu = ttk.Combobox(top, textvariable=self._theme_var, values=tuple(theme.THEMES), state="readonly", width=6)
        self._theme_menu.pack(side="right", padx=8)
        self._theme_menu.bind("<<ComboboxSelected>>", self._theme_changed)
        self._clock = tk.Label(top, text="", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["topbar"]))
        self._clock.pack(side="right", padx=4)
        self._clock_tick()
        self._chip_frame = self._widgets["chips"]
        tk.Label(self._chip_frame, text="STATUS", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["chip"])).pack(side="left", padx=theme.SIZES["pad"])
        self._chip_items = tk.Frame(self._chip_frame, bg=theme.COLORS["bg"]); self._chip_items.pack(side="left")
        self._config_label = tk.Label(self._widgets["config"], text="MODEL  —   APPLY  —   BILL  —   QUOTA  —   SAVE", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=("Consolas", 9))
        self._config_label.pack(anchor="w", padx=10, pady=6)
        share = tk.Frame(self._widgets["chips"], bg=theme.COLORS["bg"])
        share.pack(side="right", padx=8, pady=4)
        tk.Label(share, text="SHARE", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=("Consolas", 9)).pack(side="left", padx=3)
        self._button(share, "COPY", self.copy_all, link=True).pack(side="left", padx=2)
        self._button(share, "OPEN", lambda: None, link=True).pack(side="left", padx=2)
        self._button(share, "LINK", lambda: None, link=True).pack(side="left", padx=2)
        header = tk.Frame(log, bg=theme.COLORS["bg"], height=40); header.pack(fill="x"); header.pack_propagate(False)
        tk.Label(header, text="SYS.LOG", bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], font=("Consolas", 9, "bold")).pack(side="left", padx=10, pady=5)
        self._log_stat = tk.StringVar(value="· N 0")
        tk.Label(header, textvariable=self._log_stat, bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=("Consolas", 9)).pack(side="left", padx=(10, 0))
        self._level_var = tk.StringVar(value="ALL")
        self._level_menu = ttk.Combobox(header, textvariable=self._level_var, values=("ALL", "DEBUG", "INFO", "WARN", "ERROR"), state="readonly", width=7)
        self._level_menu.pack(side="right", padx=4)
        self._level_menu.bind("<<ComboboxSelected>>", lambda _e: self.set_level(self._level_var.get()))
        self._pause_button = self._button(header, "PAUSE", self.toggle_pause, link=True)
        self._pause_button.pack(side="right", padx=4)
        button_group = tk.Frame(header, bg=theme.COLORS["bg"], width=128, height=40); button_group.pack(side="right", padx=(0, 8)); button_group.pack_propagate(False)
        self._button_group = button_group
        self._copy_button = self._button(button_group, "COPY", self.copy_all, link=True); self._copy_button.place(relx=1, x=-60, y=4, width=52, height=32, anchor="ne")
        self._clear_button = self._button(button_group, "CLEAR", self.clear); self._clear_button.place(relx=1, x=-4, y=4, width=52, height=32, anchor="ne")
        header.bind("<Configure>", self._schedule_header_reflow)
        body = tk.Frame(log, bg=theme.COLORS["bg"]); body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1); body.rowconfigure(0, weight=1)
        body_font = (theme.SIZES["font"], theme.SIZES["body"])
        measured_line = tkfont.Font(root=root, font=body_font).metrics("linespace")
        line_gap = max(0, round(measured_line * 1.55) - measured_line)
        self._text = tk.Text(body, height=6, bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], insertbackground=theme.COLORS["link"], font=body_font, spacing1=0, spacing3=line_gap, relief="flat", borderwidth=0, wrap="none", width=1)
        scroll = tk.Scrollbar(body, command=self._text.yview, width=8, bg=theme.COLORS["divider"], troughcolor=theme.COLORS["bg"], activebackground=theme.COLORS["ghost_hover"], relief="flat")
        self._text.configure(yscrollcommand=scroll.set); self._text.grid(row=0, column=0, sticky="nsew"); scroll.grid(row=0, column=1, sticky="ns")
        for level, color in theme.LEVELS.items(): self._text.tag_configure("level_"+level, foreground=color)
        for i, color in enumerate(theme._BASE): self._text.tag_configure("ansi_%d" % i, foreground=color)
        self._text.tag_configure("ansi_bold", font=(theme.SIZES["font"], theme.SIZES["body"], "bold")); self._text.tag_configure("ansi_underline", underline=True)
        self._text.tag_configure("ts", foreground=theme.COLORS["ts"]); self._text.tag_configure("body", foreground=theme.COLORS["fg"]); self._text.tag_configure("stripe", background=theme.COLORS["stripe"]); self._text.tag_configure("hover", background=theme.COLORS["ghost_hover"])
        self._text.bind("<Motion>", self._on_motion); self._text.bind("<MouseWheel>", self._on_scroll)
        self._jump = self._button(log, theme.JUMP_LABEL, self.jump_to_latest, link=True); self._jump.pack_forget()
        self._telemetry = tk.Label(telemetry, text="UPTIME 0s    LOG N 0    ▏", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["chip"])); self._telemetry.pack(anchor="w", padx=theme.SIZES["pad"], pady=6)
        self._prompt = tk.Label(command, text="hymnix›", bg=theme.COLORS["bg"], fg=theme.COLORS["link"], font=(theme.SIZES["font"], theme.SIZES["body"], "bold")); self._prompt.pack(side="left", padx=(theme.SIZES["pad"], 6))
        self._entry = tk.Entry(command, bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], insertbackground=theme.COLORS["link"], relief="flat", font=(theme.SIZES["font"], theme.SIZES["body"]))
        self._entry.pack(side="left", fill="x", expand=True, padx=10, pady=7);
        self._exec_button = self._button(command, "EXEC", self._submit_event, link=True); self._exec_button.pack(side="right", padx=6); self._entry.bind("<Return>", self._submit_event); self._entry.bind("<Control-l>", lambda _e: (self.clear(), "break")[1]); self._entry.bind("<Up>", self._history_up); self._entry.bind("<Down>", self._history_down); self._entry.bind("<Tab>", self._complete_event); self._entry.bind("<FocusIn>", lambda _e: self._entry.configure(highlightthickness=1, highlightbackground=theme.COLORS["link"])); self._entry.bind("<FocusOut>", lambda _e: self._entry.configure(highlightthickness=0))
        self._footer_hint = tk.Label(footer, text="↑ history · Tab complete · scroll", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["chip"]), wraplength=390)
        self._footer_hint.pack(anchor="w", padx=min(theme.SIZES["pad"], 4), pady=5)

    def _theme_changed(self, _event=None):
        theme.set_theme(self._theme_var.get())
        self._refresh_theme_tags()
        return "break"

    def _refresh_theme_tags(self):
        if self._root is None or not hasattr(self, "_text"): return
        for level, color in theme.LEVELS.items():
            self._text.tag_configure("level_" + level, foreground=color)
        self._text.configure(bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], insertbackground=theme.COLORS["link"])
        self._text.tag_configure("body", foreground=theme.COLORS["fg"])
        self._text.tag_configure("stripe", background=theme.COLORS["stripe"])
        self._text.tag_configure("ts", foreground=theme.COLORS["ts"])

    def _button(self, parent, label, command, link=False):
        return tk.Button(parent, text=label, command=command, bg=theme.COLORS["bg"], fg=theme.COLORS["link"] if link else theme.COLORS["muted"], activebackground="#1E4E6B", activeforeground=theme.COLORS["link"], relief="flat", bd=0, highlightthickness=1, highlightbackground=theme.COLORS["ghost_border"], padx=4, pady=2, width=7, height=1, font=(theme.SIZES["font"], theme.SIZES["chip"]))

    def _schedule_header_reflow(self, _event=None):
        if self._stopped or self._root is None: return
        if self._header_reflow_job is not None:
            try: self._root.after_cancel(self._header_reflow_job)
            except Exception: pass
        self._header_reflow_job = self._root.after(60, self._reflow_header_buttons)

    def _reflow_header_buttons(self):
        self._header_reflow_job = None
        if self._root is None: return
        width = max(1, self._widgets["log"].winfo_width() - 16)
        if width < 520:
            for widget in (self._level_menu, self._pause_button): widget.place_forget()
            self._level_menu.pack_forget()
            self._pause_button.pack_forget()
            self._button_group.configure(width=58)
            self._button_group.pack(side="right", padx=(0, 8))
            self._copy_button.place_forget()
            self._clear_button.place(relx=1, x=-4, y=4, width=52, height=32, anchor="ne")
            self._pause_button.pack(side="right", padx=4)
            self._level_menu.pack(side="right", padx=4)
        else:
            for widget in (self._level_menu, self._pause_button): widget.place_forget()
            self._level_menu.pack_forget()
            self._pause_button.pack_forget()
            self._button_group.configure(width=128)
            self._button_group.pack(side="right", padx=(0, 8))
            self._copy_button.place(relx=1, x=-60, y=4, width=52, height=32, anchor="ne")
            self._clear_button.place(relx=1, x=-4, y=4, width=52, height=32, anchor="ne")
            self._pause_button.pack(side="right", padx=4)
            self._level_menu.pack(side="right", padx=4)

    def _clock_tick(self):
        if self._stopped or self._root is None or not self._clock.winfo_exists(): return
        self._clock.configure(text=time.strftime("%H:%M:%S"))
        self._clock_job = self._root.after(1000, self._clock_tick)

    def append(self, level, body, ts=None, source="trace", kind=None, persist=True):
        raw_ts = ts or datetime.now().isoformat(timespec="milliseconds")
        text = str(body if body is not None else "")
        normalized = str(level or "INFO").upper()
        normalized = {"WARNING": "WARN", "ERR": "ERROR"}.get(normalized, normalized)
        record = {"ts": raw_ts, "level": normalized, "kind": kind or "REPLY", "source": source, "body": text}
        if persist and getattr(self, "_trace_store", None) is not None: self._trace_store.append(record["kind"], text, normalized, source, raw_ts)
        self._records.append(record); self._records = self._records[-self._max_lines:]
        if self._paused: self._pending.append(record); return text
        if not self._level_ok(normalized): return text
        return self._draw_line(normalized, text, raw_ts, source)

    def _draw_line(self, level, body, ts=None, source="trace"):
        raw_ts = ts or time.strftime("%H:%M:%S.000")
        text = str(body) if body is not None else ""
        line = "%s %s · %s" % (raw_ts, str(level).upper(), text) if level else text
        key = (str(level).upper(), text, source)
        if getattr(self, "_last_line", None) == key:
            if self._records:
                self._records[-1]["repeat"] = self._records[-1].get("repeat", 1) + 1
            self._repeat_count = getattr(self, "_repeat_count", 1) + 1
            if self._root is not None and self._line_count:
                self._text.delete("end-2l", "end-1c"); self._text.insert("end-1c", " ×%d\n" % self._repeat_count, ("body",))
            else:
                self._stored_lines += 1
                self._line_count = self._stored_lines
            return line
        self._last_line = key; self._repeat_count = 1
        self._line_count += 1
        self._stored_lines += 1
        if self._root is None:
            self._stored_lines = min(self._stored_lines, self._max_lines)
            self._line_count = self._stored_lines
            return line
        info = theme.classify(line)
        start = self._text.index("end-1c")
        tags = ("stripe",) if self._line_count % 2 == 0 else ()
        prefix = info["ts"] + (" " if info["ts"] else "")
        level_text = (info["level"] + " · ") if info["level"] else ""
        rendered = prefix + level_text + info["body"]
        for fragment, attrs in theme.ansi_to_fragments(rendered):
            tagset = ("body",) + tags
            if attrs.get("bold"): tagset += ("ansi_bold",)
            if attrs.get("underline"): tagset += ("ansi_underline",)
            self._text.insert("end", fragment, tagset)
        self._text.insert("end", "\n", ("body",)+tags)
        if info["ts"]:
            self._text.tag_add("ts", start, "%s+%dc" % (start, len(prefix)))
        if info["level"]:
            level_start = "%s+%dc" % (start, len(prefix))
            self._text.tag_add("level_" + info["level"], level_start, "%s+%dc" % (level_start, len(level_text)))
        if self._line_count > self._max_lines:
            excess = self._line_count - self._max_lines
            self._text.delete("1.0", str(excess + 1) + ".0")
            self._line_count = self._max_lines
        self._append_since_seek += 1
        if self._auto_scroll and self._append_since_seek >= 32:
            self._text.see("end")
            self._append_since_seek = 0
        self.set_telemetry(log_count=self._line_count)
        if self._root is not None and hasattr(self, "_log_stat"): self._log_stat.set("· N %d" % self._line_count)
        return line

    def append_request(self, record, persist=True):
        """追加一条请求统计行：耗时 / token / 算力，成功为 OK、失败为 ERROR（红色）。

        行内容与 usage.format_request_line 一致；token 未知时带 "(estimated)"。
        persist=True 时按终端 trace 持久化（kind 记为 REPLY），暂停/过滤逻辑复用 append()。
        """
        record = dict(record) if isinstance(record, dict) else {}
        level = "ERROR" if _request_status(record) == "FAIL" else "OK"
        return self.append(level, _format_request_body(record), _request_ts(record), str(record.get("source") or "request"), kind="REPLY", persist=persist)

    def append_record(self, record, persist=True):
        record = record if isinstance(record, dict) else {}
        if _looks_like_request(record):
            return self.append_request(record, persist=persist)
        level = str(record.get("level", "INFO")).upper()
        kind = str(record.get("kind", "REPLY")).upper()
        return self.append(level, record.get("body", record.get("text", record.get("line", ""))), record.get("ts", record.get("timestamp", record.get("t"))), record.get("source", "trace"), kind=kind)
    def set_level(self, level):
        self._min_level = str(level or "ALL").upper()
        if self._root is not None: self._redraw()
        return self._min_level

    def _redraw(self):
        records = list(self._records)
        self._last_line = None
        self._repeat_count = 0
        if self._root is None:
            self._line_count = sum(1 for record in records if self._level_ok(record.get("level")))
            return
        self._text.delete("1.0", "end")
        self._line_count = 0
        for record in records:
            if self._level_ok(record.get("level")): self._draw_line(record.get("level"), record.get("body", ""), record.get("ts"), record.get("source", "terminal"))

    def _level_ok(self, level):
        level = str(level or "INFO").upper()
        selected = str(self._min_level or "ALL").upper()
        if selected == "ALL": return True
        severity = {"DEBUG": 0, "SYS": 0, "REQ": 0, "PATH": 0, "OK": 1, "INFO": 1, "WARN": 2, "ERR": 3, "ERROR": 3}
        return severity.get(level, 1) >= severity.get(selected, 0)

    def toggle_pause(self):
        self._paused = not self._paused
        if not self._paused:
            pending, self._pending = self._pending, []
            for record in pending:
                if self._level_ok(record.get("level")): self._draw_line(record.get("level"), record.get("body", ""), record.get("ts"), record.get("source", "terminal"))
        return self._paused

    def clear(self):
        self._line_count = 0
        self._stored_lines = 0
        self._records.clear()
        self._pending.clear()
        self._last_line = None
        self._repeat_count = 0
        if self._root is not None: self._text.delete("1.0", "end")

    def copy_all(self):
        text = self._text.get("1.0", "end-1c") if self._root is not None else ""
        if self._root is not None:
            try: self._root.clipboard_clear(); self._root.clipboard_append(text)
            except Exception: pass
        return text

    def set_chips(self, items):
        if self._root is None: return
        for child in self._chip_items.winfo_children(): child.destroy()
        values = items if items else [("—", "SYS")]
        for label, level in values:
            spec = theme.status_chip(label, level); tk.Label(self._chip_items, text=spec["label"], bg=spec["bg"], fg=spec["fg"], highlightthickness=1, highlightbackground=spec["border"], font=(theme.SIZES["font"], spec["size"])).pack(side="left", padx=3, pady=4)

    def set_topbar(self, title=None, clock_text=None, signal=0):
        if self._root is None: return
        if title is not None: self._title.configure(text=str(title))
        if clock_text is not None: self._clock.configure(text=str(clock_text))
        try: self._signal.configure(text=_SIGNAL[max(0, min(4, int(signal)) - 1)] if int(signal) else _SIGNAL[0])
        except Exception: self._signal.configure(text=_SIGNAL[0])

    def set_telemetry(self, uptime_s=None, log_count=None, buckets=None):
        if self._root is None: return
        up = int(uptime_s if uptime_s is not None else time.monotonic() - self._started); count = self._line_count if log_count is None else int(log_count)
        bars = "".join("▰" if float(x) > .5 else "▱" for x in (buckets or [] )[:24])
        self._telemetry.configure(text="UPTIME %ss    LOG N %s    %s" % (up, count, bars))

    def set_config_line(self, widgets_parent):
        return self._widgets.get("config", widgets_parent)

    def on_submit(self, callback): self._callback = callback
    def set_completions(self, values): self._completions = [str(x) for x in (values or [])]
    def _submit_event(self, _event=None):
        text = self._entry.get().strip(); self._entry.delete(0, "end")
        if not text: return "break"
        self.history.append(text); self._history_index = None
        started = time.monotonic()
        result = self._callback(text) if self._callback else None
        elapsed = int((time.monotonic()-started)*1000)
        if result is not None: self.append("OK", "[%d ms] %s" % (elapsed, result))
        return "break"
    def _history_up(self, _event=None):
        if not self.history: return "break"
        self._history_index = len(self.history)-1 if self._history_index is None else max(0, self._history_index-1); self._entry.delete(0,"end"); self._entry.insert(0,self.history[self._history_index]); return "break"
    def _history_down(self, _event=None):
        if not self.history: return "break"
        self._history_index = min(len(self.history)-1, (self._history_index or 0)+1); self._entry.delete(0,"end"); self._entry.insert(0,self.history[self._history_index]); return "break"
    def _complete_event(self, _event=None):
        prefix=self._entry.get(); choices=[x for x in self._completions if x.startswith(prefix)]
        if choices: self._entry.delete(0,"end"); self._entry.insert(0, choices[0])
        return "break"
    def _on_motion(self, event):
        if self._root is None:
            return
        try:
            line = int(self._text.index("@%d,%d" % (event.x, event.y)).split(".")[0])
        except Exception:
            return
        self._text.tag_remove("hover", "1.0", "end")
        if line > 0:
            self._text.tag_add("hover", "%d.0" % line, "%d.end" % line)
    def _on_scroll(self, _event):
        self._auto_scroll = False
        if self._root is not None: self._jump.pack(side="bottom", pady=3)
    def set_scanline(self, enabled=False):
        self._scanline_on = bool(enabled)
        if self._root is not None and self._scanline_on and not hasattr(self, "_scanline"):
            self._scanline = tk.Frame(self._text, height=1, bg=theme.COLORS["link"])
        if self._root is not None and self._scanline_on and hasattr(self, "_scanline"):
            self._scanline.place(relx=0, rely=0, relwidth=1, anchor="nw")
        if self._root is not None and self._scanline_on and self._scanline_job is None:
            self._scanline_tick()
        elif self._root is not None and not self._scanline_on and hasattr(self, "_scanline"):
            self._scanline.place_forget()
            if self._scanline_job is not None:
                try: self._root.after_cancel(self._scanline_job)
                except Exception: pass
                self._scanline_job = None
        return theme.scanline() if self._scanline_on else None

    def _scanline_tick(self):
        self._scanline_job = None
        if self._stopped or self._root is None or not self._scanline_on or not hasattr(self, "_scanline"): return
        self._scanline.place_configure(rely=(time.monotonic() * 0.12) % 1.0)
        self._scanline_job = self._root.after(80, self._scanline_tick)
    def jump_to_latest(self):
        self._auto_scroll = True
        if self._root is not None: self._text.see("end"); self._jump.pack_forget()
    def widget(self): return self._root
    def layout_geometry(self):
        if self._root is not None:
            self._root.update_idletasks()
            return [{"key":key,"x":frame.winfo_x(),"y":frame.winfo_y(),"width":frame.winfo_width(),"height":frame.winfo_height(),"divider":theme.COLORS["divider"]} for key,frame in self._widgets.items()]
        return [{"key":item["key"],"x":0,"y":i,"width":0,"height":0,"divider":item["divider"]} for i,item in enumerate(theme.sections())]
    def stop(self):
        self._stopped = True
        if self._root is None: return
        for attr in ("_clock_job", "_header_reflow_job", "_scanline_job"):
            job = getattr(self, attr, None)
            if job is not None:
                try: self._root.after_cancel(job)
                except Exception: pass
                setattr(self, attr, None)

    def destroy(self):
        self.stop()
        if self._root is not None: self._root.destroy()

def build_terminal_page(app, parent):
    try: return TerminalView(app, parent)
    except Exception: return None

def _selftest():
    if tk is None:
        print("SELFTEST SKIP: tkinter unavailable")
        return None
    try:
        host = tk.Tk()
    except Exception as exc:
        print("SELFTEST SKIP: Tk display unavailable (%s)" % exc)
        return None
    host.geometry("900x600+0+0")
    view = TerminalView(None, host)
    view._max_lines = 2000
    host.update()
    for i in range(5000): view.append("SYS", "selftest %d" % i)
    view.set_chips([]); view.set_telemetry(log_count=view._line_count); view.jump_to_latest()
    host.update_idletasks()
    assert all(view._widgets[key].winfo_ismapped() for key in ("topbar", "chips", "config", "log", "telemetry", "command", "footer"))
    for button in (view._copy_button, view._clear_button):
        assert button.winfo_width() >= 52
        assert button.winfo_rootx() + button.winfo_width() <= host.winfo_rootx() + host.winfo_width() - 8
    assert view._line_count == 2000
    assert int(float(view._text.index("end-1c").split(".")[0])) - 1 == 2000
    # --- 逐请求展示（B09）：耗时 / token / 算力，失败 ERROR 红色，暂停/过滤保留 ---
    view.clear()
    ok_line = view.append_request({"model": "deepseek-chat", "elapsed_ms": 842.0, "prompt_tokens": 120, "reply_tokens": 380, "success": True}, persist=False)
    assert "842ms" in ok_line and "120→380 tok" in ok_line and "FLOPs" in ok_line, ok_line
    assert view._records[-1]["level"] == "OK"
    fail_record = {"model": "qwen3:8b", "elapsed_ms": 2500.0, "success": False, "error": "timeout"}
    fail_line = view.append_request(fail_record, persist=False)
    assert "2.50s" in fail_line and "estimated" in fail_line and "error: timeout" in fail_line, fail_line
    assert view._records[-1]["level"] == "ERROR"
    host.update_idletasks()
    assert view._text.tag_ranges("level_ERROR"), "failed request must be tagged ERROR"
    assert view._text.tag_cget("level_ERROR", "foreground") == theme.color_for("ERROR")
    # 请求记录（无 body）走 append_record 也能识别
    view.append_record({"model": "deepseek-chat", "elapsed_ms": 5.0, "prompt_tokens": 1, "reply_tokens": 2, "success": True}, persist=False)
    assert view._records[-1]["level"] == "OK" and "1→2 tok" in view._records[-1]["body"]
    # 过滤与暂停不丢请求行
    view.set_level("ERROR")
    assert view._level_ok("ERROR") and not view._level_ok("OK")
    view.toggle_pause()
    view.append_request({"model": "deepseek-chat", "elapsed_ms": 7.0, "prompt_tokens": 3, "reply_tokens": 4, "success": True}, persist=False)
    assert view._pending, "paused request should be queued"
    view.toggle_pause()
    assert not view._pending
    view.set_level("ALL")
    view.stop()
    assert not host.tk.call("after", "info")
    view.destroy()
    host.destroy()
    return True

if __name__ == "__main__":
    result = _selftest()
    if result is True: print("SELFTEST OK")
    elif result is False: raise SystemExit(1)

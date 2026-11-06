# -*- coding: utf-8 -*-
"""Terminal page view with a Tk implementation and safe fallback."""
from __future__ import annotations
import os
import time
try:
    import tkinter as tk
    from tkinter import ttk, font as tkfont
except Exception:
    tk = None
    ttk = None
from hxcore import term_theme as theme

_SIGNAL = "▁▃▅▇"

class TerminalView:
    def __init__(self, app=None, parent=None):
        self.app = app
        self._callback = None
        self.history = []
        self._history_index = None
        self._completions = []
        self._auto_scroll = True
        self._scanline_on = False
        self._line_count = 0
        self._stored_lines = 0
        self._append_since_seek = 0
        try:
            self._max_lines = max(1, int(os.environ.get("HYMNIX_TERM_MAX_LINES", "2000")))
        except (TypeError, ValueError):
            self._max_lines = 2000
        self._clock_job = None
        self._header_reflow_job = None
        self._stopped = False
        self._started = time.monotonic()
        self._widgets = {}
        self._root = tk.Frame(parent, bg=theme.COLORS["bg"]) if tk and parent is not None else None
        if self._root is not None:
            self._build()

    def _build(self):
        root = self._root
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
        self._title = tk.Label(top, text="HYMNIX // TERMINAL", bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], font=(theme.SIZES["font"], theme.SIZES["topbar"], "bold"))
        self._title.pack(side="left", padx=theme.SIZES["pad"], pady=8)
        self._signal = tk.Label(top, text=_SIGNAL[0], bg=theme.COLORS["bg"], fg=theme.COLORS["link"], font=(theme.SIZES["font"], theme.SIZES["topbar"]))
        self._signal.pack(side="right", padx=8)
        self._clock = tk.Label(top, text="", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["topbar"]))
        self._clock.pack(side="right", padx=8)
        self._clock_tick()
        self._chip_frame = self._widgets["chips"]
        tk.Label(self._chip_frame, text="STATUS", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["chip"])).pack(side="left", padx=theme.SIZES["pad"])
        self._chip_items = tk.Frame(self._chip_frame, bg=theme.COLORS["bg"]); self._chip_items.pack(side="left")
        self._config_label = tk.Label(self._widgets["config"], text="MODEL  —   APPLY  —   BILL  —   QUOTA  —   SAVE", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["chip"]))
        self._config_label.pack(anchor="w", padx=theme.SIZES["pad"], pady=6)
        header = tk.Frame(log, bg=theme.COLORS["bg"], height=40); header.pack(fill="x"); header.pack_propagate(False)
        tk.Label(header, text="SYS.LOG", bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], font=(theme.SIZES["font"], theme.SIZES["body"], "bold")).pack(side="left", padx=theme.SIZES["pad"], pady=5)
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
        self._text = tk.Text(body, height=6, bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], insertbackground=theme.COLORS["link"], font=body_font, spacing1=0, spacing3=line_gap, relief="flat", borderwidth=0, wrap="none")
        scroll = tk.Scrollbar(body, command=self._text.yview, width=8, bg=theme.COLORS["divider"], troughcolor=theme.COLORS["bg"], activebackground=theme.COLORS["ghost_hover"], relief="flat")
        self._text.configure(yscrollcommand=scroll.set); self._text.grid(row=0, column=0, sticky="nsew"); scroll.grid(row=0, column=1, sticky="ns")
        for level, color in theme.LEVELS.items(): self._text.tag_configure("level_"+level, foreground=color)
        self._text.tag_configure("ts", foreground=theme.COLORS["ts"]); self._text.tag_configure("body", foreground=theme.COLORS["fg"]); self._text.tag_configure("stripe", background=theme.COLORS["stripe"]); self._text.tag_configure("hover", background=theme.COLORS["ghost_hover"])
        self._text.bind("<Motion>", self._on_motion); self._text.bind("<MouseWheel>", self._on_scroll)
        self._jump = self._button(log, theme.JUMP_LABEL, self.jump_to_latest, link=True); self._jump.pack_forget()
        self._telemetry = tk.Label(telemetry, text="UPTIME 0s    LOG N 0    ▏", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["chip"])); self._telemetry.pack(anchor="w", padx=theme.SIZES["pad"], pady=6)
        self._entry = tk.Entry(command, bg=theme.COLORS["bg"], fg=theme.COLORS["fg"], insertbackground=theme.COLORS["link"], relief="flat", font=(theme.SIZES["font"], theme.SIZES["body"]))
        self._entry.pack(side="left", fill="x", expand=True, padx=theme.SIZES["pad"], pady=7); self._entry.bind("<Return>", self._submit_event); self._entry.bind("<Up>", self._history_up); self._entry.bind("<Down>", self._history_down); self._entry.bind("<Tab>", self._complete_event); self._entry.bind("<FocusIn>", lambda _e: self._entry.configure(highlightthickness=1, highlightbackground=theme.COLORS["link"])); self._entry.bind("<FocusOut>", lambda _e: self._entry.configure(highlightthickness=0))
        tk.Label(footer, text="↑ history  ·  Tab complete  ·  scroll to inspect", bg=theme.COLORS["bg"], fg=theme.COLORS["muted"], font=(theme.SIZES["font"], theme.SIZES["chip"])).pack(anchor="w", padx=theme.SIZES["pad"], pady=5)

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
        available = max(128, self._widgets["log"].winfo_width() - 16)
        self._button_group.configure(width=min(128, available))

    def _clock_tick(self):
        if self._stopped or self._root is None or not self._clock.winfo_exists(): return
        self._clock.configure(text=time.strftime("%H:%M:%S"))
        self._clock_job = self._root.after(1000, self._clock_tick)

    def append(self, level, body, ts=None, source="trace"):
        raw_ts = ts or time.strftime("%H:%M:%S.000")
        text = str(body) if body is not None else ""
        line = "%s %s · %s" % (raw_ts, str(level).upper(), text) if level else text
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
        self._text.insert("end", prefix + level_text + info["body"] + "\n", ("body",)+tags)
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
        return line

    def append_record(self, record):
        record = record if isinstance(record, dict) else {}
        return self.append(record.get("level", record.get("kind", "")), record.get("body", record.get("text", record.get("line", ""))), record.get("ts"), record.get("source", "trace"))

    def clear(self):
        self._line_count = 0
        self._stored_lines = 0
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
        result = self._callback(text) if self._callback else None
        if result is not None: self.append("SYS", result)
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
            self._scanline = tk.Frame(self._text, height=1, bg="#25384A")
            self._scanline.place(relx=0, rely=0, relwidth=1, anchor="nw")
        elif self._root is not None and not self._scanline_on and hasattr(self, "_scanline"):
            self._scanline.place_forget()
        return theme.scanline() if self._scanline_on else None
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
        for attr in ("_clock_job", "_header_reflow_job"):
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
    view.stop()
    assert not host.tk.call("after", "info")
    view.destroy()
    host.destroy()
    return True

if __name__ == "__main__":
    result = _selftest()
    if result is True: print("SELFTEST OK")
    elif result is False: raise SystemExit(1)

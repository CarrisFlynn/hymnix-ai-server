"""Modal approval prompt for tool calls."""
import json
import sys

try:
    import tkinter as tk
except Exception:
    tk = None

try:
    from pages_modern import _UI, RoundedCard, PillButton, _label, _tag
except Exception:
    _UI = RoundedCard = PillButton = _label = _tag = None


def _preview(tool, args):
    """Return a bounded, readable representation of tool arguments."""
    command_like = any(token in str(tool).lower() for token in ("terminal", "command", "shell", "exec"))
    if command_like and isinstance(args, dict):
        value = args.get("command") or args.get("cmd")
        if value is not None:
            return str(value)[:800]
    try:
        return json.dumps(args, ensure_ascii=False, indent=2, default=str)[:800]
    except Exception:
        return str(args)[:800]


def show_approval_dialog(root, ui, tool, args, risk, reasons, on_decide):
    """Show a modal approval dialog; failures always fail closed."""
    decided = False
    window = None

    def decide(decision, remember=False):
        nonlocal decided
        if decided:
            return
        decided = True
        try:
            if callable(on_decide):
                on_decide(decision, bool(remember))
        except Exception:
            pass
        try:
            if window is not None and window.winfo_exists():
                window.destroy()
        except Exception:
            pass

    try:
        if tk is None or _UI is None or RoundedCard is None or PillButton is None or _label is None or _tag is None:
            decide("deny", False)
            return None
        theme = getattr(ui, "theme", {}) or {}
        tr = getattr(ui, "t", lambda zh, en=None: zh)
        window = tk.Toplevel(root)
        window.title(tr("确认工具操作", "Approve tool action"))
        window.transient(root)
        window.protocol("WM_DELETE_WINDOW", lambda: decide("deny", False))
        window.resizable(True, True)
        window.configure(bg=theme.get("bg", "#202124"))
        card = RoundedCard(window, ui, fill=theme.get("card", "#2a2b2e"), pad=16, radius=10)
        card.pack(fill="both", expand=True, padx=12, pady=12)
        body = card.body
        _label(body, text=tr("工具操作需要确认", "Tool action requires approval"),
               font=ui.font_obj(14, "bold"), fg=theme.get("text", "#ffffff"),
               bg=theme.get("card", "#2a2b2e")).pack(anchor="w", pady=(0, 8))
        _label(body, text=tr("工具", "Tool") + ": " + str(tool),
               fg=theme.get("text", "#ffffff"), bg=theme.get("card", "#2a2b2e")).pack(anchor="w")
        normalized_risk = str(risk).lower()
        risk_specs = {
            "safe": (tr("安全", "Safe"), theme.get("ok", "#2e9d65")),
            "moderate": (tr("中等风险", "Moderate risk"), theme.get("warning", "#d98b20")),
            "danger": (tr("高风险", "Danger"), theme.get("danger", "#d34545")),
        }
        risk_text, risk_color = risk_specs.get(normalized_risk, (str(risk), theme.get("text_muted", "#999999")))
        _tag(body, ui, risk_text, bg=theme.get("card", "#2a2b2e"), fill=risk_color, fg="#ffffff").pack(anchor="w", pady=(6, 10))
        _label(body, text=tr("参数预览", "Arguments"), font=ui.font_obj(10, "bold"),
               fg=theme.get("text", "#ffffff"), bg=theme.get("card", "#2a2b2e")).pack(anchor="w")
        preview = tk.Text(body, height=6, wrap="word", relief="flat", bd=0,
                          bg=theme.get("input_bg", theme.get("bg", "#202124")),
                          fg=theme.get("text", "#ffffff"), font=ui.font_obj(9, mono=True))
        preview.insert("1.0", _preview(tool, args))
        preview.configure(state="disabled")
        preview.pack(fill="both", expand=True, pady=(3, 8))
        _label(body, text=tr("原因", "Reasons"), font=ui.font_obj(10, "bold"),
               fg=theme.get("text", "#ffffff"), bg=theme.get("card", "#2a2b2e")).pack(anchor="w")
        reason_rows = reasons if isinstance(reasons, (list, tuple)) else [reasons]
        for reason in reason_rows:
            _label(body, text="• " + str(reason), fg=theme.get("text_muted", "#aaaaaa"),
                   bg=theme.get("card", "#2a2b2e"), wraplength=ui.px(520), anchor="w", justify="left").pack(fill="x", anchor="w")
        buttons = tk.Frame(body, bg=theme.get("card", "#2a2b2e"))
        buttons.pack(fill="x", pady=(14, 0))
        PillButton(buttons, ui, tr("拒绝", "Deny"), command=lambda: decide("deny", False),
                   kind="ghost", bg=theme.get("card", "#2a2b2e")).pack(side="right", padx=(5, 0))
        PillButton(buttons, ui, tr("本次运行内始终允许", "Always allow this run"),
                   command=lambda: decide("allow", True), kind="ghost", bg=theme.get("card", "#2a2b2e")).pack(side="right", padx=(5, 0))
        PillButton(buttons, ui, tr("允许一次", "Allow once"), command=lambda: decide("allow", False),
                   kind="primary", bg=theme.get("card", "#2a2b2e")).pack(side="right")
        try:
            window.update_idletasks()
            w = max(560, min(760, window.winfo_reqwidth()))
            h = max(480, min(720, window.winfo_reqheight()))
            try:
                rx = root.winfo_rootx() + max(0, (root.winfo_width() - w) // 2)
                ry = root.winfo_rooty() + max(0, (root.winfo_height() - h) // 3)
                window.geometry("%dx%d+%d+%d" % (int(w), int(h), int(rx), int(ry)))
            except Exception:
                window.geometry("%dx%d" % (int(w), int(h)))
            window.minsize(520, 420)
            window.lift()
        except Exception:
            pass
        window.transient(root)
        window.grab_set()
        window.wait_window()
        return None
    except Exception:
        decide("deny", False)
        return None


def selftest():
    """Exercise preview formatting and fail-closed behavior without a display."""
    try:
        assert _preview("terminal.run", {"cmd": "echo hi"}) == "echo hi"
        assert _preview("fs.read", {"text": "你好"}).startswith("{")
        assert len(_preview("fs.read", {"data": "x" * 1000})) <= 800
        decisions = []
        original = globals()["tk"]
        globals()["tk"] = None
        try:
            show_approval_dialog(None, None, "fs.write", {}, "danger", [],
                                 lambda decision, remember: decisions.append((decision, remember)))
        finally:
            globals()["tk"] = original
        assert decisions == [("deny", False)]
        return True
    except Exception:
        return False


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        if selftest():
            print("SELFTEST OK")
        else:
            print("SELFTEST FAIL")
            raise SystemExit(1)

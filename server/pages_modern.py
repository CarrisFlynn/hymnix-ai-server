# -*- coding: utf-8 -*-
"""pages_modern.py - Hymnix 1.1.0 现代扁平风页面.

主程序调用方式::

    from pages_modern import build_plugins_page, build_sponsor_page
    build_plugins_page(self, tab_plugins)
    build_sponsor_page(self, tab_support)

app 约定（全部做了兼容回退，缺一不可运行）::

    app.THEME     设计令牌 dict（缺失时回退到 hymnix_main.THEME / 内置默认主题）
    app.config    可读写配置 dict（切换开关后立即写回并调用 app.save_config()）
    app.T(zh) / app._t(zh, en)   中英切换（缺失时尝试 hymnix_main.T，再回退中文）
    app.root      Tk 根窗口（缺失时用 parent.winfo_toplevel()）
    app.AFDIAN_URL（可选，默认使用本模块的 AFDIAN_URL）

设计基准：1024 x 700（逻辑像素）。所有间距 / 圆角 / 控件尺寸都按 DPI 比例缩放，
字体用 point 字号，跟随系统 DPI。页面内容使用 Canvas + Frame 滚动容器，
小窗口下不会被裁切。
"""

from __future__ import annotations

import sys
import tkinter as tk
import tkinter.font as tkfont
import webbrowser

__all__ = [
    "AFDIAN_URL",
    "SUPPORT_EMAIL",
    "DEFAULT_THEME",
    "build_plugins_page",
    "build_sponsor_page",
    "RoundedCard",
    "PillButton",
    "ToggleSwitch",
    "ScrollPage",
]

# ==================== 常量 ====================

AFDIAN_URL = "https://ifdian.net/a/hymnixstudio"
SUPPORT_EMAIL = "shayhymnix@gmail.com"

DEFAULT_THEME = {
    "bg": "#F3F5FA",
    "surface": "#F8FAFD",
    "card": "#FFFFFF",
    "input_bg": "#FBFCFE",
    "text": "#101828",
    "text_muted": "#667085",
    "text_dim": "#98A2B3",
    "accent": "#2563EB",
    "accent_hover": "#3B82F6",
    "accent_press": "#1D4ED8",
    "accent_soft": "#EFF6FF",
    "accent_dark": "#1E40AF",
    "sep": "#E4E7EC",
    "ok": "#12B76A",
    "warn": "#F79009",
    "err": "#F04438",
    "btn": "#EEF2F7",
    "btn_hover": "#E4E9F1",
    "scroll_bg": "#D0D5DD",
    "scroll_active": "#98A2B3",
    "switch_off": "#D0D5DD",
    "chip_bg": "#F2F4F8",
    "shadow": "#E8ECF3",
    "hero_bg": "#EFF6FF",
}

# (config key, 中文名, 中文说明, English name, English desc, 默认值)
CAPABILITIES = (
    ("ui_sound", "点击音效", "按键与切换面板时播放轻微的机械键盘声，可随时关闭。",
     "Click sound", "A soft mechanical key click on taps and switches. Turn it off any time.", True),
    ("enable_server_trace", "服务端回显", "在本机终端实时显示服务端请求轨迹（思考、工具与回复）。",
     "Server trace", "Show live server-side request traces (thinking, tools, replies) in the terminal.", False),
    ("auto_scroll", "自动滚动", "新消息到达时自动滚到底部，长对话跟读更省事。",
     "Auto scroll", "Keep the chat pinned to the newest message while replies stream in.", True),
    ("enable_note_injection", "留言注入", "允许把服务端留言注入下一轮对话，让模型自然转达。",
     "Note injection", "Inject server notes into the next turn so the model can relay them naturally.", False),
)

# (中文标题, 中文说明, English title, English desc, 状态中文, 状态英文)
ROADMAP = (
    ("工具调用", "把本地时间、计算、文件与系统信息接入对话。",
     "Tool calling", "Local time, math, files and system info inside the conversation.",
     "下一版", "Next up"),
    ("OCR 识别", "截图或扫描件里的文字，直接提取进对话。",
     "OCR", "Pull text out of screenshots or scans right into the chat.",
     "规划中", "Planned"),
    ("云端聚合", "DeepSeek、OpenAI、Gemini 统一入口与用量统计。",
     "Cloud hub", "One entry point and usage stats for DeepSeek, OpenAI and Gemini.",
     "规划中", "Planned"),
)

# (序号, 中文标题, 中文说明, English title, English desc)
SPONSOR_POINTS = (
    ("01", "完全自愿", "不赞助也能使用全部功能，更新与支持不会因此打折。",
     "Fully optional", "Every feature stays available whether you donate or not."),
    ("02", "不锁功能", "没有付费墙，赞助只代表认可，不会解锁额外能力。",
     "No paywall", "No locked features. Donations are a thank-you, not a key."),
    ("03", "资金用途", "用于模型调用、域名与服务器成本，以及后续开发时间。",
     "Where it goes", "Model calls, domain and server costs, and time for future updates."),
)


# ==================== 基础工具 ====================

def _hex_rgb(value):
    raw = str(value or "").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return (0, 0, 0)
    try:
        return tuple(int(raw[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return (0, 0, 0)


def _rgb_hex(rgb):
    return "#%02X%02X%02X" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def _mix(color_a, color_b, amount):
    """把 a 向 b 混合 amount（0..1）。"""
    ca = _hex_rgb(color_a)
    cb = _hex_rgb(color_b)
    amount = max(0.0, min(1.0, float(amount)))
    return _rgb_hex(tuple(ca[i] + (cb[i] - ca[i]) * amount for i in range(3)))


def _rgba(color, alpha=255):
    r, g, b = _hex_rgb(color)
    return (r, g, b, max(0, min(255, int(alpha))))


_PIL = None


def _pil():
    """惰性加载 Pillow；没有安装时全部退回纯 Canvas 绘制。"""
    global _PIL
    if _PIL is None:
        try:
            from PIL import Image, ImageDraw, ImageFilter, ImageTk
            _PIL = (Image, ImageDraw, ImageFilter, ImageTk)
        except Exception:
            _PIL = False
    return _PIL


def _pick_font(root, candidates, fallback):
    try:
        families = set(tkfont.families(root))
    except Exception:
        families = set()
    for name in candidates:
        if name in families:
            return name
    return fallback


def _detect_scale(widget):
    """按系统 DPI 求缩放系数（96dpi -> 1.0，150% -> 1.5）。"""
    try:
        raw = float(widget.winfo_toplevel().tk.call("tk", "scaling"))
        scale = raw / (96.0 / 72.0)
        if scale <= 1.02:
            return 1.0
        return max(1.0, min(2.0, round(scale, 2)))
    except Exception:
        return 1.0


def _load_theme(app):
    theme = dict(DEFAULT_THEME)
    source = getattr(app, "THEME", None)
    if not isinstance(source, dict):
        source = None
        for name in ("hymnix_main", "__main__"):
            module = sys.modules.get(name)
            candidate = getattr(module, "THEME", None) if module else None
            if isinstance(candidate, dict):
                source = candidate
                break
    if isinstance(source, dict):
        for key, value in source.items():
            if isinstance(value, str) and value.strip().startswith("#"):
                theme[key] = value.strip()
    # 派生色：卡片阴影、正文弱化色等
    theme["shadow"] = _mix(theme["bg"], theme["sep"], 0.62)
    if "accent_hover" not in (source or {}):
        theme["accent_hover"] = _mix(theme["accent"], "#FFFFFF", 0.22)
    if "accent_press" not in (source or {}):
        theme["accent_press"] = _mix(theme["accent"], "#000000", 0.24)
    if "accent_dark" not in (source or {}):
        theme["accent_dark"] = _mix(theme["accent"], "#000000", 0.42)
    if "hero_bg" not in (source or {}):
        theme["hero_bg"] = theme["accent_soft"]
    if "switch_off" not in theme:
        theme["switch_off"] = "#D0D5DD"
    return theme


def _make_translator(app):
    method = getattr(app, "T", None)
    if callable(method):
        def translate(zh, en=None):
            try:
                return method(zh, en)
            except TypeError:
                try:
                    return method(zh)
                except Exception:
                    return zh
            except Exception:
                return zh
        return translate

    method = getattr(app, "_t", None)
    if callable(method):
        def translate(zh, en=None):
            try:
                return method(zh, en if en is not None else zh)
            except TypeError:
                try:
                    return method(zh)
                except Exception:
                    return zh
            except Exception:
                return zh
        return translate

    for name in ("hymnix_main", "__main__"):
        module = sys.modules.get(name)
        func = getattr(module, "T", None) if module else None
        if callable(func):
            def translate(zh, en=None, _func=func):
                try:
                    return _func(zh, en)
                except TypeError:
                    try:
                        return _func(zh)
                    except Exception:
                        return zh
                except Exception:
                    return zh
            return translate

    return lambda zh, en=None: zh


class _UI:
    """一次构建所需的上下文：主题、字体、缩放、翻译、配置。"""

    def __init__(self, app, parent):
        self.app = app
        self.parent = parent
        try:
            self.root = getattr(app, "root", None) or parent.winfo_toplevel()
        except Exception:
            self.root = parent
        self.theme = _load_theme(app)
        self.scale = _detect_scale(parent)
        self.font = _pick_font(
            self.root,
            ("Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", "Helvetica"),
            "Segoe UI",
        )
        self.mono = _pick_font(
            self.root,
            ("Cascadia Mono", "Consolas", "Menlo", "Courier New"),
            "Courier New",
        )
        self._translate = _make_translator(app)
        self._font_cache = {}
        config = getattr(app, "config", None)
        if not isinstance(config, dict):
            config = {}
            try:
                setattr(app, "config", config)
            except Exception:
                pass
        self.config = config

    def px(self, value):
        return max(1, int(round(float(value) * self.scale)))

    def t(self, zh, en=None):
        try:
            return self._translate(zh, en)
        except Exception:
            return zh

    def font_obj(self, size, weight="normal", mono=False):
        key = (int(size), weight, bool(mono))
        font = self._font_cache.get(key)
        if font is None:
            font = tkfont.Font(
                root=self.root,
                family=(self.mono if mono else self.font),
                size=int(size),
                weight=weight,
            )
            self._font_cache[key] = font
        return font

    def save(self):
        func = getattr(self.app, "save_config", None)
        if callable(func):
            try:
                func()
                return True
            except Exception:
                return False
        return False


def _dynamic_wrap(container, label, ui, reserve=0, minimum=160):
    """容器变宽/变窄时同步 label 的换行宽度。"""
    try:
        label.configure(wraplength=ui.px(minimum))
    except Exception:
        pass

    def on_configure(event):
        try:
            width = int(event.width) - int(reserve)
            if width >= ui.px(minimum):
                label.configure(wraplength=width)
        except Exception:
            pass

    try:
        container.bind("<Configure>", on_configure, add="+")
    except Exception:
        pass


# ==================== 纯 Canvas 绘制工具（无 Pillow 时的回退） ====================

def _round_rect(canvas, x1, y1, x2, y2, radius, fill):
    if x2 <= x1 or y2 <= y1:
        return
    r = max(0.0, min(float(radius), (x2 - x1) / 2.0, (y2 - y1) / 2.0))
    if r <= 0.5:
        canvas.create_rectangle(x1, y1, x2, y2, fill=fill, outline=fill)
        return
    canvas.create_rectangle(x1 + r, y1, x2 - r, y2, fill=fill, outline=fill)
    canvas.create_rectangle(x1, y1 + r, x2, y2 - r, fill=fill, outline=fill)
    canvas.create_arc(x1, y1, x1 + 2 * r, y1 + 2 * r, start=90, extent=90,
                      style=tk.PIESLICE, fill=fill, outline=fill)
    canvas.create_arc(x2 - 2 * r, y1, x2, y1 + 2 * r, start=0, extent=90,
                      style=tk.PIESLICE, fill=fill, outline=fill)
    canvas.create_arc(x2 - 2 * r, y2 - 2 * r, x2, y2, start=270, extent=90,
                      style=tk.PIESLICE, fill=fill, outline=fill)
    canvas.create_arc(x1, y2 - 2 * r, x1 + 2 * r, y2, start=180, extent=90,
                      style=tk.PIESLICE, fill=fill, outline=fill)


# ==================== Pillow 抗锯齿图像 ====================

def _photo_round(ui, width, height, radius, fill, shadow=False, border=None, border_width=0):
    """生成抗锯齿的圆角矩形 PhotoImage；Pillow 不可用时返回 None。"""
    pil = _pil()
    if not pil or width < 2 or height < 2:
        return None
    Image, ImageDraw, ImageFilter, ImageTk = pil
    try:
        ss = 2
        w, h = int(width), int(height)
        big_w, big_h = w * ss, h * ss
        radius_px = max(1, int(radius * ss))
        offset = ui.px(3) * ss if shadow else 0
        layer = Image.new("RGBA", (big_w, big_h), (0, 0, 0, 0))

        if shadow:
            shade = Image.new("RGBA", (big_w, big_h), (0, 0, 0, 0))
            shade_draw = ImageDraw.Draw(shade)
            shade_draw.rounded_rectangle(
                [0, offset, big_w - 1, big_h - 1],
                radius=radius_px,
                fill=(23, 32, 55, 26),
            )
            blur = max(1, int(ui.px(4) * ss))
            shade = shade.filter(ImageFilter.GaussianBlur(blur))
            layer = Image.alpha_composite(layer, shade)

        card = Image.new("RGBA", (big_w, big_h), (0, 0, 0, 0))
        card_draw = ImageDraw.Draw(card)
        bottom = big_h - offset if shadow else big_h
        if border and border_width > 0:
            card_draw.rounded_rectangle(
                [0, 0, big_w - 1, max(0, bottom - 1)],
                radius=radius_px,
                fill=_rgba(border),
            )
            inset = max(1, int(border_width * ss))
            inner_radius = max(1, radius_px - inset)
            card_draw.rounded_rectangle(
                [inset, inset, big_w - 1 - inset, max(0, bottom - 1 - inset)],
                radius=inner_radius,
                fill=_rgba(fill),
            )
        else:
            card_draw.rounded_rectangle(
                [0, 0, big_w - 1, max(0, bottom - 1)],
                radius=radius_px,
                fill=_rgba(fill),
            )
        layer = Image.alpha_composite(layer, card)
        layer = layer.resize((w, h), Image.LANCZOS)
        return ImageTk.PhotoImage(layer, master=ui.root)
    except Exception:
        return None


def _photo_switch(ui, width, height, value, hover):
    """自绘开关的整张图：轨道 + 白色滑块 + 轻微阴影。"""
    pil = _pil()
    if not pil or width < 4 or height < 4:
        return None
    Image, ImageDraw, ImageFilter, ImageTk = pil
    try:
        ss = 3
        w, h = int(width), int(height)
        big_w, big_h = w * ss, h * ss
        radius = big_h / 2.0
        theme = ui.theme
        if value:
            track = theme["accent"]
            if hover:
                track = theme.get("accent_hover") or _mix(track, "#FFFFFF", 0.2)
        else:
            track = theme.get("switch_off") or "#D0D5DD"
            if hover:
                track = _mix(track, theme["text_muted"], 0.25)

        layer = Image.new("RGBA", (big_w, big_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        draw.rounded_rectangle([0, 0, big_w - 1, big_h - 1], radius=radius,
                               fill=_rgba(track))

        margin = max(1, int(ui.px(3) * ss))
        knob_d = big_h - 2 * margin
        knob_x = (big_w - margin - knob_d) if value else margin
        knob_y = margin

        shade = Image.new("RGBA", (big_w, big_h), (0, 0, 0, 0))
        shade_draw = ImageDraw.Draw(shade)
        shade_draw.ellipse(
            [knob_x, knob_y + max(1, int(ui.px(1) * ss)),
             knob_x + knob_d, knob_y + knob_d + max(1, int(ui.px(1) * ss))],
            fill=(23, 32, 55, 55),
        )
        shade = shade.filter(ImageFilter.GaussianBlur(max(1, int(ui.px(1.2) * ss))))
        layer = Image.alpha_composite(layer, shade)
        draw = ImageDraw.Draw(layer)
        draw.ellipse([knob_x, knob_y, knob_x + knob_d, knob_y + knob_d],
                     fill=(255, 255, 255, 255))
        layer = layer.resize((w, h), Image.LANCZOS)
        return ImageTk.PhotoImage(layer, master=ui.root)
    except Exception:
        return None


# ==================== 基础控件 ====================

class RoundedCard(tk.Frame):
    """扁平圆角卡片：Canvas 画底 + 内嵌 Frame 放内容。"""

    def __init__(self, master, ui, fill=None, pad=18, radius=16, shadow=True, parent_bg=None):
        self.ui = ui
        self._outer_bg = parent_bg or ui.theme["bg"]
        super().__init__(master, bg=self._outer_bg)
        self.fill = fill or ui.theme["card"]
        self.radius = radius
        self.shadow = shadow
        self._photo = None
        self._last_size = None
        self._canvas = tk.Canvas(self, bg=self._outer_bg, highlightthickness=0, bd=0, takefocus=0)
        self._canvas.place(x=0, y=0, relwidth=1, relheight=1)
        pad_px = ui.px(pad)
        self.body = tk.Frame(self, bg=self.fill)
        self.body.pack(fill="both", expand=True, padx=pad_px, pady=pad_px)
        self.bind("<Configure>", self._redraw)

    def _redraw(self, event=None):
        width = self.winfo_width()
        height = self.winfo_height()
        if width < 8 or height < 8:
            return
        if (width, height) == self._last_size:
            return
        self._last_size = (width, height)
        canvas = self._canvas
        canvas.delete("all")
        radius = self.ui.px(self.radius)
        photo = _photo_round(self.ui, width, height, radius, self.fill,
                             shadow=self.shadow)
        if photo is not None:
            self._photo = photo
            canvas.create_image(0, 0, anchor="nw", image=photo)
        else:
            self._photo = None
            if self.shadow:
                _round_rect(canvas, 0, self.ui.px(3), width, height,
                            radius, self.ui.theme["shadow"])
            _round_rect(canvas, 0, 0, width, height - (self.ui.px(3) if self.shadow else 0),
                        radius, self.fill)


class PillButton(tk.Canvas):
    """自绘胶囊按钮，支持 primary / ghost 两种样式。"""

    def __init__(self, master, ui, text, command=None, kind="primary", bg=None):
        self.ui = ui
        self._kind = kind
        self._command = command
        self._text = text
        self._font = ui.font_obj(10, "bold")
        self._height = ui.px(42)
        self._padx = ui.px(22)
        self._bg = bg or ui.theme["bg"]
        self._width = self._font.measure(text) + 2 * self._padx
        self._photo = None
        self._hover = False
        self._pressed = False
        super().__init__(master, width=self._width, height=self._height,
                         bg=self._bg, highlightthickness=0, bd=0,
                         cursor="hand2", takefocus=1)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Button-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<Return>", self._on_key)
        self.bind("<space>", self._on_key)
        self._redraw()

    def _palette(self):
        theme = self.ui.theme
        if self._kind == "primary":
            base = theme["accent"]
            hover = theme.get("accent_hover") or _mix(base, "#FFFFFF", 0.2)
            press = theme.get("accent_press") or _mix(base, "#000000", 0.2)
            return base, hover, press, "#FFFFFF", None
        base = theme["card"]
        hover = _mix(theme["card"], theme["accent_soft"], 0.5)
        press = theme["accent_soft"]
        return base, hover, press, theme["accent"], theme.get("sep")

    def _redraw(self):
        self.delete("all")
        fill, hover, press, fg, border = self._palette()
        if self._pressed:
            fill = press
        elif self._hover:
            fill = hover
        width = self._width
        height = self._height
        radius = height / 2.0
        photo = _photo_round(self.ui, width, height, radius, fill,
                             border=border, border_width=self.ui.px(1) if border else 0)
        if photo is not None:
            self._photo = photo
            self.create_image(0, 0, anchor="nw", image=photo)
        else:
            self._photo = None
            _round_rect(self, 0, 0, width, height, radius, fill)
        self.create_text(width / 2.0, height / 2.0, text=self._text,
                         fill=fg, font=self._font)

    def set_text(self, text, resize=True):
        self._text = text
        if resize:
            self._width = self._font.measure(text) + 2 * self._padx
            self.configure(width=self._width)
        self._redraw()

    def invoke(self):
        if callable(self._command):
            try:
                self._command()
            except Exception:
                pass

    def _on_enter(self, _event=None):
        self._hover = True
        self._redraw()

    def _on_leave(self, _event=None):
        self._hover = False
        self._pressed = False
        self._redraw()

    def _on_press(self, _event=None):
        self._pressed = True
        self._redraw()

    def _on_release(self, event=None):
        was_pressed = self._pressed
        self._pressed = False
        self._redraw()
        if was_pressed and event is not None:
            try:
                if 0 <= event.x <= self._width and 0 <= event.y <= self._height:
                    self.invoke()
            except Exception:
                pass

    def _on_key(self, _event=None):
        self.invoke()
        return "break"


class Tag(tk.Canvas):
    """小号胶囊标签（ROADMAP / 下一版 / 01 等）。"""

    def __init__(self, master, ui, text, bg, fill=None, fg=None, mono=True, height=22):
        theme = ui.theme
        self.ui = ui
        self._font = ui.font_obj(8, "bold", mono=mono)
        self._height = ui.px(height)
        self._text = text
        self._width = self._font.measure(text) + ui.px(18)
        self._fill = fill or theme["accent_soft"]
        self._fg = fg or theme["accent"]
        self._bg = bg
        self._photo = None
        super().__init__(master, width=self._width, height=self._height,
                         bg=bg, highlightthickness=0, bd=0, takefocus=0)
        self._redraw()

    def _redraw(self):
        self.delete("all")
        radius = self._height / 2.0
        photo = _photo_round(self.ui, self._width, self._height, radius, self._fill)
        if photo is not None:
            self._photo = photo
            self.create_image(0, 0, anchor="nw", image=photo)
        else:
            _round_rect(self, 0, 0, self._width, self._height, radius, self._fill)
        self.create_text(self._width / 2.0, self._height / 2.0,
                         text=self._text, fill=self._fg, font=self._font)


class ToggleSwitch(tk.Canvas):
    """自绘开关；点击立即回调，支持键盘操作。"""

    def __init__(self, master, ui, value=False, command=None, bg=None):
        self.ui = ui
        self._width = ui.px(46)
        self._height = ui.px(26)
        self._value = bool(value)
        self._command = command
        self._bg = bg or ui.theme["card"]
        self._hover = False
        self._photo = None
        super().__init__(master, width=self._width, height=self._height,
                         bg=self._bg, highlightthickness=0, bd=0,
                         cursor="hand2", takefocus=1)
        self.bind("<Button-1>", self._on_click)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<space>", self._on_key)
        self.bind("<Return>", self._on_key)
        self._redraw()

    def get(self):
        return self._value

    def set(self, value):
        value = bool(value)
        if value != self._value:
            self._value = value
            self._redraw()

    def toggle(self):
        self._value = not self._value
        self._redraw()
        if callable(self._command):
            try:
                self._command(self._value)
            except Exception:
                pass

    def _on_click(self, _event=None):
        self.toggle()

    def _on_key(self, _event=None):
        self.toggle()
        return "break"

    def _on_enter(self, _event=None):
        self._hover = True
        self._redraw()

    def _on_leave(self, _event=None):
        self._hover = False
        self._redraw()

    def _redraw(self):
        self.delete("all")
        photo = _photo_switch(self.ui, self._width, self._height,
                              self._value, self._hover)
        if photo is not None:
            self._photo = photo
            self.create_image(0, 0, anchor="nw", image=photo)
            return
        self._photo = None
        theme = self.ui.theme
        height = self._height
        radius = height / 2.0
        track = theme["accent"] if self._value else (theme.get("switch_off") or "#D0D5DD")
        if self._hover:
            track = _mix(track, "#FFFFFF" if self._value else theme["text_muted"], 0.18)
        _round_rect(self, 0, 0, self._width, height, radius, track)
        margin = self.ui.px(3)
        knob = height - 2 * margin
        left = (self._width - margin - knob) if self._value else margin
        self.create_oval(left, margin + self.ui.px(1), left + knob, margin + knob + self.ui.px(1),
                         fill=_mix(track, "#000000", 0.18), outline="")
        self.create_oval(left, margin, left + knob, margin + knob,
                         fill="#FFFFFF", outline="")


class SlimScrollbar(tk.Canvas):
    """6px 宽、只有滑块的极简滚动条。"""

    def __init__(self, master, ui):
        self.ui = ui
        self._width = ui.px(7)
        self._first = 0.0
        self._last = 1.0
        self._drag = None
        self._last_visible = 1.0
        super().__init__(master, width=self._width, bg=ui.theme["bg"],
                         highlightthickness=0, bd=0, takefocus=0)
        self.bind("<Configure>", lambda _e: self._redraw())
        self.bind("<Button-1>", self._on_press)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<Enter>", lambda _e: self._redraw(hover=True))
        self.bind("<Leave>", lambda _e: self._redraw())

    def set(self, first, last):
        try:
            self._first = float(first)
            self._last = float(last)
        except Exception:
            return
        self._redraw()

    def _redraw(self, hover=False):
        self.delete("all")
        height = self.winfo_height()
        width = self.winfo_width()
        if height <= 2 or width <= 2:
            return
        visible = max(0.0, self._last - self._first)
        if visible >= 0.999:
            return
        top = int(self._first * height)
        bottom = int(self._last * height)
        min_h = self.ui.px(28)
        if bottom - top < min_h:
            bottom = min(top + min_h, height)
            top = max(0, bottom - min_h)
        margin = max(1, width // 2 - self.ui.px(2))
        x1 = margin
        x2 = width - margin
        color = self.ui.theme.get("scroll_active" if hover else "scroll_bg") or "#D0D5DD"
        _round_rect(self, x1, top, x2, bottom, (x2 - x1) / 2.0, color)

    def _on_press(self, event):
        visible = self._last - self._first
        if visible >= 0.999:
            return
        height = max(1, self.winfo_height())
        thumb_top = self._first * height
        thumb_bottom = self._last * height
        if not (thumb_top <= event.y <= thumb_bottom):
            self._scroll_to(event.y / height - visible / 2.0)
        self._drag = (event.y, self._first)
        self._last_visible = max(0.01, visible)

    def _on_drag(self, event):
        if not self._drag:
            return
        height = max(1, self.winfo_height())
        start_y, start_first = self._drag
        self._scroll_to(start_first + (event.y - start_y) / float(height))

    def _on_release(self, _event=None):
        self._drag = None

    def _scroll_to(self, first):
        first = max(0.0, min(1.0 - self._last_visible, first))
        try:
            self.master.canvas.yview_moveto(first) if hasattr(self.master, "canvas") else None
        except Exception:
            pass


class ScrollPage(tk.Frame):
    """Canvas + Frame 纵向滚动页；内容使用 grid 自适应宽度。"""

    def __init__(self, master, ui, pad_y=(20, 20)):
        super().__init__(master, bg=ui.theme["bg"])
        self.ui = ui
        self.canvas = tk.Canvas(self, bg=ui.theme["bg"], highlightthickness=0, bd=0, takefocus=0)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar = SlimScrollbar(self, ui)
        self.scrollbar.pack(side="right", fill="y", padx=(0, ui.px(2)), pady=ui.px(6))
        self.inner = tk.Frame(self.canvas, bg=ui.theme["bg"])
        self._window = self.canvas.create_window(0, 0, anchor="nw", window=self.inner)
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.inner.bind("<Configure>", self._on_inner_configure)
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.content = tk.Frame(self.inner, bg=ui.theme["bg"])
        self.content.pack(fill="both", expand=True,
                          padx=ui.px(28), pady=(ui.px(pad_y[0]), ui.px(pad_y[1])))
        self.content.columnconfigure(0, weight=1)
        self.after_idle(self._sync_width)

    def _on_inner_configure(self, _event=None):
        try:
            bbox = self.canvas.bbox("all")
            if bbox:
                self.canvas.configure(scrollregion=bbox)
        except Exception:
            pass

    def _sync_width(self):
        """Give the inner frame its final width before Tk paints the page."""
        try:
            width = self.canvas.winfo_width()
            if width <= 1:
                width = self.winfo_toplevel().winfo_width() - self.ui.px(120)
            if width > 1:
                self.canvas.itemconfigure(self._window, width=int(width))
        except Exception:
            pass

    def _on_canvas_configure(self, event):
        try:
            self.canvas.itemconfigure(self._window, width=max(1, int(event.width)))
        except Exception:
            pass

    def _on_wheel(self, event):
        try:
            step = -1 if event.delta > 0 else 1
            self.canvas.yview_scroll(step * 3, "units")
        except Exception:
            pass
        return "break"

    def bind_wheel(self):
        def walk(widget):
            try:
                widget.bind("<MouseWheel>", self._on_wheel)
            except Exception:
                pass
            try:
                children = widget.winfo_children()
            except Exception:
                return
            for child in children:
                walk(child)
        walk(self)


# ==================== 页面公共片段 ====================

_LabelBase = tk.Label


def _label(parent, **kwargs):
    """统一的扁平文字控件：去掉 Tk 默认的 1px 边距/内边距，行高更紧凑。"""
    label = _LabelBase(parent, **kwargs)
    try:
        label.configure(borderwidth=0, highlightthickness=0, padx=0, pady=0)
    except Exception:
        pass
    return label


def _after(widget, delay_ms, callback):
    """安全延时回调：控件销毁时自动取消，避免 Tk after 报 invalid command name。"""
    state = {"id": None}

    def run():
        state["id"] = None
        try:
            if widget.winfo_exists():
                callback()
        except Exception:
            pass

    def cancel(_event=None):
        ident = state.get("id")
        if ident:
            try:
                widget.after_cancel(ident)
            except Exception:
                pass
            state["id"] = None

    try:
        state["id"] = widget.after(int(delay_ms), run)
        widget.bind("<Destroy>", cancel, add="+")
    except Exception:
        pass
    return state

def _page_header(parent, ui, eyebrow, title, desc):
    theme = ui.theme
    wrap = tk.Frame(parent, bg=theme["bg"])
    wrap.columnconfigure(0, weight=1)
    _label(wrap, text=eyebrow, font=ui.font_obj(8, "bold", mono=True),
             fg=theme["text_dim"], bg=theme["bg"]).grid(row=0, column=0, sticky="w")
    _label(wrap, text=title, font=ui.font_obj(20, "bold"),
             fg=theme["text"], bg=theme["bg"]).grid(
        row=1, column=0, sticky="w", pady=(ui.px(5), ui.px(4)))
    desc_label = _label(wrap, text=desc, font=ui.font_obj(10),
                          fg=theme["text_muted"], bg=theme["bg"],
                          justify="left", anchor="w")
    desc_label.grid(row=2, column=0, sticky="w")
    _dynamic_wrap(wrap, desc_label, ui, reserve=ui.px(2), minimum=260)
    return wrap


def _tag(parent, ui, text, bg, fill=None, fg=None, mono=True):
    return Tag(parent, ui, text, bg=bg, fill=fill, fg=fg, mono=mono)


def _separator(parent, ui):
    return tk.Frame(parent, bg=ui.theme["sep"], height=1)


# ==================== 插件页 ====================

def build_plugins_page(app, parent):
    """构建「插件与能力」页。返回页面 Frame，可忽略。"""
    ui = _UI(app, parent)
    theme = ui.theme
    page = ScrollPage(parent, ui)
    page.pack(fill="both", expand=True)
    content = page.content

    header = _page_header(
        content, ui, "EXTENSIONS",
        ui.t("插件与能力", "Plugins & capabilities"),
        ui.t("按需打开模型与界面能力。改动即时写入本机配置，重启后依然生效。",
             "Turn model and interface capabilities on or off. Changes are saved to this device instantly."),
    )
    header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(12)))

    # ---- 能力开关卡片 ----
    switch_card = RoundedCard(content, ui, fill=theme["card"], pad=14, radius=16)
    switch_card.grid(row=1, column=0, sticky="ew")
    body = switch_card.body
    body.columnconfigure(0, weight=1)

    head = tk.Frame(body, bg=theme["card"])
    head.grid(row=0, column=0, sticky="ew")
    head.columnconfigure(0, weight=1)
    _label(head, text=ui.t("能力开关", "Capabilities"), font=ui.font_obj(13, "bold"),
             fg=theme["text"], bg=theme["card"]).grid(row=0, column=0, sticky="w")
    saved_label = _label(head, text=ui.t("改动即时保存", "Saved instantly"),
                           font=ui.font_obj(9), fg=theme["text_dim"], bg=theme["card"])
    saved_label.grid(row=0, column=1, sticky="e")

    hint = _label(body,
                    text=ui.t("这些开关只影响本机体验，不会改变服务端行为。",
                              "These switches only affect this device, not the server."),
                    font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"],
                    anchor="w", justify="left")
    hint.grid(row=1, column=0, sticky="w", pady=(ui.px(3), ui.px(8)))
    _dynamic_wrap(body, hint, ui, reserve=ui.px(2), minimum=220)
    _separator(body, ui).grid(row=2, column=0, sticky="ew")

    def flash_saved():
        try:
            saved_label.configure(text=ui.t("已保存", "Saved"), fg=theme["ok"])

            def reset():
                try:
                    saved_label.configure(text=ui.t("改动即时保存", "Saved instantly"),
                                          fg=theme["text_dim"])
                except Exception:
                    pass

            _after(page, 1400, reset)
        except Exception:
            pass

    for index, (key, name_zh, desc_zh, name_en, desc_en, default) in enumerate(CAPABILITIES):
        base_row = 3 + index * 2
        row = tk.Frame(body, bg=theme["card"])
        row.grid(row=base_row, column=0, sticky="ew", pady=(ui.px(8), ui.px(8)))
        row.columnconfigure(0, weight=1)

        text_box = tk.Frame(row, bg=theme["card"])
        text_box.grid(row=0, column=0, sticky="ew")
        text_box.columnconfigure(0, weight=1)
        _label(text_box, text=ui.t(name_zh, name_en), font=ui.font_obj(10, "bold"),
                 fg=theme["text"], bg=theme["card"], anchor="w").grid(row=0, column=0, sticky="w")
        desc_label = _label(text_box, text=ui.t(desc_zh, desc_en), font=ui.font_obj(9),
                              fg=theme["text_muted"], bg=theme["card"],
                              justify="left", anchor="w")
        desc_label.grid(row=1, column=0, sticky="w", pady=(ui.px(3), 0))
        _dynamic_wrap(row, desc_label, ui, reserve=ui.px(100), minimum=180)

        def on_toggle(value, config_key=key):
            ui.config[config_key] = bool(value)
            ui.save()
            flash_saved()

        switch = ToggleSwitch(row, ui, value=bool(ui.config.get(key, default)),
                              command=on_toggle, bg=theme["card"])
        switch.grid(row=0, column=1, sticky="", padx=(ui.px(18), 0))

        if index < len(CAPABILITIES) - 1:
            _separator(body, ui).grid(row=base_row + 1, column=0, sticky="ew")

    # ---- 扩展与计划卡片 ----
    roadmap_card = RoundedCard(content, ui, fill=theme["card"], pad=14, radius=16)
    roadmap_card.grid(row=2, column=0, sticky="ew", pady=(ui.px(12), 0))
    roadmap_body = roadmap_card.body
    roadmap_body.columnconfigure(0, weight=1)

    roadmap_head = tk.Frame(roadmap_body, bg=theme["card"])
    roadmap_head.grid(row=0, column=0, sticky="ew")
    roadmap_head.columnconfigure(0, weight=1)
    _label(roadmap_head, text=ui.t("扩展与计划", "Roadmap"), font=ui.font_obj(13, "bold"),
             fg=theme["text"], bg=theme["card"]).grid(row=0, column=0, sticky="w")
    _tag(roadmap_head, ui, "ROADMAP", bg=theme["card"], fill=theme["chip_bg"],
         fg=theme["text_muted"]).grid(row=0, column=1, sticky="e")

    roadmap_hint = _label(roadmap_body,
                            text=ui.t("还在路上的能力，先在这里占个位。",
                                      "Capabilities on the way. A placeholder for now."),
                            font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"],
                            anchor="w", justify="left")
    roadmap_hint.grid(row=1, column=0, sticky="w", pady=(ui.px(3), ui.px(8)))
    _dynamic_wrap(roadmap_body, roadmap_hint, ui, reserve=ui.px(2), minimum=220)
    _separator(roadmap_body, ui).grid(row=2, column=0, sticky="ew")

    for index, (title_zh, desc_zh, title_en, desc_en, status_zh, status_en) in enumerate(ROADMAP):
        base_row = 3 + index * 2
        row = tk.Frame(roadmap_body, bg=theme["card"])
        row.grid(row=base_row, column=0, sticky="ew", pady=(ui.px(7), ui.px(7)))
        row.columnconfigure(0, weight=1)
        text_box = tk.Frame(row, bg=theme["card"])
        text_box.grid(row=0, column=0, sticky="ew")
        text_box.columnconfigure(0, weight=1)
        _label(text_box, text=ui.t(title_zh, title_en), font=ui.font_obj(10, "bold"),
                 fg=theme["text"], bg=theme["card"], anchor="w").grid(row=0, column=0, sticky="w")
        desc_label = _label(text_box, text=ui.t(desc_zh, desc_en), font=ui.font_obj(9),
                              fg=theme["text_muted"], bg=theme["card"],
                              justify="left", anchor="w")
        desc_label.grid(row=1, column=0, sticky="w", pady=(ui.px(3), 0))
        _dynamic_wrap(row, desc_label, ui, reserve=ui.px(110), minimum=180)
        planned = status_zh == "规划中"
        _tag(row, ui, ui.t(status_zh, status_en), bg=theme["card"],
             fill=theme["chip_bg"] if planned else theme["accent_soft"],
             fg=theme["text_muted"] if planned else theme["accent"]).grid(
            row=0, column=1, sticky="e", padx=(ui.px(14), 0))
        if index < len(ROADMAP) - 1:
            _separator(roadmap_body, ui).grid(row=base_row + 1, column=0, sticky="ew")


    page.bind_wheel()
    return page


# ==================== 赞助页 ====================

def _supporters_from(config):
    raw = config.get("supporters") if isinstance(config, dict) else None
    names = []
    if isinstance(raw, (list, tuple)):
        for item in raw:
            if isinstance(item, str) and item.strip():
                names.append(item.strip())
            elif isinstance(item, dict):
                name = item.get("name") or item.get("nick") or item.get("title")
                if name:
                    names.append(str(name).strip())
            elif item:
                names.append(str(item).strip())
    elif isinstance(raw, str) and raw.strip():
        names.append(raw.strip())
    return names


def build_sponsor_page(app, parent):
    """构建「赞助与支持」页。返回页面 Frame，可忽略。"""
    ui = _UI(app, parent)
    theme = ui.theme
    page = ScrollPage(parent, ui, pad_y=(24, 24))
    page.pack(fill="both", expand=True)
    content = page.content

    header = _page_header(
        content, ui, "SUPPORT",
        ui.t("支持这个项目", "Support this project"),
        ui.t("Hymnix 是一个独立的小项目。如果它帮你省下了时间，下面两种方式可以让它走得更远。",
             "Hymnix is a small independent project. If it saves you time, these two options help it grow."),
    )
    header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(16)))

    # ---- Hero 卡片 ----
    hero = RoundedCard(content, ui, fill=theme["hero_bg"], pad=26, radius=18)
    hero.grid(row=1, column=0, sticky="ew")
    hero_body = hero.body
    hero_body.columnconfigure(0, weight=1)

    _label(hero_body, text=ui.t("让 Hymnix 继续长大", "Keep Hymnix growing"),
             font=ui.font_obj(18, "bold"), fg=theme["accent_dark"],
             bg=theme["hero_bg"]).grid(row=0, column=0, sticky="w")

    hero_desc = _label(
        hero_body,
        text=ui.t("赞助完全自愿。你可以在爱发电一次性或按月支持；也可以直接发邮件，告诉我你在用它做什么。",
                  "Support is entirely optional. Give once or monthly on Afdian, or just send an email and tell me what you use it for."),
        font=ui.font_obj(10), fg=theme["text_muted"], bg=theme["hero_bg"],
        justify="left", anchor="w")
    hero_desc.grid(row=1, column=0, sticky="w", pady=(ui.px(8), 0))
    _dynamic_wrap(hero_body, hero_desc, ui, reserve=ui.px(2), minimum=280)

    button_row = tk.Frame(hero_body, bg=theme["hero_bg"])
    button_row.grid(row=2, column=0, sticky="w", pady=(ui.px(18), 0))

    def open_afdian():
        url = getattr(app, "AFDIAN_URL", None) or AFDIAN_URL
        try:
            webbrowser.open(url)
        except Exception:
            pass

    copy_state = {"after_id": None}
    email_line = _label(hero_body, text="shayhymnix@gmail.com",
                          font=ui.font_obj(9, mono=True), fg=theme["text_muted"],
                          bg=theme["hero_bg"], anchor="w")
    email_line.grid(row=4, column=0, sticky="w", pady=(ui.px(14), 0))

    copy_button = PillButton(button_row, ui, ui.t("复制邮箱", "Copy email"),
                             command=None, kind="ghost", bg=theme["hero_bg"])

    def reset_copy_state():
        try:
            copy_button.set_text(ui.t("复制邮箱", "Copy email"), resize=False)
            email_line.configure(text="shayhymnix@gmail.com", fg=theme["text_muted"])
        except Exception:
            pass
        copy_state["after_id"] = None

    def copy_email():
        copied = False
        try:
            root = ui.root
            root.clipboard_clear()
            root.clipboard_append(SUPPORT_EMAIL)
            root.update_idletasks()
            copied = True
        except Exception:
            copied = False
        if not copied:
            return
        try:
            copy_button.set_text(ui.t("已复制", "Copied"), resize=False)
            email_line.configure(text=ui.t("已复制到剪贴板：%s", "Copied to clipboard: %s") % SUPPORT_EMAIL,
                                 fg=theme["accent"])
        except Exception:
            pass
        try:
            _after(page, 1800, reset_copy_state)
        except Exception:
            pass

    copy_button._command = copy_email

    afdian_button = PillButton(button_row, ui, ui.t("打开爱发电", "Open Afdian"),
                               command=open_afdian, kind="primary", bg=theme["hero_bg"])
    afdian_button.grid(row=0, column=0, sticky="w")
    copy_button.grid(row=0, column=1, sticky="w", padx=(ui.px(10), 0))

    # ---- 赞助说明 ----
    section_head = tk.Frame(content, bg=theme["bg"])
    section_head.grid(row=2, column=0, sticky="ew", pady=(ui.px(24), ui.px(12)))
    section_head.columnconfigure(0, weight=1)
    _label(section_head, text=ui.t("赞助说明", "How support works"),
             font=ui.font_obj(13, "bold"), fg=theme["text"], bg=theme["bg"]).grid(
        row=0, column=0, sticky="w")
    _tag(section_head, ui, "WHY", bg=theme["bg"], fill=theme["chip_bg"],
         fg=theme["text_muted"]).grid(row=0, column=1, sticky="e")

    points_wrap = tk.Frame(content, bg=theme["bg"])
    points_wrap.grid(row=3, column=0, sticky="ew")
    for column in range(3):
        points_wrap.columnconfigure(column, weight=1, uniform="support-points")

    point_cards = []
    for number, title_zh, desc_zh, title_en, desc_en in SPONSOR_POINTS:
        point_card = RoundedCard(points_wrap, ui, fill=theme["card"], pad=16, radius=14)
        point_cards.append(point_card)
        point_body = point_card.body
        point_body.columnconfigure(1, weight=1)
        _tag(point_body, ui, number, bg=theme["card"], fill=theme["accent_soft"],
             fg=theme["accent"], mono=True).grid(
            row=0, column=0, rowspan=2, sticky="n", padx=(0, ui.px(12)), pady=(ui.px(1), 0))
        _label(point_body, text=ui.t(title_zh, title_en), font=ui.font_obj(10, "bold"),
               fg=theme["text"], bg=theme["card"], anchor="w").grid(
            row=0, column=1, sticky="w")
        point_desc = _label(point_body, text=ui.t(desc_zh, desc_en), font=ui.font_obj(9),
                            fg=theme["text_muted"], bg=theme["card"],
                            justify="left", anchor="w")
        point_desc.grid(row=1, column=1, sticky="w", pady=(ui.px(2), 0))
        _dynamic_wrap(point_body, point_desc, ui, reserve=ui.px(78), minimum=150)

    points_state = {"columns": 0}

    def layout_points(columns):
        if columns == points_state["columns"]:
            return
        points_state["columns"] = columns
        for column in range(3):
            points_wrap.columnconfigure(column, weight=0, uniform="")
        for card in point_cards:
            card.grid_forget()
        if columns == 3:
            for column in range(3):
                points_wrap.columnconfigure(column, weight=1, uniform="support-points")
            for index, card in enumerate(point_cards):
                card.grid(row=0, column=index, sticky="nsew",
                          padx=(0 if index == 0 else ui.px(10), 0))
        else:
            points_wrap.columnconfigure(0, weight=1)
            for index, card in enumerate(point_cards):
                card.grid(row=index, column=0, sticky="ew", pady=(0, ui.px(10)))

    def on_points_width(event):
        layout_points(3 if int(event.width) >= ui.px(760) else 1)

    points_wrap.bind("<Configure>", on_points_width, add="+")
    layout_points(3)

    # ---- 赞助名单 ----
    names = _supporters_from(ui.config)
    supporter_card = RoundedCard(content, ui, fill=theme["card"], pad=22, radius=16)
    supporter_card.grid(row=4, column=0, sticky="ew", pady=(ui.px(16), 0))
    supporter_body = supporter_card.body
    supporter_body.columnconfigure(0, weight=1)

    supporter_head = tk.Frame(supporter_body, bg=theme["card"])
    supporter_head.grid(row=0, column=0, sticky="ew")
    supporter_head.columnconfigure(0, weight=1)
    _label(supporter_head, text=ui.t("赞助名单", "Supporters"),
             font=ui.font_obj(13, "bold"), fg=theme["text"], bg=theme["card"]).grid(
        row=0, column=0, sticky="w")
    _tag(supporter_head, ui, "SUPPORTERS", bg=theme["card"], fill=theme["chip_bg"],
         fg=theme["text_muted"]).grid(row=0, column=1, sticky="e")

    if names:
        names_label = _label(supporter_body, text="   ·   ".join(names),
                               font=ui.font_obj(10), fg=theme["text"], bg=theme["card"],
                               justify="left", anchor="w")
        names_label.grid(row=1, column=0, sticky="w", pady=(ui.px(12), 0))
        _dynamic_wrap(supporter_body, names_label, ui, reserve=ui.px(2), minimum=220)
    else:
        empty_title = _label(supporter_body, text=ui.t("暂无名单", "No supporters yet"),
                               font=ui.font_obj(10, "bold"), fg=theme["text"],
                               bg=theme["card"], anchor="w")
        empty_title.grid(row=1, column=0, sticky="w", pady=(ui.px(12), 0))
        empty_hint = _label(
            supporter_body,
            text=ui.t("赞助者的名字会出现在这里。谢谢每一份支持。",
                      "Names of supporters will be listed here. Thank you for every bit of support."),
            font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"],
            justify="left", anchor="w")
        empty_hint.grid(row=2, column=0, sticky="w", pady=(ui.px(4), 0))
        _dynamic_wrap(supporter_body, empty_hint, ui, reserve=ui.px(2), minimum=220)

    footer = _label(content, text=ui.t("Hymnix 1.1.0 · 感谢每一份支持",
                                          "Hymnix 1.1.0 · Thanks for every bit of support"),
                      font=ui.font_obj(8), fg=theme["text_dim"], bg=theme["bg"], anchor="w")
    footer.grid(row=5, column=0, sticky="w", pady=(ui.px(16), 0))

    page.bind_wheel()
    return page

# -*- coding: utf-8 -*-
"""Hymnix UI Kit —— 现代扁平化 Tkinter 组件库（纯标准库）。

设计目标
========
* 用 Canvas 自绘圆角 / 胶囊，替换 tk.Label / tk.Button 的方块观感；
* 圆角采用「矩形 + 4 张预乘抗锯齿角贴图」实现，无第三方依赖也能平滑；
* 文字按字体度量做几何居中（Windows 下用 GDI 量取字形墨迹盒），logo 字母不会偏；
* 尺寸全部以「像素」为单位描述，配合进程 DPI 感知即可得到清晰渲染。

快速开始
========

    import tkinter as tk
    import ui_kit as uk

    root = tk.Tk()
    root.configure(bg=uk.PALETTE["bg"])

    uk.SquareLogo(root, size=40, letter="H").pack(padx=20, pady=20)

    card = uk.RoundedFrame(root, radius=12, padding=12)
    card.pack(fill="x", padx=20)
    nav = uk.NavItem(card.body, text="对话", active=True, width=200)
    nav.pack(fill="x")

    uk.FlatButton(root, "保存", kind="primary", on_click=lambda: None).pack()

组件 API
========
PALETTE / RADIUS / FONTS
    设计令牌。PALETTE 内为 #RRGGBB 字符串；RADIUS 为常用圆角半径（10-14）；
    FONTS 内统一使用正点字号，随 Tk 的 Per-Monitor DPI 清晰缩放。

SquareLogo(parent, size=40, letter="H", color=None, fg="#FFFFFF", bg=None,
           radius=None, font_family=None, font_size=None, font_weight="bold")
    正方形圆角 logo，字母按字形墨迹盒精确居中。
    方法：set_letter(text)、set_color(color)。

RoundedFrame(parent, radius=12, fill="#FFFFFF", padding=12, bg=None,
             width=None, height=None)
    Canvas 圆角卡片，内容放到 .body（一个普通 tk.Frame）里。

NavItem(parent, text, active=False, on_click=None, width=200,
        height=None, radius=None, bg=None, font=None)
    圆角胶囊导航项：选中淡紫底 + 左侧 3px 指示条 + hover 变色，
    文字左对齐，内边距左右 14 / 上下 10。
    方法：set_active(flag)、set_text(text)。

FlatButton(parent, text, kind="primary", on_click=None, width=None,
           height=None, radius=10, bg=None, font=None)
    扁平圆角按钮，kind 取 "primary" 或 "ghost"；hover / press 有状态变化，无边框。
    方法：set_text(text)、set_kind(kind)。
"""

from __future__ import annotations

import sys
import tkinter as tk
from tkinter import font as tkfont

__all__ = [
    "PALETTE",
    "RADIUS",
    "FONTS",
    "FONT_FAMILY",
    "FONT_FAMILY_CJK",
    "mix",
    "SquareLogo",
    "RoundedFrame",
    "NavItem",
    "FlatButton",
]

# ---------------------------------------------------------------------------
# 设计令牌
# ---------------------------------------------------------------------------

PALETTE = {
    # 画布 / 卡片
    "bg": "#F6F7FB",
    "card": "#FFFFFF",
    "bg_alt": "#EEF1F6",
    # 文字
    "text": "#0F172A",
    "text_dim": "#667085",
    "text_muted": "#98A2B3",
    "on_primary": "#FFFFFF",
    # 主色与状态
    "primary": "#2563EB",
    "primary_hover": "#1D4ED8",
    "primary_press": "#1E40AF",
    "hover": "#EFF6FF",
    "selected": "#DBEAFE",
    # 线 / 语义色
    "border": "#E5E7EB",
    "divider": "#E5E7EB",
    "success": "#12B76A",
    "warning": "#F79009",
    "danger": "#F04438",
    "white": "#FFFFFF",
}

RADIUS = {"md": 10, "lg": 12, "xl": 14}

FONT_FAMILY = "Segoe UI"
FONT_FAMILY_CJK = "Microsoft YaHei UI"

#: 字号统一使用正点数，随 Per-Monitor DPI 清晰缩放。
FONTS = {
    "title": (FONT_FAMILY_CJK, 16, "bold"),
    "subtitle": (FONT_FAMILY_CJK, 12),
    "body": (FONT_FAMILY_CJK, 12),
    "body_bold": (FONT_FAMILY_CJK, 12, "bold"),
    "caption": (FONT_FAMILY_CJK, 10),
    "caption_bold": (FONT_FAMILY_CJK, 10, "bold"),
    "logo": (FONT_FAMILY_CJK, 16, "bold"),
    "button": (FONT_FAMILY_CJK, 10.5, "bold"),
    "button_ghost": (FONT_FAMILY_CJK, 10.5),
    "nav": (FONT_FAMILY_CJK, 13),
    "nav_active": (FONT_FAMILY_CJK, 13, "bold"),
}


# ---------------------------------------------------------------------------
# 颜色工具
# ---------------------------------------------------------------------------


def _hex_to_rgb(color):
    """'#RRGGBB' / '#RGB' → (r, g, b)。"""
    if not isinstance(color, str):
        color = str(color)
    color = color.strip()
    if color.startswith("#"):
        color = color[1:]
    if len(color) == 3:
        color = "".join(ch * 2 for ch in color)
    if len(color) != 6:
        return (0, 0, 0)
    return (int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16))


def _rgb_to_hex(rgb):
    r, g, b = (max(0, min(255, int(round(c)))) for c in rgb)
    return "#%02X%02X%02X" % (r, g, b)


def mix(color_a, color_b, t):
    """线性混色，t=0 返回 color_a，t=1 返回 color_b。"""
    t = max(0.0, min(1.0, float(t)))
    a, b = _hex_to_rgb(color_a), _hex_to_rgb(color_b)
    return _rgb_to_hex(tuple(a[i] + (b[i] - a[i]) * t for i in range(3)))


def _parent_bg(parent):
    try:
        return parent.cget("bg")
    except Exception:
        return PALETTE["bg"]


# ---------------------------------------------------------------------------
# 圆角绘制：矩形 + 4 张抗锯齿角贴图
# ---------------------------------------------------------------------------

_AA_SAMPLES = 4  # 每像素 4x4 超采样


def _corner_coverage(i, j, radius, corner, samples=_AA_SAMPLES):
    """计算 (i, j) 像素落在圆角墨迹内的覆盖率（0..1）。"""
    inside = 0
    total = samples * samples
    flip_x = corner in ("ne", "se")
    flip_y = corner in ("sw", "se")
    for sy in range(samples):
        y = j + (sy + 0.5) / samples
        if flip_y:
            y = radius - y
        for sx in range(samples):
            x = i + (sx + 0.5) / samples
            if flip_x:
                x = radius - x
            dx = radius - x
            dy = radius - y
            if dx * dx + dy * dy <= radius * radius:
                inside += 1
    return inside / total


def _make_corner_tiles(master, radius, fill, bg):
    """生成 4 个 (radius x radius) 抗锯齿角贴图，边缘与背景色混合。"""
    r = max(1, int(radius))
    fill_rgb = _hex_to_rgb(fill)
    bg_rgb = _hex_to_rgb(bg)
    tiles = {}
    for corner in ("nw", "ne", "sw", "se"):
        img = tk.PhotoImage(master=master, width=r, height=r)
        rows = []
        for j in range(r):
            row = []
            for i in range(r):
                cov = _corner_coverage(i, j, r, corner)
                row.append(
                    _rgb_to_hex(
                        (
                            bg_rgb[0] + (fill_rgb[0] - bg_rgb[0]) * cov,
                            bg_rgb[1] + (fill_rgb[1] - bg_rgb[1]) * cov,
                            bg_rgb[2] + (fill_rgb[2] - bg_rgb[2]) * cov,
                        )
                    )
                )
            rows.append(tuple(row))
        # 注意：PhotoImage.put 传字符串只会填一行，必须传「行的序列」。
        img.put(tuple(rows), to=(0, 0))
        tiles[corner] = img
    return tiles


def _corner_tiles(widget, cache, radius, fill, bg):
    key = (int(radius), fill, bg)
    tiles = cache.get(key)
    if tiles is None:
        tiles = _make_corner_tiles(widget, radius, fill, bg)
        cache[key] = tiles
    return tiles


def draw_round_rect(canvas, cache, x1, y1, x2, y2, radius, fill, bg, tags=()):
    """在 canvas 上画抗锯齿圆角矩形，返回 item id 列表。

    cache 是该 canvas 自己的角贴图缓存 dict（widget._tiles）。
    """
    x1, y1, x2, y2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))
    w, h = x2 - x1, y2 - y1
    if w <= 0 or h <= 0:
        return []
    r = int(round(radius))
    r = max(0, min(r, w // 2, h // 2))
    # Tk 的矩形填充范围是 [x1, x2) x [y1, y2)，所以右/下边界直接用 x2 / y2。
    rect = canvas.create_rectangle(x1, y1, x2, y2, fill=fill, outline="", tags=tags)
    items = [rect]
    if r <= 0:
        return items
    tiles = _corner_tiles(canvas, cache, r, fill, bg)
    for corner, tx, ty in (
        ("nw", x1, y1),
        ("ne", x2 - r, y1),
        ("sw", x1, y2 - r),
        ("se", x2 - r, y2 - r),
    ):
        items.append(
            canvas.create_image(tx, ty, image=tiles[corner], anchor="nw", tags=tags)
        )
    return items


# ---------------------------------------------------------------------------
# 字形墨迹测量（Windows GDI；其它平台自动降级）
# ---------------------------------------------------------------------------


class _GlyphInk(object):
    """用 GDI 把字符画到内存位图，再扫描像素得到精确墨迹盒。

    结果相对「文本行左上角」：(left, top, right, bottom)，单位像素。
    """

    def __init__(self):
        import ctypes
        from ctypes import wintypes

        self.ctypes = ctypes
        self.wintypes = wintypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
        self._cache = {}
        self._setup()

    def _setup(self):
        ct = self.ctypes
        wt = self.wintypes
        g = self.gdi32
        g.CreateCompatibleDC.restype = wt.HDC
        g.CreateCompatibleDC.argtypes = [wt.HDC]
        g.CreateCompatibleBitmap.restype = wt.HBITMAP
        g.CreateCompatibleBitmap.argtypes = [wt.HDC, ct.c_int, ct.c_int]
        g.SelectObject.restype = wt.HGDIOBJ
        g.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
        g.DeleteObject.argtypes = [wt.HGDIOBJ]
        g.DeleteDC.argtypes = [wt.HDC]
        g.PatBlt.argtypes = [wt.HDC, ct.c_int, ct.c_int, ct.c_int, ct.c_int, wt.DWORD]
        g.SetTextColor.argtypes = [wt.HDC, wt.COLORREF]
        g.SetBkMode.argtypes = [wt.HDC, ct.c_int]
        g.TextOutW.argtypes = [wt.HDC, ct.c_int, ct.c_int, wt.LPCWSTR, ct.c_int]
        g.GetDIBits.argtypes = [
            wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ct.c_void_p, ct.c_void_p, wt.UINT,
        ]

        class LOGFONTW(ct.Structure):
            _fields_ = [
                ("lfHeight", wt.LONG), ("lfWidth", wt.LONG),
                ("lfEscapement", wt.LONG), ("lfOrientation", wt.LONG),
                ("lfWeight", wt.LONG), ("lfItalic", wt.BYTE),
                ("lfUnderline", wt.BYTE), ("lfStrikeOut", wt.BYTE),
                ("lfCharSet", wt.BYTE), ("lfOutPrecision", wt.BYTE),
                ("lfClipPrecision", wt.BYTE), ("lfQuality", wt.BYTE),
                ("lfPitchAndFamily", wt.BYTE), ("lfFaceName", wt.WCHAR * 32),
            ]

        class TEXTMETRICW(ct.Structure):
            _fields_ = [
                ("tmHeight", wt.LONG), ("tmAscent", wt.LONG), ("tmDescent", wt.LONG),
                ("tmInternalLeading", wt.LONG), ("tmExternalLeading", wt.LONG),
                ("tmAveCharWidth", wt.LONG), ("tmMaxCharWidth", wt.LONG),
                ("tmWeight", wt.LONG), ("tmOverhang", wt.LONG),
                ("tmDigitizedAspectX", wt.LONG), ("tmDigitizedAspectY", wt.LONG),
                ("tmFirstChar", wt.WCHAR), ("tmLastChar", wt.WCHAR),
                ("tmDefaultChar", wt.WCHAR), ("tmBreakChar", wt.WCHAR),
                ("tmItalic", wt.BYTE), ("tmUnderlined", wt.BYTE),
                ("tmStruckOut", wt.BYTE), ("tmPitchAndFamily", wt.BYTE),
                ("tmCharSet", wt.BYTE),
            ]

        class BITMAPINFOHEADER(ct.Structure):
            _fields_ = [
                ("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD),
                ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD),
                ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG),
                ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD),
            ]

        class BITMAPINFO(ct.Structure):
            _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wt.DWORD * 3)]

        self.LOGFONTW = LOGFONTW
        self.TEXTMETRICW = TEXTMETRICW
        self.BITMAPINFO = BITMAPINFO
        self.BITMAPINFOHEADER = BITMAPINFOHEADER
        g.CreateFontIndirectW.restype = wt.HFONT
        g.CreateFontIndirectW.argtypes = [ct.POINTER(LOGFONTW)]
        g.GetTextMetricsW.argtypes = [wt.HDC, ct.POINTER(TEXTMETRICW)]

    def measure(self, text, family, px, weight=700):
        key = (text, family, int(px), int(weight))
        if key in self._cache:
            return self._cache[key]
        try:
            value = self._measure(text, family, int(px), int(weight))
        except Exception:
            value = None
        self._cache[key] = value
        return value

    def _measure(self, text, family, px, weight):
        ct = self.ctypes
        wt = self.wintypes
        g = self.gdi32
        W, H = 256, 96
        hdc_screen = self.user32.GetDC(None)
        hdc = g.CreateCompatibleDC(hdc_screen)
        hbmp = g.CreateCompatibleBitmap(hdc_screen, W, H)
        old_bmp = g.SelectObject(hdc, hbmp)
        style = self.LOGFONTW()
        style.lfHeight = -max(4, px)
        style.lfWeight = int(weight)
        style.lfCharSet = 1  # DEFAULT_CHARSET
        style.lfQuality = 4  # ANTIALIASED_QUALITY
        style.lfFaceName = family
        hfont = g.CreateFontIndirectW(ct.byref(style))
        old_font = g.SelectObject(hdc, hfont)
        tm = self.TEXTMETRICW()
        g.GetTextMetricsW(hdc, ct.byref(tm))
        g.PatBlt(hdc, 0, 0, W, H, 0x00000042)  # BLACKNESS
        g.SetBkMode(hdc, 1)  # TRANSPARENT
        g.SetTextColor(hdc, 0x00FFFFFF)
        x0, top = 8, 8
        g.TextOutW(hdc, x0, top, text, len(text))
        bmi = self.BITMAPINFO()
        bmi.bmiHeader.biSize = ct.sizeof(self.BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = W
        bmi.bmiHeader.biHeight = -H
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0
        buf = (ct.c_ubyte * (W * H * 4))()
        g.GetDIBits(hdc, hbmp, 0, H, buf, ct.byref(bmi), 0)
        g.SelectObject(hdc, old_font)
        g.DeleteObject(hfont)
        g.SelectObject(hdc, old_bmp)
        g.DeleteObject(hbmp)
        g.DeleteDC(hdc)
        self.user32.ReleaseDC(None, hdc_screen)

        min_x, min_y, max_x, max_y = W, H, -1, -1
        for y in range(H):
            row = y * W * 4
            for x in range(W):
                i = row + x * 4
                if buf[i] > 64 or buf[i + 1] > 64 or buf[i + 2] > 64:
                    if x < min_x:
                        min_x = x
                    if x > max_x:
                        max_x = x
                    if y < min_y:
                        min_y = y
                    if y > max_y:
                        max_y = y
        if max_x < 0:
            return None
        # 以「基线」为参照量字形墨迹：base_row 是基线所在的设备行。
        base_row = top + tm.tmAscent
        return {
            # 相对文字原点的水平范围
            "left": min_x - x0,
            "right": max_x - x0,
            # 相对基线的垂直范围（向上为正，g / y 的下伸部分为负）
            "top_above": base_row - min_y,
            "bottom_above": base_row - max_y,
            "width": max_x - min_x + 1,
            "height": max_y - min_y + 1,
        }


_INK = None
_INK_FAILED = False


def _glyph_ink(text, family, px, weight=700):
    """字形墨迹盒（缓存）。不可用时返回 None。"""
    global _INK, _INK_FAILED
    if sys.platform != "win32" or _INK_FAILED:
        return None
    if _INK is None:
        try:
            _INK = _GlyphInk()
        except Exception:
            _INK_FAILED = True
            return None
    return _INK.measure(text, family, px, weight)


def _resolve_font(widget, font):
    """接受 tkfont.Font / 字体元组 / Tk 字体描述字符串，统一返回 tkfont.Font。"""
    if isinstance(font, tkfont.Font):
        return font
    default = FONTS["body"]
    spec = font if font is not None else default
    try:
        return tkfont.Font(root=widget, font=spec)
    except Exception:
        return tkfont.Font(root=widget, font=default)


def _fit_font(widget, font, **overrides):
    """基于已有 Font 复制并覆盖属性（weight 等）。"""
    actual = font.actual()
    kwargs = {
        "family": actual.get("family", FONT_FAMILY_CJK),
        "size": actual.get("size", 12),
        "weight": actual.get("weight", "normal"),
        "slant": actual.get("slant", "roman"),
    }
    kwargs.update(overrides)
    if not kwargs["size"]:
        kwargs["size"] = 12
    return tkfont.Font(root=widget, **kwargs)


# ---------------------------------------------------------------------------
# SquareLogo
# ---------------------------------------------------------------------------


class SquareLogo(tk.Canvas):
    """正方形圆角 logo：蓝底 + 居中字母。

    字母居中不是靠 anchor="center"（那只居中「行盒」），而是量取字形实际
    墨迹盒，把墨迹的几何中心对准方块中心，因此 H / A / M 等字母视觉上都正。
    """

    def __init__(
        self,
        parent,
        size=40,
        letter="H",
        color=None,
        fg=None,
        bg=None,
        radius=None,
        font_family=None,
        font_size=None,
        font_weight="bold",
        **kwargs,
    ):
        size = max(16, int(size))
        bg = bg or _parent_bg(parent)
        kwargs.setdefault("highlightthickness", 0)
        kwargs.setdefault("bd", 0)
        super().__init__(parent, width=size, height=size, bg=bg, **kwargs)
        self._size = size
        self._letter = str(letter)
        self._color = color or PALETTE["primary"]
        self._fg = fg or PALETTE["on_primary"]
        self._radius = radius if radius is not None else max(8, int(round(size * 0.30)))
        self._font_family = font_family or FONT_FAMILY
        self._font_px = int(font_size) if font_size else max(10, int(round(size * 0.58)))
        self._font_weight = font_weight
        self._bg = bg
        self._tiles = {}
        self._text_font = tkfont.Font(
            root=self,
            family=self._font_family,
            size=-self._font_px,
            weight=self._font_weight,
        )
        self._redraw()

    # -- 公开 API ---------------------------------------------------------
    def set_letter(self, letter):
        """更新 logo 字母（任意字符 / 短字符串），自动重新居中。"""
        self._letter = str(letter)
        self._redraw()
        return self

    def set_color(self, color):
        """更新主题色（圆角方块底色）。"""
        self._color = color or PALETTE["primary"]
        self._redraw()
        return self

    # -- 内部 -------------------------------------------------------------
    def _redraw(self):
        self.delete("all")
        size = self._size
        radius = max(0, min(int(self._radius), size // 2))
        draw_round_rect(self, self._tiles, 0, 0, size, size, radius, self._color, self._bg)

        if not self._letter:
            return
        weight = 700 if self._font_weight == "bold" else 400
        ink = _glyph_ink(self._letter, self._font_family, self._font_px, weight)
        if ink is not None:
            # 墨迹盒中心对齐几何中心：先求基线，再用 Tk 的 ascent 换成
            # anchor="nw" 需要的「行顶」坐标，避免两边 ascent 差 1px 时偏移。
            ascent = self._text_font.metrics("ascent")
            x = size / 2.0 - (ink["left"] + ink["right"] + 1) / 2.0
            baseline = size / 2.0 + (ink["top_above"] + ink["bottom_above"] - 1) / 2.0
            self.create_text(x, baseline - ascent, text=self._letter,
                             font=self._text_font, fill=self._fg, anchor="nw")
        else:  # 非 Windows 降级：行盒居中
            self.create_text(size / 2.0, size / 2.0, text=self._letter,
                             font=self._text_font, fill=self._fg, anchor="center")


# ---------------------------------------------------------------------------
# RoundedFrame
# ---------------------------------------------------------------------------


class RoundedFrame(tk.Canvas):
    """圆角卡片。内容放进 .body：一个使用 fill 背景的普通 tk.Frame。

    不传 width / height 时按内容自动撑开；传了则固定尺寸，适合
    pack(fill="both", expand=True) 的场景。
    """

    def __init__(
        self,
        parent,
        radius=12,
        fill=None,
        padding=12,
        bg=None,
        width=None,
        height=None,
        **kwargs,
    ):
        bg = bg or _parent_bg(parent)
        kwargs.setdefault("highlightthickness", 0)
        kwargs.setdefault("bd", 0)
        super().__init__(parent, bg=bg, **kwargs)
        self._radius = int(radius)
        self._fill = fill or PALETTE["card"]
        self._padding = int(padding)
        self._bg = bg
        self._tiles = {}
        self._auto = width is None and height is None
        if width is not None:
            self.configure(width=int(width))
        if height is not None:
            self.configure(height=int(height))
        self.body = tk.Frame(self, bg=self._fill)
        self._body_item = None
        self._last_size = None
        self.bind("<Configure>", self._on_configure)
        self.body.bind("<Configure>", self._on_body_configure)
        self._redraw(max(1, int(self["width"])), max(1, int(self["height"])))
        self.after_idle(self._sync_from_body)

    # -- 内部 -------------------------------------------------------------
    def _on_configure(self, event):
        size = (event.width, event.height)
        if size == self._last_size:
            return
        self._last_size = size
        self._redraw(event.width, event.height)

    def _on_body_configure(self, _event):
        if self._auto:
            self._sync_from_body()

    def _sync_from_body(self):
        if not self._auto:
            return
        try:
            w = self.body.winfo_reqwidth() + 2 * self._padding
            h = self.body.winfo_reqheight() + 2 * self._padding
        except Exception:
            return
        if w != int(self["width"]) or h != int(self["height"]):
            self.configure(width=max(1, w), height=max(1, h))

    def _redraw(self, w, h):
        self.delete("bg")
        draw_round_rect(self, self._tiles, 0, 0, w, h, self._radius, self._fill,
                        self._bg, tags=("bg",))
        self.tag_lower("bg")
        opts = {"width": max(1, w - 2 * self._padding)}
        if not self._auto:
            # 固定尺寸模式：body 撑满卡片内部
            opts["height"] = max(1, h - 2 * self._padding)
        # 自动尺寸模式不锁定高度，body 用内容自然高度，这样内容变高时
        # <Configure> 才会触发，卡片跟着长高。
        if self._body_item is None:
            self._body_item = self.create_window(
                self._padding, self._padding, window=self.body, anchor="nw", **opts
            )
        else:
            self.coords(self._body_item, self._padding, self._padding)
            self.itemconfigure(self._body_item, **opts)


# ---------------------------------------------------------------------------
# NavItem
# ---------------------------------------------------------------------------


class NavItem(tk.Canvas):
    """圆角胶囊导航项。

    * 未选中：透明底、次要文字色；
    * hover：PALETTE["hover"] 淡紫底；
    * 选中：PALETTE["selected"] 淡紫底 + 左侧 3px 主色指示条 + 主色加粗文字。
    """

    PAD_X = 16
    PAD_Y = 12

    def __init__(
        self,
        parent,
        text,
        active=False,
        on_click=None,
        width=200,
        height=None,
        radius=None,
        bg=None,
        font=None,
        **kwargs,
    ):
        bg = bg or _parent_bg(parent)
        kwargs.setdefault("highlightthickness", 0)
        kwargs.setdefault("bd", 0)
        self._font = _resolve_font(parent, font or FONTS["nav"])
        self._font_bold = _fit_font(parent, self._font, weight="bold")
        h = int(height) if height else self._font.metrics("linespace") + 2 * self.PAD_Y
        h = max(28, h)
        super().__init__(parent, width=int(width), height=h, bg=bg, **kwargs)
        self._height = h
        self._text = str(text)
        self._active = bool(active)
        self._hover = False
        self._press = False
        self._on_click = on_click
        self._radius = h // 2 if radius is None else int(radius)
        self._bg = bg
        self._tiles = {}
        self._size = None
        self.configure(cursor="hand2")
        self.bind("<Configure>", self._on_configure)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
        self._redraw()

    # -- 公开 API ---------------------------------------------------------
    def set_active(self, active):
        """设置选中态（True/False）。"""
        self._active = bool(active)
        self._redraw()
        return self

    def set_text(self, text):
        """更新导航项文字。"""
        self._text = str(text)
        self._redraw()
        return self

    def invoke(self):
        """程序化触发点击。"""
        if callable(self._on_click):
            self._on_click()

    # -- 内部 -------------------------------------------------------------
    def _paint_for_state(self):
        if self._active:
            return PALETTE["selected"], PALETTE["primary"]
        if self._press:
            return PALETTE["selected"], PALETTE["text"]
        if self._hover:
            return PALETTE["hover"], PALETTE["text"]
        return None, PALETTE["text_dim"]

    def _on_configure(self, event):
        size = (event.width, event.height)
        if size == self._size:
            return
        self._size = size
        self._redraw(event.width, event.height)

    def _on_enter(self, _event):
        self._hover = True
        self._redraw()
        self.configure(cursor="hand2")

    def _on_leave(self, _event):
        self._hover = False
        self._press = False
        self._redraw()

    def _on_press(self, _event):
        self._press = True
        self._redraw()

    def _on_release(self, event):
        was_press = self._press
        self._press = False
        self._redraw()
        if was_press and 0 <= event.x <= self.winfo_width() and 0 <= event.y <= self.winfo_height():
            self.invoke()

    def _redraw(self, width=None, height=None):
        self.delete("all")
        w = int(width if width is not None else max(1, self.winfo_width()))
        h = int(height if height is not None else max(1, self.winfo_height()))
        if w <= 1:
            w = int(self["width"])
        if h <= 1:
            h = self._height
        fill, fg = self._paint_for_state()
        if fill:
            draw_round_rect(self, self._tiles, 0, 0, w, h, self._radius, fill, self._bg)
        if self._active:
            # 左侧 3px 指示条，垂直居中
            bar_h = min(20, h - 12)
            y1 = (h - bar_h) // 2
            self.create_rectangle(0, y1, 3, y1 + bar_h, fill=PALETTE["primary"], outline="")
        font = self._font_bold if self._active else self._font
        self.create_text(self.PAD_X, h / 2.0, text=self._text, font=font, fill=fg, anchor="w")


# ---------------------------------------------------------------------------
# FlatButton
# ---------------------------------------------------------------------------


class FlatButton(tk.Canvas):
    """扁平圆角按钮。

    kind="primary"：主色实心；kind="ghost"：透明底，hover 出现淡紫底，无边框。
    """

    def __init__(
        self,
        parent,
        text,
        kind="primary",
        on_click=None,
        width=None,
        height=None,
        radius=10,
        bg=None,
        font=None,
        **kwargs,
    ):
        bg = bg or _parent_bg(parent)
        kwargs.setdefault("highlightthickness", 0)
        kwargs.setdefault("bd", 0)
        self._font = _resolve_font(parent, font or FONTS["button"])
        h = int(height) if height else self._font.metrics("linespace") + 20
        h = max(30, h)
        if width is None:
            width = max(96, self._font.measure(str(text)) + 36)
        super().__init__(parent, width=int(width), height=h, bg=bg, **kwargs)
        self._height = h
        self._text = str(text)
        self._kind = kind if kind in ("primary", "ghost") else "primary"
        self._radius = int(radius)
        self._bg = bg
        self._tiles = {}
        self._on_click = on_click
        self._hover = False
        self._press = False
        self._size = None
        self.configure(cursor="hand2")
        self.bind("<Configure>", self._on_configure)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
        self._redraw()

    # -- 公开 API ---------------------------------------------------------
    def set_text(self, text):
        """更新按钮文字。"""
        self._text = str(text)
        self._redraw()
        return self

    def set_kind(self, kind):
        """切换按钮风格："primary" / "ghost"。"""
        self._kind = kind if kind in ("primary", "ghost") else "primary"
        self._redraw()
        return self

    def invoke(self):
        """程序化触发点击。"""
        if callable(self._on_click):
            self._on_click()

    # -- 内部 -------------------------------------------------------------
    def _paint_for_state(self):
        if self._kind == "primary":
            if self._press:
                return PALETTE["primary_press"], PALETTE["on_primary"]
            if self._hover:
                return PALETTE["primary_hover"], PALETTE["on_primary"]
            return PALETTE["primary"], PALETTE["on_primary"]
        if self._press:
            return PALETTE["selected"], PALETTE["primary"]
        if self._hover:
            return PALETTE["hover"], PALETTE["primary"]
        return self._bg, PALETTE["text_dim"]

    def _on_configure(self, event):
        size = (event.width, event.height)
        if size == self._size:
            return
        self._size = size
        self._redraw(event.width, event.height)

    def _on_enter(self, _event):
        self._hover = True
        self._redraw()

    def _on_leave(self, _event):
        self._hover = False
        self._press = False
        self._redraw()

    def _on_press(self, _event):
        self._press = True
        self._redraw()

    def _on_release(self, event):
        was_press = self._press
        self._press = False
        self._redraw()
        if was_press and 0 <= event.x <= self.winfo_width() and 0 <= event.y <= self.winfo_height():
            self.invoke()

    def _redraw(self, width=None, height=None):
        self.delete("all")
        w = int(width if width is not None else max(1, self.winfo_width()))
        h = int(height if height is not None else max(1, self.winfo_height()))
        if w <= 1:
            w = int(self["width"])
        if h <= 1:
            h = self._height
        fill, fg = self._paint_for_state()
        if fill and fill != self._bg:
            draw_round_rect(self, self._tiles, 0, 0, w, h, self._radius, fill, self._bg)
        self.create_text(w / 2.0, h / 2.0, text=self._text, font=self._font,
                         fill=fg, anchor="center")

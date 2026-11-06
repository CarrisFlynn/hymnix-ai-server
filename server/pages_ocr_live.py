# -*- coding: utf-8 -*-
"""Local OCR page for screenshots and image files."""
from __future__ import annotations

import os
import sys
import tkinter as tk
from tkinter import filedialog, messagebox
import webbrowser

try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, _page_header, _label, _tag, _separator
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = _page_header = _label = _tag = _separator = None

try:
    from hxcore import ocr
except Exception:
    ocr = None

TESSERACT_URL = "https://github.com/tesseract-ocr/tesseract"
LANGUAGES = ("chi_sim", "eng", "chi_sim+eng")


def _t(ui, zh, en):
    try:
        return ui.t(zh, en)
    except Exception:
        return zh


def _safe_info():
    try:
        return ocr.info() if ocr is not None else {"available": False, "engines": [], "note": "OCR backend unavailable"}
    except Exception:
        return {"available": False, "engines": [], "note": "OCR backend unavailable"}


def build_ocr_page(app, parent):
    if _UI is None:
        return None
    try:
        ui = _UI(app, parent)
        theme = ui.theme
        page = ScrollPage(parent, ui)
        page.pack(fill="both", expand=True)
        content = page.content
        content.columnconfigure(0, weight=1)
        header = _page_header(content, ui, "IMAGE TO TEXT",
            _t(ui, "图片文字识别", "Image OCR"),
            _t(ui, "从本机图片提取文字；识别在本机执行。", "Extract text from a local image; recognition runs locally."))
        header.grid(row=0, column=0, sticky="ew", pady=(0, ui.px(12)))

        status_card = RoundedCard(content, ui, fill=theme["card"], pad=14, radius=12)
        status_card.grid(row=1, column=0, sticky="ew", pady=(0, ui.px(10)))
        status_card.body.columnconfigure(0, weight=1)
        status_text = _label(status_card.body, text="", font=ui.font_obj(10), fg=theme["text"], bg=theme["card"], justify="left", anchor="w", wraplength=ui.px(720))
        status_text.pack(fill="x")
        guide = tk.Frame(status_card.body, bg=theme["card"])
        guide.pack(fill="x", pady=(ui.px(6), 0))
        guide_label = _label(guide, text="", font=ui.font_obj(9), fg=theme["warn"], bg=theme["card"], justify="left", anchor="w", wraplength=ui.px(700))
        guide_label.pack(side="left", fill="x", expand=True)
        # font_obj(9, "underline") 会把 "underline" 当成 weight，Tk 只接受 normal/bold，会抛 TclError
        _link_font = ("Segoe UI", 9, "underline")
        try:
            import tkinter.font as _tkfont
            _link_font = _tkfont.Font(root=ui.root, family="Segoe UI", size=9, underline=1)
        except Exception:
            _link_font = ("Segoe UI", 9, "underline")
        link = tk.Label(guide, text="Tesseract", font=_link_font, fg=theme["accent"], bg=theme["card"], cursor="hand2")
        link.pack(side="right", padx=(ui.px(8), 0))
        link.bind("<Button-1>", lambda _e: webbrowser.open(TESSERACT_URL))

        input_card = RoundedCard(content, ui, fill=theme["card"], pad=14, radius=12)
        input_card.grid(row=2, column=0, sticky="ew", pady=(0, ui.px(10)))
        input_card.body.columnconfigure(0, weight=1)
        _label(input_card.body, text=_t(ui, "图片文件", "Image file"), font=ui.font_obj(11, "bold"), fg=theme["text"], bg=theme["card"]).pack(anchor="w")
        path_row = tk.Frame(input_card.body, bg=theme["card"])
        path_row.pack(fill="x", pady=(ui.px(7), 0))
        path_var = tk.StringVar()
        path_entry = tk.Entry(path_row, textvariable=path_var, font=ui.font_obj(9), relief="flat", bg=theme["input_bg"], fg=theme["text"], width=24)
        # 先 pack 右侧按钮，再让输入框 expand，否则输入框会把按钮挤出可视区
        _browse_holder = tk.Frame(path_row, bg=theme["card"])
        _browse_holder.pack(side="right", padx=(ui.px(8), 0))
        path_entry.pack(side="left", fill="x", expand=True, ipady=ui.px(6))
        def choose_file():
            selected = filedialog.askopenfilename(parent=ui.root, title=_t(ui, "选择图片", "Choose image"), filetypes=[(_t(ui, "图片文件", "Image files"), "*.png *.jpg *.jpeg *.bmp *.tif *.tiff *.webp"), (_t(ui, "所有文件", "All files"), "*.*")])
            if selected:
                path_var.set(selected)
        try:
            PillButton(_browse_holder, ui, _t(ui, "选择…", "Browse…"), command=choose_file, kind="ghost", bg=theme["card"]).pack()
        except Exception:
            tk.Button(_browse_holder, text=_t(ui, "选择…", "Browse…"), command=choose_file).pack()

        controls = tk.Frame(input_card.body, bg=theme["card"])
        controls.pack(fill="x", pady=(ui.px(10), 0))
        _label(controls, text=_t(ui, "识别语言", "Language"), font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).pack(side="left")
        lang_var = tk.StringVar(value=LANGUAGES[0])
        language_menu = tk.OptionMenu(controls, lang_var, *LANGUAGES)
        language_menu.configure(font=ui.font_obj(9), relief="flat", bg=theme["btn"], fg=theme["text"])
        language_menu.pack(side="left", padx=(ui.px(8), 0))
        # not implemented yet: Screenshot area selection requires manual drag-box UI; image path input is supported for now.
        _label(controls, text=_t(ui, "截图区域：手动框选待实现", "Screenshot region: manual selection TODO"), font=ui.font_obj(9), fg=theme["text_dim"], bg=theme["card"]).pack(side="left", padx=(ui.px(14), 0))

        result_card = RoundedCard(content, ui, fill=theme["card"], pad=14, radius=12)
        result_card.grid(row=3, column=0, sticky="nsew")
        content.rowconfigure(3, weight=1)
        result_card.body.columnconfigure(0, weight=1)
        result_card.body.rowconfigure(1, weight=1)
        result_head = tk.Frame(result_card.body, bg=theme["card"])
        result_head.grid(row=0, column=0, sticky="ew")
        result_head.columnconfigure(0, weight=1)
        _label(result_head, text=_t(ui, "识别结果", "Result"), font=ui.font_obj(11, "bold"), fg=theme["text"], bg=theme["card"]).grid(row=0, column=0, sticky="w")
        meta_var = tk.StringVar(value="")
        _label(result_head, textvariable=meta_var, font=ui.font_obj(9), fg=theme["text_muted"], bg=theme["card"]).grid(row=0, column=1, sticky="e")
        result = tk.Text(result_card.body, height=12, wrap="word", font=ui.font_obj(10), relief="flat", bg=theme["input_bg"], fg=theme["text"], insertbackground=theme["text"])
        result.grid(row=1, column=0, sticky="nsew", pady=(ui.px(8), 0))
        result.configure(state="disabled")
        def put_result(text):
            result.configure(state="normal")
            result.delete("1.0", "end")
            result.insert("1.0", text)
            result.configure(state="disabled")
        def copy_result():
            try:
                ui.root.clipboard_clear()
                ui.root.clipboard_append(result.get("1.0", "end-1c"))
                ui.root.update_idletasks()
            except Exception:
                pass
        def recognize():
            path = path_var.get()
            if not path:
                put_result(_t(ui, "错误：请输入图片路径或选择文件。", "Error: enter an image path or browse for a file."))
                return
            if "\x00" in path:
                put_result(_t(ui, "错误：路径包含空字节。", "Error: path contains a null byte."))
                return
            if len(path) > 260:
                put_result(_t(ui, "错误：路径长度不能超过 260 个字符。", "Error: path must not exceed 260 characters."))
                return
            allowed = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}
            if os.path.splitext(path)[1].lower() not in allowed:
                put_result(_t(ui, "错误：不支持此文件类型，请选择 PNG、JPG、BMP、WEBP 或 TIFF 图片。", "Error: unsupported file type; choose a PNG, JPG, BMP, WEBP, or TIFF image."))
                return
            if not os.path.isfile(path):
                put_result(_t(ui, "错误：找不到指定图片文件。", "Error: the image file does not exist."))
                return
            try:
                data = ocr.image_to_text(path, lang_var.get()) if ocr is not None else {"ok": False, "error": "module_missing", "text": "", "engine": "", "ms": 0}
            except Exception as exc:
                data = {"ok": False, "error": "ocr_error", "text": str(exc), "engine": "", "ms": 0}
            text = str(data.get("text") or "")
            put_result(text or _t(ui, "未识别到文字。", "No text was recognized.") if data.get("ok") else _t(ui, "识别失败：", "Recognition failed: ") + str(data.get("error") or "unknown"))
            meta_var.set(_t(ui, "引擎：{0} · {1:.1f} 毫秒", "Engine: {0} · {1:.1f} ms").format(data.get("engine") or "-", float(data.get("ms") or 0)))
        button_row = tk.Frame(input_card.body, bg=theme["card"])
        button_row.pack(fill="x", pady=(ui.px(10), 0))
        try:
            PillButton(button_row, ui, _t(ui, "开始识别", "Recognize"), command=recognize, kind="primary", bg=theme["card"]).pack(side="left")
            PillButton(button_row, ui, _t(ui, "复制结果", "Copy result"), command=copy_result, kind="ghost", bg=theme["card"]).pack(side="left", padx=(ui.px(8), 0))
        except Exception:
            tk.Button(button_row, text=_t(ui, "开始识别", "Recognize"), command=recognize).pack(side="left")
            tk.Button(button_row, text=_t(ui, "复制结果", "Copy result"), command=copy_result).pack(side="left", padx=(ui.px(8), 0))

        def refresh_info():
            data = _safe_info()
            names = ", ".join(str(x) for x in data.get("engines", [])) or _t(ui, "无", "none")
            status_text.configure(text=_t(ui, "可用：{0} · 引擎：{1}", "Available: {0} · Engines: {1}").format(_t(ui, "是", "yes") if data.get("available") else _t(ui, "否", "no"), names))
            missing = not data.get("available")
            guide_label.configure(text=_t(ui, "未检测到 OCR 引擎，请安装 Tesseract 后重试", "No OCR engine detected. Install Tesseract and try again.") if missing else str(data.get("note") or ""))
            link.configure(text=_t(ui, "官方下载", "Official download"), state="normal" if missing else "disabled")
        refresh_info()
        page.bind_wheel()
        return page
    except Exception:
        try:
            tk.Label(parent, text=_t(ui, "模块未就绪", "Module not ready")).pack(fill="both", expand=True)
        except Exception:
            pass
        return None


def _selftest():
    assert callable(build_ocr_page)
    assert LANGUAGES == ("chi_sim", "eng", "chi_sim+eng")
    assert TESSERACT_URL.startswith("https://")
    class UI:
        def t(self, zh, en): return en
    assert _t(UI(), "中文", "English") == "English"
    print("SELFTEST OK")


if __name__ == "__main__" and "--selftest" in sys.argv:
    _selftest()

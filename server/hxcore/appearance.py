# -*- coding: utf-8 -*-
"""Persistent, peer-level appearance palettes for Hymnix."""
from __future__ import annotations

import json
import os
import tempfile

SCHEMA_VERSION = 2
THEME_FILE = "appearance.json"
DEFAULT_THEME = "daylight"
STATUS = {"success": "#2E9B62", "warning": "#D98A16", "danger": "#D9364F", "info": "#3C82C4"}
TOKEN_KEYS = (
    "bg", "surface", "surface_alt", "text", "text_muted", "border", "accent",
    "accent_hover", "accent_pressed", "focus", "selection", "success", "warning",
    "danger", "info", "button_text",
)

THEMES = {
    "daylight": {
        "name": "蓝白 · 白昼", "id": "daylight", "primary": "#2563EB", "background": "#F3F5FA",
        "tokens": {"bg": "#F3F5FA", "surface": "#F8FAFD", "surface_alt": "#EEF2F7", "text": "#101828", "text_muted": "#667085", "border": "#E4E7EC", "accent": "#2563EB", "accent_hover": "#3B82F6", "accent_pressed": "#1D4ED8", "focus": "#2563EB", "selection": "#DBEAFE", "button_text": "#101828"},
    },
    "camellia-white": {
        "name": "红白 · 茶花红 / 无日白", "id": "camellia-white", "primary": "#E72D48", "background": "#F1DDDF",
        "tokens": {"bg": "#F1DDDF", "surface": "#FFF8F8", "surface_alt": "#FFF8F8", "text": "#24080D", "text_muted": "#7A2634", "border": "#D9AAB1", "accent": "#E72D48", "accent_hover": "#C9213A", "accent_pressed": "#A9182E", "focus": "#E72D48", "selection": "#F7C8D0", "button_text": "#FFFFFF"},
    },
    "cyan-black": {
        "name": "青黑 · 浅海青 / 纯黑", "id": "cyan-black", "primary": "#00DFEA", "background": "#000000",
        "tokens": {"bg": "#000000", "surface": "#071216", "surface_alt": "#102126", "text": "#E8FEFF", "text_muted": "#8DDCE1", "border": "#16434A", "accent": "#00DFEA", "accent_hover": "#55F3F7", "accent_pressed": "#00AEB8", "focus": "#00DFEA", "selection": "#16434A", "button_text": "#000000"},
    },
    "orange-black": {
        "name": "橘黑 · 蜜橘橙 / 纯黑", "id": "orange-black", "primary": "#FF812C", "background": "#000000",
        "tokens": {"bg": "#000000", "surface": "#160D06", "surface_alt": "#211209", "text": "#FFF3E8", "text_muted": "#E9AD7F", "border": "#593019", "accent": "#FF812C", "accent_hover": "#FFA45F", "accent_pressed": "#D95C0B", "focus": "#FF812C", "selection": "#593019", "button_text": "#000000"},
    },
    "rog-red-black": {
        "name": "红黑 · ROG 风格", "id": "rog-red-black", "primary": "#FF1A1A", "background": "#000000",
        "tokens": {"bg": "#000000", "surface": "#0B0B0D", "surface_alt": "#151519", "text": "#F5F5F5", "text_muted": "#A8A8AD", "border": "#3A1014", "accent": "#FF1A1A", "accent_hover": "#FF4D4D", "accent_pressed": "#C70000", "focus": "#FF4D4D", "selection": "#5C1118", "button_text": "#FFFFFF"},
    },
}


def theme_path(data_dir=None):
    root = data_dir or os.environ.get("HYMNIX_DATA_DIR")
    if not root:
        root = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Hymnix")
    return os.path.join(root, "config", THEME_FILE)


def load_theme(data_dir=None):
    try:
        with open(theme_path(data_dir), "r", encoding="utf-8") as stream:
            payload = json.load(stream)
        if not isinstance(payload, dict) or payload.get("schema") != SCHEMA_VERSION:
            return DEFAULT_THEME
        name = payload.get("theme_id")
        return name if name in THEMES else DEFAULT_THEME
    except (OSError, ValueError, TypeError):
        return DEFAULT_THEME


def save_theme(name, data_dir=None):
    if name not in THEMES:
        return False
    path = theme_path(data_dir)
    directory = os.path.dirname(path)
    tmp = None
    try:
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".appearance-", suffix=".tmp", dir=directory)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"schema": SCHEMA_VERSION, "theme_id": name}, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        return True
    except OSError:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass
        return False


def tokens(name=None):
    key = name if name in THEMES else DEFAULT_THEME
    return {**THEMES[key]["tokens"], **STATUS}


def legacy_tokens(name=None):
    """Map semantic tokens to established app style keys."""
    value = tokens(name)
    return {
        "bg": value["bg"], "surface": value["surface"], "surface_alt": value["surface_alt"],
        "accent_hover": value["accent_hover"], "accent_pressed": value["accent_pressed"],
        "selection": value["selection"], "card": value.get("card", value["surface_alt"]), "input_bg": value.get("input_bg", value["surface"]),
        "text": value["text"], "text_muted": value["text_muted"], "text_dim": value["text_muted"],
        "accent": value["accent"], "accent_soft": value["selection"], "accent_press": value["accent_pressed"],
        "btn": value["surface_alt"], "btn_hover": value["surface_alt"], "btn_press": value["selection"],
        "btn_text": value["text"], "ok": value["success"], "warn": value["warning"],
        "err": value["danger"], "sep": value["border"], "bg_color": value["bg"],
        "frame_bg": value["surface"], "button_bg": value["surface_alt"],
        "button_active": value["selection"], "button_fg": value.get("button_text", value["text"]), "entry_bg": value["surface"], "entry_fg": value["text"],
        "text_bg": value["surface"], "text_fg": value["text"], "label_bg": value["surface"],
        "label_fg": value["text"], "combo_bg": value["surface"], "combo_fg": value["text"],
        "scroll_bg": value["border"], "scroll_active": value["text_muted"], "border_color": value["border"],
        "highlight_color": value["focus"], "success_color": value["success"], "error_color": value["danger"],
        "warning_color": value["warning"], "info_color": value["info"],
    }
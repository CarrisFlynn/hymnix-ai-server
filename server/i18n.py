# -*- coding: utf-8 -*-
"""Hymnix i18n —— 轻量、零依赖的界面多语言模块。

支持语言：中文（zh）、English（en）、Français（fr）、Русский（ru）、Español（es）。
资源文件：<本模块目录>/locales/<code>.json，UTF-8 编码，扁平结构：

    {"menu.file": "文件", "sidebar.chat": "对话", ...}

基本用法::

    import i18n

    i18n.init()                                 # 环境变量 / 系统语言自动检测
    i18n.set_lang("fr")                         # 运行时切换语言
    print(i18n.get_lang())                      # -> "fr"
    print(i18n.t("menu.file"))                  # -> "Fichier"
    print(i18n.t("monitor.status_fmt", clients=2, requests=10,
                 chats=3, service="online"))

约定：

* key 采用英文点分命名，例如 menu.file、sidebar.chat、api.save。
* 当前语言缺少某个 key 时，自动回退到英文（en）；英文也缺少时返回 key 本身。
* t(key, **fmt) 使用 str.format 风格的具名占位符（{name}）；
  若调用方漏传参数，返回未格式化的原文而不是抛异常，保证界面不会崩。
* 模块内部加锁，可从后台线程安全调用。
* 语言代码大小写、连字符/下划线、地区后缀均可识别，如 zh-CN、en_US、
  fr_FR、ru-RU、es_ES。

无第三方依赖，兼容 Python 3.8+（在 3.14 上验证）。
"""

from __future__ import annotations

import json
import locale
import os
import sys
import threading

__all__ = [
    "init",
    "set_lang",
    "get_lang",
    "t",
    "langs",
    "detect",
    "SUPPORTED_LANGS",
    "FALLBACK_LANG",
    "DEFAULT_LANG",
]

#: 支持的语言：(代码, 本语言名称)。顺序即界面语言菜单的展示顺序。
SUPPORTED_LANGS = (
    ("zh", "中文"),
    ("en", "English"),
    ("fr", "Français"),
    ("ru", "Русский"),
    ("es", "Español"),
)

#: 缺少 key 时的回退语言。
FALLBACK_LANG = "en"

#: 检测不到系统语言时使用的默认语言（本程序以中文界面为主）。
DEFAULT_LANG = "zh"

_LANG_CODES = tuple(code for code, _label in SUPPORTED_LANGS)
_LOCALES_DIR_NAME = "locales"

# Windows GetUserDefaultUILanguage 返回的 LANGID 主语言 ID（低 10 位）。
_WIN_PRIMARY_LANGS = {
    0x04: "zh",  # 中文
    0x09: "en",  # 英语
    0x0C: "fr",  # 法语
    0x0A: "es",  # 西班牙语
    0x19: "ru",  # 俄语
}

_lock = threading.RLock()
_state = {
    "lang": None,          # 当前语言代码
    "locales_dir": None,   # locales 目录绝对路径
    "cache": {},           # code -> dict
    "fallback": None,      # 英文词典缓存
}


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------
def _default_locales_dir():
    """返回模块同级的 locales 目录。"""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), _LOCALES_DIR_NAME)


def _lang_codes():
    return _LANG_CODES


def _normalize(code):
    """把 zh-CN / en_US.UTF-8 / Chinese 等统一成受支持的语言代码。

    无法识别时返回 None。
    """
    if code is None:
        return None
    text = str(code).strip().lower()
    if not text:
        return None
    text = text.replace("-", "_")
    aliases = {
        "chs": "zh", "cht": "zh", "chinese": "zh", "中文": "zh",
        "eng": "en", "english": "en", "英语": "en",
        "fra": "fr", "fre": "fr", "francais": "fr", "français": "fr", "法语": "fr",
        "rus": "ru", "russian": "ru", "русский": "ru", "俄语": "ru",
        "spa": "es", "spanish": "es", "espanol": "es", "español": "es", "西班牙语": "es",
    }
    if text in aliases:
        return aliases[text]
    # 去掉编码/修饰后缀：zh_CN.UTF-8 -> zh_CN；sr_RS@latin -> sr_RS
    base = text.split(".", 1)[0].split("@", 1)[0]
    if base in aliases:
        return aliases[base]
    primary = base.split("_", 1)[0]
    if primary in _LANG_CODES:
        return primary
    if base in _LANG_CODES:
        return base
    return None


def _load(code):
    """加载并缓存某语言的 JSON 词典；失败时返回空字典（不抛异常）。"""
    with _lock:
        cache = _state["cache"]
        if code in cache:
            return cache[code]
        directory = _state["locales_dir"] or _default_locales_dir()
        path = os.path.join(directory, code + ".json")
        data = {}
        try:
            with open(path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if isinstance(raw, dict):
                data = {
                    str(key): str(value)
                    for key, value in raw.items()
                    if isinstance(value, str)
                }
        except FileNotFoundError:
            print("[i18n] locale file not found: %s" % path, file=sys.stderr)
        except (OSError, ValueError) as exc:
            print("[i18n] cannot load %s: %s" % (path, exc), file=sys.stderr)
        cache[code] = data
        return data


def _ensure_init():
    """惰性初始化，保证直接 import 后调用 t()/get_lang() 也可用。"""
    if _state["lang"] is None:
        init()


def _windows_ui_lang():
    """读取 Windows 用户界面语言（不依赖第三方库）。"""
    if os.name != "nt":
        return None
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        try:
            lcid = int(kernel32.GetUserDefaultUILanguage())
        except Exception:
            lcid = int(kernel32.GetSystemDefaultUILanguage())
    except Exception:
        return None
    return _WIN_PRIMARY_LANGS.get(lcid & 0x3FF)


def _locale_lang():
    """读取 Python/系统 locale（跨平台兜底）。"""
    try:
        language, _encoding = locale.getlocale()
    except Exception:
        language = None
    if language:
        return language
    try:
        return locale.getdefaultlocale()[0]  # type: ignore[attr-defined]
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 公共 API
# ---------------------------------------------------------------------------
def init(lang=None, locales_dir=None):
    """初始化 i18n 模块。

    :param lang: 语言代码；None 表示按环境变量 / 系统语言自动检测。
                 无法识别时退回 DEFAULT_LANG，不会抛异常。
    :param locales_dir: locales 目录；None 表示使用模块同级的 locales 目录。
    :return: 实际生效的语言代码。
    """
    with _lock:
        if locales_dir:
            _state["locales_dir"] = os.path.abspath(os.fspath(locales_dir))
        elif not _state["locales_dir"]:
            _state["locales_dir"] = _default_locales_dir()
        _state["cache"].clear()
        _state["fallback"] = _load(FALLBACK_LANG)
        code = _normalize(lang) if lang is not None else None
        if code is None:
            code = detect() if lang is None else DEFAULT_LANG
        if code not in _LANG_CODES:
            code = DEFAULT_LANG
        _state["lang"] = code
        _load(code)
        return code


def set_lang(code):
    """切换当前语言并加载对应词典。

    :param code: 语言代码（支持 zh-CN、en_US 等别名）。
    :return: 归一化后的语言代码。
    :raises ValueError: 语言不受支持时。
    """
    normalized = _normalize(code)
    if normalized is None:
        raise ValueError(
            "unsupported language code: %r (supported: %s)"
            % (code, ", ".join(_LANG_CODES))
        )
    with _lock:
        if _state["lang"] is None:
            _state["locales_dir"] = _state["locales_dir"] or _default_locales_dir()
            _state["fallback"] = _load(FALLBACK_LANG)
        _state["lang"] = normalized
        _load(normalized)
    return normalized


def get_lang():
    """返回当前语言代码。"""
    _ensure_init()
    return _state["lang"]


def t(key, **fmt):
    """翻译一个 key。

    * 当前语言缺失 -> 回退英文 -> 回退 key 本身。
    * 传入 **fmt 时使用 str.format 具名占位符格式化；
      缺少参数或格式串有误时返回未格式化的原文。

    :param key: 英文点分 key，例如 menu.file。
    :param fmt: 占位符参数，例如 count=3。
    :return: 翻译后的字符串。
    """
    _ensure_init()
    if not isinstance(key, str):
        return "" if key is None else str(key)
    with _lock:
        current = _load(_state["lang"])
        text = current.get(key)
        if text is None:
            fallback = _state["fallback"]
            if fallback is None:
                fallback = _load(FALLBACK_LANG)
                _state["fallback"] = fallback
            text = fallback.get(key)
        if text is None:
            text = key
    if fmt:
        try:
            return text.format(**fmt)
        except (KeyError, IndexError, TypeError, ValueError):
            return text
    return text


def langs():
    """返回支持的语言列表 [(code, label), ...]（顺序固定，供菜单使用）。"""
    return list(SUPPORTED_LANGS)


def detect():
    """检测当前环境/系统语言。

    检测顺序：

    1. 环境变量 HYMNIX_LANG（本程序专用）；
    2. LC_ALL / LC_MESSAGES / LANG / LANGUAGE；
    3. Windows 用户界面语言（GetUserDefaultUILanguage）；
    4. Python locale（locale.getlocale()）；
    5. DEFAULT_LANG。

    :return: 受支持的语言代码（始终落在 langs() 的代码集合内）。
    """
    for name in ("HYMNIX_LANG", "LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"):
        code = _normalize(os.environ.get(name))
        if code:
            return code
    for probe in (_windows_ui_lang, _locale_lang):
        try:
            code = _normalize(probe())
        except Exception:
            code = None
        if code:
            return code
    return DEFAULT_LANG

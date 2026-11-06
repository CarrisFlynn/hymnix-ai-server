# -*- coding: utf-8 -*-
"""Optional OCR helpers with strict, exception-safe result contracts."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from typing import Any

_MAX_CHARS = 100_000
_LAST_ERROR = ""


def _set_error(value: str) -> None:
    global _LAST_ERROR
    _LAST_ERROR = str(value or "")


def last_error() -> str:
    try:
        return _LAST_ERROR
    except Exception:
        return ""


def engines() -> list[str]:
    found: list[str] = []
    try:
        try:
            import pytesseract  # type: ignore
            if getattr(pytesseract, "get_tesseract_version", None):
                pytesseract.get_tesseract_version()
                found.append("tesseract")
        except Exception:
            pass
        if not found and shutil.which("tesseract"):
            found.append("tesseract")
    except Exception:
        pass
    return found


def available() -> bool:
    try:
        return bool(engines())
    except Exception:
        return False


def info() -> dict:
    try:
        available_now = available()
        return {
            "engines": engines(),
            "available": available_now,
            "note": ("Tesseract ready / 已检测到 Tesseract" if available_now else "No OCR engine detected; 未检测到 OCR 引擎，请安装 Tesseract 后重试"),
        }
    except Exception as exc:
        _set_error("info_error")
        return {"engines": [], "available": False, "note": "OCR unavailable: %s" % exc}


def _result(ok: bool, text: str = "", engine: str = "", lang: str = "", error: str = "", started: float = 0.0) -> dict:
    value = text[:_MAX_CHARS] if isinstance(text, str) else str(text or "")[:_MAX_CHARS]
    if error:
        _set_error(error)
    else:
        _set_error("")
    return {"ok": bool(ok), "text": value, "engine": engine, "lang": lang or "", "chars": len(value), "ms": round(max(0.0, (time.perf_counter() - started) * 1000), 3), "error": error or ""}


def _ocr_image(image: Any, lang: str, started: float) -> dict:
    try:
        import pytesseract  # type: ignore
        text = pytesseract.image_to_string(image, lang=lang or None)
        return _result(True, text, "tesseract", lang, started=started)
    except Exception:
        pass
    executable = shutil.which("tesseract")
    if not executable:
        return _result(False, engine="", lang=lang, error="no_engine", started=started)
    temp_name = ""
    try:
        fd, temp_name = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        image.save(temp_name)
        cmd = [executable, temp_name, "stdout"]
        if lang:
            cmd.extend(["-l", lang])
        completed = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=30)
        if completed.returncode != 0:
            return _result(False, engine="tesseract", lang=lang, error="engine_error", started=started)
        text = completed.stdout.decode("utf-8", errors="replace")
        return _result(True, text, "tesseract", lang, started=started)
    except Exception:
        return _result(False, engine="tesseract", lang=lang, error="engine_error", started=started)
    finally:
        if temp_name:
            try: os.remove(temp_name)
            except Exception: pass


def image_to_text(path: str, lang: str | None = None) -> dict:
    started = time.perf_counter()
    language = str(lang or "")
    try:
        if not isinstance(path, (str, os.PathLike)) or not os.path.isfile(path):
            return _result(False, lang=language, error="not_found", started=started)
        try:
            from PIL import Image
        except Exception:
            return _result(False, lang=language, error="no_pillow", started=started)
        try:
            with Image.open(path) as image:
                image.load()
                if not available():
                    return _result(False, lang=language, error="no_engine", started=started)
                return _ocr_image(image, language, started)
        except Exception:
            return _result(False, lang=language, error="bad_image", started=started)
    except Exception:
        return _result(False, lang=language, error="ocr_error", started=started)


def screenshot_to_text(rect: tuple[int, int, int, int] | None = None, lang: str | None = None) -> dict:
    started = time.perf_counter()
    language = str(lang or "")
    try:
        try:
            from PIL import ImageGrab
        except Exception:
            return _result(False, lang=language, error="no_pillow", started=started)
        try:
            image = ImageGrab.grab(bbox=rect)
        except Exception:
            return _result(False, lang=language, error="screenshot_error", started=started)
        try:
            if not available():
                return _result(False, lang=language, error="no_engine", started=started)
            return _ocr_image(image, language, started)
        finally:
            try: image.close()
            except Exception: pass
    except Exception:
        return _result(False, lang=language, error="ocr_error", started=started)

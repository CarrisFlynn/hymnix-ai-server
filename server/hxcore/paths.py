# -*- coding: utf-8 -*-
"""hxcore.paths — 统一路径与原子写工具。所有新模块的目录都只从这里取。

约定：
- root_dir(): 程序根目录（frozen=exe 所在目录；源码运行=项目根，即 source 的父目录）。
- data_dir(): 用户数据目录（HYMNIX_DATA_DIR > 根目录），个人版数据放在 exe 旁边。
- logs_dir(): 日志根目录（HYMNIX_LOG_DIR > 根目录/logs）。
- 所有函数出错时返回可用兜底值，绝不抛异常给调用方（启动路径上不能因路径问题崩溃）。
"""
from __future__ import annotations

import json
import os
import sys
import time

_APP_DIR = None


def app_dir() -> str:
    """代码所在目录（frozen 时为 exe 同目录）。"""
    global _APP_DIR
    try:
        if _APP_DIR:
            return _APP_DIR
        if getattr(sys, "frozen", False):
            _APP_DIR = os.path.dirname(os.path.abspath(sys.executable))
        else:
            _APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return _APP_DIR or os.getcwd()
    except Exception:
        return _APP_DIR or "."


def root_dir() -> str:
    """项目/安装根目录：源码模式返回项目根，frozen 返回 exe 所在目录。"""
    try:
        if getattr(sys, "frozen", False):
            return app_dir()
        src = app_dir()
        parent = os.path.dirname(src)
        if os.path.isdir(os.path.join(parent, "logs")) or os.path.isdir(os.path.join(parent, "tools")):
            return parent
        return src
    except Exception:
        return app_dir() or "."


def data_dir() -> str:
    try:
        return os.environ.get("HYMNIX_DATA_DIR") or root_dir()
    except Exception:
        return root_dir() or "."


def logs_dir() -> str:
    try:
        return os.environ.get("HYMNIX_LOG_DIR") or os.path.join(root_dir(), "logs")
    except Exception:
        return "logs"


def plugins_dir() -> str:
    try:
        return os.environ.get("HYMNIX_PLUGINS_DIR") or os.path.join(root_dir(), "plugins")
    except Exception:
        return "plugins"


def ensure_dir(path: str) -> str:
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass
    return path


def now_iso() -> str:
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
    except Exception:
        return ""


def read_json(path: str, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def atomic_write_json(path: str, payload, indent: int = 2) -> bool:
    """原子写 JSON（先写 .tmp 再 os.replace），失败返回 False。"""
    try:
        ensure_dir(os.path.dirname(os.path.abspath(path)))
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=indent)
        os.replace(tmp, path)
        return True
    except Exception:
        return False


def append_jsonl(path: str, row) -> bool:
    """追加一行 JSONL；失败返回 False（调用方不关心异常）。"""
    try:
        ensure_dir(os.path.dirname(os.path.abspath(path)))
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        return True
    except Exception:
        return False

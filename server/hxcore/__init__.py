# -*- coding: utf-8 -*-
"""hxcore — Hymnix 底层能力模块包。

约定：本包内模块只依赖标准库；不得导入 hymnix_main（避免循环依赖），
需要界面回调时由 hymnix_main 注入 callable。
"""
from __future__ import annotations

__version__ = "1.0.0"

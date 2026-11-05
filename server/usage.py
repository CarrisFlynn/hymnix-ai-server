r"""usage.py — Hymnix 用量统计模块

特性：
- 线程安全（按文件路径共享锁）
- JSON 原子持久化（临时文件 + fsync + os.replace）
- 默认路径：%LOCALAPPDATA%\Hymnix\usage.json，可传入自定义 path
- 坏文件容错：解析失败或结构异常时自动备份为 *.corrupt-<时间戳> 并重新开始
- 内置 DeepSeek / OpenAI / Gemini / OpenRouter 常见模型的成本估算表（USD / 1M tokens）

示例：
    from usage import UsageStore
    store = UsageStore()
    store.record("chat", "deepseek-chat", 120, 380, 950.0, provider="deepseek")
    print(store.summary("today"))
    print(store.daily(14))
    print(store.estimate_cost("openai", "gpt-4o-mini", 120, 380))
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

__all__ = ["UsageStore", "estimate_cost", "default_path", "PRICE_TABLE"]

_APP_DIRNAME = "Hymnix"
_DEFAULT_FILENAME = "usage.json"
_VERSION = 1

# 价格单位：美元 / 100 万 tokens，(输入价格, 输出价格)
PRICE_TABLE: Dict[str, Dict[str, Tuple[float, float]]] = {
    "deepseek": {
        "deepseek-chat": (0.27, 1.10),
        "deepseek-reasoner": (0.55, 2.19),
        "deepseek-v3": (0.27, 1.10),
        "deepseek-v3.2": (0.28, 0.42),
    },
    "openai": {
        "gpt-4o": (2.50, 10.00),
        "gpt-4o-mini": (0.15, 0.60),
        "gpt-4.1": (2.00, 8.00),
        "gpt-4.1-mini": (0.40, 1.60),
        "gpt-4.1-nano": (0.10, 0.40),
        "o3-mini": (1.10, 4.40),
        "gpt-3.5-turbo": (0.50, 1.50),
        "text-embedding-3-small": (0.02, 0.0),
        "text-embedding-3-large": (0.13, 0.0),
    },
    "gemini": {
        "gemini-2.5-pro": (1.25, 10.00),
        "gemini-2.5-flash": (0.30, 2.50),
        "gemini-2.0-flash": (0.10, 0.40),
        "gemini-1.5-pro": (1.25, 5.00),
        "gemini-1.5-flash": (0.075, 0.30),
    },
    "openrouter": {},  # OpenRouter 透传底层模型价格，按模型名回退匹配
}

# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

_LOCKS: Dict[str, "threading.RLock"] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(path: Union[str, os.PathLike]) -> "threading.RLock":
    """同一路径的多个 UsageStore 实例共享同一把锁。"""
    try:
        key = os.path.normcase(os.path.abspath(os.fspath(path)))
    except (TypeError, ValueError):
        key = str(path)
    with _LOCKS_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[key] = lock
        return lock


def default_path() -> Path:
    """返回默认的用量数据文件路径（不创建目录）。"""
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if base:
        return Path(base) / _APP_DIRNAME / _DEFAULT_FILENAME
    return Path.home() / ("." + _APP_DIRNAME.lower()) / _DEFAULT_FILENAME


def _normalize(name: Any) -> str:
    return str(name or "").strip().lower()


def _strip_vendor_prefix(model: str) -> str:
    """deepseek/deepseek-chat -> deepseek-chat；openai/gpt-4o -> gpt-4o。"""
    if "/" in model:
        return model.split("/", 1)[1].strip()
    return model


def _lookup_prices(provider: Any, model: Any) -> Optional[Tuple[float, float]]:
    prov = _normalize(provider)
    name = _normalize(model)
    if not name:
        return None

    candidates: List[str] = [name]
    stripped = _strip_vendor_prefix(name)
    if stripped and stripped != name:
        candidates.append(stripped)

    for candidate in candidates:
        # 1) 精确匹配（provider 优先，其次任意 provider）
        tables: List[Dict[str, Tuple[float, float]]] = []
        if prov in PRICE_TABLE:
            tables.append(PRICE_TABLE[prov])
            if prov == "openrouter":
                tables.extend(
                    table for key, table in PRICE_TABLE.items() if key != "openrouter"
                )
        if not tables:
            tables = [table for table in PRICE_TABLE.values()]
        for table in tables:
            if candidate in table:
                return table[candidate]

        # 2) 模糊匹配：gpt-4o-mini-2024-07-18 -> gpt-4o-mini
        known: List[str] = []
        for table in PRICE_TABLE.values():
            for known_name in table:
                if known_name not in known:
                    known.append(known_name)
        for known_name in sorted(known, key=len, reverse=True):
            if candidate == known_name or candidate.startswith(known_name + "-"):
                for table in PRICE_TABLE.values():
                    if known_name in table:
                        return table[known_name]
    return None


def estimate_cost(provider: str, model: str, prompt: int, reply: int) -> float:
    """估算一次请求的费用（美元）。

    价格单位是美元 / 100 万 tokens；未知 provider/model 返回 0.0。
    """
    prices = _lookup_prices(provider, model)
    if not prices:
        return 0.0
    try:
        prompt_tokens = max(0, int(prompt or 0))
        reply_tokens = max(0, int(reply or 0))
    except (TypeError, ValueError):
        return 0.0
    input_price, output_price = prices
    cost = (prompt_tokens / 1_000_000.0) * input_price + (
        reply_tokens / 1_000_000.0
    ) * output_price
    return round(cost, 8)


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, bool):
        raise ValueError("invalid timestamp")
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value)).astimezone()
    if not isinstance(value, str) or not value.strip():
        raise ValueError("invalid timestamp")
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()  # 按本地时间解释
    return parsed


def _record_date(record: Dict[str, Any]) -> date:
    return _parse_ts(record["ts"]).astimezone().date()


def _sanitize_record(item: Any) -> Optional[Dict[str, Any]]:
    """把磁盘上的一条记录清洗成合法结构；非法记录返回 None。"""
    if not isinstance(item, dict):
        return None
    try:
        ts = str(item.get("ts") or item.get("timestamp") or "")
        _parse_ts(ts)

        def _num(key: str) -> float:
            value = item.get(key, 0)
            if value is None or isinstance(value, bool):
                return 0.0
            number = float(value)
            if number != number or number in (float("inf"), float("-inf")):  # NaN/Inf
                return 0.0
            return number

        return {
            "ts": ts,
            "kind": str(item.get("kind") or "chat"),
            "model": str(item.get("model") or "unknown"),
            "provider": str(item.get("provider") or "local"),
            "prompt_tokens": max(0, int(_num("prompt_tokens"))),
            "reply_tokens": max(0, int(_num("reply_tokens"))),
            "elapsed_ms": max(0.0, _num("elapsed_ms")),
            "cost": max(0.0, _num("cost")),
        }
    except (TypeError, ValueError, OverflowError):
        return None


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    """原子写入 JSON：同目录临时文件 + fsync + os.replace。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _aggregate(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    requests = len(records)
    prompt_tokens = sum(int(r.get("prompt_tokens", 0)) for r in records)
    reply_tokens = sum(int(r.get("reply_tokens", 0)) for r in records)
    elapsed = sum(float(r.get("elapsed_ms", 0.0)) for r in records)
    cost = sum(float(r.get("cost", 0.0)) for r in records)
    return {
        "requests": requests,
        "prompt_tokens": prompt_tokens,
        "reply_tokens": reply_tokens,
        "total_tokens": prompt_tokens + reply_tokens,
        "cost": round(cost, 8),
        "avg_latency_ms": round(elapsed / requests, 1) if requests else 0.0,
    }


# ---------------------------------------------------------------------------
# UsageStore
# ---------------------------------------------------------------------------


class UsageStore:
    """线程安全的用量存储。

    所有写操作都会立即原子落盘；读取基于内存中的记录列表。
    """

    def __init__(self, path: Optional[Union[str, os.PathLike]] = None) -> None:
        self._path: Path = Path(path).expanduser() if path is not None else default_path()
        self._lock = _lock_for(self._path)
        self._records: List[Dict[str, Any]] = []
        with self._lock:
            self._load_locked()

    # -- 只读属性 ---------------------------------------------------------
    @property
    def path(self) -> Path:
        return self._path

    @staticmethod
    def default_path() -> Path:
        return default_path()

    # -- 公共 API ---------------------------------------------------------
    def record(
        self,
        kind: str,
        model: str,
        prompt_tokens: int = 0,
        reply_tokens: int = 0,
        elapsed_ms: float = 0.0,
        provider: str = "local",
        cost: Optional[float] = None,
    ) -> Dict[str, Any]:
        """记录一次请求；cost 为 None 时按内置价格表自动估算。"""
        prompt = max(0, int(prompt_tokens or 0))
        reply = max(0, int(reply_tokens or 0))
        elapsed = max(0.0, float(elapsed_ms or 0.0))
        if cost is None:
            estimated = estimate_cost(provider, model, prompt, reply)
        else:
            try:
                estimated = max(0.0, round(float(cost), 8))
            except (TypeError, ValueError):
                estimated = estimate_cost(provider, model, prompt, reply)

        entry = {
            "ts": datetime.now().astimezone().isoformat(),
            "kind": str(kind or "chat"),
            "model": str(model or "unknown"),
            "provider": str(provider or "local"),
            "prompt_tokens": prompt,
            "reply_tokens": reply,
            "elapsed_ms": round(elapsed, 1),
            "cost": estimated,
        }
        with self._lock:
            self._records.append(entry)
            self._save_locked()
        return dict(entry)

    def summary(self, period: str = "today") -> Dict[str, Any]:
        """汇总统计。period: "today" 仅今天，"all" 全部记录。"""
        if period not in ("today", "all"):
            raise ValueError('period 只能是 "today" 或 "all"')
        with self._lock:
            if period == "today":
                today = datetime.now().astimezone().date()
                selected = [r for r in self._records if _record_date(r) == today]
            else:
                selected = list(self._records)
            return _aggregate(selected)

    def daily(self, n: int = 14) -> List[Dict[str, Any]]:
        """最近 n 天（含今天、含无数据的空日）的按日统计，日期升序。"""
        try:
            count = max(1, int(n))
        except (TypeError, ValueError):
            count = 14
        today = datetime.now().astimezone().date()
        days = [today - timedelta(days=offset) for offset in range(count - 1, -1, -1)]
        buckets: Dict[date, List[Dict[str, Any]]] = {day: [] for day in days}
        with self._lock:
            for record in self._records:
                try:
                    day = _record_date(record)
                except (TypeError, ValueError, OverflowError):
                    continue
                if day in buckets:
                    buckets[day].append(record)
        result: List[Dict[str, Any]] = []
        for day in days:
            item = _aggregate(buckets[day])
            item["date"] = day.isoformat()
            result.append(item)
        return result

    def reset(self) -> None:
        """清空所有记录并立即落盘。"""
        with self._lock:
            self._records = []
            self._save_locked()

    # -- 内部实现 ---------------------------------------------------------
    def _load_locked(self) -> None:
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            self._records = []
            return
        except OSError:
            self._records = []
            return
        if not raw.strip():
            self._records = []
            return
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            self._quarantine_locked()
            self._records = []
            return
        if not isinstance(data, dict) or not isinstance(data.get("records", []), list):
            self._quarantine_locked()
            self._records = []
            return
        records: List[Dict[str, Any]] = []
        for item in data.get("records", []):
            sanitized = _sanitize_record(item)
            if sanitized is not None:
                records.append(sanitized)
        self._records = records

    def _quarantine_locked(self) -> None:
        stamp = datetime.now().strftime("%Y%m%d%H%M%S")
        backup = self._path.with_name(self._path.name + ".corrupt-" + stamp)
        try:
            os.replace(self._path, backup)
        except OSError:
            try:
                self._path.unlink()
            except OSError:
                pass

    def _save_locked(self) -> None:
        payload = {
            "version": _VERSION,
            "updated_at": datetime.now().astimezone().isoformat(),
            "records": self._records,
        }
        _atomic_write_json(self._path, payload)

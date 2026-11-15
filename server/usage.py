r"""usage.py — Hymnix 用量统计模块

特性：
- 线程安全（按文件路径共享锁）
- JSON 原子持久化（临时文件 + fsync + os.replace）
- 默认路径：%LOCALAPPDATA%\Hymnix\usage.json，可传入自定义 path
- 坏文件容错：解析失败或结构异常时自动备份为 *.corrupt-<时间戳> 并重新开始
- 内置 DeepSeek / OpenAI / Gemini / OpenRouter 常见模型的成本估算表（USD / 1M tokens）
- 逐请求字段：耗时 elapsed_ms、token、算力 compute_flops，以及 success / error /
  estimated（token 缺失或为估算值时标记）
- request_status() / format_request_line() 统一逐请求展示格式；token 未知时输出
  "(estimated)" 标记，失败请求输出 "FAIL" 与 "error: ..."（终端侧按 ERROR 红色渲染）

示例：
    from usage import UsageStore, format_request_line
    store = UsageStore()
    entry = store.record("chat", "deepseek-chat", 120, 380, 950.0, provider="deepseek")
    print(format_request_line(entry))
    store.record("chat", "deepseek-chat", None, None, 2400.0, provider="deepseek",
                 success=False, error="timeout")
    print(store.summary("today"))
    print(store.daily(14))
    print(store.estimate_cost("openai", "gpt-4o-mini", 120, 380))
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

__all__ = [
    "UsageStore",
    "estimate_cost",
    "default_path",
    "format_elapsed",
    "format_flops",
    "format_request_line",
    "model_params_b",
    "estimate_compute_flops",
    "request_status",
    "PRICE_TABLE",
]

_APP_DIRNAME = "Hymnix"
_DEFAULT_FILENAME = "usage.json"
_VERSION = 2

# 算力估算：模型名里的参数量（8b / 7B / 1.5b ...），未知模型按 8B 兜底。
# 与客户端一致：FLOPs ≈ 2 × 参数量 × token 数（前向推理的一次近似）。
_DEFAULT_MODEL_PARAMS_B = 8.0
_PARAMS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[bB](?![A-Za-z])")
_MAX_ERROR_LEN = 240
_ESTIMATED = "(estimated)"

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


def model_params_b(model: Any) -> float:
    """从模型名推断参数量（单位 B）；无法识别时按 8B 处理。"""
    try:
        match = _PARAMS_RE.search(str(model or ""))
    except (TypeError, ValueError):
        match = None
    if match:
        try:
            value = float(match.group(1))
            if value > 0:
                return value
        except (TypeError, ValueError, OverflowError):
            pass
    return _DEFAULT_MODEL_PARAMS_B


def estimate_compute_flops(model: Any, tokens: Any) -> float:
    """按 token 数估算一次请求的算力（FLOPs，约 2 × 参数量 × tokens）。"""
    try:
        count = max(0, int(tokens or 0))
    except (TypeError, ValueError, OverflowError):
        count = 0
    if count <= 0:
        return 0.0
    return 2.0 * model_params_b(model) * 1e9 * count


def _known_int(value: Any) -> Optional[int]:
    """把 token/耗时之类的数值转成非负整数；None/非法值返回 None（表示未知）。"""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return max(0, number)


def _is_estimated(record: Dict[str, Any]) -> bool:
    """该记录的 token / 算力是否为估算值（未知 token 必须视为 estimated）。"""
    if not isinstance(record, dict):
        return False
    if record.get("estimated") is True:
        return True
    prompt = _known_int(record.get("prompt_tokens"))
    reply = _known_int(record.get("reply_tokens"))
    return prompt is None or reply is None


def request_status(record: Dict[str, Any]) -> str:
    """单条请求结果：OK 或 FAIL。success 缺失时按 error 文本推断。"""
    if not isinstance(record, dict):
        return "OK"
    success = record.get("success", record.get("ok"))
    if success is True:
        return "OK"
    if success is False:
        return "FAIL"
    return "FAIL" if str(record.get("error") or "").strip() else "OK"


def format_flops(flops: Any) -> str:
    """把 FLOPs 数值格式化成人读单位（TFLOPs / GFLOPs / MFLOPs / FLOPs）。"""
    try:
        value = max(0.0, float(flops or 0.0))
    except (TypeError, ValueError, OverflowError):
        value = 0.0
    if value >= 1e12:
        return "%.2f TFLOPs" % (value / 1e12)
    if value >= 1e9:
        return "%.1f GFLOPs" % (value / 1e9)
    if value >= 1e6:
        return "%.0f MFLOPs" % (value / 1e6)
    if value >= 1.0:
        return "%.0f FLOPs" % value
    return "0 FLOPs"


def format_elapsed(elapsed_ms: Any) -> str:
    """耗时展示：小于 1 秒用毫秒，否则用秒（保留两位小数）；未知耗时显示 "-"。"""
    if elapsed_ms is None:
        return "-"
    try:
        value = max(0.0, float(elapsed_ms))
    except (TypeError, ValueError, OverflowError):
        return "-"
    if value >= 1000.0:
        return "%.2fs" % (value / 1000.0)
    return "%dms" % int(round(value))


def _format_tokens(record: Dict[str, Any]) -> str:
    prompt = _known_int(record.get("prompt_tokens"))
    reply = _known_int(record.get("reply_tokens"))
    estimated = _is_estimated(record)
    if prompt is None or reply is None:
        return "tok unknown " + _ESTIMATED
    if prompt + reply <= 0:
        return "tok unknown " + _ESTIMATED if estimated else "0 tok"
    if estimated:
        return "≈%d→≈%d tok %s" % (prompt, reply, _ESTIMATED)
    return "%d→%d tok" % (prompt, reply)


def _format_gpu(gpu: Any) -> str:
    """真实 GPU 指标优先于 FLOPs 估算（gateway 记录里的 gpu dict）。"""
    if not isinstance(gpu, dict):
        return ""
    parts: List[str] = []
    util = gpu.get("gpu_util")
    seconds = gpu.get("gpu_seconds")
    try:
        if util is not None:
            parts.append("GPU %d%%" % max(0, min(100, int(round(float(util))))))
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        if seconds is not None:
            parts.append("%.2f GPU-s" % max(0.0, float(seconds)))
    except (TypeError, ValueError, OverflowError):
        pass
    return " · ".join(parts)


def _format_compute(record: Dict[str, Any]) -> str:
    gpu_label = _format_gpu(record.get("gpu"))
    if gpu_label:
        return gpu_label
    estimated = _is_estimated(record) or bool(record.get("compute_estimated"))
    flops = record.get("compute_flops")
    if flops is None:
        prompt = _known_int(record.get("prompt_tokens")) or 0
        reply = _known_int(record.get("reply_tokens")) or 0
        flops = estimate_compute_flops(record.get("model"), prompt + reply)
    try:
        value = max(0.0, float(flops or 0.0))
    except (TypeError, ValueError, OverflowError):
        value = 0.0
    if value <= 0:
        return "compute unknown " + _ESTIMATED if estimated else "0 FLOPs"
    label = format_flops(value)
    if estimated:
        return "≈%s %s" % (label, _ESTIMATED)
    return label


def format_request_line(record: Dict[str, Any], include_status: bool = True) -> str:
    """把一条请求记录格式化成终端/日志用的一行。

    形如：OK · deepseek-chat · 950ms · 120→380 tok · 5.0 GFLOPs；
    失败请求为 FAIL · ... · error: timeout；token/算力未知时带
    (estimated) 标记。终端页面调用时传 include_status=False，因为级别
    （OK/ERROR）会由终端行前缀单独渲染。
    """
    record = record if isinstance(record, dict) else {}
    parts: List[str] = []
    if include_status:
        parts.append(request_status(record))
    parts.append(str(record.get("model") or "unknown"))
    parts.append(format_elapsed(record.get("elapsed_ms")))
    parts.append(_format_tokens(record))
    parts.append(_format_compute(record))
    error = str(record.get("error") or "").strip().replace("\r", " ").replace("\n", " ")
    if not error and request_status(record) == "FAIL":
        error = "request failed"
    if error:
        parts.append("error: " + error[:_MAX_ERROR_LEN])
    return " · ".join(parts)


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

        model = str(item.get("model") or "unknown")
        prompt = _known_int(item.get("prompt_tokens"))
        reply = _known_int(item.get("reply_tokens"))
        error = str(item.get("error") or "").strip()[:_MAX_ERROR_LEN]
        success_raw = item.get("success", item.get("ok"))
        success = (not error) if success_raw is None else bool(success_raw)
        estimated = bool(item.get("estimated")) or prompt is None or reply is None
        compute_raw = item.get("compute_flops")
        if compute_raw is None:
            flops = estimate_compute_flops(model, (prompt or 0) + (reply or 0))
            compute_estimated = estimated
        else:
            flops = max(0.0, _num("compute_flops"))
            compute_estimated = bool(item.get("compute_estimated", estimated))

        return {
            "ts": ts,
            "kind": str(item.get("kind") or "chat"),
            "model": model,
            "provider": str(item.get("provider") or "local"),
            "prompt_tokens": prompt or 0,
            "reply_tokens": reply or 0,
            "elapsed_ms": max(0.0, _num("elapsed_ms")),
            "cost": max(0.0, _num("cost")),
            "success": success,
            "error": error,
            "estimated": bool(estimated),
            "compute_flops": round(flops, 1),
            "compute_estimated": bool(compute_estimated),
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
    prompt_tokens = sum(int(r.get("prompt_tokens") or 0) for r in records)
    reply_tokens = sum(int(r.get("reply_tokens") or 0) for r in records)
    elapsed = sum(float(r.get("elapsed_ms") or 0.0) for r in records)
    cost = sum(float(r.get("cost") or 0.0) for r in records)
    succeeded = sum(1 for r in records if request_status(r) == "OK")
    estimated_requests = sum(1 for r in records if _is_estimated(r))
    compute_flops = sum(float(r.get("compute_flops") or 0.0) for r in records)
    return {
        "requests": requests,
        "prompt_tokens": prompt_tokens,
        "reply_tokens": reply_tokens,
        "total_tokens": prompt_tokens + reply_tokens,
        "cost": round(cost, 8),
        "avg_latency_ms": round(elapsed / requests, 1) if requests else 0.0,
        "succeeded": succeeded,
        "failed": requests - succeeded,
        "estimated_requests": estimated_requests,
        "compute_flops": round(compute_flops, 1),
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
        prompt_tokens: Optional[int] = 0,
        reply_tokens: Optional[int] = 0,
        elapsed_ms: float = 0.0,
        provider: str = "local",
        cost: Optional[float] = None,
        *,
        success: Optional[bool] = None,
        error: str = "",
        estimated: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """记录一次请求；cost 为 None 时按内置价格表自动估算。

        prompt_tokens / reply_tokens 传 None 表示 token 未知：记录会标记
        estimated=True，展示层输出 "(estimated)"，不会伪装成 0 token。
        success 为 None 时按 error 是否为空推断；error 文本同时用于失败展示。
        """
        prompt = _known_int(prompt_tokens)
        reply = _known_int(reply_tokens)
        unknown_tokens = prompt is None or reply is None
        prompt = prompt or 0
        reply = reply or 0
        try:
            elapsed = max(0.0, float(elapsed_ms or 0.0))
        except (TypeError, ValueError, OverflowError):
            elapsed = 0.0
        if cost is None:
            estimated_cost = estimate_cost(provider, model, prompt, reply)
        else:
            try:
                estimated_cost = max(0.0, round(float(cost), 8))
            except (TypeError, ValueError):
                estimated_cost = estimate_cost(provider, model, prompt, reply)

        error_text = str(error or "").strip()[:_MAX_ERROR_LEN]
        success_flag = (not error_text) if success is None else bool(success)
        estimated_flag = True if unknown_tokens else bool(estimated)
        compute_flops = estimate_compute_flops(model, prompt + reply)

        entry = {
            "ts": datetime.now().astimezone().isoformat(),
            "kind": str(kind or "chat"),
            "model": str(model or "unknown"),
            "provider": str(provider or "local"),
            "prompt_tokens": prompt,
            "reply_tokens": reply,
            "elapsed_ms": round(elapsed, 1),
            "cost": estimated_cost,
            "success": success_flag,
            "error": error_text,
            "estimated": estimated_flag,
            "compute_flops": round(compute_flops, 1),
            "compute_estimated": estimated_flag,
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


def _selftest() -> bool:
    """无网络自检：逐请求字段、estimated 标记、聚合与持久化。"""
    import json
    import shutil
    import tempfile

    tmp = tempfile.mkdtemp(prefix="hymnix-usage-")
    try:
        path = os.path.join(tmp, "usage.json")
        store = UsageStore(path)
        ok = store.record("chat", "deepseek-chat", 120, 380, 950.0, provider="deepseek")
        assert ok["success"] is True and ok["estimated"] is False and ok["error"] == ""
        assert format_request_line(ok).startswith("OK · deepseek-chat · 950ms · 120→380 tok · ")
        fail = store.record("chat", "qwen3:8b", None, None, 2500.0, error="timeout")
        assert fail["success"] is False and fail["estimated"] is True
        fline = format_request_line(fail)
        assert fline.startswith("FAIL · qwen3:8b · 2.50s · tok unknown (estimated)"), fline
        assert fline.endswith("error: timeout"), fline
        guessed = store.record("chat", "deepseek-chat", 100, 200, 300.0, estimated=True)
        assert "≈100→≈200 tok (estimated)" in format_request_line(guessed)
        summary = store.summary("all")
        assert summary["requests"] == 3 and summary["succeeded"] == 2 and summary["failed"] == 1, summary
        assert summary["estimated_requests"] == 2 and summary["compute_flops"] > 0, summary
        reloaded = UsageStore(path)._records
        assert reloaded[1]["success"] is False and reloaded[1]["error"] == "timeout"
        assert reloaded[1]["estimated"] is True and reloaded[1]["elapsed_ms"] == 2500.0
        legacy = os.path.join(tmp, "legacy.json")
        with open(legacy, "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "records": [{
                "ts": "2026-01-01T00:00:00+08:00", "model": "deepseek-chat",
                "prompt_tokens": 10, "reply_tokens": 20,
            }]}, handle)
        v1 = UsageStore(legacy).summary("all")
        assert v1["requests"] == 1 and v1["succeeded"] == 1 and v1["compute_flops"] > 0
        assert model_params_b("qwen3:8b") == 8.0 and format_elapsed(None) == "-"
        assert format_flops(2.5e9) == "2.5 GFLOPs"
        return True
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    _selftest()
    print("SELFTEST OK")
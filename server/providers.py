r"""providers.py — Hymnix 云端 API provider 预设与连通性测试

包含：
- PRESETS：DeepSeek / OpenAI / Gemini / OpenRouter 的 base_url、默认模型、常见模型与价格
- default_config_path / default_config / load_config / save_config：JSON 原子持久化配置
- test_connection：调用 /chat/completions（或 /models）验证地址、密钥、模型是否可用
  返回 (ok, message, latency_ms, models)，所有异常都转换为可读中文提示

示例：
    import providers
    cfg = providers.load_config()
    cfg["providers"]["deepseek"]["api_key"] = "sk-..."
    providers.save_config(cfg)
    ok, msg, ms, models = providers.test_connection(
        cfg["providers"]["deepseek"]["base_url"],
        cfg["providers"]["deepseek"]["api_key"],
        cfg["providers"]["deepseek"]["model"],
    )
    print(ok, msg, ms, models[:5])
"""

from __future__ import annotations

import copy
import json
import os
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:  # requests 是可选运行依赖，缺失时 test_connection 返回中文提示而不是崩溃
    import requests
except Exception:  # pragma: no cover - 环境缺库时
    requests = None  # type: ignore[assignment]

__all__ = [
    "PRESETS",
    "default_config",
    "default_config_path",
    "get_preset",
    "load_config",
    "save_config",
    "test_connection",
]

_APP_DIRNAME = "Hymnix"
_DEFAULT_FILENAME = "providers.json"
_VERSION = 1

# 价格单位：美元 / 100 万 tokens
PRESETS: Dict[str, Dict[str, Any]] = {
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "docs": "https://platform.deepseek.com/",
        "pricing": {
            "deepseek-chat": {"input": 0.27, "output": 1.10},
            "deepseek-reasoner": {"input": 0.55, "output": 2.19},
        },
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "models": [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4.1-nano",
            "o3-mini",
        ],
        "docs": "https://platform.openai.com/docs/models",
        "pricing": {
            "gpt-4o": {"input": 2.50, "output": 10.00},
            "gpt-4o-mini": {"input": 0.15, "output": 0.60},
            "gpt-4.1": {"input": 2.00, "output": 8.00},
            "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
            "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
            "o3-mini": {"input": 1.10, "output": 4.40},
        },
    },
    "gemini": {
        "name": "Google Gemini",
        # Gemini 官方提供的 OpenAI 兼容入口
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "default_model": "gemini-2.0-flash",
        "models": [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-pro",
            "gemini-1.5-flash",
        ],
        "docs": "https://ai.google.dev/gemini-api/docs/openai",
        "pricing": {
            "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
            "gemini-2.5-flash": {"input": 0.30, "output": 2.50},
            "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
            "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
            "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
        },
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "deepseek/deepseek-chat",
        "models": [
            "deepseek/deepseek-chat",
            "openai/gpt-4o-mini",
            "google/gemini-2.0-flash-001",
            "anthropic/claude-3.5-sonnet",
        ],
        "docs": "https://openrouter.ai/models",
        "pricing": {
            "deepseek/deepseek-chat": {"input": 0.27, "output": 1.10},
            "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
            "google/gemini-2.0-flash-001": {"input": 0.10, "output": 0.40},
            "anthropic/claude-3.5-sonnet": {"input": 3.00, "output": 15.00},
        },
        # OpenRouter 推荐/要求的附加请求头
        "extra_headers": {
            "HTTP-Referer": "https://hymnix.local",
            "X-Title": "Hymnix",
        },
    },
}

_CFG_LOCKS: Dict[str, "threading.RLock"] = {}
_CFG_LOCKS_GUARD = threading.Lock()


def _lock_for(path: Union[str, os.PathLike]) -> "threading.RLock":
    try:
        key = os.path.normcase(os.path.abspath(os.fspath(path)))
    except (TypeError, ValueError):
        key = str(path)
    with _CFG_LOCKS_GUARD:
        lock = _CFG_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _CFG_LOCKS[key] = lock
        return lock


def default_config_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if base:
        return Path(base) / _APP_DIRNAME / _DEFAULT_FILENAME
    return Path.home() / ("." + _APP_DIRNAME.lower()) / _DEFAULT_FILENAME


def default_config() -> Dict[str, Any]:
    """返回带完整预设的默认配置（每次调用都是新对象）。"""
    providers: Dict[str, Dict[str, Any]] = {}
    for key, preset in PRESETS.items():
        providers[key] = {
            "base_url": preset["base_url"],
            "api_key": "",
            "model": preset["default_model"],
        }
    return {"active": "deepseek", "providers": providers}


def get_preset(name: str) -> Optional[Dict[str, Any]]:
    """返回某个 provider 预设的深拷贝；不存在返回 None。"""
    preset = PRESETS.get(str(name or "").strip().lower())
    return copy.deepcopy(preset) if preset is not None else None


def load_config(path: Optional[Union[str, os.PathLike]] = None) -> Dict[str, Any]:
    """读取配置；文件不存在、JSON 损坏或结构异常时安静地回退到默认配置。"""
    target = Path(path).expanduser() if path is not None else default_config_path()
    with _lock_for(target):
        try:
            raw = target.read_text(encoding="utf-8")
        except (FileNotFoundError, OSError):
            return default_config()
        if not raw.strip():
            return default_config()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return default_config()
        if not isinstance(data, dict):
            return default_config()

    config = default_config()
    active = data.get("active")
    if isinstance(active, str) and active.strip().lower() in PRESETS:
        config["active"] = active.strip().lower()

    saved_providers = data.get("providers")
    if isinstance(saved_providers, dict):
        for key, value in saved_providers.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            base = config["providers"].get(
                key, {"base_url": "", "api_key": "", "model": ""}
            )
            merged = dict(base)
            for field in ("base_url", "api_key", "model"):
                field_value = value.get(field)
                if isinstance(field_value, str):
                    merged[field] = field_value
            # 保留用户自定义的额外字段
            for extra_key, extra_value in value.items():
                if extra_key not in merged:
                    merged[extra_key] = copy.deepcopy(extra_value)
            config["providers"][key] = merged
    return config


def save_config(
    config: Dict[str, Any], path: Optional[Union[str, os.PathLike]] = None
) -> str:
    """原子保存配置，返回实际写入的路径。"""
    if not isinstance(config, dict):
        raise TypeError("config 必须是 dict")
    target = Path(path).expanduser() if path is not None else default_config_path()

    providers: Dict[str, Any] = {}
    raw_providers = config.get("providers")
    if isinstance(raw_providers, dict):
        for key, value in raw_providers.items():
            if not isinstance(key, str):
                continue
            if isinstance(value, dict):
                providers[key] = copy.deepcopy(value)
            else:
                providers[key] = value

    payload = {
        "version": _VERSION,
        "updated_at": datetime.now().astimezone().isoformat(),
        "active": str(config.get("active") or "deepseek"),
        "providers": providers,
    }
    with _lock_for(target):
        _atomic_write_json(target, payload)
    return str(target)


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
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


# ---------------------------------------------------------------------------
# 连通性测试
# ---------------------------------------------------------------------------


def _normalize_base_url(base_url: str) -> str:
    text = str(base_url or "").strip()
    if not text:
        return ""
    if not text.lower().startswith(("http://", "https://")):
        text = "https://" + text
    text = text.rstrip("/")
    lowered = text.lower()
    for suffix in ("/chat/completions", "/completions"):
        if lowered.endswith(suffix):
            text = text[: -len(suffix)].rstrip("/")
            break
    return text


def _safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:
        try:
            return {"_text": (response.text or "")[:300]}
        except Exception:
            return {}


def _extract_error_detail(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    error = data.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("code") or ""
        if message:
            return str(message)[:300]
    elif isinstance(error, str) and error:
        return error[:300]
    for key in ("message", "detail", "_text"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:300]
    return ""


def _http_error_message(status: int, data: Any) -> str:
    detail = _extract_error_detail(data)
    suffix = (" 服务器返回：" + detail) if detail else ""
    if status in (401, 403):
        return (
            "API Key 无效或没有访问权限（HTTP %d）。请检查密钥是否填写正确、"
            "是否已过期或被撤销。%s" % (status, suffix)
        )
    if status == 404:
        return (
            "接口地址或模型名称不正确（HTTP 404）。请确认 Base URL 完整（例如以 /v1 结尾），"
            "并检查模型名称是否存在。%s" % suffix
        )
    if status == 429:
        return (
            "请求过于频繁或账户额度不足（HTTP 429）。请稍后重试，或检查账户余额/限流设置。%s"
            % suffix
        )
    if status == 400:
        return (
            "请求被服务端拒绝（HTTP 400）：%s。请检查模型名称、账户权限或请求格式。"
            % (detail or "参数不受支持")
        )
    if status == 402:
        return "账户余额不足（HTTP 402）。请充值后重试。%s" % suffix
    if 500 <= status < 600:
        return "服务端错误（HTTP %d），请稍后重试。%s" % (status, suffix)
    return "请求失败（HTTP %d）。%s" % (status, suffix)


def _model_ids(data: Any) -> List[str]:
    items = None
    if isinstance(data, dict):
        items = data.get("data")
        if not isinstance(items, list):
            items = data.get("models")
    elif isinstance(data, list):
        items = data
    ids: List[str] = []
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                model_id = item.get("id") or item.get("name")
                if isinstance(model_id, str) and model_id.strip():
                    ids.append(model_id.strip())
            elif isinstance(item, str) and item.strip():
                ids.append(item.strip())
    return ids


def _fetch_models(
    session: Any, base_url: str, headers: Dict[str, str], timeout: float
) -> Tuple[int, List[str], Any]:
    response = session.get(base_url + "/models", headers=headers, timeout=timeout)
    data = _safe_json(response)
    return response.status_code, _model_ids(data), data


def _chat_probe(
    session: Any,
    base_url: str,
    headers: Dict[str, str],
    model: str,
    timeout: float,
) -> Tuple[int, Any, str]:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "temperature": 0,
        "stream": False,
    }
    response = session.post(
        base_url + "/chat/completions", headers=headers, json=payload, timeout=timeout
    )
    data = _safe_json(response)
    if response.status_code == 400 and "max_tokens" in _extract_error_detail(data).lower():
        # 部分新模型（如 o 系列）要求 max_completion_tokens
        payload.pop("max_tokens", None)
        payload["max_completion_tokens"] = 16
        response = session.post(
            base_url + "/chat/completions",
            headers=headers,
            json=payload,
            timeout=timeout,
        )
        data = _safe_json(response)
    return response.status_code, data, ""


def test_connection(
    base_url: str, api_key: str, model: str = "", timeout: float = 15
) -> Tuple[bool, str, float, List[str]]:
    """测试 provider 是否可用。

    返回 (ok, message, latency_ms, models)：
    - ok: 是否连接成功
    - message: 可读中文提示（异常、401、超时等都会返回中文说明）
    - latency_ms: 本次测试耗时（毫秒）
    - models: /models 返回的模型 id 列表（拿不到则为 []）
    """
    started = time.perf_counter()

    def elapsed_ms() -> float:
        return round((time.perf_counter() - started) * 1000.0, 1)

    base = _normalize_base_url(base_url)
    if not base:
        return False, "Base URL 不能为空，请填写完整的接口地址（例如 https://api.openai.com/v1）。", 0.0, []

    key = str(api_key or "").strip()
    if not key:
        return False, "API Key 不能为空，请先在设置中填写密钥。", 0.0, []

    model_name = str(model or "").strip()
    if requests is None:
        return False, "未安装 requests 库，请先执行 pip install requests。", 0.0, []

    headers = {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if "openrouter.ai" in base:
        headers.setdefault("HTTP-Referer", "https://hymnix.local")
        headers.setdefault("X-Title", "Hymnix")

    session = None
    try:
        session = requests.Session()
        models: List[str] = []

        try:
            models_status, model_ids, models_data = _fetch_models(
                session, base, headers, timeout
            )
        except requests.exceptions.RequestException:
            raise
        if models_status == 200:
            models = model_ids
        elif models_status in (401, 403):
            return False, _http_error_message(models_status, models_data), elapsed_ms(), []

        if not model_name:
            if models_status == 200:
                return (
                    True,
                    "连接成功，共获取 %d 个可用模型。" % len(models),
                    elapsed_ms(),
                    models,
                )
            return (
                False,
                "无法访问模型列表接口（HTTP %d）。请检查 Base URL 是否正确，"
                "或填写模型名称后再测试。%s"
                % (models_status, _extract_error_detail(models_data)),
                elapsed_ms(),
                [],
            )

        chat_status, chat_data, _ = _chat_probe(
            session, base, headers, model_name, timeout
        )
        latency = elapsed_ms()

        if chat_status == 200:
            message = "连接成功：模型 %s 可用。" % model_name
            if models:
                message += "（共获取 %d 个可用模型）" % len(models)
            return True, message, latency, models

        if chat_status in (401, 403):
            return False, _http_error_message(chat_status, chat_data), latency, models
        if chat_status == 404:
            # 对话接口 404 时，如果 /models 可用且包含该模型，也视为基本可用
            if models_status == 200 and model_name in models:
                return (
                    True,
                    "连接成功：模型 %s 在模型列表中，但对话接口返回 HTTP 404，"
                    "请确认 Base URL 末尾是否需要 /v1。" % model_name,
                    latency,
                    models,
                )
            return False, _http_error_message(chat_status, chat_data), latency, models
        return False, _http_error_message(chat_status, chat_data), latency, models

    except requests.exceptions.Timeout:
        return (
            False,
            "连接超时（超过 %.0f 秒）：服务器没有响应。请检查网络、代理设置或 Base URL 是否正确。"
            % timeout,
            elapsed_ms(),
            [],
        )
    except requests.exceptions.SSLError as exc:
        return (
            False,
            "SSL 证书校验失败：%s。请检查代理/证书设置或 Base URL。" % _short(exc),
            elapsed_ms(),
            [],
        )
    except requests.exceptions.InvalidURL as exc:
        return (
            False,
            "接口地址格式不正确：%s。请填写完整的 http(s) URL。" % _short(exc),
            elapsed_ms(),
            [],
        )
    except requests.exceptions.ConnectionError as exc:
        return (
            False,
            "无法连接到服务器：%s。请检查网络、代理或 Base URL 是否正确。" % _short(exc),
            elapsed_ms(),
            [],
        )
    except Exception as exc:  # 兜底：任何异常都返回可读中文消息
        return (
            False,
            "连接测试失败：%s" % _short(exc),
            elapsed_ms(),
            [],
        )
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass


def _short(exc: Any, limit: int = 200) -> str:
    text = str(exc or "").replace("\n", " ").strip()
    if not text:
        return type(exc).__name__
    return text[:limit]

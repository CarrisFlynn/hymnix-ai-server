# -*- coding: utf-8 -*-
"""Pure normalization, filtering and serialization for tool timeline cards."""
from __future__ import annotations

import json
from collections.abc import Iterable, Mapping


def safe_json(value) -> str:
    """Format Unicode JSON, falling back to text for unsupported values."""
    try:
        return json.dumps(value, ensure_ascii=False, indent=2)
    except Exception:
        try:
            return str(value)
        except Exception:
            return "<unprintable>"


def to_json(card) -> str:
    """Serialize one normalized card without losing non-JSON values."""
    return safe_json(card)


def normalize_event(event) -> dict:
    """Turn a begin/end event into a display card with replay metadata."""
    event = event if isinstance(event, Mapping) else {}
    phase = event.get("phase")
    if phase == "begin" or event.get("status") == "running":
        status = "running"
    elif "ok" in event:
        status = "ok" if event["ok"] else "fail"
    elif event.get("status") in ("ok", "fail"):
        status = event["status"]
    else:
        status = "unknown"
    args_present = isinstance(event.get("args"), dict)
    args = event.get("args", {})
    tool = str(event.get("tool") or event.get("name") or "")
    error = event.get("error", "")
    return {
        "id": str(event.get("id") or ""), "tool": tool, "status": status,
        "args_json": safe_json(args), "result_json": safe_json(event.get("result")),
        "error": error if isinstance(error, str) else str(error or ""),
        "ms": event.get("ms"), "ts": event.get("ts", event.get("t1", event.get("t0"))),
        "retryable": status == "fail" and bool(tool) and args_present
                     and event.get("retryable", True) is not False,
        "args": args, "args_present": args_present, "origin": event.get("origin", "tool"),
    }


def cards_from_events(events: Iterable) -> list[dict]:
    """Collapse begin/end events sharing a call ID into one latest card."""
    cards = {}
    for index, event in enumerate(events or ()):
        if not isinstance(event, Mapping):
            continue
        card = normalize_event(event)
        key = card["id"] or f"event-{index}"
        previous = cards.get(key)
        if previous and event.get("phase") == "end":
            merged = dict(event)
            if not card["args_present"] and previous["args_present"]:
                merged["args"] = previous["args"]
            if not card["tool"] and previous["tool"]:
                merged["tool"] = previous["tool"]
            if not event.get("origin"):
                merged["origin"] = previous["origin"]
            card = normalize_event(merged)
            card["start_ts"] = previous.get("start_ts", previous["ts"])
            card["ts"] = card["start_ts"]
        cards[key] = card
    return list(cards.values())


def filter_cards(cards: Iterable, status: str = "all", query: str = "", tool=None) -> list[dict]:
    """Filter by status, exact tool and case-insensitive visible text."""
    if status not in ("all", "ok", "fail", "running"):
        raise ValueError("invalid card status")
    needle = str(query or "").casefold()
    return [card for card in (cards or ()) if
            (status == "all" or card.get("status") == status) and
            (tool is None or card.get("tool") == tool) and
            (not needle or any(needle in str(card.get(field) or "").casefold()
                               for field in ("tool", "args_json", "result_json", "error")))]


if __name__ == "__main__":
    events = [
        {"id": "a", "tool": "calc", "args": {"text": "中文"}, "phase": "begin", "t0": 1},
        {"id": "a", "tool": "calc", "phase": "end", "ok": False,
         "error": "traceback\n完整失败详情", "t1": 2},
        {"id": "b", "tool": "time.now", "args": {}, "phase": "begin"},
        {"id": "c", "tool": "calc", "args": {"text": "old"}, "phase": "begin"},
        {"id": "c", "tool": "calc", "args": {"text": "new"}, "phase": "end", "ok": False},
        {"id": "d", "tool": "calc", "phase": "end", "ok": False},
    ]
    cards = cards_from_events(events)
    assert len(cards) == 4 and cards[0]["args"] == {"text": "中文"}
    assert cards[0]["retryable"] and cards[0]["args_present"] and cards[0]["ts"] == 1
    assert not cards[1]["retryable"]
    assert cards[2]["args"] == {"text": "new"} and cards[2]["retryable"]
    assert cards[3]["args_present"] is False and cards[3]["retryable"] is False
    assert len(filter_cards(cards, "fail", "完整失败详情")) == 1
    assert len(filter_cards(cards, "running")) == 1
    assert "中文" in to_json(cards[0])
    assert safe_json({"x": object()})
    print("PASS")

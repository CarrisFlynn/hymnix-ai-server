# -*- coding: utf-8 -*-
"""Anthropic Messages <-> Ollama chat.

A guest that speaks the Anthropic protocol (Claude Code, the Anthropic SDKs) can
then use a model this machine shares. Nothing here executes a tool: the guest
receives tool_use blocks and runs them on its own machine, which is the whole
point of the sharing model — the brain is here, the hands are there.

Pure functions only, so the translation is testable without a server.
"""
from __future__ import annotations

import json


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    return "\n".join(p for p in parts if p)


def anthropic_to_upstream(payload: dict, real_model: str) -> dict:
    """Anthropic Messages request -> the shape Ollama's /api/chat takes."""
    messages: list[dict] = []

    system = payload.get("system")
    system_text = _text_of(system).strip()
    if system_text:
        messages.append({"role": "system", "content": system_text})

    for turn in payload.get("messages") or []:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "user")
        content = turn.get("content")
        if isinstance(content, str):
            messages.append({"role": role, "content": content})
            continue
        texts: list[str] = []
        tool_calls: list[dict] = []
        tool_results: list[dict] = []
        for block in content or []:
            if not isinstance(block, dict):
                continue
            kind = str(block.get("type") or "")
            if kind == "text":
                texts.append(str(block.get("text") or ""))
            elif kind == "tool_use" and role == "assistant":
                tool_calls.append({
                    "id": str(block.get("id") or ""),
                    "type": "function",
                    "function": {
                        "name": str(block.get("name") or ""),
                        "arguments": json.dumps(block.get("input") or {}, ensure_ascii=False),
                    },
                })
            elif kind == "tool_result":
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": str(block.get("tool_use_id") or ""),
                    "content": _text_of(block.get("content")),
                })
        merged = "\n".join(t for t in texts if t)
        if tool_results:
            messages.extend(tool_results)
            if merged:
                messages.append({"role": "user", "content": merged})
            continue
        row: dict = {"role": role, "content": merged}
        if tool_calls:
            row["tool_calls"] = tool_calls
            if not merged:
                row["content"] = ""
        messages.append(row)

    body: dict = {"model": real_model, "messages": messages, "stream": True}

    tools = payload.get("tools")
    if isinstance(tools, list) and tools:
        converted = []
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            name = str(tool.get("name") or "").strip()
            if not name:
                continue
            converted.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": str(tool.get("description") or ""),
                    "parameters": tool.get("input_schema") or {"type": "object", "properties": {}},
                },
            })
        if converted:
            body["tools"] = converted

    max_tokens = payload.get("max_tokens")
    options = {}
    if isinstance(max_tokens, int) and max_tokens > 0:
        options["num_predict"] = max_tokens
    if isinstance(payload.get("temperature"), (int, float)):
        options["temperature"] = float(payload["temperature"])
    if options:
        body["options"] = options
    return body


def _sse(event: str, data: dict) -> str:
    return "event: " + event + "\ndata: " + json.dumps(data, ensure_ascii=False) + "\n\n"


def start_events(model: str, input_tokens: int = 0) -> list[str]:
    return [_sse("message_start", {
        "type": "message_start",
        "message": {
            "id": "msg_hymnix",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [],
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {"input_tokens": int(input_tokens), "output_tokens": 0},
        },
    })]


def text_block_start(index: int) -> str:
    return _sse("content_block_start", {"type": "content_block_start", "index": index,
                                        "content_block": {"type": "text", "text": ""}})


def text_delta(index: int, text: str) -> str:
    return _sse("content_block_delta", {"type": "content_block_delta", "index": index,
                                        "delta": {"type": "text_delta", "text": text}})


def thinking_block_start(index: int) -> str:
    return _sse("content_block_start", {"type": "content_block_start", "index": index,
                                        "content_block": {"type": "thinking", "thinking": ""}})


def thinking_delta(index: int, text: str) -> str:
    return _sse("content_block_delta", {"type": "content_block_delta", "index": index,
                                        "delta": {"type": "thinking_delta", "thinking": text}})


def tool_block_start(index: int, call_id: str, name: str) -> str:
    return _sse("content_block_start", {"type": "content_block_start", "index": index,
                                        "content_block": {"type": "tool_use", "id": call_id or "toolu_hymnix",
                                                          "name": name, "input": {}}})


def tool_input_delta(index: int, partial: str) -> str:
    return _sse("content_block_delta", {"type": "content_block_delta", "index": index,
                                        "delta": {"type": "input_json_delta", "partial_json": partial}})


def block_stop(index: int) -> str:
    return _sse("content_block_stop", {"type": "content_block_stop", "index": index})


def finish_events(stop_reason: str, output_tokens: int) -> list[str]:
    return [
        _sse("message_delta", {"type": "message_delta",
                               "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                               "usage": {"output_tokens": int(output_tokens)}}),
        _sse("message_stop", {"type": "message_stop"}),
    ]


def stream_from_ollama(lines, model: str):
    """Consume Ollama NDJSON frames and yield Anthropic SSE strings."""
    index = 0
    text_open = False
    think_open = False
    tool_index = 0
    output_tokens = 0
    produced_text = False
    produced_tools = False
    for raw in lines:
        text = raw.decode("utf-8", "replace").strip() if isinstance(raw, bytes) else str(raw).strip()
        if not text:
            continue
        try:
            frame = json.loads(text)
        except Exception:
            continue
        message = frame.get("message") or {}
        # qwen3 and friends stream their reasoning first; Anthropic has a block for it,
        # so it is forwarded instead of being dropped, and the text block opens later.
        reasoning = str(message.get("thinking") or "")
        if reasoning:
            if not think_open and not text_open:
                think_open = True
                yield thinking_block_start(index)
            if think_open:
                yield thinking_delta(index, reasoning)
        piece = str(message.get("content") or "")
        if piece:
            if think_open:
                yield block_stop(index)
                think_open = False
                index += 1
            if not text_open:
                text_open = True
                yield text_block_start(index)
            produced_text = True
            output_tokens += max(1, len(piece) // 4)
            yield text_delta(index, piece)
        for call in message.get("tool_calls") or []:
            fn = call.get("function") or {}
            name = str(fn.get("name") or "")
            if not name:
                continue
            if text_open:
                yield block_stop(index)
                text_open = False
                index += 1
            produced_tools = True
            block_index = index
            yield tool_block_start(block_index, str(call.get("id") or ""), name)
            arguments = fn.get("arguments")
            payload = arguments if isinstance(arguments, str) else json.dumps(arguments or {}, ensure_ascii=False)
            yield tool_input_delta(block_index, payload or "{}")
            yield block_stop(block_index)
            index += 1
            tool_index += 1
        if frame.get("done"):
            break
    if think_open:
        yield block_stop(index)
        think_open = False
        index += 1
    if text_open:
        yield block_stop(index)
    if not produced_text and not produced_tools:
        # An empty answer still needs a well-formed block before the message ends.
        yield text_block_start(0)
        yield text_delta(0, "")
        yield block_stop(0)
    stop = "tool_use" if produced_tools else "end_turn"
    for event in finish_events(stop, max(output_tokens, 1)):
        yield event

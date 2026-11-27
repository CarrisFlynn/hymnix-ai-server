# -*- coding: utf-8 -*-
"""The Anthropic adapter: translation in, translation out, no tool execution."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from hxcore import anthropic


class RequestTranslation(unittest.TestCase):
    def test_system_and_turns(self):
        body = anthropic.anthropic_to_upstream({
            "model": "m",
            "system": "be brief",
            "messages": [{"role": "user", "content": "hi"}],
        }, "m")
        self.assertEqual(body["messages"][0], {"role": "system", "content": "be brief"})
        self.assertEqual(body["messages"][1], {"role": "user", "content": "hi"})
        self.assertTrue(body["stream"])

    def test_tool_use_and_result_round_trip(self):
        body = anthropic.anthropic_to_upstream({
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "text", "text": "reading"},
                    {"type": "tool_use", "id": "t1", "name": "fs.read", "input": {"path": "a"}}]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "data"}]},
            ],
            "tools": [{"name": "fs.read", "description": "read", "input_schema": {"type": "object"}}],
        }, "m")
        call = body["messages"][0]["tool_calls"][0]
        self.assertEqual(call["function"]["name"], "fs.read")
        self.assertEqual(json.loads(call["function"]["arguments"]), {"path": "a"})
        self.assertEqual(body["messages"][1]["role"], "tool")
        self.assertEqual(body["messages"][1]["content"], "data")
        self.assertEqual(body["tools"][0]["function"]["name"], "fs.read")

    def test_max_tokens_becomes_num_predict(self):
        body = anthropic.anthropic_to_upstream({"max_tokens": 128, "temperature": 0.3}, "m")
        self.assertEqual(body["options"]["num_predict"], 128)
        self.assertEqual(body["options"]["temperature"], 0.3)


class StreamTranslation(unittest.TestCase):
    def frames(self, rows):
        return [json.dumps(row).encode("utf-8") for row in rows]

    def test_text_stream_ends_with_message_stop(self):
        events = list(anthropic.stream_from_ollama(self.frames([
            {"message": {"content": "He"}},
            {"message": {"content": "llo"}},
            {"done": True},
        ]), "m"))
        joined = "".join(events)
        self.assertIn("text_delta", joined)
        self.assertIn("message_stop", joined)
        self.assertIn('"stop_reason": "end_turn"', joined)

    def test_tool_calls_become_tool_use_blocks(self):
        events = list(anthropic.stream_from_ollama(self.frames([
                        {"message": {"content": "", "tool_calls": [{"id": "c1", "function": {"name": "fs.read", "arguments": json.dumps({"path": "a"})}}]}},
            {"done": True},
        ]), "m"))
        joined = "".join(events)
        self.assertIn("tool_use", joined)
        self.assertIn("input_json_delta", joined)
        self.assertIn('"stop_reason": "tool_use"', joined)

    def test_reasoning_becomes_a_thinking_block(self):
        events = list(anthropic.stream_from_ollama(self.frames([
            {"message": {"content": "", "thinking": "hmm"}},
            {"message": {"content": "ok"}},
            {"done": True},
        ]), "m"))
        joined = "".join(events)
        self.assertIn("thinking_delta", joined)
        self.assertIn("text_delta", joined)

    def test_empty_answer_still_produces_a_well_formed_stream(self):
        events = list(anthropic.stream_from_ollama(self.frames([{"done": True}]), "m"))
        joined = "".join(events)
        self.assertIn("content_block_start", joined)
        self.assertIn("message_stop", joined)

    def test_thinking_block_is_closed_before_a_tool_block(self):
        events = list(anthropic.stream_from_ollama(self.frames([
            {"message": {"content": "", "thinking": "planning"}},
            {"message": {"content": "", "tool_calls": [{"id": "c1", "function": {"name": "fs.read", "arguments": json.dumps({"path": "a"})}}]}},
            {"done": True},
        ]), "m"))
        joined = "".join(events)
        thinking_at = joined.index('"type": "thinking"')
        tool_at = joined.index('"type": "tool_use"')
        self.assertLess(thinking_at, tool_at)
        between = joined[thinking_at:tool_at]
        self.assertIn("content_block_stop", between)
        self.assertIn('"index": 0, "content_block": {"type": "thinking"', joined)
        self.assertIn('"index": 1, "content_block": {"type": "tool_use"', joined)

    def test_two_tool_calls_get_distinct_ids(self):
        events = list(anthropic.stream_from_ollama(self.frames([
            {"message": {"content": "", "tool_calls": [
                {"function": {"name": "fs.read", "arguments": json.dumps({"path": "a"})}},
                {"function": {"name": "fs.list", "arguments": json.dumps({"path": "."})}},
            ]}},
            {"done": True},
        ]), "m"))
        ids = [json.loads(line[len("data: "):])["content_block"]["id"]
               for line in "".join(events).splitlines()
               if line.startswith("data: ") and '"type": "tool_use"' in line]
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(set(ids)), 2, "tool_use ids must be unique: %r" % (ids,))


if __name__ == "__main__":
    unittest.main()

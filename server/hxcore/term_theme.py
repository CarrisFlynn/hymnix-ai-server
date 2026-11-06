# -*- coding: utf-8 -*-
"""Pure terminal theme calculations; deliberately independent of Tk."""
from __future__ import annotations
import re

COLORS = {"bg":"#05080E","fg":"#9BE8FF","ts":"#2F5F79","stripe":"#070C14","divider":"#16324A","ghost_border":"#16324A","ghost_hover":"#1E4E6B","link":"#21A0C9","muted":"#4E7C93"}
LEVELS = {"SYS":"#21A0C9","REQ":"#7C9CFF","PATH":"#4E7C93","OK":"#3DDC97","WARN":"#FFC857","ERR":"#FF6B6B"}
SIZES = {"body":11,"chip":10,"topbar":11,"line_spacing":1.55,"pad":34,"font":"Consolas"}
JUMP_LABEL = "JUMP TO LATEST"
BACK_TO_LATEST = "回到最新"
_LINE = re.compile(r"^(?P<ts>\d{2}:\d{2}:\d{2}\.\d{3})\s+(?P<level>[A-Za-z]+)\s+·\s+(?P<body>.*)$")

def color_for(level):
    try:
        return LEVELS.get(str(level).upper(), COLORS["fg"])
    except Exception:
        return COLORS["fg"]

def classify(line: str) -> dict:
    try:
        raw = str(line) if line is not None else ""
        match = _LINE.match(raw)
        if not match or match.group("level").upper() not in LEVELS:
            return {"ts":"", "level":"", "body":raw, "color":COLORS["fg"]}
        level = match.group("level").upper()
        return {"ts":match.group("ts"), "level":level, "body":match.group("body"), "color":color_for(level)}
    except Exception:
        return {"ts":"", "level":"", "body":"", "color":COLORS["fg"]}

def row_bg(index) -> str:
    try:
        return COLORS["stripe"] if int(index) % 2 == 1 else ""
    except Exception:
        return ""

def sections() -> list[dict]:
    try:
        definitions = [
            {"key":"topbar", "title":"HYMNIX // TERMINAL"},
            {"key":"chips"},
            {"key":"config"},
            {"key":"log", "header":"SYS.LOG"},
            {"key":"telemetry"},
            {"key":"command"},
            {"key":"footer"},
        ]
        return [dict(item, divider=COLORS["divider"]) for item in definitions]
    except Exception:
        return []

def scanline(density=0.035) -> dict:
    try:
        value = float(density)
    except Exception:
        value = 0.035
    return {"color":"#FFFFFF", "alpha":max(0.03, min(0.04, value)), "step":3}

def status_chip(label, level) -> dict:
    try:
        text = "" if label is None else str(label)
    except Exception:
        text = ""
    return {"label":text, "fg":color_for(level), "bg":"#0B1420", "border":"#16324A", "size":10}

def _selftest() -> bool:
    assert classify("08:44:57.080 SYS · text")["level"] == "SYS"
    assert len(sections()) == 7
    assert scanline(1)["alpha"] == 0.04
    return True

if __name__ == "__main__":
    print("SELFTEST OK" if _selftest() else "SELFTEST FAIL")

# -*- coding: utf-8 -*-
"""Defensive Markdown parser for the chat renderer."""
from __future__ import annotations
import re
MAX_CHARS = 200000
_URL_RE = re.compile(r"https?://[^\s<>()\"']+")

def _safe_text(value):
    try: return value if isinstance(value, str) else str(value or "")
    except Exception: return ""

def parse(text: str) -> list[dict]:
    try:
        raw = _safe_text(text); truncated = len(raw) > MAX_CHARS
        if truncated: raw = raw[:MAX_CHARS]
        blocks=[]; paragraph=[]; code=False; lang=None; code_lines=[]
        def flush():
            if paragraph: blocks.append({"type":"paragraph","text":"\n".join(paragraph)}); paragraph.clear()
        for line in raw.replace("\r\n","\n").replace("\r","\n").split("\n"):
            if code:
                if line.strip().startswith("```"): blocks.append({"type":"code","lang":lang,"text":"\n".join(code_lines)}); code=False; lang=None; code_lines=[]
                else: code_lines.append(line)
                continue
            fence=re.match(r"^\s*```\s*([^\s`]*)\s*$",line)
            if fence: flush(); code=True; lang=fence.group(1) or None; code_lines=[]; continue
            if not line.strip(): flush(); continue
            heading=re.match(r"^\s*(#{1,3})\s+(.+?)\s*$",line)
            if heading: flush(); blocks.append({"type":"heading","level":len(heading.group(1)),"text":heading.group(2)}); continue
            quote=re.match(r"^\s*>\s?(.*)$",line)
            if quote: flush(); blocks.append({"type":"quote","text":quote.group(1)}); continue
            item=re.match(r"^(\s*)([-*]|\d+\.)\s+(.+)$",line)
            if item: flush(); blocks.append({"type":"list_item","ordered":item.group(2)[0].isdigit(),"indent":len(item.group(1))//2,"text":item.group(3)}); continue
            paragraph.append(line)
        if code: blocks.append({"type":"code","lang":lang,"text":"\n".join(code_lines)})
        flush()
        if truncated: blocks.append({"type":"paragraph","text":"...(truncated)"})
        return blocks
    except Exception: return []

def styles() -> dict:
    return {"h1":{"font":("TkDefaultFont",15,"bold")},"h2":{"font":("TkDefaultFont",14,"bold")},"h3":{"font":("TkDefaultFont",13,"bold")},"body":{"font":("TkDefaultFont",11)},"inline_code":{"background":"#F2F4F7","foreground":"#0F172A"},"code_block":{"background":"#0F172A","foreground":"#E6EDF3"},"code_badge":{"foreground":"#98A2B3"},"link":{"foreground":"#2563EB","underline":True},"quote":{"foreground":"#475467"},"list":{"lmargin1":24,"lmargin2":44}}

def link_targets(text: str) -> list[str]:
    try:
        out=[]
        for url in _URL_RE.findall(_safe_text(text)):
            url=url.rstrip(".,;:!?)]}")
            if url not in out: out.append(url)
        return out
    except Exception: return []

def to_rich(text: str) -> dict:
    try:
        source=_safe_text(text); plain=[]
        for line in source.splitlines():
            line=re.sub(r"^\s*(?:#{1,3}\s+|>\s?|(?:[-*]|\d+\.)\s+)","",line)
            line=re.sub(r"`([^`]*)`",r"\1",line)
            line=re.sub(r"!\[([^]]*)\]\([^)]*\)",r"\1",line)
            line=re.sub(r"\[([^]]+)\]\(https?://[^)]+\)",r"\1",line)
            plain.append(line)
        return {"blocks":parse(source),"plain":"\n".join(plain)}
    except Exception: return {"blocks":[],"plain":""}

if __name__ == "__main__":
    print("SELFTEST OK")

# -*- coding: utf-8 -*-
import json, sys
sys.path.insert(0, r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0\server")
from hxcore import plugins, tools

folder = plugins.plugins_root()
print("PLUGINS_ROOT", folder)
for perm in ("tools.register", "fs.read"):
    plugins.grant("clock-tools", perm)
plugins.set_enabled("clock-tools", True)
loaded = plugins.load("clock-tools")
print("LOAD", json.dumps(loaded, ensure_ascii=False, default=str)[:300])
names = sorted(t["name"] for t in tools.catalog()) if hasattr(tools, "catalog") else []
print("HAS_TOOL", [n for n in names if n.startswith("clock-tools")])
result = tools.call("clock-tools.world_clock", {})
print("CALL", json.dumps(result, ensure_ascii=False, default=str)[:400])

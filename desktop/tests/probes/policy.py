import sys
sys.path.insert(0, ".")
import gateway_core as g
from hxcore import tools
tools.builtin_tools()
for name in ("patch.apply", "web.fetch"):
    print(name, g._tool_policy_allows("workspace", name)[0])
tools.register("someplugin.do_thing", "demo", {"type": "object", "properties": {}}, lambda a: {"ok": True})
print("plugin", g._tool_class("someplugin.do_thing"), g._tool_policy_allows("workspace", "someplugin.do_thing")[0])
print("unknown", g._tool_class("not.a.tool"), g._tool_policy_allows("workspace", "not.a.tool")[0])

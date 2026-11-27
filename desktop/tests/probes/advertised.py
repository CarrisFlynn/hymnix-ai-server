import json, sys
sys.path.insert(0, ".")
import gateway_core as g
from hxcore import tools
tools.builtin_tools()
names = json.load(open(sys.argv[1], encoding="utf-8"))
denied = []
for name in names:
    ok, why = g._tool_policy_allows("workspace", name)
    if not ok:
        denied.append(name + ":" + why)
print("DENIED " + json.dumps(denied))
print("CHECKED " + str(len(names)))

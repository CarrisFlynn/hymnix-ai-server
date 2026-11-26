import sys
sys.path.insert(0, r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0\server")
from hxcore.mcp import _mcp_command_allowed as ok
cases = [
    (["npx", "-y", "@modelcontextprotocol/server-filesystem", "."], True),
    (["python", "-m", "some_server"], True),
    (["npx", "-y", "x", ";", "rm", "-rf", "/"], False),
    (["C:\\Windows\\System32\\cmd.exe", "/c", "dir"], False),
    (["sh", "-c", "echo hi"], False),
    (["npx", "-y", "x$(whoami)"], False),
]
bad = [(c, e, ok(c)) for c, e in cases if ok(c) != e]
print("MCP_CASES", len(cases), "FAILED", bad)

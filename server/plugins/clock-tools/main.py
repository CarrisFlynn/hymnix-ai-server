def on_load(api):
    api["register_tool"]("world_clock", lambda: {"utc": "available through host adapter"})

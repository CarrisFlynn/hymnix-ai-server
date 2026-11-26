# -*- coding: utf-8 -*-
import json, os, sys, tempfile
ROOT = r"C:\Users\xiaoy\Desktop\Hymnix AI 1.4.0"
data = tempfile.mkdtemp(prefix="hx-save-")
json.dump({"api_key": "K", "admin_key": "A", "trust_proxy_headers": False},
          open(os.path.join(data, "gateway_config.json"), "w", encoding="utf-8"))
os.environ["HYMNIX_DATA_DIR"] = data
sys.path.insert(0, os.path.join(ROOT, "server"))
import gateway_core
gateway_core.CFG["trust_proxy_headers"] = True
gateway_core._save_cfg()
saved = json.load(open(os.path.join(data, "gateway_config.json"), encoding="utf-8"))
print("SAVE_CFG", saved.get("trust_proxy_headers") is True, "path_ok", gateway_core.CONFIG_PATH.startswith(data))

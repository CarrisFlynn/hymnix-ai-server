import importlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
import urllib.request


SERVER = Path(__file__).resolve().parents[1]


class ManagedGatewayTests(unittest.TestCase):
    def test_headless_reports_bound_port_and_exits_on_stop_marker(self):
        with tempfile.TemporaryDirectory() as root, socket.socket() as upstream:
            # Hold an upstream port open without serving Ollama, to exercise independent gateway startup.
            upstream.bind(("127.0.0.1", 0))
            control = Path(root, "control")
            control.mkdir()
            data = Path(root, "data")
            data.mkdir()
            config_path = data / "gateway_config.json"
            config_path.write_text(json.dumps({"listen_host": "0.0.0.0", "listen_port": 11435,
                                               "upstream_port": upstream.getsockname()[1]}), encoding="utf-8")
            plugin_root = Path(root, "plugins")
            env = {**os.environ, "HYMNIX_DESKTOP_CONTROL_DIR": str(control), "HYMNIX_DATA_DIR": str(data),
                   "HYMNIX_PLUGINS_DIR": str(plugin_root),
                   "HYMNIX_LISTEN_HOST": "0.0.0.0", "HYMNIX_LISTEN_PORT": "11435"}
            with subprocess.Popen([sys.executable, str(SERVER / "headless_gateway.py")], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as child:
                try:
                    ready = control / "ready.json"
                    deadline = time.monotonic() + 8
                    while not ready.exists() and child.poll() is None and time.monotonic() < deadline:
                        time.sleep(0.05)
                    self.assertTrue(ready.exists(), "headless launch did not publish its bound port")
                    payload = json.loads(ready.read_text(encoding="utf-8"))
                    config = json.loads(config_path.read_text(encoding="utf-8"))
                    self.assertEqual(config["listen_host"], "0.0.0.0")
                    self.assertEqual(config["listen_port"], 11435)
                    base = "http://127.0.0.1:%d" % payload["port"]
                    with urllib.request.urlopen(base + "/health", timeout=3) as response:
                        health = json.load(response)
                    self.assertTrue(health["ok"])
                    self.assertEqual(health["gateway"], payload["version"])
                    self.assertFalse(health["ollama"])
                    req = urllib.request.Request(base + "/admin/ollama", data=b'{"action":"status"}',
                                                 headers={"X-Admin-Key": config["admin_key"]})
                    with urllib.request.urlopen(req, timeout=3) as response:
                        self.assertEqual(json.load(response), {"ok": True, "online": False, "ready": False, "models": 0})
                    with self.assertRaises(urllib.error.HTTPError) as unauthorized:
                        urllib.request.urlopen(base + "/admin/plugins", timeout=3)
                    self.assertEqual(unauthorized.exception.code, 401)
                    unauthorized.exception.close()
                    source = Path(root, "plugin-source")
                    source.mkdir()
                    (source / "plugin.json").write_text(json.dumps({
                        "schema_version": 1, "id": "test-plugin", "name": "Test plugin", "version": "1.0.0",
                        "apiVersion": "1", "entry": "main.py", "capabilities": ["hook"],
                        "permissions": ["ui.toast"], "description": "Gateway API smoke test"
                    }), encoding="utf-8")
                    (source / "main.py").write_text('def on_load(api):\n    api["toast"]("loaded")\n', encoding="utf-8")
                    def plugin_request(action, **values):
                        body = json.dumps({"action": action, **values}).encode("utf-8")
                        request = urllib.request.Request(base + "/admin/plugins", data=body,
                            headers={"X-Admin-Key": config["admin_key"], "Content-Type": "application/json"})
                        with urllib.request.urlopen(request, timeout=3) as response:
                            return json.load(response)
                    installed = plugin_request("install", source=str(source))
                    self.assertTrue(installed["ok"], installed)
                    with urllib.request.urlopen(urllib.request.Request(base + "/admin/plugins",
                            headers={"X-Admin-Key": config["admin_key"]}), timeout=3) as response:
                        catalog = json.load(response)
                    plugin = next(item for item in catalog["plugins"] if item["id"] == "test-plugin")
                    self.assertFalse(plugin["enabled"])
                    self.assertNotIn("path", plugin, "plugin API must not expose local filesystem paths")
                    self.assertTrue(plugin_request("grant", id="test-plugin", permission="ui.toast")["ok"])
                    enabled = plugin_request("enable", id="test-plugin")
                    self.assertTrue(enabled["ok"], enabled)
                    self.assertTrue(enabled["loaded"])
                    revoked = plugin_request("revoke", id="test-plugin", permission="ui.toast")
                    self.assertTrue(revoked["ok"])
                    with urllib.request.urlopen(urllib.request.Request(base + "/admin/plugins",
                            headers={"X-Admin-Key": config["admin_key"]}), timeout=3) as response:
                        plugin = next(item for item in json.load(response)["plugins"] if item["id"] == "test-plugin")
                    self.assertFalse(plugin["enabled"], "revoking a permission must disable the plugin")
                    self.assertFalse(plugin["loaded"], "revoking a permission must unload the plugin")
                    self.assertTrue(plugin_request("uninstall", id="test-plugin")["ok"])
                finally:
                    (control / "stop").touch()
                    try:
                        exit_code = child.wait(timeout=4)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        raise
                self.assertEqual(exit_code, 0)
                with self.assertRaises(OSError):
                    urllib.request.urlopen(base + "/health", timeout=1)


class OllamaStartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.data.cleanup)
        with patch.dict(os.environ, {"HYMNIX_DATA_DIR": cls.data.name}):
            sys.path.insert(0, str(SERVER))
            try:
                cls.gateway = importlib.import_module("gateway_core")
            finally:
                sys.path.remove(str(SERVER))

    def setUp(self):
        self.gateway.GATEWAY_STOPPING.clear()
        self.gateway.OLLAMA_STATE["proc"] = None
        self.addCleanup(self.gateway.GATEWAY_STOPPING.clear)

    def test_reuses_healthy_external_ollama_with_no_models(self):
        with patch.object(self.gateway, "_ollama_version", return_value="0.8.0"), \
                patch.object(self.gateway, "_ollama_models", return_value=[]), \
                patch.object(self.gateway.subprocess, "Popen") as spawn:
            self.assertEqual(self.gateway._start_ollama(), {"ok": True, "online": True, "ready": True, "models": 0})
            spawn.assert_not_called()

    def test_waits_for_version_endpoint_after_spawn(self):
        proc = Mock(pid=1234, poll=Mock(return_value=None))
        with patch.object(self.gateway.subprocess, "run") as stop_tree, \
                patch.object(self.gateway, "_ollama_version", side_effect=["", "", "0.8.0"]), \
                patch.object(self.gateway, "_ollama_models", return_value=["model"]), \
                patch.object(self.gateway, "_find_ollama", return_value="ollama"), \
                patch.object(self.gateway, "OLLAMA_PROBE_INTERVAL", 0.001), \
                patch.object(self.gateway.subprocess, "Popen", return_value=proc) as spawn:
            self.assertEqual(self.gateway._start_ollama(), {"ok": True, "online": True, "ready": True, "models": 1})
            self.assertEqual(spawn.call_args.args[0], ["ollama", "serve"])
            self.assertIs(self.gateway.OLLAMA_STATE["proc"], proc)
            self.gateway._stop_owned_ollama()
            if os.name == "nt":
                self.assertEqual(stop_tree.call_args.args[0], ["taskkill.exe", "/PID", "1234", "/T", "/F"])
            else:
                stop_tree.assert_not_called()
            proc.terminate.assert_called_once()
            self.assertIsNone(self.gateway.OLLAMA_STATE["proc"])

    def test_missing_install_and_early_exit_report_distinct_failures(self):
        with patch.object(self.gateway, "_ollama_version", return_value=""), \
                patch.object(self.gateway, "_find_ollama", return_value=None):
            missing = self.gateway._start_ollama()
        self.assertFalse(missing["ready"])
        self.assertEqual(missing["code"], "ollama_not_installed")
        proc = Mock(poll=Mock(return_value=42))
        with patch.object(self.gateway, "_ollama_version", return_value=""), \
                patch.object(self.gateway, "_find_ollama", return_value="ollama"), \
                patch.object(self.gateway.subprocess, "Popen", return_value=proc):
            early_exit = self.gateway._start_ollama()
        self.assertFalse(early_exit["ok"])
        self.assertEqual(early_exit["code"], "ollama_exited")
        self.assertIn("42", early_exit["detail"])

    def test_timeout_reports_failure_and_retry_reuses_running_process(self):
        proc = Mock(poll=Mock(return_value=None))
        self.gateway.OLLAMA_STATE["proc"] = proc
        with patch.object(self.gateway, "_ollama_version", return_value=""), \
                patch.object(self.gateway, "OLLAMA_START_TIMEOUT", 0.01), \
                patch.object(self.gateway.subprocess, "Popen") as spawn:
            result = self.gateway._start_ollama()
            spawn.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertFalse(result["online"])
        self.assertEqual(result["code"], "ollama_start_timeout")

    def test_invalid_version_response_is_not_ready(self):
        for payload in ({}, {"version": " "}, {"version": 42}, ["0.8.0"]):
            with self.subTest(payload=payload), patch.object(self.gateway, "upstream_json", return_value=(200, payload)):
                self.assertEqual(self.gateway._ollama_version(), "")

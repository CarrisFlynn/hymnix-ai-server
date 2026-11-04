# -*- coding: utf-8 -*-
"""Hymnix Client —— 独立的远程对话客户端（只负责连接与聊天）"""
import json
import os
import queue
import re
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox

import requests

APP_NAME = "Hymnix"
APP_VER = "1.0.0"

DEFAULT_SERVER = "http://127.0.0.1:11435/v1"
DEFAULT_KEY = ""
DEFAULT_MODEL = ""   # empty = use the first model installed on the server



# ==================== Language / 语言 ====================
ZH2EN = {
    "终端 · 轨迹": "Terminal · Trace",
    "服务端监控": "Server Monitor",
    "API 接口": "API",
    "插件": "Plugins",
    "就绪": "Ready",
    "网关": "Gateway",
    "隧道": "Tunnel",
    "模型": "Model",
    "公网地址": "Public address",
    "在线客户端": "Clients online",
    "复制地址": "Copy address",
    "看监控": "Open monitor",
    "启动隧道": "Start tunnel",
    "停止隧道": "Stop tunnel",
    "分配中…": "Allocating...",
    "建立中…": "Starting...",
    "刷新模型": "Refresh models",
    "下载模型": "Download models",
    "启动服务": "Start service",
    "停止服务": "Stop service",
    "模型管理": "Manage models",
    "保存": "Save",
    "加载": "Load",
    "清空": "Clear",
    "导出": "Export",
    "发送": "Send",
    "设置": "Settings",
    "清理历史…": "Clean up history...",
    "客户端连接": "Clients",
    "对话记录（点一条看完整内容）": "Conversations (click a row for details)",
    "全部": "All",
    "今天": "Today",
    "最近1小时": "Last hour",
    "全部IP": "All IPs",
    "关键词": "Keyword",
    "插件与能力": "Plugins & capabilities",
    "模型接口": "Model API",
    "在线": "Online",
    "离线": "Offline",
    "已就绪": "Ready",
    "未分配": "Not allocated",
    "分配中": "Allocating",
    "连接设置": "Connection settings",
    "服务器地址": "Server URL",
    "连接密钥": "API key",
    "从剪贴板填入": "Paste from clipboard",
    "刷新模型列表": "Refresh model list",
    "已连接": "Connected",
    T("未连接", "Disconnected"): "Disconnected",
    "保存并应用": "Save and apply",
    "测试连接": "Test connection",
    "关闭": "Close",
    "输入消息…": "Type a message...",
    "对话": "Chat",
    "清屏": "Clear screen",
    "复制最后回复": "Copy last reply",
    "导出对话": "Export chat",
}


LANG = {"cur": "zh"}


def T(zh, en):
    return en if LANG["cur"] == "en" else zh


ZH2EN.update({
    "文件": "File",
    "工具": "Tools",
    "服务器": "Server",
    "帮助": "Help",
    "就绪": "Ready",
    "检测硬件": "Detect hardware",
    "应用": "Apply",
    "详情": "Details",
    "Chat历史": "Chat history",
    "对话历史": "Chat history",
    "计算设备 · 选 CPU 还是哪张显卡来算": "Compute device - CPU or GPU",
    "自动（由 Ollama 决定，推荐）": "Auto (decided by Ollama, recommended)",
})


def normalize_button_icons(root):
    """统一去掉按钮文字前面的图标符号，保证所有按钮文字居中对齐。"""
    ICON_RE = re.compile(r"[\s\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u2000-\u206F\u2600-\u27BF"
                         r"\U0001F300-\U0001FAFF]+")
    def walk(w):
        try:
            cls = w.winfo_class()
        except Exception:
            return
        if cls in ("TButton",):
            try:
                txt = str(w.cget("text") or "")
                clean = ICON_RE.sub("", txt).strip()
                if clean and clean != txt:
                    w.configure(text=clean)
            except Exception:
                pass
        try:
            for c in w.winfo_children():
                walk(c)
        except Exception:
            pass
    walk(root)


TERMS = {
    "网关": "Gateway", "隧道": "Tunnel", "模型": "Model", "客户端": "Client",
    "在线": "Online", "离线": "Offline", "未分配": "Not allocated", "已就绪": "Ready",
    "分配中": "Allocating", "启动": "Start", "停止": "Stop", "刷新": "Refresh",
    "下载": "Download", "上传": "Upload", "管理": "Manage", "保存": "Save",
    "加载": "Load", "清空": "Clear", "导出": "Export", "设置": "Settings",
    "帮助": "Help", "关于": "About", "历史": "History", "记录": "Records",
    "请求": "Requests", "对话": "Chat", "服务": "Service", "延迟": "Latency",
    "耗时": "Time", "显存": "VRAM", "内存": "RAM", "显卡": "GPU", "功耗": "Power",
    "能耗": "Energy", "状态": "Status", "清理": "Clean up", "删除": "Delete",
    "取消": "Cancel", "确定": "OK", "关闭": "Close", "提示": "Notice",
    "错误": "Error", "成功": "Success", "失败": "Failed", "重试": "Retry",
    "重启": "Restart", "上传附件": "Attach", "发送": "Send", "复制": "Copy",
    "监控": "Monitor", "接口": "API", "插件": "Plugins", "语言": "Language",
    "高级": "Advanced", "基础": "Basic", "默认": "Default", "自动": "Auto",
    "正在": "Working:", "完成": "Done", "进行中": "In progress", "已连接": "Connected",
    "未连接": "Disconnected", "可用": "Available", "不可用": "Unavailable",
    "选择": "Select", "浏览": "Browse", "编辑": "Edit", "添加": "Add",
}

def _en_text(value):
    if not isinstance(value, str) or not value.strip():
        return value
    key = value.strip()
    if key in ZH2EN:
        out = ZH2EN[key]
        prefix = value[:len(value) - len(value.lstrip())]
        return prefix + out
    out = value
    for zh in sorted(TERMS, key=len, reverse=True):
        if zh in out:
            out = out.replace(zh, TERMS[zh])
    return out


def install_runtime_i18n():
    """Install global hooks so dynamically generated strings are translated too."""
    try:
        import tkinter as _tk
        if not getattr(_tk.StringVar, "_hymnix_patched", False):
            _orig_set = _tk.StringVar.set

            def _set(self, value):
                if LANG.get("cur") == "en":
                    try:
                        value = _en_text(value)
                    except Exception:
                        pass
                return _orig_set(self, value)

            _tk.StringVar.set = _set
            _tk.StringVar._hymnix_patched = True
    except Exception:
        pass
    try:
        from tkinter import messagebox as _mb
        for _name in ("showinfo", "showwarning", "showerror", "askyesno"):
            _orig = getattr(_mb, _name)

            def _wrap(orig):
                def _fn(title=None, message=None, **kw):
                    if LANG.get("cur") == "en":
                        title = _en_text(title) if isinstance(title, str) else title
                        message = _en_text(message) if isinstance(message, str) else message
                    return orig(title, message, **kw)
                return _fn

            setattr(_mb, _name, _wrap(_orig))
    except Exception:
        pass


def detect_language(cfg):
    lang = str((cfg or {}).get("language") or "").strip().lower()
    if lang in ("zh", "en"):
        return lang
    try:
        import locale
        loc = (locale.getdefaultlocale()[0] or "").lower()
    except Exception:
        loc = ""
    return "zh" if loc.startswith("zh") else "en"




def apply_menu_language(menu, memo, mapping=None):
    """翻译 tk.Menu（含级联子菜单）"""
    if menu is None:
        return
    mapping = ZH2EN if mapping is None else mapping
    try:
        end = menu.index("end")
    except Exception:
        return
    if end is None:
        return
    for i in range(end + 1):
        try:
            kind = menu.type(i)
        except Exception:
            continue
        if kind in ("command", "cascade", "checkbutton", "radiobutton"):
            try:
                label = str(menu.entrycget(i, "label"))
            except Exception:
                continue
            key = ("menu", id(menu), i)
            if mapping is not None:
                if key not in memo:
                    memo[key] = label
                out = memo[key]
                for zh in sorted(mapping, key=len, reverse=True):
                    if zh in out:
                        out = out.replace(zh, mapping[zh])
                if out == memo[key]:
                    out = _en_text(memo[key])
                if out != memo[key]:
                    try:
                        menu.entryconfigure(i, label=out)
                    except Exception:
                        pass
            elif key in memo:
                try:
                    menu.entryconfigure(i, label=memo[key])
                except Exception:
                    pass
        if kind == "cascade":
            try:
                apply_menu_language(menu.nametowidget(menu.entrycget(i, "menu")), memo, mapping)
            except Exception:
                pass


def apply_zh2en(widget, memo, mapping=None):
    """把界面里已知的中文文案换成英文；memo 保存原文用于切回。mapping None=恢复中文"""
    mapping = ZH2EN if mapping is None else mapping
    try:
        cls = widget.winfo_class()
    except Exception:
        return
    try:
        if cls in ("Label", "Button", "Checkbutton", "Radiobutton", "TLabel", "TButton",
                   "TCheckbutton", "TRadiobutton", "TLabelframe"):
            cur = str(widget.cget("text"))
            key = ("text", id(widget))
            if mapping is not None:
                if key not in memo:
                    memo[key] = cur
                orig = memo[key]
                out = orig
                for _zh in sorted(mapping, key=len, reverse=True):
                    if _zh in out:
                        out = out.replace(_zh, mapping[_zh])
                if out == orig:
                    out = _en_text(orig)
                if out != orig:
                    widget.configure(text=out)
            elif key in memo:
                widget.configure(text=memo[key])
    except Exception:
        pass
    try:
        if cls == "TNotebook":
            n = widget.index("end")
            key = ("tabs", id(widget))
            if mapping is not None:
                if key not in memo:
                    memo[key] = [widget.tab(i, "text") for i in range(n)]
                orig = memo[key]
                for i, txt in enumerate(orig[:n]):
                    new = mapping.get(txt.strip())
                    if new:
                        widget.tab(i, text=txt.replace(txt.strip(), new))
            elif key in memo:
                for i, txt in enumerate(memo[key]):
                    if i < n:
                        widget.tab(i, text=txt)
    except Exception:
        pass
    try:
        if cls == "Treeview":
            cols = widget["columns"]
            key = ("tree", id(widget))
            if mapping is not None:
                if key not in memo:
                    memo[key] = {c: str(widget.heading(c)["text"]) for c in cols}
                for c in cols:
                    orig = memo[key].get(c, "")
                    if orig in mapping:
                        widget.heading(c, text=mapping[orig])
            elif key in memo:
                for c in cols:
                    widget.heading(c, text=memo[key].get(c, ""))
    except Exception:
        pass
    try:
        if cls == "TCombobox":
            key = ("combo", id(widget))
            if mapping is not None:
                vals = [str(v) for v in widget["values"]]
                if key not in memo:
                    memo[key] = vals
                new = [mapping.get(v, v) for v in memo[key]]
                widget.configure(values=new)
            elif key in memo:
                widget.configure(values=memo[key])
    except Exception:
        pass
    try:
        for child in widget.winfo_children():
            apply_zh2en(child, memo, mapping)
    except Exception:
        pass

def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


APP_DIR = app_dir()


def data_dir():
    """可写数据目录：环境变量 > %LOCALAPPDATA%\\Hymnix > exe 同目录（兜底）"""
    env = os.environ.get("HYMNIX_DATA_DIR")
    if env:
        try:
            os.makedirs(env, exist_ok=True)
            return env
        except Exception:
            pass
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "Hymnix")
    try:
        os.makedirs(d, exist_ok=True)
        return d
    except Exception:
        return APP_DIR


DATA_DIR = data_dir()
CONFIG_PATH = os.path.join(DATA_DIR, "hymnix_client.json")
ICON_PATH = os.path.join(getattr(sys, "_MEIPASS", APP_DIR), "icon.ico")

FACTORY = {
    "server_url": DEFAULT_SERVER,
    "api_key": DEFAULT_KEY,
    "model": DEFAULT_MODEL,
    "user_name": "您",
    "ai_name": "Hymnix",
    "system_prompt": (
        "你是 Hymnix，一个运行在服务器主人本机 qwen3:8b 上的中文 AI 助手。\n"
        "说话自然、简洁；不确定就说不确定，不要编造。默认用简体中文回答。"
    ),
}


def load_cfg():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                c = json.load(f)
            for k, v in FACTORY.items():
                c.setdefault(k, v)
            return c
        except Exception:
            pass
    c = dict(FACTORY)
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return c


CFG = load_cfg()


class ClientApp(tk.Tk):
    def __init__(self, selftest=False):
        super().__init__()
        self.selftest = selftest
        self.title("%s %s" % (APP_NAME, APP_VER))
        self.geometry("760x640")
        self.minsize(600, 480)
        self.configure(bg="#F4F5F3")
        try:
            self.iconbitmap(ICON_PATH)
        except Exception:
            pass

        self.connected = False
        self.latency = 0
        self.models = []
        self.busy = False
        self.history = []
        self.q = queue.Queue()
        self._reply_parts = []
        self._first_token_at = None

        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self.destroy)
        threading.Thread(target=self._probe_loop, daemon=True).start()
        threading.Thread(target=self._poll_models, daemon=True).start()
        try:
            self._lang_memo = {}
            if not CFG.get("language"):
                CFG["language"] = detect_language(CFG)
            self._lang = detect_language(CFG)
            LANG["cur"] = self._lang
            if self._lang == "en":
                apply_zh2en(self, self._lang_memo)
                try:
                    apply_menu_language(self.nametowidget(self["menu"]), self._lang_memo)
                except Exception:
                    pass
                self.after(1500, lambda: apply_zh2en(self, self._lang_memo))
        except Exception:
            pass
        self.after(6000, self._poll_inbox)
        try:
            normalize_button_icons(self)
        except Exception:
            pass
        self.after(60, self._drain)
        if selftest:
            self.withdraw()
            self.after(2500, self._selftest_send)

    # ---------- UI ----------
    def _build_ui(self):
        style = ttk.Style(self)
        try:
            style.theme_use("vista")
        except Exception:
            pass
        style.configure(".", font=("Microsoft YaHei UI", 10))

        top = ttk.Frame(self, padding=(14, 10, 14, 6))
        top.pack(fill="x")
        ttk.Label(top, text="Hymnix", font=("Microsoft YaHei UI", 16, "bold")).pack(side="left")
        self.dot = tk.Label(top, text="", fg="#9A6B12", bg="#F4F5F3", font=("Microsoft YaHei UI", 12))
        self.dot.pack(side="left", padx=(10, 4))
        self.var_state = tk.StringVar(value="连接中…")
        ttk.Label(top, textvariable=self.var_state, foreground="#71757C").pack(side="left")
        self.var_model = tk.StringVar(value=CFG["model"])
        ttk.Combobox(top, textvariable=self.var_model, values=[CFG["model"]], width=18,
                     state="readonly").pack(side="right")
        ttk.Button(top, text="设置", command=self.open_settings).pack(side="right", padx=(0, 8))

        self.chat = scrolledtext.ScrolledText(
            self, wrap="word", font=("Microsoft YaHei UI", 11), bg="#FCFCFB",
            fg="#23252A", relief="flat", padx=12, pady=10, state="disabled")
        self.chat.pack(fill="both", expand=True, padx=14, pady=(0, 8))
        self.chat.tag_config("user", foreground="#2F6BD8", font=("Microsoft YaHei UI", 11, "bold"))
        self.chat.tag_config("assistant", foreground="#1F2A37", font=("Microsoft YaHei UI", 11))
        self.chat.tag_config("system", foreground="#8A9099", font=("Microsoft YaHei UI", 9))

        bottom = ttk.Frame(self, padding=(14, 0, 14, 12))
        bottom.pack(fill="x")
        self.var_input = tk.StringVar()
        entry = tk.Entry(bottom, textvariable=self.var_input, font=("Microsoft YaHei UI", 11),
                         relief="flat", bg="#FCFCFB", fg="#23252A", insertbackground="#23252A")
        entry.pack(side="left", fill="x", expand=True, ipady=8, padx=(0, 8))
        entry.bind("<Return>", lambda e: self.send())
        self.entry = entry
        self.btn_send = ttk.Button(bottom, text="发送", command=self.send)
        self.btn_send.pack(side="left")

        self.var_hint = tk.StringVar(value="")
        ttk.Label(self, textvariable=self.var_hint, foreground="#8A9099").pack(anchor="w", padx=16, pady=(0, 8))

    # ---------- 网络 ----------
    def base(self):
        return CFG["server_url"].rstrip("/")

    def headers(self):
        return {"Authorization": "Bearer" + CFG["api_key"]}

    def _probe_loop(self):
        while True:
            t0 = time.time()
            try:
                r = requests.get(self.base() + "/health", timeout=6)
                d = r.json()
                ok = bool(d.get("ok")) and bool(d.get("ollama"))
                self.latency = int((time.time() - t0) * 1000)
                self._set_state(ok, T("已连接 · %d ms", "Connected · %d ms") % self.latency if ok else T("服务器模型未就绪", "Server model not ready"))
            except Exception:
                self._set_state(False, T("未连接", "Disconnected"))
            time.sleep(5)

    def _set_state(self, ok, text):
        self.connected = ok

        def apply():
            self.var_state.set(text)
            self.dot.configure(fg="#2E7D5B" if ok else "#A33A32")
            if not ok:
                self.var_hint.set("连不上？确认服务器已开机运行；若地址已更新，点右上角「设置」，把主人发来的信息粘贴进去。")
            else:
                self.var_hint.set("")
        try:
            self.after(0, apply)
        except Exception:
            pass

    def _poll_models(self):
        try:
            r = requests.get(self.base() + "/api/tags", headers=self.headers(), timeout=10)
            if r.status_code == 200:
                names = [m.get("name") for m in r.json().get("models", []) if m.get("name")]
                self.models = names
                if names:
                    def apply():
                        w = self.nametowidget(self.var_model) if False else None
                        pass
                    self.after(0, lambda: self._apply_models(names))
        except Exception:
            pass

    def _apply_models(self, names):
        try:
            cb = getattr(self, "_settings_model_combo", None)
            if cb is not None:
                cb.configure(values=names)
        except Exception:
            pass
        if CFG["model"] not in names and names:
            CFG["model"] = DEFAULT_MODEL if DEFAULT_MODEL in names else names[0]
            self.var_model.set(CFG["model"])

    # ---------- 服务端消息 ----------
    def _poll_inbox(self):
        try:
            r = requests.get(self.base() + "/api/inbox", headers=self.headers(), timeout=4)
            if r.status_code == 200:
                for m in (r.json().get("messages") or []):
                    self._append("\n 服务端消息：" + str(m.get("text", "")) + "\n", "system")
        except Exception:
            pass
        self.after(5000, self._poll_inbox)

    # ---------- 对话 ----------
    def _append(self, text, tag="assistant"):
        self.chat.config(state="normal")
        self.chat.insert("end", text, tag)
        self.chat.see("end")
        self.chat.config(state="disabled")

    def send(self):
        text = self.var_input.get().strip()
        if not text or self.busy:
            return
        self.var_input.set("")
        self._append("你：" + text + "\n", "user")
        self.history.append({"role": "user", "content": text})
        self.busy = True
        self.btn_send.config(state="disabled")
        self.var_hint.set("正在思考…")
        threading.Thread(target=self._request, args=(list(self.history),), daemon=True).start()

    def _request(self, messages):
        payload = {
            "model": CFG["model"],
            "messages": [{"role": "system", "content": CFG["system_prompt"]}] + messages[-24:],
            "stream": True,
            "options": {"temperature": 0.7, "num_predict": 1024, "num_ctx": 8192},
        }
        self._reply_parts = []
        t0 = time.time()
        try:
            with requests.post(self.base() + "/api/chat", json=payload, stream=True,
                               headers=self.headers(), timeout=(15, 180)) as resp:
                if resp.status_code == 401:
                    self.q.put(("sys", "连接密钥无效，请在设置里检查。\n"))
                    return
                if resp.status_code != 200:
                    self.q.put(("sys", "服务器返回错误 %d\n" % resp.status_code))
                    return
                for line in resp.iter_lines(decode_unicode=True):
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    piece = (obj.get("message") or {}).get("content") or ""
                    if piece:
                        if self._first_token_at is None:
                            self._first_token_at = time.time()
                        self._reply_parts.append(piece)
                        self.q.put(("chunk", piece))
                    if obj.get("done"):
                        break
            answer = "".join(self._reply_parts)
            if answer:
                self.history.append({"role": "assistant", "content": answer})
                self.q.put(("sys", "\n· 用时 %.1fs\n\n" % (time.time() - t0)))
            else:
                self.q.put(("sys", "\n（没有收到内容）\n"))
        except requests.exceptions.ConnectionError:
            self.q.put(("sys", "连接失败：服务器不可达。\n"))
        except Exception as e:
            self.q.put(("sys", "请求异常：%s\n" % e))
        finally:
            self.q.put(("done", None))

    def _drain(self):
        try:
            while True:
                item = self.q.get_nowait()
                kind = item[0]
                if kind == "chunk":
                    self._append(item[1], "assistant")
                elif kind == "sys":
                    self._append(item[1], "system")
                elif kind == "done":
                    self.busy = False
                    self.btn_send.config(state="normal")
                    self.var_hint.set("")
                    self._append("\n", "assistant")
        except queue.Empty:
            pass
        self.after(60, self._drain)

    # ---------- 设置 / 自检 ----------
    def open_settings(self):
        win = tk.Toplevel(self)
        win.title("连接设置")
        win.geometry("520x310")
        win.transient(self)
        win.grab_set()
        ttk.Label(win, text="服务器地址").grid(row=0, column=0, sticky="w", padx=16, pady=10)
        v_url = tk.StringVar(value=CFG["server_url"])
        ttk.Entry(win, textvariable=v_url, width=46).grid(row=0, column=1, pady=10)
        ttk.Label(win, text="连接密钥").grid(row=1, column=0, sticky="w", padx=16)
        v_key = tk.StringVar(value=CFG["api_key"])
        ttk.Entry(win, textvariable=v_key, width=46, show="*").grid(row=1, column=1)
        ttk.Label(win, text="模型").grid(row=2, column=0, sticky="w", padx=16, pady=10)
        v_model = tk.StringVar(value=CFG["model"])
        cb_model = ttk.Combobox(win, textvariable=v_model, values=self.models or [CFG["model"]],
                                width=44)
        cb_model.grid(row=2, column=1, pady=10)
        self._settings_model_combo = cb_model

        def refresh_models():
            def worker():
                self._poll_models()
                names = list(self.models)
                self.after(0, lambda: cb_model.configure(values=names or [CFG["model"]])
                           or (not CFG["model"] and names and v_model.set(names[0])))
            threading.Thread(target=worker, daemon=True).start()

        ttk.Button(win, text="刷新模型列表", command=refresh_models).grid(row=2, column=2, padx=6)
        ttk.Label(win, text="语言 / Language").grid(row=3, column=0, sticky="w", padx=16, pady=6)
        v_lang = tk.StringVar(value="English" if detect_language(CFG) == "en" else "中文")
        ttk.Combobox(win, textvariable=v_lang, values=["中文", "English"],
                     state="readonly", width=42).grid(row=3, column=1, pady=6)
        msg = tk.StringVar(value="")
        ttk.Label(win, textvariable=msg, foreground="#2E7D5B").grid(row=4, column=0, columnspan=2)

        def import_clip():
            try:
                txt = self.clipboard_get()
            except Exception:
                msg.set("剪贴板里没有文本")
                return
            m = re.search(r"https?://[\s'\"]+", txt)
            if m:
                v_url.set(m.group(0).strip())
            m2 = re.search(r"(Hymnix[0-9A-Za-z]+)", txt)
            if m2:
                v_key.set(m2.group(1))
            m3 = re.search(r"(HymnixAdmin[0-9A-Za-z\-]+)", txt)
            msg.set("已从剪贴板填入，点保存生效")

        def save():
            CFG["server_url"] = v_url.get().strip().rstrip("/")
            CFG["api_key"] = v_key.get().strip()
            CFG["model"] = v_model.get().strip() or CFG["model"]
            CFG["language"] = "en" if v_lang.get() == "English" else "zh"
            try:
                with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                    json.dump(CFG, f, ensure_ascii=False, indent=2)
            except Exception as e:
                msg.set("保存失败：%s" % e)
                return
            msg.set("已保存（语言重启后生效）" if CFG.get("language") == "en" else "已保存（语言重启后生效）")
            self.var_model.set(CFG["model"])
            threading.Thread(target=self._poll_models, daemon=True).start()

        ttk.Button(win, text="从剪贴板填入", command=import_clip).grid(row=4, column=0, pady=14)
        ttk.Button(win, text="保存", command=save).grid(row=4, column=1, pady=14)

    def _selftest_send(self):
        self.var_input.set("这是一次连通性自检，请回复：连接正常。")
        self.send()
        self.after(20000, self._selftest_done)

    def _selftest_done(self):
        text = self.chat.get("1.0", "end")
        out = {"connected": self.connected, "latency_ms": self.latency,
               "models": self.models, "tail": text[-400:]}
        try:
            with open(os.path.join(APP_DIR, "selftest_result.json"), "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        self.destroy()


def main():
    selftest = "--selftest" in sys.argv
    app = ClientApp(selftest=selftest)
    app.mainloop()


if __name__ == "__main__":
    main()

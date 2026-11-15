# -*- coding: utf-8 -*-
"""更新对话框：检查 → 展示更新说明 → 下载(带进度/可取消) → 校验 → 覆盖重启。

只依赖标准库 + tkinter + 本项目的 updater 模块，不引入新依赖。
UI 走 ttk 命名样式（Primary.TButton / Secondary.TButton），缺样式时自动回退。
"""
import os
import sys
import threading
import webbrowser

import tkinter as tk
from tkinter import ttk, messagebox

try:
    import updater
except Exception:  # pragma: no cover
    updater = None
try:
    from hxcore import channels
except Exception:  # pragma: no cover
    channels = None


def _T(zh, en):
    try:
        import hymnix_main
        return hymnix_main.T(zh, en)
    except Exception:
        return zh


def _scale(widget):
    try:
        return max(1.0, min(3.0, float(widget.winfo_fpixels("1i")) / 96.0))
    except Exception:
        return 1.0


def _px(widget, value, minimum=1):
    return max(minimum, int(round(float(value) * _scale(widget))))


def _style_btn(btn, name):
    try:
        btn.configure(style=name)
    except Exception:
        pass


class UpdateDialog(tk.Toplevel):
    """一次性的更新流程窗口。"""

    def __init__(self, master, on_log=None):
        super().__init__(master)
        self.on_log = on_log
        self.result = None
        self._cancel = threading.Event()
        self._closed = False
        self._check_seq = 0
        self._verified_path = None

        self.title(_T("检查更新", "Check for updates"))
        self.transient(master)
        self.resizable(False, False)
        try:
            self.configure(bg="#FFFFFF")
        except Exception:
            pass

        self._scale_factor = _scale(self)
        available_width = max(_px(self, 240), min(_px(self, 460), self.winfo_screenwidth() - _px(self, 40)))
        self._available_width = available_width
        frm = ttk.Frame(self, style="Card.TFrame", padding=_px(self, 20))
        frm.pack(fill="both", expand=True)

        self.lbl_title = ttk.Label(frm, text=_T("正在检查更新…", "Checking for updates…"),
                                   style="H1.TLabel")
        self.lbl_title.pack(anchor="w")
        self.channel_var = tk.StringVar(value=self._current_channel())
        channel_row = ttk.Frame(frm, style="Card.TFrame")
        channel_row.pack(fill="x", pady=(6, 4))
        ttk.Label(channel_row, text=_T("更新通道", "Update channel")).pack(side="left")
        self.channel_box = ttk.Combobox(channel_row, state="readonly", width=12,
                                        values=("稳定 / Stable", "预览 / Preview"))
        self.channel_box.current(1 if self.channel_var.get() == "preview" else 0)
        self.channel_box.pack(side="right")
        self.channel_box.bind("<<ComboboxSelected>>", self._channel_changed)

        self.lbl_body = ttk.Label(frm, text=_T("正在连接 GitHub Releases", "Contacting GitHub Releases"),
                                  style="Caption.TLabel", wraplength=available_width, justify="left")
        self.lbl_body.pack(anchor="w", pady=(6, 12))

        self.bar = ttk.Progressbar(frm, mode="determinate", maximum=100, length=available_width)
        self.bar.pack(fill="x")

        self.lbl_progress = ttk.Label(frm, text="", style="Caption.TLabel")
        self.lbl_progress.pack(anchor="w", pady=(6, 0))

        btns = ttk.Frame(frm, style="Card.TFrame")
        btns.pack(fill="x", pady=(16, 0))
        self.btn_skip = ttk.Button(btns, text=_T("以后再说", "Later"), command=self._close)
        _style_btn(self.btn_skip, "Secondary.TButton")
        self.btn_skip.pack(side="right")
        self.btn_main = ttk.Button(btns, text=_T("关闭", "Close"), command=self._close)
        _style_btn(self.btn_main, "Ghost.TButton")
        self.btn_main.pack(side="right", padx=(0, _px(self, 8)))
        self.btn_link = ttk.Button(btns, text=_T("打开发布页", "Release page"),
                                   command=self._open_release)
        _style_btn(self.btn_link, "Ghost.TButton")

        self.geometry("+%d+%d" % (master.winfo_rootx() + _px(master, 120), master.winfo_rooty() + _px(master, 80)))
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.after(60, self._start)

    # ---------- helpers ----------
    def _current_channel(self):
        try:
            value = channels.get() if channels is not None else "stable"
            return value if value in ("stable", "preview") else "stable"
        except Exception:
            return "stable"

    def _channel_changed(self, _event=None):
        channel = "preview" if self.channel_box.current() == 1 else "stable"
        try:
            result = channels.set(channel) if channels is not None else {"ok": False}
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}
        if not result.get("ok"):
            self.channel_box.current(1 if self.channel_var.get() == "preview" else 0)
            self._set(body=_T("无法保存更新通道设置。", "Could not save update channel setting."))
            return
        self.channel_var.set(channel)
        self.result = None
        self._verified_path = None
        self._check_seq += 1
        self.btn_main.configure(state="disabled")
        self._set(_T("通道已更改", "Channel changed"),
                  _T("当前通道：%s", "Current channel: %s") % ("预览 / Preview" if channel == "preview" else "稳定 / Stable"), 0, "")
        self.after(0, self._start)

    def _log(self, text):
        if callable(self.on_log):
            try:
                self.on_log(text)
            except Exception:
                pass

    def _set(self, title=None, body=None, progress=None, ptext=None):
        if title is not None:
            self.lbl_title.configure(text=title)
        if body is not None:
            self.lbl_body.configure(text=body)
        if progress is not None:
            try:
                self.bar.stop()
            except Exception:
                pass
            self.bar.configure(mode="determinate")
            self.bar["value"] = max(0, min(100, progress))
        if ptext is not None:
            self.lbl_progress.configure(text=ptext)
        try:
            self.update_idletasks()
        except Exception:
            pass

    def _close(self):
        self._closed = True
        self._cancel.set()
        try:
            self.destroy()
        except Exception:
            pass

    def _open_release(self):
        url = (self.result or {}).get("html_url") or "https://github.com/CarrisFlynn/hymnix-ai-server/releases"
        try:
            webbrowser.open(url)
        except Exception:
            pass

    # ---------- flow ----------
    def _start(self):
        if updater is None:
            self._set(_T("更新模块不可用", "Updater unavailable"),
                      _T("找不到 updater.py，无法检查更新。", "updater.py is missing."), 0, "")
            self.btn_main.configure(text=_T("关闭", "Close"), command=self._close)
            return
        channel = self._current_channel()
        channel_label = "预览 / Preview" if channel == "preview" else "稳定 / Stable"
        self.btn_main.configure(state="disabled")
        self._set(progress=5, ptext=_T("当前版本 %s · 通道 %s" % (updater.get_current_version(), channel_label),
                                      "Current version %s · Channel %s" % (updater.get_current_version(), channel_label)))
        self._check_seq += 1
        seq = self._check_seq
        threading.Thread(target=self._check_worker, args=(seq, channel), daemon=True).start()

    def _check_worker(self, seq=None, channel=None):
        if seq is None:
            seq = self._check_seq
        if channel is None:
            channel = self._current_channel()
        try:
            info = updater.check_for_update(channel=channel)
        except Exception as e:  # pragma: no cover
            info = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if self._closed:
            return
        try:
            self.after(0, lambda: self._check_done(info, seq))
        except Exception:
            pass

    def _check_done(self, info, seq=None):
        if seq is not None and seq != self._check_seq:
            return
        try:
            self.btn_main.configure(state="normal")
        except Exception:
            pass
        self.result = info
        if not info.get("ok"):
            err = info.get("error") or "unknown"
            self._set(_T("检查失败", "Check failed"),
                      _T("暂时无法获取更新信息（%s）。\n可以稍后重试，或直接打开发布页手动下载。" % err,
                         "Could not fetch update info (%s).\nTry again later, or open the release page." % err),
                      0, "")
            self.btn_main.configure(text=_T("重试", "Retry"), command=self._retry)
            self.btn_main.pack(side="right", padx=(0, _px(self, 8)))
            self.btn_link.pack(side="right", padx=(0, _px(self, 8)))
            return

        latest = info.get("latest") or "?"
        if not info.get("has_update"):
            self._set(_T("已是最新版本", "Up to date"),
                      _T("当前 %s，远端 %s。" % (info.get("current"), latest),
                         "Current %s, remote %s." % (info.get("current"), latest)),
                      100, "")
            self.btn_main.configure(text=_T("关闭", "Close"), command=self._close)
            return

        notes = (info.get("notes") or "").strip()
        if len(notes) > 600:
            notes = notes[:600] + "…"
        body = _T("发现新版本 %s（当前 %s）\n\n%s" % (latest, info.get("current"), notes or "—"),
                  "New version %s (current %s)\n\n%s" % (latest, info.get("current"), notes or "—"))
        size = info.get("asset", {}).get("size") or 0
        if size:
            body += _T("\n\n安装包 %.1f MB" % (size / 1048576.0), "\n\nPackage %.1f MB" % (size / 1048576.0))
        self._set(_T("发现新版本", "Update available"), body, 0, "")
        self.btn_main.configure(text=_T("下载并安装", "Download & install"), command=self._download)
        self.btn_main.pack(side="right", padx=(0, _px(self, 8)))
        self.btn_link.pack(side="right", padx=(0, _px(self, 8)))
        self.btn_skip.pack(side="right")

    def _retry(self):
        self.btn_link.pack_forget()
        self.btn_main.configure(text=_T("关闭", "Close"), command=self._close)
        self._start()

    def _download(self):
        info = self.result or {}
        seq = self._check_seq
        channel = self._current_channel()
        if not info.get("asset") or info.get("requested_channel", info.get("channel", channel)) != channel:
            self.btn_main.configure(state="disabled")
            self._set(_T("通道已变化，请重新检查。", "Channel changed; check again."))
            self._start()
            return
        self._verified_path = None
        self.btn_main.configure(state="disabled")
        self.btn_skip.configure(text=_T("取消下载", "Cancel"), command=self._close)
        self._set(_T("正在下载…", "Downloading…"), None, 0, "")
        threading.Thread(target=self._download_worker, args=(seq, channel, dict(info.get("asset") or {})), daemon=True).start()

    def _download_worker(self, seq, channel, asset):
        def prog(done, total):
            if self._closed:
                return False
            pct = int(done * 100 / total) if total else 0
            text = _T("%.1f / %.1f MB" % (done / 1048576.0, (total or 0) / 1048576.0),
                      "%.1f / %.1f MB" % (done / 1048576.0, (total or 0) / 1048576.0))
            try:
                self.after(0, lambda: self._set(progress=pct, ptext=text))
            except Exception:
                return False
            return not self._cancel.is_set()
        path, err = None, None
        try:
            path = updater.download(asset, progress_cb=prog)
        except Exception as e:
            err = "%s: %s" % (type(e).__name__, e)
        if self._closed:
            return
        try:
            self.after(0, lambda: self._download_done(path, err, seq, channel))
        except Exception:
            pass

    def _download_done(self, path, err, seq=None, channel=None):
        if seq is not None and (seq != self._check_seq or channel != self._current_channel()):
            return
        if path and not err:
            self._verified_path = path
        if err:
            self._set(_T("下载失败", "Download failed"), err, 0, "")
            self.btn_main.configure(state="normal", text=_T("重试", "Retry"), command=self._download)
            self.btn_main.pack(side="right", padx=(0, _px(self, 8)))
            self.btn_skip.configure(text=_T("关闭", "Close"), command=self._close)
            return
        self._set(_T("下载完成", "Downloaded"),
                  _T("安装包已校验：%s\n\n现在安装？程序会关闭并在覆盖完成后自动重启。"
                     % os.path.basename(path or ""),
                     "Package verified: %s\n\nInstall now? The app will close and restart after replacing files."
                     % os.path.basename(path or "")),
                  100, "")
        self.btn_main.configure(state="normal", text=_T("立即安装并重启", "Install & restart"),
                                command=lambda: self._apply(path))
        self.btn_main.pack(side="right", padx=(0, _px(self, 8)))
        self.btn_skip.pack(side="right")

    def _apply(self, path):
        if not path or path != self._verified_path or not self.result:
            return
        if self.result.get("requested_channel", self.result.get("channel")) != self._current_channel():
            return
        ok = messagebox.askyesno(_T("确认安装", "Confirm"),
                                 _T("将关闭当前程序、覆盖安装并重新启动。未保存的对话会丢失，继续？",
                                    "This closes the app, replaces files and restarts. Unsaved chats are lost. Continue?"),
                                 parent=self)
        if not ok:
            return
        try:
            bat = updater.apply_and_restart(path, os.getpid(), (self.result or {}).get("latest"))
            self._log(_T("更新已就绪，程序退出后自动重启。", "Update staged; the app will restart."))
            try:
                self.destroy()
            except Exception:
                pass
            master = self.master
            try:
                master.destroy()
            except Exception:
                pass
            return
        except Exception as e:
            messagebox.showerror(_T("安装失败", "Install failed"), str(e), parent=self)


def check_and_prompt(master, on_log=None):
    """菜单入口：打开更新窗口并立即返回（不阻塞主线程）。"""
    dlg = UpdateDialog(master, on_log=on_log)
    dlg.focus_set()
    return dlg

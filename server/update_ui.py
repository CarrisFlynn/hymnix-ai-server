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


def _T(zh, en):
    try:
        import hymnix_main
        return hymnix_main.T(zh, en)
    except Exception:
        return zh


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

        self.title(_T("检查更新", "Check for updates"))
        self.transient(master)
        self.resizable(False, False)
        try:
            self.configure(bg="#FFFFFF")
        except Exception:
            pass

        frm = ttk.Frame(self, style="Card.TFrame", padding=20)
        frm.pack(fill="both", expand=True)

        self.lbl_title = ttk.Label(frm, text=_T("正在检查更新…", "Checking for updates…"),
                                   style="H1.TLabel")
        self.lbl_title.pack(anchor="w")

        self.lbl_body = ttk.Label(frm, text=_T("正在连接 GitHub Releases", "Contacting GitHub Releases"),
                                  style="Caption.TLabel", wraplength=460, justify="left")
        self.lbl_body.pack(anchor="w", pady=(6, 12))

        self.bar = ttk.Progressbar(frm, mode="determinate", maximum=100, length=460)
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
        self.btn_main.pack(side="right", padx=(0, 8))
        self.btn_link = ttk.Button(btns, text=_T("打开发布页", "Release page"),
                                   command=self._open_release)
        _style_btn(self.btn_link, "Ghost.TButton")

        self.geometry("+%d+%d" % (master.winfo_rootx() + 120, master.winfo_rooty() + 80))
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.after(60, self._start)

    # ---------- helpers ----------
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
        self._set(progress=5, ptext=_T("当前版本 %s" % updater.get_current_version(),
                                      "Current version %s" % updater.get_current_version()))
        threading.Thread(target=self._check_worker, daemon=True).start()

    def _check_worker(self):
        try:
            info = updater.check_for_update()
        except Exception as e:  # pragma: no cover
            info = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        if self._closed:
            return
        try:
            self.after(0, lambda: self._check_done(info))
        except Exception:
            pass

    def _check_done(self, info):
        self.result = info
        if not info.get("ok"):
            err = info.get("error") or "unknown"
            self._set(_T("检查失败", "Check failed"),
                      _T("暂时无法获取更新信息（%s）。\n可以稍后重试，或直接打开发布页手动下载。" % err,
                         "Could not fetch update info (%s).\nTry again later, or open the release page." % err),
                      0, "")
            self.btn_main.configure(text=_T("重试", "Retry"), command=self._retry)
            self.btn_main.pack(side="right", padx=(0, 8))
            self.btn_link.pack(side="right", padx=(0, 8))
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
        self.btn_main.pack(side="right", padx=(0, 8))
        self.btn_link.pack(side="right", padx=(0, 8))
        self.btn_skip.pack(side="right")

    def _retry(self):
        self.btn_link.pack_forget()
        self.btn_main.configure(text=_T("关闭", "Close"), command=self._close)
        self._start()

    def _download(self):
        self.btn_main.configure(state="disabled")
        self.btn_skip.configure(text=_T("取消下载", "Cancel"), command=self._close)
        self._set(_T("正在下载…", "Downloading…"), None, 0, "")
        threading.Thread(target=self._download_worker, daemon=True).start()

    def _download_worker(self):
        asset = (self.result or {}).get("asset") or {}
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
            self.after(0, lambda: self._download_done(path, err))
        except Exception:
            pass

    def _download_done(self, path, err):
        if err:
            self._set(_T("下载失败", "Download failed"), err, 0, "")
            self.btn_main.configure(state="normal", text=_T("重试", "Retry"), command=self._download)
            self.btn_main.pack(side="right", padx=(0, 8))
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
        self.btn_main.pack(side="right", padx=(0, 8))
        self.btn_skip.pack(side="right")

    def _apply(self, path):
        if not path:
            return
        ok = messagebox.askyesno(_T("确认安装", "Confirm"),
                                 _T("将关闭当前程序、覆盖安装并重新启动。未保存的对话会丢失，继续？",
                                    "This closes the app, replaces files and restarts. Unsaved chats are lost. Continue?"),
                                 parent=self)
        if not ok:
            return
        try:
            bat = updater.apply_and_restart(path, os.getpid())
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

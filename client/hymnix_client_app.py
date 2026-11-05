# -*- coding: utf-8 -*-
r"""Hymnix Client — 现代化桌面 AI 聊天客户端（单文件 · UTF-8）

功能概览
  * 顶部栏：品牌 / 连接状态 / 模型下拉 / 刷新 / 设置
  * 聊天区：左右气泡（用户右侧强调色、助手左侧白卡）、时间戳、滚动、右键复制
  * 输入区：多行输入，Enter 发送、Shift+Enter 换行；发送与停止
  * 底部用量条：本次 prompt / reply / total tokens、tok/s、耗时；
                会话累计 tokens 与估算算力
  * 流式 /v1/chat/completions（stream=true），失败自动回退非流式
  * 五语言界面：中文 / English / Français / Русский / Español
  * 设置持久化到 %LOCALAPPDATA%\Hymnix\hymnix_client.json
  * 浅色主题默认，可在设置中切换深色

仅依赖标准库 tkinter 与 requests；不依赖任何第三方 UI 组件。
"""

import json
import math
import os
import queue
import re
import sys
import threading
import time
import traceback
from datetime import datetime

import tkinter as tk
import tkinter.font as tkfont
from tkinter import ttk

import requests

APP_NAME = "Hymnix"
APP_VER = "2.0.0"

DEFAULT_SERVER = "http://127.0.0.1:11435"
DEFAULT_KEY = ""
DEFAULT_MODEL = ""

LANGS = ("zh", "en", "fr", "ru", "es")
LANG = {"cur": "zh"}
LANG_OPTIONS = (
    ("zh", "中文"),
    ("en", "English"),
    ("fr", "Français"),
    ("ru", "Русский"),
    ("es", "Español"),
)

# ---------------------------------------------------------------------------
# i18n：每个键对应 5 种语言，顺序与 LANGS 一致（中 / 英 / 法 / 俄 / 西）
# ---------------------------------------------------------------------------
TEXTS = {
    "app_subtitle": ("AI 聊天客户端", "AI Chat Client", "Client de chat IA", "ИИ-клиент чата", "Cliente de chat IA"),
    "status_connecting": ("连接中…", "Connecting…", "Connexion…", "Подключение…", "Conectando…"),
    "status_connected": ("已连接 · {ms} ms", "Connected · {ms} ms", "Connecté · {ms} ms", "Подключено · {ms} мс", "Conectado · {ms} ms"),
    "status_online_model_missing": ("服务器在线 · 模型未就绪", "Server online · model not ready", "Serveur en ligne · modèle non prêt", "Сервер онлайн · модель не готова", "Servidor en línea · modelo no listo"),
    "status_disconnected": ("未连接", "Disconnected", "Déconnecté", "Не подключено", "Desconectado"),
    "status_auth_failed": ("密钥无效", "Invalid key", "Clé invalide", "Неверный ключ", "Clave no válida"),
    "models_refresh": ("刷新", "Refresh", "Actualiser", "Обновить", "Actualizar"),
    "settings": ("设置", "Settings", "Paramètres", "Настройки", "Ajustes"),
    "model_label": ("模型", "Model", "Modèle", "Модель", "Modelo"),
    "role_you": ("你", "You", "Vous", "Вы", "Tú"),
    "empty_title": ("开始新的对话", "Start a new conversation", "Commencez une nouvelle conversation", "Начните новый диалог", "Inicia una nueva conversación"),
    "empty_hint": ("在下方输入问题，Enter 发送，Shift+Enter 换行。", "Type below. Enter to send, Shift+Enter for a new line.", "Saisissez votre question ci-dessous. Entrée pour envoyer, Maj+Entrée pour un saut de ligne.", "Введите вопрос ниже. Enter — отправить, Shift+Enter — новая строка.", "Escribe tu pregunta abajo. Enter para enviar, Mayús+Enter para una línea nueva."),
    "input_placeholder": ("输入消息…", "Type a message…", "Saisissez un message…", "Введите сообщение…", "Escribe un mensaje…"),
    "send": ("发送", "Send", "Envoyer", "Отправить", "Enviar"),
    "stop": ("停止", "Stop", "Arrêter", "Остановить", "Detener"),
    "input_hint": ("Enter 发送 · Shift+Enter 换行", "Enter to send · Shift+Enter for a new line", "Entrée pour envoyer · Maj+Entrée pour un saut de ligne", "Enter — отправить · Shift+Enter — новая строка", "Enter para enviar · Mayús+Enter para una línea nueva"),
    "thinking": ("正在思考…", "Thinking…", "Réflexion…", "Думаю…", "Pensando…"),
    "usage_prompt": ("提示", "Prompt", "Invite", "Запрос", "Prompt"),
    "usage_reply": ("回复", "Reply", "Réponse", "Ответ", "Respuesta"),
    "usage_total": ("合计", "Total", "Total", "Всего", "Total"),
    "usage_elapsed": ("耗时", "Time", "Durée", "Время", "Tiempo"),
    "usage_idle": ("等待第一条消息", "Waiting for the first message", "En attente du premier message", "Ожидание первого сообщения", "Esperando el primer mensaje"),
    "usage_session": ("会话累计", "Session total", "Total de la session", "Всего за сеанс", "Total de sesión"),
    "usage_compute": ("算力≈", "Compute≈", "Calcul≈", "Вычисления≈", "Cómputo≈"),
    "usage_estimated": ("估算", "estimated", "estimé", "оценка", "estimado"),
    "usage_tokens": ("tokens", "tokens", "tokens", "токенов", "tokens"),
    "err_connection": ("连接失败：服务器不可达。", "Connection failed: server unreachable.", "Échec de la connexion : serveur inaccessible.", "Ошибка подключения: сервер недоступен.", "Error de conexión: servidor inaccesible."),
    "err_auth": ("密钥无效，请在设置中检查。", "Invalid API key. Check it in Settings.", "Clé API invalide. Vérifiez-la dans les paramètres.", "Неверный ключ API. Проверьте его в настройках.", "Clave de API no válida. Revísala en Ajustes."),
    "err_http": ("服务器返回错误 {code}", "Server returned error {code}", "Le serveur a renvoyé l'erreur {code}", "Сервер вернул ошибку {code}", "El servidor devolvió el error {code}"),
    "err_timeout": ("请求超时，请重试。", "Request timed out. Please try again.", "Délai d'attente dépassé. Veuillez réessayer.", "Время ожидания истекло. Повторите попытку.", "Se agotó el tiempo de espera. Inténtalo de nuevo."),
    "err_empty": ("没有收到内容。", "No content received.", "Aucun contenu reçu.", "Содержимое не получено.", "No se recibió contenido."),
    "err_generic": ("请求异常：{msg}", "Request error: {msg}", "Erreur de requête : {msg}", "Ошибка запроса: {msg}", "Error de solicitud: {msg}"),
    "err_no_model": ("还没有选择模型，请在设置中刷新并选择。", "No model selected. Refresh the list in Settings and choose one.", "Aucun modèle sélectionné. Actualisez la liste dans les paramètres et choisissez-en un.", "Модель не выбрана. Обновите список в настройках и выберите модель.", "Ningún modelo seleccionado. Actualiza la lista en Ajustes y elige uno."),
    "notice_fallback": ("流式不可用，已切换为非流式。", "Streaming unavailable; fell back to non-streaming.", "Diffusion indisponible ; passage au mode non diffusé.", "Потоковая передача недоступна; включён обычный режим.", "Difusión no disponible; se usó el modo sin difusión."),
    "notice_stopped": ("已停止生成。", "Generation stopped.", "Génération arrêtée.", "Генерация остановлена.", "Generación detenida."),
    "notice_server_msg": ("服务端消息：{text}", "Server message: {text}", "Message du serveur : {text}", "Сообщение сервера: {text}", "Mensaje del servidor: {text}"),
    "copy_message": ("复制消息", "Copy message", "Copier le message", "Копировать сообщение", "Copiar mensaje"),
    "copy_last": ("复制最后回复", "Copy last reply", "Copier la dernière réponse", "Копировать последний ответ", "Copiar la última respuesta"),
    "clear_chat": ("清空对话", "Clear chat", "Effacer la conversation", "Очистить диалог", "Borrar chat"),
    "copied": ("已复制", "Copied", "Copié", "Скопировано", "Copiado"),
    "settings_title": ("设置", "Settings", "Paramètres", "Настройки", "Ajustes"),
    "tab_connection": ("连接", "Connection", "Connexion", "Подключение", "Conexión"),
    "tab_appearance": ("界面", "Appearance", "Apparence", "Интерфейс", "Apariencia"),
    "tab_about": ("关于", "About", "À propos", "О программе", "Acerca de"),
    "server_url": ("服务器地址", "Server URL", "URL du serveur", "Адрес сервера", "URL del servidor"),
    "api_key": ("API 密钥", "API key", "Clé API", "Ключ API", "Clave API"),
    "show_key": ("显示", "Show", "Afficher", "Показать", "Mostrar"),
    "hide_key": ("隐藏", "Hide", "Masquer", "Скрыть", "Ocultar"),
    "paste_clipboard": ("粘贴连接信息", "Paste connection info", "Coller les informations", "Вставить данные", "Pegar información"),
    "paste_ok": ("已填入剪贴板中的服务器信息，点保存生效。", "Connection info pasted. Click Save to apply.", "Informations collées. Cliquez sur Enregistrer pour appliquer.", "Данные вставлены. Нажмите «Сохранить».", "Información pegada. Pulsa Guardar para aplicar."),
    "paste_empty": ("剪贴板里没有可用的文本。", "No usable text in the clipboard.", "Aucun texte utilisable dans le presse-papiers.", "В буфере обмена нет текста.", "No hay texto utilizable en el portapapeles."),
    "refresh_models": ("刷新模型列表", "Refresh models", "Actualiser les modèles", "Обновить модели", "Actualizar modelos"),
    "refreshing": ("刷新中…", "Refreshing…", "Actualisation…", "Обновление…", "Actualizando…"),
    "models_loaded": ("已加载 {n} 个模型", "{n} models loaded", "{n} modèles chargés", "Загружено моделей: {n}", "{n} modelos cargados"),
    "no_models": ("没有获取到模型，请检查密钥或服务器。", "No models found. Check the API key or the server.", "Aucun modèle trouvé. Vérifiez la clé API ou le serveur.", "Модели не найдены. Проверьте ключ API или сервер.", "No se encontraron modelos. Revisa la clave de API o el servidor."),
    "test_connection": ("测试连接", "Test connection", "Tester la connexion", "Проверить подключение", "Probar conexión"),
    "testing": ("测试中…", "Testing…", "Test en cours…", "Проверка…", "Probando…"),
    "test_ok": ("连接正常 · {ms} ms", "Connection OK · {ms} ms", "Connexion OK · {ms} ms", "Подключение работает · {ms} мс", "Conexión correcta · {ms} ms"),
    "test_fail": ("连接失败：{msg}", "Connection failed: {msg}", "Échec de la connexion : {msg}", "Ошибка подключения: {msg}", "Error de conexión: {msg}"),
    "language": ("语言", "Language", "Langue", "Язык", "Idioma"),
    "theme": ("主题", "Theme", "Thème", "Тема", "Tema"),
    "theme_light": ("浅色", "Light", "Clair", "Светлая", "Claro"),
    "theme_dark": ("深色", "Dark", "Sombre", "Тёмная", "Oscuro"),
    "save": ("保存", "Save", "Enregistrer", "Сохранить", "Guardar"),
    "cancel": ("取消", "Cancel", "Annuler", "Отмена", "Cancelar"),
    "close": ("关闭", "Close", "Fermer", "Закрыть", "Cerrar"),
    "saved": ("已保存并生效", "Saved and applied", "Enregistré et appliqué", "Сохранено и применено", "Guardado y aplicado"),
    "save_failed": ("保存失败：{msg}", "Save failed: {msg}", "Échec de l'enregistrement : {msg}", "Не удалось сохранить: {msg}", "Error al guardar: {msg}"),
    "url_required": ("请填写服务器地址。", "Server URL is required.", "L'URL du serveur est requise.", "Укажите адрес сервера.", "La URL del servidor es obligatoria."),
    "settings_note": ("修改后点「保存」立即生效。", "Changes take effect immediately after saving.", "Les modifications s'appliquent dès l'enregistrement.", "Изменения вступят в силу после сохранения.", "Los cambios se aplican al guardar."),
    "about_desc": ("连接 Hymnix 网关的桌面聊天客户端。支持流式回复、token 用量统计与五种界面语言。", "A desktop chat client for the Hymnix gateway. Supports streaming replies, token usage tracking and five interface languages.", "Un client de bureau pour la passerelle Hymnix. Réponses en diffusion, suivi des tokens et cinq langues d'interface.", "Настольный клиент чата для шлюза Hymnix. Потоковые ответы, учёт токенов и пять языков интерфейса.", "Un cliente de escritorio para la pasarela Hymnix. Respuestas en difusión, control de tokens y cinco idiomas de interfaz."),
    "about_version": ("版本 {ver}", "Version {ver}", "Version {ver}", "Версия {ver}", "Versión {ver}"),
    "config_path": ("配置文件", "Config file", "Fichier de configuration", "Файл конфигурации", "Archivo de configuración"),
    "hint_disconnected": ("连不上？确认服务器已运行；若地址已更新，点右上角「设置」粘贴新的服务器地址和密钥。", "Can't connect? Make sure the server is running; if the address changed, paste the new server URL and key in Settings.", "Connexion impossible ? Vérifiez que le serveur est démarré ; si l'adresse a changé, collez la nouvelle URL et la clé dans les paramètres.", "Не удаётся подключиться? Убедитесь, что сервер запущен; если адрес изменился, вставьте новый адрес и ключ в настройках.", "¿No conecta? Comprueba que el servidor esté en marcha; si la dirección cambió, pega la nueva URL y la clave en Ajustes."),
}


def tr(key, **kw):
    """取当前语言的文案；缺失时回退到中文。"""
    pair = TEXTS.get(key)
    if not pair:
        return key
    idx = LANGS.index(LANG["cur"]) if LANG["cur"] in LANGS else 0
    text = pair[idx]
    if kw:
        try:
            text = text.format(**kw)
        except Exception:
            pass
    return text


# ---------------------------------------------------------------------------
# 主题
# ---------------------------------------------------------------------------
THEMES = {
    "light": {
        "bg": "#F4F6F9",
        "surface": "#FFFFFF",
        "surface_alt": "#EDF0F5",
        "chat_bg": "#F7F8FA",
        "border": "#E2E6ED",
        "text": "#1E2430",
        "text_muted": "#6B7280",
        "text_faint": "#9AA1AC",
        "accent": "#3B6FE0",
        "accent_hover": "#2F5CC4",
        "accent_text": "#FFFFFF",
        "accent_soft": "#E8EFFC",
        "user_bubble": "#3B6FE0",
        "user_text": "#FFFFFF",
        "assistant_bubble": "#FFFFFF",
        "assistant_text": "#1E2430",
        "assistant_border": "#E2E6ED",
        "ok": "#1E9E6A",
        "ok_soft": "#E6F6EE",
        "bad": "#C0392B",
        "bad_soft": "#FBEAE8",
        "input_bg": "#FFFFFF",
        "scrollbar": "#C9CFDA",
        "timestamp": "#8A93A3",
        "user_timestamp": "#D6E2FB",
        "chip_bg": "#EEF1F6",
        "ghost_hover": "#EDF0F5",
        "notice_error": "#B63C30",
        "notice_warn": "#9A6B12",
        "notice_info": "#6B7280",
    },
    "dark": {
        "bg": "#121418",
        "surface": "#1A1D23",
        "surface_alt": "#232730",
        "chat_bg": "#15181E",
        "border": "#2B303A",
        "text": "#E8EAF0",
        "text_muted": "#A3AAB8",
        "text_faint": "#6F7786",
        "accent": "#4C8DFF",
        "accent_hover": "#3C7BEA",
        "accent_text": "#FFFFFF",
        "accent_soft": "#1D2A44",
        "user_bubble": "#2F63D6",
        "user_text": "#FFFFFF",
        "assistant_bubble": "#1E232B",
        "assistant_text": "#E8EAF0",
        "assistant_border": "#2B303A",
        "ok": "#3DD68C",
        "ok_soft": "#17301F",
        "bad": "#F87171",
        "bad_soft": "#3A1D1D",
        "input_bg": "#1A1D23",
        "scrollbar": "#3A404C",
        "timestamp": "#8A93A3",
        "user_timestamp": "#C9D8F5",
        "chip_bg": "#242933",
        "ghost_hover": "#232730",
        "notice_error": "#F08A82",
        "notice_warn": "#E0B45C",
        "notice_info": "#A3AAB8",
    },
}


# ---------------------------------------------------------------------------
# 路径与配置
# ---------------------------------------------------------------------------
def app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


APP_DIR = app_dir()


def data_dir():
    """可写数据目录：HYMNIX_DATA_DIR > %LOCALAPPDATA%\\Hymnix > 程序目录（兜底）。"""
    env = os.environ.get("HYMNIX_DATA_DIR")
    if env:
        try:
            os.makedirs(env, exist_ok=True)
            return env
        except Exception:
            pass
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    path = os.path.join(base, "Hymnix")
    try:
        os.makedirs(path, exist_ok=True)
        return path
    except Exception:
        return APP_DIR


DATA_DIR = data_dir()
CONFIG_PATH = os.path.join(DATA_DIR, "hymnix_client.json")
ICON_CANDIDATES = (
    os.path.join(getattr(sys, "_MEIPASS", APP_DIR), "assets", "icon.ico"),
    os.path.join(getattr(sys, "_MEIPASS", APP_DIR), "icon.ico"),
)

FACTORY = {
    "server_url": DEFAULT_SERVER,
    "api_key": DEFAULT_KEY,
    "model": DEFAULT_MODEL,
    "language": "zh",
    "theme": "light",
    "temperature": 0.7,
    "system_prompt": (
        "你是 Hymnix，一个运行在服务器主人本机上的中文 AI 助手。\n"
        "说话自然、简洁；不确定就说不确定，不要编造。默认用简体中文回答。"
    ),
}


def normalize_base(url):
    """把用户填写的地址规范成网关根地址（去掉尾部 / 与 /v1、/api）。"""
    u = (url or "").strip()
    if not u:
        return ""
    if not re.match(r"^https?://", u, re.I):
        u = "http://" + u
    u = u.rstrip("/")
    low = u.lower()
    for suffix in ("/v1/chat/completions", "/api/chat", "/v1/models",
                   "/api/tags", "/v1", "/api"):
        if low.endswith(suffix):
            u = u[: -len(suffix)].rstrip("/")
            break
    return u


def load_cfg():
    cfg = dict(FACTORY)
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                for k, v in loaded.items():
                    if k in FACTORY:
                        cfg[k] = v
    except Exception:
        pass
    if cfg.get("language") not in LANGS:
        cfg["language"] = "zh"
    if cfg.get("theme") not in ("light", "dark"):
        cfg["theme"] = "light"
    cfg["server_url"] = normalize_base(cfg.get("server_url")) or DEFAULT_SERVER
    try:
        cfg["temperature"] = float(cfg.get("temperature", 0.7))
    except Exception:
        cfg["temperature"] = 0.7
    return cfg


def save_config(cfg=None):
    data = dict(CFG if cfg is None else cfg)
    data["server_url"] = normalize_base(data.get("server_url"))
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True, ""
    except Exception as exc:
        return False, str(exc)


CFG = load_cfg()


# ---------------------------------------------------------------------------
# 通用小工具
# ---------------------------------------------------------------------------
def now_hm():
    return datetime.now().strftime("%H:%M")


def fmt_int(value):
    try:
        return "{:,}".format(int(value))
    except Exception:
        return str(value)


def fmt_secs(seconds):
    try:
        seconds = float(seconds)
    except Exception:
        return "-"
    if seconds < 60:
        return "%.1fs" % seconds
    minutes = int(seconds // 60)
    rest = int(seconds % 60)
    return "%dm %02ds" % (minutes, rest)


def estimate_tokens(text):
    """字符数 / 4 的粗略估算（服务端未返回 usage 时使用）。"""
    n = len(text or "")
    if n <= 0:
        return 0
    return max(1, int(math.ceil(n / 4.0)))


def model_params_b(model):
    m = re.search(r"(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])", model or "")
    if m:
        try:
            return float(m.group(1))
        except Exception:
            pass
    return 8.0


def fmt_flops(tokens, model):
    """按 2 * 参数量 * token 数粗估算力（FLOPs）。"""
    params = model_params_b(model)
    flops = 2.0 * params * 1e9 * max(0, int(tokens or 0))
    if flops >= 1e12:
        return "%.2f TFLOPs" % (flops / 1e12)
    if flops >= 1e9:
        return "%.1f GFLOPs" % (flops / 1e9)
    return "%.0f MFLOPs" % (flops / 1e6)


def safe_int(value):
    try:
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


def pick_font_family(root):
    try:
        families = set(tkfont.families(root))
    except Exception:
        families = set()
    for name in ("Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", "Arial"):
        if name in families:
            return name
    return "TkDefaultFont"


def round_rect(canvas, x1, y1, x2, y2, radius, **kwargs):
    """在 Canvas 上画圆角矩形（返回 polygon 的 id）。"""
    radius = max(0, min(radius, (x2 - x1) / 2.0, (y2 - y1) / 2.0))
    points = (
        x1 + radius, y1,
        x2 - radius, y1,
        x2, y1,
        x2, y1 + radius,
        x2, y2 - radius,
        x2, y2,
        x2 - radius, y2,
        x1 + radius, y2,
        x1, y2,
        x1, y2 - radius,
        x1, y1 + radius,
        x1, y1,
    )
    return canvas.create_polygon(points, smooth=True, splinesteps=24, **kwargs)


class ChatHTTPError(Exception):
    """聊天请求失败：kind = auth / http / timeout / connection / empty / generic。"""

    def __init__(self, kind, code=None, detail=""):
        super().__init__(detail or kind)
        self.kind = kind
        self.code = code
        self.detail = detail or ""


# ---------------------------------------------------------------------------
# 基础绘制部件
# ---------------------------------------------------------------------------
def shade(color, factor):
    """把 #RRGGBB 颜色按比例调亮/调暗。"""
    try:
        value = color.lstrip("#")
        r = int(value[0:2], 16)
        g = int(value[2:4], 16)
        b = int(value[4:6], 16)
        r = max(0, min(255, int(r * factor)))
        g = max(0, min(255, int(g * factor)))
        b = max(0, min(255, int(b * factor)))
        return "#%02x%02x%02x" % (r, g, b)
    except Exception:
        return color


class StatusPill(tk.Canvas):
    """顶部圆角状态胶囊（圆点 + 文案）。"""

    def __init__(self, master, theme, fonts):
        super().__init__(master, width=150, height=28, bg=theme["surface"],
                         highlightthickness=0, bd=0)
        self.theme = theme
        self.font = fonts["pill"]
        self.state = "warn"
        self.text = tr("status_connecting")
        self._draw()

    def set_state(self, state, text):
        if state == self.state and text == self.text:
            return
        self.state = state
        self.text = text
        self._draw()

    def _colors(self):
        t = self.theme
        return {
            "ok": (t["ok_soft"], t["ok"], t["ok"]),
            "warn": (t["chip_bg"], t["notice_warn"], t["notice_warn"]),
            "bad": (t["bad_soft"], t["bad"], t["bad"]),
        }.get(self.state, (t["chip_bg"], t["text_muted"], t["text_muted"]))

    def _draw(self):
        self.delete("all")
        bg, fg, dot = self._colors()
        width = max(96, self.font.measure(self.text) + 40)
        self.configure(width=width, height=28)
        round_rect(self, 1, 1, width - 1, 27, 13, fill=bg, outline="")
        self.create_oval(13, 11, 19, 17, fill=dot, outline="")
        self.create_text(25, 14, anchor="w", text=self.text, font=self.font, fill=fg)


class RoundButton(tk.Canvas):
    """圆角文字按钮，无 emoji / 图标。"""

    def __init__(self, master, text, command, theme, font, kind="primary",
                 bg=None, padx=16, pady=7, radius=10):
        self.theme = theme
        self.font = font
        self.kind = kind
        self.command = command
        self.text = text
        self.padx = padx
        self.pady = pady
        self.radius = radius
        self.bg = bg if bg else theme["surface"]
        self._enabled = True
        self._hovering = False
        width, height = self._measure()
        super().__init__(master, width=width, height=height, bg=self.bg,
                         highlightthickness=0, bd=0, cursor="hand2")
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Button-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
        self._draw()

    # ---- 对外接口 ----
    def set_text(self, text):
        if text == self.text:
            return
        self.text = text
        width, height = self._measure()
        self.configure(width=width, height=height)
        self._draw()

    def set_enabled(self, enabled):
        enabled = bool(enabled)
        if enabled == self._enabled:
            return
        self._enabled = enabled
        self._hovering = False
        try:
            self.configure(cursor="hand2" if enabled else "arrow")
        except Exception:
            pass
        self._draw()

    def set_kind(self, kind):
        if kind == self.kind:
            return
        self.kind = kind
        self._draw()

    # ---- 内部 ----
    def _measure(self):
        line = self.font.metrics("linespace")
        return (max(52, self.font.measure(self.text) + 2 * self.padx),
                line + 2 * self.pady)

    def _colors(self):
        t = self.theme
        if not self._enabled:
            return t["surface_alt"], t["text_faint"], ""
        if self.kind == "primary":
            if self._hovering:
                return t["accent_hover"], t["accent_text"], ""
            return t["accent"], t["accent_text"], ""
        if self.kind == "danger":
            if self._hovering:
                return shade(t["bad"], 0.85), "#FFFFFF", ""
            return t["bad"], "#FFFFFF", ""
        if self.kind == "secondary":
            if self._hovering:
                return t["accent_soft"], t["accent"], ""
            return t["surface_alt"], t["text"], ""
        # ghost：与父容器同色，悬停出现浅底
        if self._hovering:
            return t["ghost_hover"], t["text"], ""
        return self.bg, t["text_muted"], ""

    def _draw(self):
        self.delete("all")
        fill, fg, outline = self._colors()
        width = int(self["width"])
        height = int(self["height"])
        round_rect(self, 1, 1, width - 1, height - 1, self.radius,
                   fill=fill, outline=outline, width=1)
        self.create_text(width / 2.0, height / 2.0, text=self.text,
                         font=self.font, fill=fg)

    def _on_enter(self, _event):
        self._hovering = True
        self._draw()

    def _on_leave(self, _event):
        self._hovering = False
        self._draw()

    def _on_press(self, _event):
        if self._enabled:
            self._hovering = True
            self._draw()

    def _on_release(self, event):
        if not self._enabled:
            return
        inside = 0 <= event.x <= int(self["width"]) and 0 <= event.y <= int(self["height"])
        if inside and self.command:
            try:
                self.command()
            except Exception:
                traceback.print_exc()
        self._hovering = inside
        self._draw()


class Avatar(tk.Canvas):
    """消息旁的小圆形头像（字母，非 emoji）。"""

    SIZE = 30

    def __init__(self, master, role, theme, fonts, bg):
        super().__init__(master, width=self.SIZE, height=self.SIZE, bg=bg,
                         highlightthickness=0, bd=0)
        is_user = role == "user"
        fill = theme["accent"] if is_user else theme["accent_soft"]
        fg = theme["accent_text"] if is_user else theme["accent"]
        self.create_oval(1, 1, self.SIZE - 1, self.SIZE - 1, fill=fill, outline="")
        letter = "H" if not is_user else tr("role_you")[:1]
        self.create_text(self.SIZE / 2.0, self.SIZE / 2.0, text=letter,
                         font=fonts["avatar"], fill=fg)


class Bubble(tk.Canvas):
    """单条消息气泡：圆角背景 + 自动换行文本 + 时间戳。"""

    PAD_X = 14
    PAD_TOP = 10
    PAD_BOTTOM = 8
    TIME_H = 17
    RADIUS = 14

    TOKEN_RE = re.compile(
        r"[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff]"
        r"|\s+"
        r"|[^\s\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff]+"
    )

    def __init__(self, master, role, theme, fonts, max_width, bg):
        super().__init__(master, bg=bg, highlightthickness=0, bd=0)
        self.role = role
        self.theme = theme
        self.fonts = fonts
        self.max_width = max_width
        self.text = ""
        self.ts = ""
        self.placeholder = False
        self._mcache = {}
        self._render()

    # ---- 对外接口 ----
    def set_content(self, text, ts=None, placeholder=False):
        if ts is not None:
            self.ts = ts
        self.text = text or ""
        self.placeholder = bool(placeholder)
        self._render()

    def set_max_width(self, width):
        if abs(width - self.max_width) < 2:
            return
        self.max_width = width
        self._render()

    # ---- 绘制 ----
    def _measure(self, text):
        cached = self._mcache.get(text)
        if cached is None:
            if len(self._mcache) > 4000:
                self._mcache.clear()
            cached = self.fonts["body"].measure(text)
            self._mcache[text] = cached
        return cached

    def _render(self):
        self.delete("all")
        theme = self.theme
        is_user = self.role == "user"
        fill = theme["user_bubble"] if is_user else theme["assistant_bubble"]
        fg = theme["user_text"] if is_user else theme["assistant_text"]
        border = "" if is_user else theme["assistant_border"]
        time_fg = theme["user_timestamp"] if is_user else theme["timestamp"]
        body_font = self.fonts["body"]

        raw = tr("thinking") if self.placeholder else self.text
        max_text = max(120, self.max_width - 2 * self.PAD_X)
        lines = self._wrap(raw, max_text) or [""]

        content_w = 0
        for line in lines:
            content_w = max(content_w, self._measure(line))
        width = int(min(self.max_width, max(54, content_w + 2 * self.PAD_X)))

        display = "\n".join(lines)
        text_fill = theme["text_muted"] if self.placeholder else fg
        text_id = self.create_text(self.PAD_X, self.PAD_TOP, anchor="nw",
                                   text=display, font=body_font, fill=text_fill,
                                   justify="left")
        bbox = self.bbox(text_id)
        text_h = (bbox[3] - bbox[1]) if bbox else body_font.metrics("linespace")
        has_time = bool(self.ts)
        height = int(self.PAD_TOP + text_h + (self.TIME_H if has_time else 0) + self.PAD_BOTTOM)

        self.configure(width=width, height=height)
        bg_id = round_rect(self, 1, 1, width - 1, height - 1, self.RADIUS,
                           fill=fill, outline=border, width=1)
        self.tag_lower(bg_id, text_id)
        if has_time:
            self.create_text(width - self.PAD_X, height - self.PAD_BOTTOM,
                             anchor="se", text=self.ts, font=self.fonts["tiny"],
                             fill=time_fg)

    # ---- 换行（CJK 按字、拉丁按词） ----
    def _wrap(self, text, max_px):
        lines = []
        for para in (text or "").split("\n"):
            if not para:
                lines.append("")
                continue
            lines.extend(self._wrap_para(para, max_px))
        return lines

    def _wrap_para(self, para, max_px):
        lines = []
        current = ""
        for token in self.TOKEN_RE.findall(para):
            if not current:
                if token.isspace():
                    continue
                if self._measure(token) <= max_px:
                    current = token
                else:
                    lines.extend(self._split_long(token, max_px))
                continue
            if self._measure(current + token) <= max_px:
                current += token
                continue
            lines.append(current.rstrip())
            if token.isspace():
                current = ""
                continue
            if self._measure(token) > max_px:
                parts = self._split_long(token, max_px)
                lines.extend(parts[:-1])
                current = parts[-1]
            else:
                current = token
        if current:
            lines.append(current.rstrip())
        return lines or [""]

    def _split_long(self, token, max_px):
        parts = []
        current = ""
        for char in token:
            if current and self._measure(current + char) > max_px:
                parts.append(current)
                current = char
            else:
                current += char
        if current:
            parts.append(current)
        return parts or [""]


class ChatView(tk.Frame):
    """可滚动的聊天区：气泡行 + 居中的空状态提示。"""

    def __init__(self, master, app):
        self.app = app
        theme = app.theme
        super().__init__(master, bg=theme["chat_bg"])
        self.canvas = tk.Canvas(self, bg=theme["chat_bg"], highlightthickness=0, bd=0)
        self.vbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview,
                                  style="Hymnix.Vertical.TScrollbar")
        self.canvas.configure(yscrollcommand=self.vbar.set)
        self.vbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)

        self.inner = tk.Frame(self.canvas, bg=theme["chat_bg"])
        self.win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", self._on_inner_configure)
        self.canvas.bind("<Configure>", self._on_canvas_configure)

        self.rows = []
        self.bubbles = []
        self.kinds = []
        self.follow = True
        self._last_width = 0
        self._maxw = 620
        self._resize_job = None
        self._empty = None
        self._build_empty_overlay()

    # ---- 空状态 ----
    def _build_empty_overlay(self):
        theme = self.app.theme
        fonts = self.app.fonts
        overlay = tk.Frame(self, bg=theme["chat_bg"])
        logo = tk.Canvas(overlay, width=64, height=64, bg=theme["chat_bg"],
                         highlightthickness=0, bd=0)
        round_rect(logo, 2, 2, 62, 62, 16, fill=theme["accent_soft"], outline="")
        logo.create_text(32, 32, text="H", font=fonts["title"], fill=theme["accent"])
        logo.pack(pady=(0, 18))
        tk.Label(overlay, text=tr("empty_title"), font=fonts["title"],
                 fg=theme["text"], bg=theme["chat_bg"]).pack()
        tk.Label(overlay, text=tr("empty_hint"), font=fonts["small"],
                 fg=theme["text_muted"], bg=theme["chat_bg"], wraplength=460,
                 justify="center").pack(pady=(8, 0))
        self._empty = overlay
        overlay.place(relx=0.5, rely=0.44, anchor="center")

    def show_empty(self, show):
        if self._empty is None:
            return
        if show:
            self._empty.place(relx=0.5, rely=0.44, anchor="center")
            self._empty.lift()
        else:
            self._empty.place_forget()

    # ---- 尺寸 ----
    def _bubble_width(self):
        try:
            width = self.canvas.winfo_width()
        except Exception:
            width = 0
        if width < 200:
            width = 960
        return max(300, min(660, int(width * 0.72)))

    def _on_canvas_configure(self, event):
        try:
            self.canvas.itemconfigure(self.win, width=event.width)
        except Exception:
            pass
        if abs(event.width - self._last_width) > 8:
            self._last_width = event.width
            if self._resize_job is not None:
                try:
                    self.after_cancel(self._resize_job)
                except Exception:
                    pass
            self._resize_job = self.after(140, self._relayout)

    def _relayout(self):
        self._resize_job = None
        new_width = self._bubble_width()
        if abs(new_width - self._maxw) < 4:
            return
        self._maxw = new_width
        for bubble in self.bubbles:
            if bubble is not None:
                try:
                    bubble.set_max_width(new_width)
                except Exception:
                    pass
        self._scroll_to_bottom(force=True)

    def _on_inner_configure(self, _event):
        try:
            self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        except Exception:
            pass

    # ---- 内容 ----
    def add_message(self, role, text, ts="", placeholder=False):
        theme = self.app.theme
        self.show_empty(False)
        row = tk.Frame(self.inner, bg=theme["chat_bg"])
        bubble = Bubble(row, role, theme, self.app.fonts, self._bubble_width(),
                        theme["chat_bg"])
        bubble.set_content(text, ts=ts, placeholder=placeholder)
        avatar = Avatar(row, role, theme, self.app.fonts, theme["chat_bg"])
        if role == "user":
            avatar.pack(side="right", anchor="n", padx=(10, 0), pady=(2, 0))
            bubble.pack(side="right", anchor="ne")
        else:
            avatar.pack(side="left", anchor="n", padx=(0, 10), pady=(2, 0))
            bubble.pack(side="left", anchor="nw")
        row.pack(fill="x", padx=18, pady=(3, 3))
        index = len(self.bubbles)
        bubble.bind("<Button-3>", lambda e=None, i=index: self.app.show_bubble_menu(e, i))
        self.rows.append(row)
        self.bubbles.append(bubble)
        self.kinds.append("bubble")
        self.follow = True
        self._scroll_to_bottom(force=True)
        return index

    def add_notice(self, text, level="info"):
        theme = self.app.theme
        self.show_empty(False)
        color = {
            "error": theme["notice_error"],
            "warn": theme["notice_warn"],
        }.get(level, theme["notice_info"])
        row = tk.Frame(self.inner, bg=theme["chat_bg"])
        label = tk.Label(row, text=text, font=self.app.fonts["small"], fg=color,
                         bg=theme["chat_bg"], wraplength=560, justify="center")
        label.pack(padx=44, pady=4)
        row.pack(fill="x")
        index = len(self.bubbles)
        self.rows.append(row)
        self.bubbles.append(None)
        self.kinds.append("notice")
        self._scroll_to_bottom(force=True)
        return index

    def update_message(self, index, text, ts=None, placeholder=False):
        if 0 <= index < len(self.bubbles):
            bubble = self.bubbles[index]
            if bubble is not None:
                bubble.set_content(text, ts=ts, placeholder=placeholder)
                self._scroll_to_bottom()

    def remove_at(self, index):
        if not (0 <= index < len(self.rows)):
            return
        row = self.rows.pop(index)
        try:
            row.destroy()
        except Exception:
            pass
        self.bubbles.pop(index)
        self.kinds.pop(index)
        try:
            self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        except Exception:
            pass

    def remove_last(self):
        if not self.rows:
            return
        row = self.rows.pop()
        try:
            row.destroy()
        except Exception:
            pass
        self.bubbles.pop()
        self.kinds.pop()

    def clear(self):
        for row in self.rows:
            try:
                row.destroy()
            except Exception:
                pass
        self.rows = []
        self.bubbles = []
        self.kinds = []
        self.show_empty(True)

    def _scroll_to_bottom(self, force=False):
        if not force and not self.follow:
            return
        try:
            self.canvas.yview_moveto(1.0)
        except Exception:
            pass
        try:
            self.after_idle(lambda: self.canvas.yview_moveto(1.0))
        except Exception:
            pass


class ClientApp(tk.Tk):
    """主窗口。"""

    def __init__(self, cli_lang=None, cli_theme=None):
        super().__init__()
        self._closing = False
        self.lang = cli_lang if cli_lang in LANGS else CFG.get("language", "zh")
        if self.lang not in LANGS:
            self.lang = "zh"
        LANG["cur"] = self.lang
        self.theme_key = cli_theme if cli_theme in THEMES else CFG.get("theme", "light")
        if self.theme_key not in THEMES:
            self.theme_key = "light"
        self.theme = THEMES[self.theme_key]

        self.models = []
        self.connected = False
        self._status_kind = "connecting"
        self._status_ms = 0
        self._models_loaded = False
        self._models_fetching = False
        self._models_auto_attempts = 0
        self.busy = False
        self._cancel = threading.Event()
        self._active_resp = None
        self._gen_id = 0
        self._stream_index = None
        self._live = None
        self.current_usage = None
        self.session = {"prompt": 0, "reply": 0, "total": 0, "requests": 0,
                        "elapsed": 0.0, "model": ""}
        self.messages = []
        self.q = queue.Queue()
        self._settings_win = None
        self._toast_label = None
        self._toast_job = None
        self._placeholder_active = False
        self._autotest_deadline = 0.0
        self._first_build = True

        self.title("%s %s" % (APP_NAME, APP_VER))
        self.geometry("1020x790")
        self.minsize(860, 620)
        self._set_icon()

        self._build_ui()
        self._center_window()
        self._first_build = False
        self._set_placeholder(True)
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.bind_all("<MouseWheel>", self._on_mousewheel)

        self.after(50, self._drain_queue)
        self.after(150, self._ensure_window_visible)
        threading.Thread(target=self._probe_loop, daemon=True).start()
        threading.Thread(target=self._inbox_loop, daemon=True).start()

    # ==================================================================
    # 外观 / 字体 / ttk 样式
    # ==================================================================
    def _set_icon(self):
        for path in ICON_CANDIDATES:
            try:
                if os.path.exists(path):
                    self.iconbitmap(path)
                    return
            except Exception:
                continue

    def _apply_window_chrome(self, window=None):
        """深色主题时把 Windows 标题栏也切换成深色（失败则忽略）。"""
        if not sys.platform.startswith("win"):
            return
        target = window if window is not None else self
        try:
            import ctypes
            hwnd = ctypes.windll.user32.GetParent(target.winfo_id())
            if not hwnd:
                hwnd = target.winfo_id()
            value = ctypes.c_int(1 if self.theme_key == "dark" else 0)
            for attribute in (20, 19):
                try:
                    ctypes.windll.dwmapi.DwmSetWindowAttribute(
                        hwnd, attribute, ctypes.byref(value), ctypes.sizeof(value))
                except Exception:
                    continue
        except Exception:
            pass

    def _init_fonts(self):
        family = pick_font_family(self)
        self.fonts = {
            "brand": tkfont.Font(family=family, size=18, weight="bold"),
            "title": tkfont.Font(family=family, size=17, weight="bold"),
            "subtitle": tkfont.Font(family=family, size=9),
            "body": tkfont.Font(family=family, size=11),
            "body_bold": tkfont.Font(family=family, size=11, weight="bold"),
            "small": tkfont.Font(family=family, size=9),
            "tiny": tkfont.Font(family=family, size=8),
            "button": tkfont.Font(family=family, size=10, weight="bold"),
            "pill": tkfont.Font(family=family, size=9),
            "entry": tkfont.Font(family=family, size=10),
            "avatar": tkfont.Font(family=family, size=11, weight="bold"),
        }

    def _build_styles(self):
        t = self.theme
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure(
            "Hymnix.TCombobox",
            fieldbackground=t["input_bg"], background=t["surface"],
            foreground=t["text"], arrowcolor=t["text_muted"],
            bordercolor=t["border"], lightcolor=t["border"], darkcolor=t["border"],
            padding=(8, 4), relief="flat",
        )
        style.map(
            "Hymnix.TCombobox",
            fieldbackground=[("readonly", t["input_bg"])],
            foreground=[("readonly", t["text"])],
            selectbackground=[("readonly", t["accent_soft"])],
            selectforeground=[("readonly", t["text"])],
            bordercolor=[("focus", t["accent"])],
            darkcolor=[("focus", t["accent"])],
        )
        style.configure(
            "Hymnix.Vertical.TScrollbar",
            background=t["surface_alt"], troughcolor=t["chat_bg"],
            bordercolor=t["chat_bg"], arrowcolor=t["text_muted"],
            relief="flat", width=10,
        )
        style.map("Hymnix.Vertical.TScrollbar",
                  background=[("active", t["border"])])

    # ==================================================================
    # 界面构建
    # ==================================================================
    def _build_ui(self):
        for child in self.winfo_children():
            try:
                child.destroy()
            except Exception:
                pass
        self._settings_win = None
        self._toast_label = None
        self._toast_job = None
        self.configure(bg=self.theme["bg"])
        self._init_fonts()
        self._build_styles()
        self._build_topbar()
        self._build_hint_bar()
        self.chat = ChatView(self, self)
        self.chat.pack(fill="both", expand=True)
        self._build_composer()
        self._build_usage_bar()
        self._restore_messages()
        self._render_status()
        self._render_usage()
        self._render_session()
        self._update_busy_ui()
        try:
            self.update_idletasks()
        except Exception:
            pass
        try:
            self.after(80, self._layout_composer)
            self.after(120, self._apply_window_chrome)
        except Exception:
            pass

    def _build_topbar(self):
        t = self.theme
        fonts = self.fonts
        bar = tk.Frame(self, bg=t["surface"])
        bar.pack(fill="x")
        self.topbar = bar
        inner = tk.Frame(bar, bg=t["surface"])
        inner.pack(fill="x", padx=22, pady=(12, 10))

        logo = tk.Canvas(inner, width=36, height=36, bg=t["surface"],
                         highlightthickness=0, bd=0)
        round_rect(logo, 2, 2, 34, 34, 10, fill=t["accent"], outline="")
        logo.create_text(18, 18, text="H", font=fonts["brand"], fill=t["accent_text"])
        logo.pack(side="left")

        brand = tk.Frame(inner, bg=t["surface"])
        brand.pack(side="left", padx=(11, 0))
        tk.Label(brand, text=APP_NAME, font=fonts["brand"], fg=t["text"],
                 bg=t["surface"]).pack(anchor="w")
        tk.Label(brand, text=tr("app_subtitle"), font=fonts["subtitle"],
                 fg=t["text_muted"], bg=t["surface"]).pack(anchor="w")

        self.status_pill = StatusPill(inner, t, fonts)
        self.status_pill.pack(side="left", padx=(20, 0))

        self.settings_btn = RoundButton(inner, tr("settings"), self.open_settings,
                                        t, fonts["body_bold"], kind="ghost",
                                        bg=t["surface"], padx=12, pady=6)
        self.settings_btn.pack(side="right")
        self.refresh_btn = RoundButton(inner, tr("models_refresh"),
                                       self._on_refresh_clicked, t, fonts["body"],
                                       kind="ghost", bg=t["surface"], padx=11, pady=6)
        self.refresh_btn.pack(side="right", padx=(0, 4))

        self.var_model = tk.StringVar(value=CFG.get("model") or "")
        initial = [CFG["model"]] if CFG.get("model") else []
        self.model_combo = ttk.Combobox(inner, textvariable=self.var_model,
                                        values=initial, state="readonly", width=18,
                                        font=fonts["entry"], style="Hymnix.TCombobox")
        self.model_combo.pack(side="right")
        self.model_combo.bind("<<ComboboxSelected>>", self._on_model_selected)
        tk.Label(inner, text=tr("model_label"), font=fonts["subtitle"],
                 fg=t["text_muted"], bg=t["surface"]).pack(side="right", padx=(0, 8))

        tk.Frame(bar, bg=t["border"], height=1).pack(fill="x", side="bottom")

    def _build_hint_bar(self):
        t = self.theme
        self.hint_bar = tk.Frame(self, bg=t["bad_soft"])
        self.hint_label = tk.Label(self.hint_bar, text=tr("hint_disconnected"),
                                   font=self.fonts["small"], fg=t["bad"],
                                   bg=t["bad_soft"], anchor="w", justify="left")
        self.hint_label.pack(fill="x", padx=22, pady=6)

    def _build_composer(self):
        t = self.theme
        fonts = self.fonts
        wrap = tk.Frame(self, bg=t["bg"])
        wrap.pack(fill="x", padx=22, pady=(10, 8))
        self.composer_wrap = wrap

        line_h = fonts["body"].metrics("linespace")
        text_h = line_h * 3 + 20
        row_h = max(34, line_h + 16)
        card_h = 14 + text_h + 8 + row_h + 10
        card = tk.Canvas(wrap, bg=t["bg"], height=card_h, highlightthickness=0, bd=0)
        card.pack(fill="x")
        self.composer_card = card
        self._card_height = card_h

        self.input_text = tk.Text(
            card, font=fonts["body"], bg=t["input_bg"], fg=t["text"],
            insertbackground=t["text"], relief="flat", bd=0, highlightthickness=0,
            wrap="word", undo=True, maxundo=100, padx=10, pady=8,
            selectbackground=t["accent_soft"], selectforeground=t["text"],
        )
        self._input_window = card.create_window(14, 14, anchor="nw",
                                                width=600, height=text_h,
                                                window=self.input_text)

        self.input_hint = tk.Label(card, text=tr("input_hint"), font=fonts["tiny"],
                                   bg=t["input_bg"], fg=t["text_faint"])
        self._hint_window = card.create_window(18, card_h - 12, anchor="sw",
                                               window=self.input_hint)

        self.send_btn = RoundButton(card, tr("send"), self.send_message, t,
                                    fonts["body_bold"], kind="primary",
                                    bg=t["input_bg"], padx=18, pady=6, radius=9)
        self.stop_btn = RoundButton(card, tr("stop"), self.stop_generation, t,
                                    fonts["body_bold"], kind="danger",
                                    bg=t["input_bg"], padx=16, pady=6, radius=9)
        self._send_window = card.create_window(0, 0, anchor="se", window=self.send_btn)
        self._stop_window = card.create_window(0, 0, anchor="se", window=self.stop_btn)

        card.bind("<Configure>", self._layout_composer)
        card.bind("<Button-1>", lambda e=None: self._focus_input())
        self.input_text.bind("<Return>", self._on_return)
        self.input_text.bind("<KP_Enter>", self._on_return)
        self.input_text.bind("<FocusIn>", self._on_input_focus_in)
        self.input_text.bind("<FocusOut>", self._on_input_focus_out)

    def _build_usage_bar(self):
        t = self.theme
        fonts = self.fonts
        bar = tk.Frame(self, bg=t["surface"])
        bar.pack(fill="x")
        self.usage_bar = bar
        tk.Frame(bar, bg=t["border"], height=1).pack(fill="x")
        inner = tk.Frame(bar, bg=t["surface"])
        inner.pack(fill="x", padx=22, pady=7)
        self.var_usage = tk.StringVar(value=tr("usage_idle"))
        self.var_session = tk.StringVar(value="")
        tk.Label(inner, textvariable=self.var_usage, font=fonts["small"],
                 fg=t["text_muted"], bg=t["surface"], anchor="w").pack(side="left")
        tk.Label(inner, textvariable=self.var_session, font=fonts["small"],
                 fg=t["text_muted"], bg=t["surface"], anchor="e").pack(side="right")

    def _layout_composer(self, _event=None):
        if not hasattr(self, "composer_card"):
            return
        try:
            width = int(self.composer_card.winfo_width())
            height = int(self._card_height)
            if width < 80:
                return
            self.composer_card.delete("cardbg")
            round_rect(self.composer_card, 1, 1, width - 1, height - 1, 14,
                       fill=self.theme["input_bg"], outline=self.theme["border"],
                       width=1, tags="cardbg")
            self.composer_card.itemconfigure(self._input_window, width=width - 28)
            send_w = int(self.send_btn["width"])
            self.composer_card.coords(self._send_window, width - 14, height - 12)
            self.composer_card.coords(self._stop_window, width - 14 - send_w - 8,
                                      height - 12)
            self.composer_card.coords(self._hint_window, 18, height - 12)
        except Exception:
            pass

    def _restore_messages(self):
        if not self.messages:
            self.chat.show_empty(True)
            return
        for msg in self.messages:
            role = msg.get("role")
            if role == "notice":
                self.chat.add_notice(msg.get("text", ""), msg.get("level", "info"))
            elif role in ("user", "assistant"):
                self.chat.add_message(role, msg.get("text", ""),
                                      ts=msg.get("ts", ""),
                                      placeholder=bool(msg.get("placeholder")))
        self.chat.show_empty(False)

    # ==================================================================
    # 主题 / 语言 / 状态渲染
    # ==================================================================
    def _status_text(self):
        kind = self._status_kind
        if kind == "ok":
            return tr("status_connected", ms=self._status_ms)
        if kind == "connecting":
            return tr("status_connecting")
        if kind == "warn":
            return tr("status_online_model_missing")
        if kind == "auth":
            return tr("status_auth_failed")
        return tr("status_disconnected")

    def _render_status(self):
        if not hasattr(self, "status_pill"):
            return
        pill_state = {"ok": "ok", "warn": "warn", "auth": "bad", "bad": "bad"}.get(
            self._status_kind, "warn")
        self.status_pill.set_state(pill_state, self._status_text())
        disconnected = self._status_kind in ("bad", "auth")
        try:
            if disconnected:
                self.hint_label.configure(text=tr("hint_disconnected"))
                if not self.hint_bar.winfo_ismapped():
                    self.hint_bar.pack(fill="x", before=self.chat)
            else:
                if self.hint_bar.winfo_ismapped():
                    self.hint_bar.pack_forget()
        except Exception:
            pass

    def _render_usage(self):
        if not hasattr(self, "var_usage"):
            return
        if self.busy and self._live is not None:
            live = self._live
            elapsed = max(0.0, time.time() - live["t0"])
            chars = int(live.get("reply_chars") or 0)
            reply_tokens = max(1, int(math.ceil(chars / 4.0))) if chars else 0
            prompt_tokens = int(live.get("prompt_tokens") or 0)
            total = prompt_tokens + reply_tokens
            first = live.get("first")
            gen = (time.time() - first) if first else elapsed
            tps = (reply_tokens / gen) if gen > 0.05 else 0.0
            estimated = True
        else:
            usage = self.current_usage
            if not usage:
                self.var_usage.set(tr("usage_idle"))
                return
            prompt_tokens = int(usage.get("prompt") or 0)
            reply_tokens = int(usage.get("reply") or 0)
            total = int(usage.get("total") or 0)
            tps = float(usage.get("tps") or 0.0)
            elapsed = float(usage.get("elapsed") or 0.0)
            estimated = bool(usage.get("estimated"))
        text = "%s %s · %s %s · %s %s · %.1f tok/s · %s %s" % (
            tr("usage_prompt"), fmt_int(prompt_tokens),
            tr("usage_reply"), fmt_int(reply_tokens),
            tr("usage_total"), fmt_int(total),
            tps, tr("usage_elapsed"), fmt_secs(elapsed),
        )
        if estimated:
            text += " · " + tr("usage_estimated")
        self.var_usage.set(text)

    def _render_session(self):
        if not hasattr(self, "var_session"):
            return
        total = int(self.session.get("total") or 0)
        model = self.session.get("model") or CFG.get("model") or ""
        text = "%s %s %s · %s %s" % (
            tr("usage_session"), fmt_int(total), tr("usage_tokens"),
            tr("usage_compute"), fmt_flops(total, model),
        )
        self.var_session.set(text)

    def _update_busy_ui(self):
        if not hasattr(self, "send_btn"):
            return
        if self.busy:
            self.send_btn.set_enabled(False)
            self.stop_btn.set_enabled(True)
            try:
                self.composer_card.itemconfigure(self._stop_window, state="normal")
            except Exception:
                pass
        else:
            self.send_btn.set_enabled(True)
            try:
                self.composer_card.itemconfigure(self._stop_window, state="hidden")
            except Exception:
                pass

    # ==================================================================
    # 输入框
    # ==================================================================
    def _focus_input(self):
        try:
            self.input_text.focus_set()
        except Exception:
            pass

    def _set_placeholder(self, show):
        try:
            if not hasattr(self, "input_text") or not self.input_text.winfo_exists():
                return
            if show:
                if self._placeholder_active:
                    return
                if self.input_text.get("1.0", "end-1c"):
                    return
                self.input_text.insert("1.0", tr("input_placeholder"))
                self.input_text.tag_add("placeholder", "1.0", "end-1c")
                self.input_text.tag_config("placeholder",
                                           foreground=self.theme["text_faint"])
                self.input_text.mark_set("insert", "1.0")
                self._placeholder_active = True
            else:
                if self._placeholder_active:
                    self.input_text.delete("1.0", "end")
                    self.input_text.tag_remove("placeholder", "1.0", "end")
                    self._placeholder_active = False
        except Exception:
            pass

    def _on_input_focus_in(self, _event):
        if self._placeholder_active:
            self._set_placeholder(False)
            self.input_text.delete("1.0", "end")
            self.input_text.mark_set("insert", "1.0")

    def _on_input_focus_out(self, _event):
        try:
            content = self.input_text.get("1.0", "end-1c")
        except Exception:
            return
        if not content.strip():
            self.input_text.delete("1.0", "end")
            self._placeholder_active = False
            self._set_placeholder(True)

    def _on_return(self, event):
        shift = bool(event.state & 0x0001)
        if shift:
            return None
        self.send_message()
        return "break"

    def _on_model_selected(self, _event=None):
        value = (self.var_model.get() or "").strip()
        if value:
            CFG["model"] = value
            save_config()

    # ==================================================================
    # 与网关的通信
    # ==================================================================
    def base(self):
        return normalize_base(CFG.get("server_url")) or DEFAULT_SERVER

    def headers(self):
        key = (CFG.get("api_key") or "").strip()
        return {"Authorization": "Bearer " + key} if key else {}

    def _probe_loop(self):
        while not self._closing:
            started = time.time()
            kind = "bad"
            ms = 0
            try:
                resp = requests.get(self.base() + "/health", timeout=4)
                ms = int((time.time() - started) * 1000)
                if resp.status_code == 200:
                    try:
                        data = resp.json()
                    except Exception:
                        data = {}
                    if data.get("ok", True):
                        kind = "ok" if data.get("ollama", True) else "warn"
            except Exception:
                kind = "bad"
                ms = 0
            self.q.put(("status", kind, ms))
            if kind in ("ok", "warn") and not self._models_loaded \
                    and not self._models_fetching and self._models_auto_attempts < 2:
                self._models_auto_attempts += 1
                self._refresh_models_async()
            time.sleep(5)

    def _inbox_loop(self):
        """保留旧版的服务器留言功能：轮询 /api/inbox 并显示为灰色提示。"""
        while not self._closing:
            time.sleep(8)
            if self._closing:
                break
            if not (CFG.get("api_key") or "").strip():
                continue
            try:
                resp = requests.get(self.base() + "/api/inbox",
                                    headers=self.headers(), timeout=4)
                if resp.status_code == 200:
                    for message in (resp.json().get("messages") or []):
                        text = str(message.get("text") or "").strip()
                        if text:
                            self.q.put(("inbox", text))
            except Exception:
                pass

    def fetch_models(self, url=None, key=None):
        base = normalize_base(url if url is not None else CFG.get("server_url"))
        key = (CFG.get("api_key") if key is None else key) or ""
        headers = {"Authorization": "Bearer " + key} if key.strip() else {}
        if not base:
            raise ChatHTTPError("connection")
        names = []
        try:
            resp = requests.get(base + "/v1/models", headers=headers, timeout=10)
        except requests.exceptions.Timeout:
            raise ChatHTTPError("timeout")
        except requests.exceptions.ConnectionError:
            raise ChatHTTPError("connection")
        except Exception as exc:
            raise ChatHTTPError("generic", detail=str(exc))
        if resp.status_code in (401, 403):
            raise ChatHTTPError("auth")
        if resp.status_code == 200:
            try:
                payload = resp.json()
            except Exception:
                payload = {}
            for item in payload.get("data") or []:
                mid = item.get("id") or item.get("name") if isinstance(item, dict) else None
                if mid:
                    names.append(str(mid))
        if not names:
            try:
                resp = requests.get(base + "/api/tags", headers=headers, timeout=10)
            except requests.exceptions.Timeout:
                raise ChatHTTPError("timeout")
            except requests.exceptions.ConnectionError:
                raise ChatHTTPError("connection")
            except Exception as exc:
                raise ChatHTTPError("generic", detail=str(exc))
            if resp.status_code in (401, 403):
                raise ChatHTTPError("auth")
            if resp.status_code == 200:
                try:
                    payload = resp.json()
                except Exception:
                    payload = {}
                for item in payload.get("models") or []:
                    mid = item.get("name") if isinstance(item, dict) else None
                    if mid:
                        names.append(str(mid))
        unique = []
        for name in names:
            if name not in unique:
                unique.append(name)
        if not unique:
            raise ChatHTTPError("empty", detail=tr("no_models"))
        return unique

    def _refresh_models_async(self, manual=False):
        if self._models_fetching:
            return
        self._models_fetching = True

        def worker():
            try:
                names = self.fetch_models()
                self.q.put(("models", names, manual))
            except ChatHTTPError as exc:
                self.q.put(("models_error", exc.kind, manual))
            except Exception:
                self.q.put(("models_error", "generic", manual))
            finally:
                self._models_fetching = False

        threading.Thread(target=worker, daemon=True).start()

    def _on_refresh_clicked(self):
        self._refresh_models_async(manual=True)

    # ==================================================================
    # 发送 / 流式 / 非流式回退
    # ==================================================================
    def _append_message(self, role, text, ts="", placeholder=False):
        message = {"role": role, "text": text, "ts": ts}
        if placeholder:
            message["placeholder"] = True
        self.messages.append(message)
        self.chat.add_message(role, text, ts=ts, placeholder=placeholder)
        return len(self.messages) - 1

    def _append_notice(self, text, level="info"):
        self.messages.append({"role": "notice", "text": text, "level": level})
        self.chat.add_notice(text, level)

    def _api_messages(self):
        history = []
        for message in self.messages:
            if message.get("role") not in ("user", "assistant"):
                continue
            if message.get("placeholder"):
                continue
            content = (message.get("text") or "").strip()
            if content:
                history.append({"role": message["role"], "content": content})
        return history[-24:]

    def _error_text(self, exc):
        if not isinstance(exc, ChatHTTPError):
            return tr("err_generic", msg=str(exc))
        if exc.kind == "auth":
            return tr("err_auth")
        if exc.kind == "timeout":
            return tr("err_timeout")
        if exc.kind == "connection":
            return tr("err_connection")
        if exc.kind == "http":
            text = tr("err_http", code=exc.code)
            if exc.detail:
                text += " · " + exc.detail[:200]
            return text
        if exc.kind == "empty":
            return tr("err_empty")
        return tr("err_generic", msg=exc.detail or exc.kind)

    def send_message(self):
        if self.busy:
            return
        content = self.input_text.get("1.0", "end-1c")
        if self._placeholder_active:
            content = ""
        content = content.strip()
        if not content:
            return
        model = (self.var_model.get() or CFG.get("model") or "").strip()
        if not model:
            self._append_notice(tr("err_no_model"), "error")
            return
        CFG["model"] = model
        self._placeholder_active = False
        try:
            self.input_text.delete("1.0", "end")
        except Exception:
            pass

        ts = now_hm()
        self._append_message("user", content, ts)
        self._gen_id += 1
        gen_id = self._gen_id
        self._append_message("assistant", "", ts, placeholder=True)
        self._stream_index = len(self.messages) - 1
        self.busy = True
        self._cancel = threading.Event()
        self._active_resp = None
        api_messages = self._api_messages()
        prompt_text = (CFG.get("system_prompt") or "") + "\n" + \
            "\n".join(m.get("content", "") for m in api_messages)
        self._live = {
            "prompt_tokens": estimate_tokens(prompt_text),
            "reply_chars": 0,
            "t0": time.time(),
            "first": None,
            "model": model,
        }
        self._update_busy_ui()
        self._render_usage()
        self._focus_input()
        threading.Thread(target=self._chat_worker,
                         args=(gen_id, model, api_messages), daemon=True).start()

    def stop_generation(self):
        if not self.busy:
            return
        self._cancel.set()
        resp = self._active_resp
        if resp is not None:
            try:
                resp.close()
            except Exception:
                pass
        try:
            self.stop_btn.set_enabled(False)
        except Exception:
            pass

    def _request_error(self, exc):
        if isinstance(exc, requests.exceptions.Timeout):
            return ChatHTTPError("timeout")
        if isinstance(exc, requests.exceptions.ConnectionError):
            return ChatHTTPError("connection")
        if isinstance(exc, requests.exceptions.RequestException):
            return ChatHTTPError("generic", detail=str(exc))
        return ChatHTTPError("generic", detail=str(exc))

    def _extract_error(self, body):
        try:
            data = json.loads(body)
            error = data.get("error")
            if isinstance(error, dict):
                return str(error.get("message") or error.get("detail") or "")
            if isinstance(error, str):
                return error
            return str(data.get("message") or "")
        except Exception:
            return (body or "").strip()[:200]

    def _consume_chunk(self, obj, state, gen_id):
        usage = obj.get("usage")
        if isinstance(usage, dict) and usage:
            state["usage"] = usage
        choices = obj.get("choices") or []
        piece = ""
        if choices:
            choice = choices[0] or {}
            delta = choice.get("delta") or {}
            piece = delta.get("content") or ""
            if not piece:
                message = choice.get("message") or {}
                piece = message.get("content") or ""
        if piece:
            now = time.time()
            if state["first"] is None:
                state["first"] = now
            state["last"] = now
            state["text"] += piece
            self.q.put(("chunk", gen_id, piece))

    def _consume_completion(self, data, state, gen_id):
        usage = data.get("usage")
        if isinstance(usage, dict) and usage:
            state["usage"] = usage
        choices = data.get("choices") or []
        text = ""
        if choices:
            choice = choices[0] or {}
            message = choice.get("message") or {}
            text = message.get("content") or choice.get("text") or ""
        if not text and isinstance(data.get("response"), str):
            text = data["response"]
        if text:
            now = time.time()
            if state["first"] is None:
                state["first"] = now
            state["last"] = now
            state["text"] += text
            self.q.put(("chunk", gen_id, text))

    def _stream_request(self, base, payload, state, gen_id):
        url = base + "/v1/chat/completions"
        headers = self.headers()
        headers["Accept"] = "text/event-stream"
        try:
            resp = requests.post(url, json=payload, headers=headers, stream=True,
                                 timeout=(15, 180))
        except Exception as exc:
            raise self._request_error(exc)
        self._active_resp = resp
        try:
            if resp.status_code in (401, 403):
                raise ChatHTTPError("auth")
            if resp.status_code != 200:
                body = ""
                try:
                    body = resp.text[:400]
                except Exception:
                    pass
                raise ChatHTTPError("http", code=resp.status_code,
                                    detail=self._extract_error(body))
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "text/event-stream" not in ctype:
                try:
                    data = resp.json()
                except Exception:
                    raise ChatHTTPError("empty")
                self._consume_completion(data, state, gen_id)
                return
            try:
                lines = resp.iter_lines(decode_unicode=True)
                for raw in lines:
                    if self._cancel.is_set():
                        break
                    if raw is None:
                        continue
                    line = raw.strip() if isinstance(raw, str) else \
                        raw.decode("utf-8", "ignore").strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        data_text = line[5:].strip()
                    elif line.startswith("{"):
                        data_text = line
                    else:
                        continue
                    if data_text == "[DONE]":
                        break
                    try:
                        obj = json.loads(data_text)
                    except Exception:
                        continue
                    self._consume_chunk(obj, state, gen_id)
            except Exception as exc:
                raise self._request_error(exc)
        finally:
            self._active_resp = None
            try:
                resp.close()
            except Exception:
                pass

    def _plain_request(self, base, payload, state, gen_id):
        url = base + "/v1/chat/completions"
        plain = dict(payload)
        plain["stream"] = False
        plain.pop("stream_options", None)
        try:
            resp = requests.post(url, json=plain, headers=self.headers(),
                                 timeout=(15, 150))
        except Exception as exc:
            raise self._request_error(exc)
        try:
            if resp.status_code in (401, 403):
                raise ChatHTTPError("auth")
            if resp.status_code != 200:
                body = ""
                try:
                    body = resp.text[:400]
                except Exception:
                    pass
                raise ChatHTTPError("http", code=resp.status_code,
                                    detail=self._extract_error(body))
            try:
                data = resp.json()
            except Exception:
                raise ChatHTTPError("empty")
            self._consume_completion(data, state, gen_id)
        finally:
            try:
                resp.close()
            except Exception:
                pass

    def _chat_worker(self, gen_id, model, messages):
        base = self.base()
        system = CFG.get("system_prompt") or ""
        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system}] + messages,
            "stream": True,
            "temperature": float(CFG.get("temperature", 0.7) or 0.7),
            "stream_options": {"include_usage": True},
        }
        prompt_text = "\n".join(m.get("content", "") for m in payload["messages"])
        t0 = time.time()
        state = {"text": "", "usage": {}, "first": None, "last": None,
                 "fallback": False, "error": None, "tried_plain": False}
        try:
            try:
                self._stream_request(base, payload, state, gen_id)
            except ChatHTTPError as exc:
                if self._cancel.is_set():
                    pass
                elif exc.kind == "auth":
                    raise
                elif state["text"]:
                    state["error"] = self._error_text(exc)
                    self.q.put(("notice", gen_id, state["error"], "error"))
                elif exc.kind == "timeout":
                    raise
                else:
                    state["fallback"] = True
                    self.q.put(("notice", gen_id, tr("notice_fallback"), "warn"))
                    self._plain_request(base, payload, state, gen_id)
                    state["tried_plain"] = True
            if not state["text"] and not self._cancel.is_set() and not state["error"] \
                    and not state["tried_plain"]:
                state["fallback"] = True
                self.q.put(("notice", gen_id, tr("notice_fallback"), "warn"))
                self._plain_request(base, payload, state, gen_id)
                state["tried_plain"] = True
            if not state["text"] and not self._cancel.is_set() and not state["error"]:
                raise ChatHTTPError("empty")
        except ChatHTTPError as exc:
            self.q.put(("error", gen_id, exc.kind, exc.code, exc.detail))
            return
        except Exception as exc:
            self.q.put(("error", gen_id, "generic", None, str(exc)))
            return

        elapsed = time.time() - t0
        reply_text = state["text"]
        estimated = False
        usage = state["usage"] or {}
        p_tok = safe_int(usage.get("prompt_tokens"))
        r_tok = safe_int(usage.get("completion_tokens"))
        t_tok = safe_int(usage.get("total_tokens"))
        if p_tok is None or r_tok is None or (p_tok + r_tok) <= 0:
            p_tok = estimate_tokens(prompt_text)
            r_tok = estimate_tokens(reply_text)
            t_tok = p_tok + r_tok
            estimated = True
        elif t_tok is None or t_tok <= 0:
            t_tok = p_tok + r_tok
        if state["first"] and state["last"] and state["last"] > state["first"]:
            gen_secs = state["last"] - state["first"]
        else:
            gen_secs = elapsed
        if gen_secs <= 0.05:
            # 太快（或时间精度不足）时退回总耗时，避免显示 0.0 tok/s
            gen_secs = max(elapsed, 0.05)
        tps = (r_tok / gen_secs) if gen_secs > 0 else 0.0
        stats = {
            "prompt": p_tok,
            "reply": r_tok,
            "total": t_tok,
            "tps": round(tps, 1),
            "elapsed": elapsed,
            "estimated": estimated,
            "fallback": state["fallback"],
            "stopped": self._cancel.is_set(),
            "error": state["error"],
            "model": model,
            "reply_text": reply_text,
        }
        self.q.put(("done", gen_id, stats))

    # ==================================================================
    # 队列处理
    # ==================================================================
    def _drain_queue(self):
        if self._closing:
            return
        try:
            processed = 0
            while processed < 400:
                item = self.q.get_nowait()
                processed += 1
                self._handle_event(item)
        except queue.Empty:
            pass
        except Exception:
            traceback.print_exc()
        if self.busy and self._live is not None:
            self._render_usage()
        try:
            self.after(50, self._drain_queue)
        except Exception:
            pass

    def _handle_event(self, item):
        event = item[0]
        if event == "chunk":
            _, gen_id, piece = item
            if gen_id != self._gen_id:
                return
            if self._live is not None:
                self._live["reply_chars"] = int(self._live.get("reply_chars") or 0) + len(piece)
                if self._live.get("first") is None and piece:
                    self._live["first"] = time.time()
            index = self._stream_index
            if index is None or index >= len(self.messages):
                index = self._append_message("assistant", "", now_hm())
                self._stream_index = index
            self.messages[index]["text"] = (self.messages[index].get("text") or "") + piece
            self.messages[index]["placeholder"] = False
            self.chat.update_message(index, self.messages[index]["text"], placeholder=False)
        elif event == "notice":
            _, gen_id, text, level = item
            if gen_id is not None and gen_id != self._gen_id:
                return
            self._append_notice(text, level)
        elif event == "done":
            _, gen_id, stats = item
            if gen_id != self._gen_id:
                return
            self._finish_generation(stats)
        elif event == "error":
            _, gen_id, kind, code, detail = item
            if gen_id != self._gen_id:
                return
            self._fail_generation(ChatHTTPError(kind, code, detail))
        elif event == "status":
            _, kind, ms = item
            self._status_kind = kind
            self._status_ms = ms
            self.connected = kind in ("ok", "warn")
            self._render_status()
        elif event == "models":
            _, names, manual = item
            self._models_loaded = True
            self.models = list(names)
            try:
                self.model_combo.configure(values=names)
            except Exception:
                pass
            current = (self.var_model.get() or "").strip()
            if names and (not current or current not in names):
                self.var_model.set(names[0])
                CFG["model"] = names[0]
                save_config()
            if manual:
                self._toast(tr("models_loaded", n=len(names)))
        elif event == "inbox":
            _, text = item
            self._append_notice(tr("notice_server_msg", text=text), "info")
        elif event == "models_error":
            _, kind, manual = item
            if kind == "auth":
                self._status_kind = "auth"
                self._render_status()
                if manual:
                    self._toast(tr("err_auth"))
            elif manual:
                self._toast(tr("no_models"))

    def _finish_generation(self, stats):
        self.busy = False
        self._active_resp = None
        self._live = None
        self._update_busy_ui()
        index = self._stream_index
        if index is not None and 0 <= index < len(self.messages):
            self.messages[index]["text"] = stats.get("reply_text") or \
                self.messages[index].get("text") or ""
            self.messages[index]["placeholder"] = False
            self.messages[index]["ts"] = now_hm()
            self.chat.update_message(index, self.messages[index]["text"],
                                     ts=self.messages[index]["ts"], placeholder=False)
        self._stream_index = None
        self.current_usage = stats
        if stats.get("stopped"):
            self._append_notice(tr("notice_stopped"), "info")
        self.session["prompt"] += int(stats.get("prompt") or 0)
        self.session["reply"] += int(stats.get("reply") or 0)
        self.session["total"] += int(stats.get("total") or 0)
        self.session["requests"] += 1
        self.session["elapsed"] += float(stats.get("elapsed") or 0.0)
        self.session["model"] = stats.get("model") or CFG.get("model", "")
        self._render_usage()
        self._render_session()
        self._focus_input()

    def _fail_generation(self, exc):
        self.busy = False
        self._active_resp = None
        self._live = None
        self._update_busy_ui()
        index = self._stream_index
        if index is not None and 0 <= index < len(self.messages):
            message = self.messages[index]
            if message.get("role") == "assistant" and not (message.get("text") or "").strip():
                try:
                    self.chat.remove_at(index)
                except Exception:
                    pass
                self.messages.pop(index)
        self._stream_index = None
        self.current_usage = None
        self._append_notice(self._error_text(exc), "error")
        if exc.kind == "auth":
            self._status_kind = "auth"
            self._render_status()
        self._render_usage()
        self._focus_input()

    # ==================================================================
    # 滚动 / 右键菜单 / 复制 / toast
    # ==================================================================
    def _on_mousewheel(self, event):
        try:
            widget = self.winfo_containing(event.x_root, event.y_root)
        except Exception:
            widget = None
        chat = getattr(self, "chat", None)
        target = widget
        while target is not None:
            if chat is not None and target is chat.canvas:
                steps = max(1, abs(int(event.delta)) // 120)
                direction = -1 if event.delta > 0 else 1
                chat.canvas.yview_scroll(direction * steps, "units")
                chat.follow = chat.canvas.yview()[1] >= 0.97
                return "break"
            try:
                target = target.master
            except Exception:
                break
        return None

    def show_bubble_menu(self, event, index):
        if not (0 <= index < len(self.messages)):
            return
        message = self.messages[index]
        menu = tk.Menu(self, tearoff=0)
        if message.get("role") in ("user", "assistant") and message.get("text"):
            menu.add_command(label=tr("copy_message"),
                             command=lambda: self._copy_text(message.get("text")))
        menu.add_command(label=tr("copy_last"),
                         command=lambda: self._copy_text(self._last_reply()))
        menu.add_separator()
        menu.add_command(label=tr("clear_chat"), command=self.clear_chat)
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            try:
                menu.grab_release()
            except Exception:
                pass

    def _last_reply(self):
        for message in reversed(self.messages):
            if message.get("role") == "assistant" and (message.get("text") or "").strip():
                return message.get("text")
        return ""

    def _copy_text(self, text):
        try:
            self.clipboard_clear()
            self.clipboard_append(text or "")
            self.update_idletasks()
            self._toast(tr("copied"))
        except Exception:
            pass

    def clear_chat(self):
        if self.busy:
            self._cancel.set()
            try:
                if self._active_resp is not None:
                    self._active_resp.close()
            except Exception:
                pass
            self._gen_id += 1
            self.busy = False
            self._active_resp = None
            self._live = None
            self._update_busy_ui()
        self.messages = []
        self._stream_index = None
        self.current_usage = None
        self.chat.clear()
        self.chat.show_empty(True)
        self._render_usage()
        self._focus_input()

    def _toast(self, text):
        try:
            if self._toast_label is not None and self._toast_label.winfo_exists():
                self._toast_label.destroy()
        except Exception:
            pass
        try:
            label = tk.Label(self, text=text, font=self.fonts["small"],
                             bg=self.theme["text"], fg=self.theme["bg"],
                             padx=14, pady=6)
            label.place(relx=0.5, rely=0.92, anchor="s")
            self._toast_label = label
            if self._toast_job is not None:
                try:
                    self.after_cancel(self._toast_job)
                except Exception:
                    pass
            self._toast_job = self.after(1500, self._hide_toast)
        except Exception:
            pass

    def _hide_toast(self):
        self._toast_job = None
        try:
            if self._toast_label is not None:
                self._toast_label.destroy()
        except Exception:
            pass
        self._toast_label = None

    # ==================================================================
    # 设置窗口
    # ==================================================================
    def open_settings(self):
        if self._settings_win is not None:
            try:
                if self._settings_win.winfo_exists():
                    self._settings_win.lift()
                    self._settings_win.focus_force()
                    return
            except Exception:
                pass
            self._settings_win = None

        t = self.theme
        fonts = self.fonts
        win = tk.Toplevel(self)
        self._settings_win = win
        win.title(tr("settings_title"))
        win.configure(bg=t["bg"])
        win.resizable(False, False)
        win.transient(self)
        win.grab_set()
        try:
            for icon_path in ICON_CANDIDATES:
                if os.path.exists(icon_path):
                    win.iconbitmap(icon_path)
                    break
        except Exception:
            pass
        scale = 1.0
        try:
            scale = max(1.0, min(2.5, self.winfo_fpixels("1i") / 96.0))
        except Exception:
            scale = 1.0
        width = int(720 * scale)
        height = min(int(610 * scale), self.winfo_screenheight() - 80)
        self.update_idletasks()
        x = self.winfo_rootx() + (self.winfo_width() - width) // 2
        y = self.winfo_rooty() + (self.winfo_height() - height) // 2
        win.geometry("%dx%d+%d+%d" % (width, height, max(0, x), max(0, y)))
        win.after(150, lambda: self._apply_window_chrome(win))

        def on_close():
            try:
                win.grab_release()
            except Exception:
                pass
            win.destroy()
            self._settings_win = None

        header = tk.Frame(win, bg=t["bg"])
        header.pack(fill="x", padx=26, pady=(20, 6))
        tk.Label(header, text=tr("settings_title"), font=fonts["title"],
                 fg=t["text"], bg=t["bg"]).pack(side="left")
        RoundButton(header, tr("close"), on_close, t, fonts["body"], kind="ghost",
                    bg=t["bg"], padx=10, pady=4).pack(side="right")

        tabbar = tk.Frame(win, bg=t["bg"])
        tabbar.pack(fill="x", padx=26)
        body = tk.Frame(win, bg=t["bg"])
        body.pack(fill="both", expand=True, padx=26, pady=(8, 0))

        conn_page = tk.Frame(body, bg=t["bg"])
        look_page = tk.Frame(body, bg=t["bg"])
        about_page = tk.Frame(body, bg=t["bg"])
        pages = {"connection": conn_page, "appearance": look_page, "about": about_page}
        tab_labels = {}
        tabs = (("connection", "tab_connection"), ("appearance", "tab_appearance"),
                ("about", "tab_about"))

        def select_tab(key):
            for name, page in pages.items():
                if name == key:
                    page.pack(fill="both", expand=True)
                else:
                    page.pack_forget()
            for name, label in tab_labels.items():
                if name == key:
                    label.configure(fg=t["accent"])
                else:
                    label.configure(fg=t["text_muted"])

        for key, text_key in tabs:
            label = tk.Label(tabbar, text=tr(text_key), font=fonts["body_bold"],
                             fg=t["text_muted"], bg=t["bg"], cursor="hand2",
                             padx=2, pady=6)
            label.pack(side="left", padx=(0, 22))
            label.bind("<Button-1>", lambda e=None, k=key: select_tab(k))
            tab_labels[key] = label

        # ---- 连接页 ----
        conn_page.columnconfigure(0, weight=1)
        url_var = tk.StringVar(value=CFG.get("server_url") or DEFAULT_SERVER)
        key_var = tk.StringVar(value=CFG.get("api_key") or "")
        model_var = tk.StringVar(value=CFG.get("model") or "")
        msg_var = tk.StringVar(value="")

        def field_label(text, row):
            tk.Label(conn_page, text=text, font=fonts["small"], fg=t["text_muted"],
                     bg=t["bg"], anchor="w").grid(row=row, column=0, sticky="w",
                                                 columnspan=2, pady=(12, 3))

        def make_entry(variable, show=None):
            entry = tk.Entry(conn_page, textvariable=variable, font=fonts["body"],
                             bg=t["input_bg"], fg=t["text"], insertbackground=t["text"],
                             relief="flat", bd=0, highlightthickness=1,
                             highlightbackground=t["border"], highlightcolor=t["accent"])
            if show:
                entry.configure(show=show)
            return entry

        field_label(tr("server_url"), 0)
        url_entry = make_entry(url_var)
        url_entry.grid(row=1, column=0, sticky="ew", padx=(0, 8))
        paste_btn = RoundButton(conn_page, tr("paste_clipboard"), None, t,
                                fonts["small"], kind="secondary", bg=t["bg"],
                                padx=10, pady=5)
        paste_btn.grid(row=1, column=1, sticky="e")

        field_label(tr("api_key"), 2)
        key_entry = make_entry(key_var, show="*")
        key_entry.grid(row=3, column=0, sticky="ew", padx=(0, 8))
        show_btn = RoundButton(conn_page, tr("show_key"), None, t, fonts["small"],
                               kind="secondary", bg=t["bg"], padx=10, pady=5)
        show_btn.grid(row=3, column=1, sticky="e")

        field_label(tr("model_label"), 4)
        model_values = list(self.models) or ([model_var.get()] if model_var.get() else [])
        model_combo = ttk.Combobox(conn_page, textvariable=model_var,
                                   values=model_values,
                                   state="readonly", font=fonts["entry"],
                                   style="Hymnix.TCombobox")
        model_combo.grid(row=5, column=0, sticky="ew", padx=(0, 8))
        refresh_btn = RoundButton(conn_page, tr("refresh_models"), None, t,
                                  fonts["small"], kind="secondary", bg=t["bg"],
                                  padx=10, pady=5)
        refresh_btn.grid(row=5, column=1, sticky="e")

        test_row = tk.Frame(conn_page, bg=t["bg"])
        test_row.grid(row=6, column=0, columnspan=2, sticky="w", pady=(16, 4))
        test_btn = RoundButton(test_row, tr("test_connection"), None, t,
                               fonts["small"], kind="secondary", bg=t["bg"],
                               padx=12, pady=6)
        test_btn.pack(side="left")
        msg_label = tk.Label(conn_page, textvariable=msg_var, font=fonts["small"],
                             fg=t["text_muted"], bg=t["bg"], anchor="w",
                             justify="left", wraplength=620)
        msg_label.grid(row=7, column=0, columnspan=2, sticky="w")

        result_q = queue.Queue()

        def run_async(tag, fn):
            def worker():
                try:
                    result_q.put((tag, "ok", fn()))
                except ChatHTTPError as exc:
                    result_q.put((tag, "err", exc))
                except Exception as exc:
                    result_q.put((tag, "err", ChatHTTPError("generic", detail=str(exc))))
            threading.Thread(target=worker, daemon=True).start()

        def poll_results():
            if not win.winfo_exists():
                return
            try:
                while True:
                    tag, state, value = result_q.get_nowait()
                    if state == "ok":
                        msg_label.configure(fg=t["ok"])
                        if tag == "models":
                            names = value
                            model_combo.configure(values=names)
                            if names and (not model_var.get() or model_var.get() not in names):
                                model_var.set(names[0])
                            msg_var.set(tr("models_loaded", n=len(names)))
                        else:
                            msg_var.set(tr("test_ok", ms=value))
                    else:
                        msg_label.configure(fg=t["bad"])
                        if tag == "models":
                            msg_var.set(self._error_text(value))
                        else:
                            msg_var.set(tr("test_fail", msg=self._error_text(value)))
            except queue.Empty:
                pass
            try:
                win.after(120, poll_results)
            except Exception:
                pass

        win.after(120, poll_results)

        def toggle_key():
            hidden = (key_entry.cget("show") or "") == "*"
            key_entry.configure(show="" if hidden else "*")
            show_btn.set_text(tr("hide_key") if hidden else tr("show_key"))

        def paste_info():
            try:
                text = self.clipboard_get()
            except Exception:
                msg_var.set(tr("paste_empty"))
                return
            match = re.search(r"https?://[^\s'\"<>]+", text or "")
            if match:
                url_var.set(match.group(0).rstrip("/"))
            key_match = re.search(r"(Hymnix[0-9A-Za-z\-]+)", text or "")
            if key_match:
                key_var.set(key_match.group(1))
            if match or key_match:
                msg_var.set(tr("paste_ok"))
            else:
                msg_var.set(tr("paste_empty"))

        def do_refresh():
            msg_label.configure(fg=t["text_muted"])
            msg_var.set(tr("refreshing"))
            run_async("models", lambda: self.fetch_models(url_var.get(), key_var.get()))

        def do_test():
            msg_label.configure(fg=t["text_muted"])
            msg_var.set(tr("testing"))

            def test():
                started = time.time()
                base = normalize_base(url_var.get())
                if not base:
                    raise ChatHTTPError("generic", detail=tr("url_required"))
                key = (key_var.get() or "").strip()
                headers = {"Authorization": "Bearer " + key} if key else {}
                try:
                    resp = requests.get(base + "/health", timeout=5)
                except requests.exceptions.Timeout:
                    raise ChatHTTPError("timeout")
                except requests.exceptions.ConnectionError:
                    raise ChatHTTPError("connection")
                except Exception as exc:
                    raise ChatHTTPError("generic", detail=str(exc))
                ms = int((time.time() - started) * 1000)
                if resp.status_code != 200:
                    raise ChatHTTPError("http", code=resp.status_code)
                try:
                    self.fetch_models(url_var.get(), key_var.get())
                except ChatHTTPError as exc:
                    if exc.kind == "auth":
                        raise
                return ms

            run_async("test", test)

        show_btn.command = toggle_key
        paste_btn.command = paste_info
        refresh_btn.command = do_refresh
        test_btn.command = do_test

        # ---- 外观页 ----
        look_page.columnconfigure(0, weight=1)
        lang_display = dict(LANG_OPTIONS)
        current_lang_display = lang_display.get(self.lang, lang_display["zh"])
        theme_display = {tr("theme_light"): "light", tr("theme_dark"): "dark"}
        current_theme_display = tr("theme_light") if self.theme_key == "light" \
            else tr("theme_dark")

        tk.Label(look_page, text=tr("language"), font=fonts["small"],
                 fg=t["text_muted"], bg=t["bg"], anchor="w").grid(
            row=0, column=0, sticky="w", pady=(14, 3))
        lang_var = tk.StringVar(value=current_lang_display)
        lang_combo = ttk.Combobox(look_page, textvariable=lang_var,
                                  values=[d for _, d in LANG_OPTIONS],
                                  state="readonly", font=fonts["entry"],
                                  style="Hymnix.TCombobox")
        lang_combo.grid(row=1, column=0, sticky="ew")

        tk.Label(look_page, text=tr("theme"), font=fonts["small"],
                 fg=t["text_muted"], bg=t["bg"], anchor="w").grid(
            row=2, column=0, sticky="w", pady=(16, 3))
        theme_var = tk.StringVar(value=current_theme_display)
        theme_combo = ttk.Combobox(look_page, textvariable=theme_var,
                                   values=list(theme_display.keys()),
                                   state="readonly", font=fonts["entry"],
                                   style="Hymnix.TCombobox")
        theme_combo.grid(row=3, column=0, sticky="ew")
        tk.Label(look_page, text=tr("settings_note"), font=fonts["tiny"],
                 fg=t["text_faint"], bg=t["bg"], anchor="w").grid(
            row=4, column=0, sticky="w", pady=(14, 0))

        # ---- 关于页 ----
        about_logo = tk.Canvas(about_page, width=56, height=56, bg=t["bg"],
                               highlightthickness=0, bd=0)
        round_rect(about_logo, 2, 2, 54, 54, 14, fill=t["accent"], outline="")
        about_logo.create_text(28, 28, text="H", font=fonts["title"],
                               fill=t["accent_text"])
        about_logo.pack(anchor="w", pady=(14, 8))
        tk.Label(about_page, text="%s %s" % (APP_NAME, APP_VER), font=fonts["title"],
                 fg=t["text"], bg=t["bg"]).pack(anchor="w")
        tk.Label(about_page, text=tr("about_version", ver=APP_VER),
                 font=fonts["small"], fg=t["text_muted"], bg=t["bg"]).pack(
            anchor="w", pady=(2, 10))
        tk.Label(about_page, text=tr("about_desc"), font=fonts["body"],
                 fg=t["text_muted"], bg=t["bg"], wraplength=620,
                 justify="left").pack(anchor="w")
        tk.Label(about_page, text="%s: %s" % (tr("config_path"), CONFIG_PATH),
                 font=fonts["tiny"], fg=t["text_faint"], bg=t["bg"],
                 wraplength=620, justify="left").pack(anchor="w", pady=(14, 0))

        # ---- 底部按钮 ----
        footer = tk.Frame(win, bg=t["bg"])
        footer.pack(fill="x", padx=26, pady=(10, 18))
        msg_footer = tk.Label(footer, text=tr("settings_note"), font=fonts["tiny"],
                              fg=t["text_faint"], bg=t["bg"])
        msg_footer.pack(side="left")

        def do_save():
            base = normalize_base(url_var.get())
            if not base:
                msg_label.configure(fg=t["bad"])
                msg_var.set(tr("url_required"))
                return
            CFG["server_url"] = base
            CFG["api_key"] = (key_var.get() or "").strip()
            CFG["model"] = (model_var.get() or "").strip()
            reverse_lang = {display: code for code, display in LANG_OPTIONS}
            CFG["language"] = reverse_lang.get(lang_var.get(), self.lang)
            CFG["theme"] = theme_display.get(theme_var.get(), self.theme_key)
            ok, error = save_config()
            if not ok:
                msg_label.configure(fg=t["bad"])
                msg_var.set(tr("save_failed", msg=error))
                return
            LANG["cur"] = CFG["language"]
            self.lang = CFG["language"]
            self.theme_key = CFG["theme"]
            self.theme = THEMES[self.theme_key]
            on_close()
            self._rebuild_ui()
            self._models_auto_attempts = 0
            self._refresh_models_async()

        RoundButton(footer, tr("cancel"), on_close, t, fonts["body"], kind="ghost",
                    bg=t["bg"], padx=14, pady=6).pack(side="right")
        RoundButton(footer, tr("save"), do_save, t, fonts["body_bold"],
                    kind="primary", bg=t["bg"], padx=18, pady=7).pack(
            side="right", padx=(0, 8))

        win.bind("<Escape>", lambda e=None: on_close())
        select_tab("connection")
        win.after(80, lambda: win.focus_force())

    def _rebuild_ui(self):
        saved_text = ""
        placeholder = False
        try:
            if hasattr(self, "input_text") and self.input_text.winfo_exists():
                saved_text = self.input_text.get("1.0", "end-1c")
                placeholder = self._placeholder_active
        except Exception:
            saved_text = ""
            placeholder = False
        old_stream_index = self._stream_index
        self._build_ui()
        if self.busy and old_stream_index is not None and \
                0 <= old_stream_index < len(self.messages):
            self._stream_index = old_stream_index
        try:
            self.input_text.delete("1.0", "end")
            if saved_text and not placeholder:
                self.input_text.insert("1.0", saved_text)
                self.input_text.mark_set("insert", "end-1c")
            else:
                self._placeholder_active = False
                self._set_placeholder(True)
        except Exception:
            pass
        self._update_busy_ui()

    # ==================================================================
    # 窗口 / 关闭 / 测试模式
    # ==================================================================
    def _center_window(self):
        if not self._first_build:
            return
        try:
            self.update_idletasks()
            screen_w = self.winfo_screenwidth()
            screen_h = self.winfo_screenheight()
            scale = 1.0
            try:
                scale = max(1.0, min(2.5, self.winfo_fpixels("1i") / 96.0))
            except Exception:
                scale = 1.0
            avail_w = max(640, screen_w - 60)
            avail_h = max(520, screen_h - 100)
            width = min(int(1020 * scale), avail_w)
            height = min(int(790 * scale), avail_h)
            width = max(width, min(int(860 * scale), avail_w))
            height = max(height, min(int(620 * scale), avail_h))
            self.minsize(min(int(860 * scale), avail_w),
                         min(int(620 * scale), avail_h))
            x = max(0, (screen_w - width) // 2)
            y = max(0, (screen_h - height) // 2 - 20)
            self.geometry("%dx%d+%d+%d" % (width, height, x, y))
        except Exception:
            pass

    def _ensure_window_visible(self):
        """启动后确认窗口已映射，避免某些环境下只渲染局部区域的错觉。"""
        try:
            if not self.winfo_viewable():
                self.deiconify()
            self.update_idletasks()
        except Exception:
            pass

    def _on_close(self):
        self._closing = True
        try:
            self._cancel.set()
            if self._active_resp is not None:
                self._active_resp.close()
        except Exception:
            pass
        try:
            self.destroy()
        except Exception:
            pass

    # ---- 冒烟 / 自动测试 ----
    def _collect_state(self):
        widgets = {}
        for name in ("topbar", "chat", "composer_card", "input_text",
                     "status_pill", "model_combo", "send_btn", "stop_btn"):
            widget = getattr(self, name, None)
            try:
                widgets[name] = bool(widget is not None and widget.winfo_exists())
            except Exception:
                widgets[name] = False
        widgets["usage_bar"] = bool(hasattr(self, "var_usage"))
        try:
            chat_messages = len(self.chat.bubbles)
        except Exception:
            chat_messages = -1
        return {
            "ok": True,
            "window_viewable": bool(self.winfo_viewable()),
            "title": self.title(),
            "status_kind": self._status_kind,
            "status_text": self._status_text(),
            "connected": self.connected,
            "models": list(self.models),
            "lang": self.lang,
            "theme": self.theme_key,
            "message_count": len(self.messages),
            "chat_bubble_count": chat_messages,
            "widgets": widgets,
            "usage_text": self.var_usage.get() if hasattr(self, "var_usage") else "",
            "session_text": self.var_session.get() if hasattr(self, "var_session") else "",
            "config_path": CONFIG_PATH,
            "version": APP_VER,
            "window_geometry": self.geometry(),
            "screen_size": [self.winfo_screenwidth(), self.winfo_screenheight()],
            "dpi_scale": round(self.winfo_fpixels("1i") / 96.0, 2),
            "layout": self._layout_state(),
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }

    def _layout_state(self):
        state = {}
        for name, widget in (("topbar", getattr(self, "topbar", None)),
                             ("chat", getattr(self, "chat", None)),
                             ("composer", getattr(self, "composer_card", None)),
                             ("usage", getattr(self, "usage_bar", None))):
            try:
                state[name] = {
                    "mapped": bool(widget is not None and widget.winfo_ismapped()),
                    "width": int(widget.winfo_width()) if widget is not None else 0,
                    "height": int(widget.winfo_height()) if widget is not None else 0,
                }
            except Exception:
                state[name] = {"mapped": False, "width": 0, "height": 0}
        return state

    def _write_result(self, path, prefix, payload):
        text = json.dumps(payload, ensure_ascii=False, indent=2)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception:
            pass
        try:
            print(prefix, json.dumps(payload, ensure_ascii=False))
            sys.stdout.flush()
        except Exception:
            pass

    def start_smoke(self, wait, result_path):
        def finish():
            if not self.winfo_exists():
                return
            payload = self._collect_state()
            payload["mode"] = "smoke"
            self._write_result(result_path, "SMOKE_RESULT", payload)
            self.destroy()
        self.after(int(max(1.0, wait) * 1000), finish)

    def start_autotest(self, message, wait, result_path, keep_open=False):
        def kick():
            if not self.winfo_exists():
                return
            try:
                self._placeholder_active = False
                self.input_text.delete("1.0", "end")
                self.input_text.insert("1.0", message)
                self.send_message()
            except Exception:
                traceback.print_exc()
            self._autotest_deadline = time.time() + wait
            self._poll_autotest(result_path, keep_open)
        self.after(900, kick)

    def _poll_autotest(self, result_path, keep_open=False):
        if not self.winfo_exists():
            return
        if self.busy and time.time() < self._autotest_deadline:
            self.after(200, lambda: self._poll_autotest(result_path, keep_open))
            return
        timed_out = bool(self.busy)
        if timed_out:
            self._cancel.set()
        payload = self._collect_state()
        reply = ""
        for message in reversed(self.messages):
            if message.get("role") == "assistant":
                reply = message.get("text") or ""
                break
        payload.update({
            "mode": "autotest",
            "timeout": timed_out,
            "reply": reply,
            "usage": dict(self.current_usage) if self.current_usage else None,
            "session": dict(self.session),
            "notices": [m.get("text") for m in self.messages
                        if m.get("role") == "notice"],
            "errors": [m.get("text") for m in self.messages
                       if m.get("role") == "notice" and m.get("level") == "error"],
            "fallback_notice": any(
                (m.get("text") or "") == tr("notice_fallback")
                for m in self.messages if m.get("role") == "notice"),
        })
        self._write_result(result_path, "AUTOTEST_RESULT", payload)
        if not keep_open:
            self.after(150, self.destroy)


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------
def parse_args(argv):
    opts = {
        "smoke": False,
        "smoke_wait": 7.0,
        "autotest": None,
        "autotest_wait": 90.0,
        "lang": None,
        "theme": None,
        "result": None,
        "keep_open": False,
    }
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--smoke":
            opts["smoke"] = True
        elif arg == "--smoke-wait" and index + 1 < len(argv):
            opts["smoke_wait"] = float(argv[index + 1])
            index += 1
        elif arg == "--autotest" and index + 1 < len(argv):
            opts["autotest"] = argv[index + 1]
            index += 1
        elif arg == "--autotest-wait" and index + 1 < len(argv):
            opts["autotest_wait"] = float(argv[index + 1])
            index += 1
        elif arg == "--lang" and index + 1 < len(argv):
            opts["lang"] = argv[index + 1]
            index += 1
        elif arg == "--theme" and index + 1 < len(argv):
            opts["theme"] = argv[index + 1]
            index += 1
        elif arg == "--result" and index + 1 < len(argv):
            opts["result"] = argv[index + 1]
            index += 1
        elif arg == "--keep-open":
            opts["keep_open"] = True
        index += 1
    return opts


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    opts = parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

    app = ClientApp(cli_lang=opts["lang"], cli_theme=opts["theme"])
    result_path = opts["result"] or os.path.join(
        os.environ.get("TEMP") or os.path.expanduser("~"), "hymnix_smoke.json")
    if opts["autotest"] is not None:
        app.start_autotest(opts["autotest"], opts["autotest_wait"],
                           result_path, opts["keep_open"])
    elif opts["smoke"]:
        app.start_smoke(opts["smoke_wait"], result_path)
    try:
        app.mainloop()
    except KeyboardInterrupt:
        try:
            app.destroy()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
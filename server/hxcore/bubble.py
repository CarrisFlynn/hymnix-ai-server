"""Pure geometry and style calculations for chat bubbles."""
from __future__ import annotations
import datetime

USER = {"bg":"#EFF6FF","radius":12,"radius_near_avatar":4,"pad_x":12,"pad_y":14,"side":"right","max_ratio":0.78}
AI = {"bg":"#FFFFFF","border":"#EAECF0","radius":12,"pad_x":14,"pad_y":16,"side":"left","max_ratio":0.78}
META = {"fg":"#98A2B3","size":12}
AVATAR = {"size":28,"ai_text":"H","ai_bg":"#2563EB","ai_fg":"#FFFFFF","user_bg":"#2563EB","user_fg":"#FFFFFF"}
MAX_BUBBLE_PX = 780

def _is_user(role):
    try: return str(role).lower() == "user"
    except Exception: return False

def side(role):
    return "right" if _is_user(role) else "left"

def style(role):
    try: return dict(USER if _is_user(role) else AI)
    except Exception: return dict(AI)

def max_width_px(container_px, role="user"):
    try: value = int(float(container_px) * (USER if _is_user(role) else AI)["max_ratio"])
    except Exception: value = 160
    return max(160, min(MAX_BUBBLE_PX, value))

def corners(role):
    if _is_user(role): return {"tl":12,"tr":4,"br":4,"bl":12}
    return {"tl":4,"tr":12,"br":12,"bl":4}

def avatar(role, name=""):
    if _is_user(role):
        try: text = str(name or "U").strip()[:1] or "U"
        except Exception: text = "U"
        return {"kind":"initial","text":text,"bg":AVATAR["user_bg"],"fg":AVATAR["user_fg"],"size":28}
    return {"kind":"icon","text":"H","bg":AVATAR["ai_bg"],"fg":AVATAR["ai_fg"],"size":28}

def _time(ts):
    try:
        if ts is None or ts == "": return ""
        if isinstance(ts, (int,float)):
            value=float(ts); value=value/1000 if value > 100000000000 else value
            return datetime.datetime.fromtimestamp(value).strftime("%H:%M")
        text=str(ts).strip().replace("Z","+00:00")
        return datetime.datetime.fromisoformat(text).strftime("%H:%M")
    except Exception: return ""

def meta(name, ts=None):
    return {"name":str(name or ""),"time":_time(ts),"fg":"#98A2B3","size":12,"sep":" · "}

def wrap_chars(width_px, font_px=11):
    try: width=float(width_px); font=max(1.0,float(font_px))
    except Exception: return 20
    return max(20, int(width / font))

if __name__ == "__main__" and "--selftest" in __import__("sys").argv:
    assert side("user") == "right" and side("assistant") == "left"
    assert max_width_px(2000) == 780 and avatar("user", "张")["text"] == "张"
    print("SELFTEST OK")

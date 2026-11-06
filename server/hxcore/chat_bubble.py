"""Tk chat bubble cards and scrollable message list."""
from __future__ import annotations
import os, re, sys, datetime, traceback
import tkinter as tk
from tkinter import font as tkfont
try:
 from hxcore import md_render
except Exception:
 md_render=None
if md_render is None:
 class _FallbackMarkdown:
  @staticmethod
  def parse(text):
   value=str(text or "")
   if value.startswith("```") and value.rstrip().endswith("```"):
    rows=value.splitlines(); return [{"type":"code","text":"\n".join(rows[1:-1])}]
   return [{"type":"paragraph","text":value}]
 md_render=_FallbackMarkdown()

def _bg(widget):
 for option in ("bg","background"):
  try:
   value=widget.cget(option)
   if isinstance(value,str) and value:return value
  except Exception:pass
 return "#FFFFFF"

BG_CARD="#FFFFFF"; BORDER="#EAECF0"; BG_USER="#EFF6FF"; TEXT="#111827"; MUTED="#98A2B3"; ACCENT="#2563EB"
RADIUS=12; RADIUS_TAIL=4; PAD_X=14; PAD_Y=12; AVATAR=28; META_H=18; GAP=8

class ChatBubble(tk.Frame):
    def __init__(self, master, *, role="assistant", name="AI 助手", time_text="", text="", md=None, max_width_px=760, on_copy=None, font_family=None):
        super().__init__(master, bg=_bg(master))
        self.role = "user" if role == "user" else "assistant"; self.name=name; self.time_text=time_text; self.max_width_px=max(160,int(max_width_px)); self.on_copy=on_copy; self.font_family=font_family or "TkDefaultFont"; self._after_id=None; self._streaming=False; self._text=text; self._md=bool(md if md is not None else True); self.blocks=[]; self.code_blocks=[]; self._md=bool(md if md is not None else True); self.blocks=[]; self.code_blocks=[]
        self.canvas=tk.Canvas(self, highlightthickness=0, bd=0, bg=_bg(self), height=1, width=self.max_width_px); self.canvas.pack(fill="both",expand=True)
        self._render()
    def _render(self):
        self.canvas.delete("all")
        self._copy_done = False
        try:
            self.blocks = md_render.parse(self._text) if self._md and md_render else [{"type": "paragraph", "text": str(self._text or "")}]
        except Exception:
            self.blocks = [{"type": "paragraph", "text": str(self._text or "")}]
        self.code_blocks = [b for b in self.blocks if b.get("type") == "code"]
        width = max(180, min(self.max_width_px, int(self.max_width_px)))
        font = tkfont.Font(family=self.font_family, size=11)
        bold = tkfont.Font(family=self.font_family, size=11, weight="bold")
        mono = tkfont.Font(family="TkFixedFont", size=10)
        line_h = font.metrics("linespace")
        code_h = mono.metrics("linespace")
        body_x = PAD_X
        text_limit = max(100, width - 2 * PAD_X - AVATAR - GAP - 10)
        code_limit = max(100, width - 2 * PAD_X - 24)
        wrapped = []

        def wrap_words(raw, f, typ, prefix=""):
            line = ""
            for word in re.split(r"(\s+)", prefix + raw):
                if line and f.measure(line + word) > text_limit:
                    wrapped.append((line, f, typ)); line = word.lstrip()
                else:
                    line += word
            wrapped.append((line, f, typ))

        for block in self.blocks:
            raw = str(block.get("text", ""))
            typ = block.get("type")
            if typ == "code":
                for code_line in raw.split("\n"):
                    line = ""
                    for word in re.split(r"(\s+)", code_line):
                        if line and mono.measure(line + word) > code_limit:
                            wrapped.append((line, mono, "code")); line = word.lstrip()
                        else:
                            line += word
                    wrapped.append((line, mono, "code"))
                continue
            f = bold if typ == "heading" else font
            prefix = "• " if typ == "list_item" and not block.get("ordered") else "1. " if typ == "list_item" else ""
            wrap_words(raw, f, typ, prefix)
        if not wrapped:
            wrapped = [("", font, "paragraph")]
        heights = [code_h if typ == "code" else line_h for _, _, typ in wrapped]
        body_h = sum(heights)
        total_h = PAD_Y + META_H + 4 + body_h + PAD_Y
        self.canvas.configure(width=width, height=total_h)
        bg = BG_USER if self.role == "user" else BG_CARD
        self.canvas.create_arc(0, 0, 24, 24, start=90, extent=90, fill=bg, outline=bg, tags="card")
        self.canvas.create_arc(width - 24, 0, width, 24, start=0, extent=90, fill=bg, outline=bg, tags="card")
        self.canvas.create_rectangle(12, 0, width - 12, 24, fill=bg, outline=bg, tags="card")
        self.canvas.create_rectangle(0, 12, width, total_h - 12, fill=bg, outline=bg, tags="card")
        self.canvas.create_arc(0, total_h - 24, 24, total_h, start=180, extent=90, fill=bg, outline=bg, tags="card")
        self.canvas.create_arc(width - 24, total_h - 24, width, total_h, start=270, extent=90, fill=bg, outline=bg, tags="card")
        if self.role != "user":
            self.canvas.create_rectangle(0, 0, width, total_h, outline=BORDER, width=1, tags="card")
        ax = width - AVATAR - 8 if self.role == "user" else 8
        ay = PAD_Y
        self.canvas.create_oval(ax, ay, ax + AVATAR, ay + AVATAR, fill=ACCENT, outline=ACCENT, tags="avatar")
        self.canvas.create_text(ax + 14, ay + 14, text=("U" if self.role == "user" else "H"), fill="#FFFFFF", font=(self.font_family, 11, "bold"), tags="avatar")
        mx = 8 if self.role == "user" else AVATAR + GAP + 8
        self.canvas.create_text(mx, PAD_Y + 9, text=(str(self.name) + (" · " + str(self.time_text) if self.time_text else "")), anchor="w", fill=MUTED, font=(self.font_family, 12), tags="meta")
        cy = PAD_Y + META_H + 8
        index = 0
        total = len(wrapped)
        while index < total:
            line, f, typ = wrapped[index]
            if typ == "code":
                start = index
                while index < total and wrapped[index][2] == "code":
                    index += 1
                block_h = sum(heights[start:index])
                top = cy - 3
                self.canvas.create_rectangle(12, top, width - 12, top + block_h + 6, fill="#0F172A", outline="#0F172A", tags="code_bg")
                for j in range(start, index):
                    self.canvas.create_text(24, cy, anchor="nw", text=wrapped[j][0], fill="#E6EDF3", font=mono, tags="code")
                    cy += code_h
                code_text = "\n".join(str(b.get("text", "")) for b in self.code_blocks)
                self._copy_button(width, top, code_text)
                cy += 6
                continue
            self.canvas.create_text(body_x, cy, anchor="nw", text=line, fill=TEXT, font=f, tags="body")
            cy += line_h
            index += 1
        if self._streaming:
            self.canvas.create_rectangle(PAD_X, cy, PAD_X + 7, cy + line_h - 2, fill=ACCENT, outline=ACCENT, tags="cursor")
        del font, bold, mono

    def _copy_button(self, width, top, code_text):
        try:
            rect = self.canvas.create_rectangle(width - 72, top + 7, width - 22, top + 25, fill="#1E293B", outline="#334155", tags="copy_button")
            label = self.canvas.create_text(width - 47, top + 16, text="Copy", fill="#E6EDF3", font=(self.font_family, 9), tags="copy_button")
            for item in (rect, label):
                self.canvas.tag_bind(item, "<Button-1>", lambda e, value=code_text: self._copy_code(value))
        except Exception:
            pass

    def _copy_code(self,code):
        try:
            self.clipboard_clear(); self.clipboard_append(code)
            if callable(self.on_copy):self.on_copy(code)
            self.canvas.itemconfigure("copy_button",text="已复制 / Copied"); self.after(1200,self._render)
        except Exception:pass
    def set_text(self,text,md=True): self._text=str(text or ""); self._md=bool(md); self._render()
    def set_meta(self,name=None,time_text=None):
        if name is not None:self.name=name
        if time_text is not None:self.time_text=time_text
        self._render()
    def _tick(self):
        self._after_id=None
        if self._streaming:self._render(); self._after_id=self.after(500,self._tick)
    def set_streaming(self,flag):
        self._streaming=bool(flag)
        if self._after_id:
            try:self.after_cancel(self._after_id)
            except Exception:pass
            self._after_id=None
        if self._streaming:self._after_id=self.after(500,self._tick)
        self._render()
    def bubble_geometry(self):
        self.update_idletasks(); w=max(160, int(self.canvas.winfo_width() or self.max_width_px)); h=int(self.canvas.winfo_height() or 1)
        return {"x":int(self.winfo_x()),"y":int(self.winfo_y()),"w":w,"h":h,"avatar_w":AVATAR,"avatar_h":AVATAR,"side":"right" if self.role=="user" else "left","blocks":len(self.blocks),"code_blocks":len(self.code_blocks)}
    def destroy(self):
        if self._after_id:
            try:self.after_cancel(self._after_id)
            except Exception:pass
            self._after_id=None
        super().destroy()

class MessageList(tk.Frame):
    def __init__(self, master, *, on_copy=None):
        super().__init__(master,bg=_bg(master)); self.on_copy=on_copy; self._jump_cb=None
        self.canvas=tk.Canvas(self,bg=_bg(self),highlightthickness=0); self.scrollbar=tk.Scrollbar(self,orient="vertical",command=self.canvas.yview,width=8,activebackground="#98A2B3",bg="#D0D5DD"); self.canvas.configure(yscrollcommand=self.scrollbar.set); self.canvas.pack(side="left",fill="both",expand=True); self.scrollbar.pack(side="right",fill="y")
        self.inner=tk.Frame(self.canvas,bg=_bg(self)); self.window=self.canvas.create_window((0,0),window=self.inner,anchor="nw"); self.inner.bind("<Configure>",lambda e:self.canvas.configure(scrollregion=self.canvas.bbox("all"))); self._resize_id=None; self.canvas.bind("<Configure>",self._resize); self.bubbles=[]; self.jump=tk.Button(self,text="回到最新 / Back to latest",command=lambda:self.scroll_to_bottom(True),fg=ACCENT,bg=BG_CARD,activeforeground=ACCENT,relief="solid",bd=1)
    def _resize(self,event):
        self.canvas.itemconfigure(self.window,width=event.width)
        if self._resize_id:
            try:self.after_cancel(self._resize_id)
            except Exception:pass
        self._resize_id=self.after(80,self._relayout)
    def _relayout(self):
        self._resize_id=None; width=max(160,min(760,int(self.canvas.winfo_width()*0.78)))
        for bubble in self.bubbles:bubble.max_width_px=width; bubble._render()
    def append(self,role,name,time_text,text,md=True):
        visible=max(160,int(self.canvas.winfo_width()*0.78)) if self.canvas.winfo_width()>1 else 760
        b=ChatBubble(self.inner,role=role,name=name,time_text=time_text,text=text,md=md,max_width_px=min(760,visible),on_copy=self.on_copy); b.pack(anchor="e" if role=="user" else "w",padx=12,pady=4); self.bubbles.append(b); self.scroll_to_bottom(); return b
    def append_streaming(self,role,name,time_text):
        b=self.append(role,name,time_text,""); b.set_streaming(True); return b
    def clear(self):
        if self._resize_id:
            try:self.after_cancel(self._resize_id)
            except Exception:pass
            self._resize_id=None
        for b in self.bubbles:b.destroy()
        self.bubbles=[]; self.canvas.yview_moveto(0)
    def scroll_to_bottom(self,animate=False): self.update_idletasks(); self.canvas.yview_moveto(1.0); self.show_jump(False)
    def at_bottom(self,tol=0.999):
        try:return self.canvas.yview()[1]>=float(tol)
        except Exception:return True
    def show_jump(self,show):
        if show:self.jump.place(relx=.5,rely=1,anchor="s",y=-8)
        else:self.jump.place_forget()
    def on_jump(self,callback): self._jump_cb=callback; self.jump.configure(command=lambda:(self.scroll_to_bottom(),callback()))

if __name__ == "__main__" and "--selftest" in sys.argv:
    try:
        root=tk.Tk(); root.withdraw(); ml=MessageList(root); ml.pack(); ml.append("user","U","12:00","hello"); b=ml.append("assistant","H","12:01","```py"+chr(10)+"print(1)"+chr(10)+"```"); root.update(); assert len(ml.bubbles)==2 and b.bubble_geometry()["code_blocks"]==1; root.destroy(); print("CHAT BUBBLE OK")
    except Exception:
        traceback.print_exc(); raise
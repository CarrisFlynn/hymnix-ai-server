# -*- coding: utf-8 -*-
"""Token usage and cost dashboard."""
from __future__ import annotations
import sys
import tkinter as tk
try:
    from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, Tag, _page_header, _label, _separator, _round_rect
except Exception:
    _UI = ScrollPage = RoundedCard = PillButton = Tag = _page_header = _label = _separator = _round_rect = None
try:
    from hxcore import tokens
except Exception:
    tokens = None

__all__ = ["build_usage_page"]

def _t(ui, zh, en):
    try: return ui.t(zh, en)
    except Exception: return zh

def _num(value):
    try: return int(value or 0)
    except Exception: return 0

def _money(value):
    try: return f"{float(value or 0):.6f}"
    except Exception: return "0.000000"

def _load_summary(days):
    try:
        from hxcore import tokens as api
        return api.summary(days), True
    except Exception:
        return {}, False

def build_usage_page(app, parent) -> None:
    try:
        ui=_UI(app,parent); theme=ui.theme; t=lambda zh,en:_t(ui,zh,en)
        page=ScrollPage(parent,ui); page.pack(fill="both",expand=True)
        content=page.content; content.columnconfigure(0,weight=1)
        head=_page_header(content,ui,"USAGE",t("用量与成本","Usage & cost"),t("查看近期模型调用量与费用估算。","Review recent model usage and estimated costs."))
        head.grid(row=0,column=0,sticky="ew",pady=(0,ui.px(10)))
        controls=tk.Frame(content,bg=theme["bg"]);controls.grid(row=1,column=0,sticky="ew",pady=(0,ui.px(8)))
        period=tk.IntVar(value=7); state={"days":7,"summary":{},"available":False}
        summary_area=tk.Frame(content,bg=theme["bg"]);summary_area.grid(row=2,column=0,sticky="ew")
        summary_area.columnconfigure(0,weight=1)
        lower=tk.Frame(content,bg=theme["bg"]);lower.grid(row=3,column=0,sticky="ew",pady=(ui.px(10),0))
        lower.columnconfigure(0,weight=1,uniform="usage")
        lower.columnconfigure(1,weight=1,uniform="usage")
        model_card=RoundedCard(lower,ui,pad=12,radius=8,shadow=False)
        day_card=RoundedCard(lower,ui,pad=12,radius=8,shadow=False)
        def arrange_cards(event=None):
            # 始终上下单列：双列在 1100~1300 宽度下会把“按天”卡片挤到窗口外（R3 评审 P1）。
            model_card.grid(row=0,column=0,columnspan=2,sticky="ew",pady=(0,ui.px(8)))
            day_card.grid(row=1,column=0,columnspan=2,sticky="ew")
        arrange_cards()
        mb,db=model_card.body,day_card.body;mb.columnconfigure(0,weight=1);db.columnconfigure(0,weight=1)
        _label(mb,text=t("按模型","By model"),font=ui.font_obj(12,"bold"),fg=theme["text"],bg=theme["card"]).grid(row=0,column=0,sticky="w")
        _label(db,text=t("按天","By day"),font=ui.font_obj(12,"bold"),fg=theme["text"],bg=theme["card"]).grid(row=0,column=0,sticky="w")
        model_rows=tk.Frame(mb,bg=theme["card"]);model_rows.grid(row=1,column=0,sticky="ew",pady=(ui.px(8),0))
        chart=tk.Canvas(db,height=175,bg=theme["card"],highlightthickness=0);chart.grid(row=1,column=0,sticky="ew",pady=(ui.px(8),0))
        def render():
            for c in summary_area.winfo_children():c.destroy()
            for c in model_rows.winfo_children():c.destroy()
            chart.delete("all")
            data=state["summary"]
            if not state["available"]:
                card=RoundedCard(summary_area,ui,pad=16,radius=8,shadow=False);card.grid(row=0,column=0,sticky="ew")
                _label(card.body,text=t("模块未就绪","Module not ready"),font=ui.font_obj(10),fg=theme["text_muted"],bg=theme["card"]).pack(anchor="w")
                return
            stats=RoundedCard(summary_area,ui,pad=12,radius=8,shadow=False);stats.grid(row=0,column=0,sticky="ew")
            values=[(t("调用数","Calls"),_num(data.get("calls"))),(t("输入 Token","Prompt tokens"),_num(data.get("prompt"))),(t("输出 Token","Completion tokens"),_num(data.get("completion"))),(t("费用 USD","Cost USD"),"$"+_money(data.get("usd"))),(t("费用 CNY","Cost CNY"),"¥"+_money(data.get("cny")))]
            for i,(label,value) in enumerate(values):
                cell=tk.Frame(stats.body,bg=theme["card"]);cell.grid(row=0,column=i,sticky="ew",padx=(0,ui.px(12)))
                _label(cell,text=label,font=ui.font_obj(8),fg=theme["text_muted"],bg=theme["card"]).pack(anchor="w")
                _label(cell,text=str(value),font=ui.font_obj(12,"bold"),fg=theme["text"],bg=theme["card"]).pack(anchor="w",pady=(ui.px(3),0))
            models=data.get("by_model",{})
            if not isinstance(models,dict):models={}
            headers=(t("模型","Model"),t("调用","Calls"),t("输入","Prompt"),t("输出","Completion"),"USD")
            for col,title in enumerate(headers):_label(model_rows,text=title,font=ui.font_obj(8,"bold"),fg=theme["text_muted"],bg=theme["card"]).grid(row=0,column=col,sticky="w",padx=(0,ui.px(8)))
            for row,(name,item) in enumerate(models.items(),1):
                item=item if isinstance(item,dict) else {}
                vals=(name,_num(item.get("calls")),_num(item.get("prompt")),_num(item.get("completion")),_money(item.get("usd")))
                for col,val in enumerate(vals):_label(model_rows,text=str(val),font=ui.font_obj(8),fg=theme["text"],bg=theme["card"],anchor="w").grid(row=row,column=col,sticky="w",padx=(0,ui.px(8)),pady=(ui.px(5),0))
            days=data.get("by_day",{})
            if not isinstance(days,dict):days={}
            pairs=list(days.items())[-30:]
            if not pairs:
                _label(db,text=t("暂无用量记录","No usage recorded"),font=ui.font_obj(9),fg=theme["text_muted"],bg=theme["card"]).grid(row=2,column=0,sticky="w",pady=(ui.px(6),0))
                return
            chart.bind("<Configure>",lambda _e:draw_chart(pairs))
            draw_chart(pairs)
            try:chart.after(150,lambda:draw_chart(pairs))
            except Exception:pass
        def draw_chart(pairs):
            try:
                chart.delete("all");w=chart.winfo_width()
                if w<60:
                    chart.after(120,lambda:draw_chart(pairs));return
                h=chart.winfo_height();maxv=max((_num(v.get("total",_num(v.get("prompt"))+_num(v.get("completion")))) for _,v in pairs),default=0) or 0
                if maxv<=0:
                    chart.create_text(w//2,h//2,text=t("暂无用量记录","No usage recorded"),fill=theme["text_muted"],font=(ui.font,9));return
                n=len(pairs);slot=max(1,w//n);bar=max(2,int(slot*.58));base=h-ui.px(27);scale=max(1,h-ui.px(50))
                for i,(day,item) in enumerate(pairs):
                    total=_num(item.get("total",_num(item.get("prompt"))+_num(item.get("completion"))));bh=max(2,int(scale*total/maxv));x=i*slot+(slot-bar)//2
                    _round_rect(chart,x,base-bh,x+bar,base,ui.px(2),theme["accent"])
                    if n<=14:chart.create_text(x+bar/2,base+ui.px(11),text=str(day)[5:],fill=theme["text_muted"],font=(ui.font,7))
            except Exception:pass
        def refresh():
            state["days"]=period.get();state["summary"],state["available"]=_load_summary(state["days"]);render()
        for label,value in ((t("7 天","7 days"),7),(t("30 天","30 days"),30)):
            tk.Radiobutton(controls,text=label,variable=period,value=value,command=refresh,bg=theme["bg"],fg=theme["text"],selectcolor=theme["card"],activebackground=theme["bg"]).pack(side="left",padx=(0,ui.px(6)))
        PillButton(controls,ui,t("刷新","Refresh"),command=refresh,kind="ghost",bg=theme["bg"]).pack(side="right")
        refresh();page.bind_wheel()
    except Exception:
        try:tk.Label(parent,text=_t(ui,"模块未就绪","Module not ready")).pack(fill="both",expand=True)
        except Exception:pass

def _selftest():
    assert _num("7")==7
    assert _num("bad")==0
    assert _money(1.2)=="1.200000"
    assert _money(None)=="0.000000"
    assert _load_summary(7)[1] in (True,False)
    print("SELFTEST OK")
if __name__=="__main__" and "--selftest" in sys.argv:_selftest()

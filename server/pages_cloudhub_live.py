# -*- coding: utf-8 -*-
from __future__ import annotations
import sys, threading, queue, tkinter as tk
from tkinter import filedialog
try:
 from pages_modern import _UI,ScrollPage,RoundedCard,PillButton,_page_header,_label,_tag
except Exception as exc:
 _UI=ScrollPage=RoundedCard=PillButton=_page_header=_label=_tag=None; _COMPONENT_ERROR=str(exc)
try: from hxcore import cloudhub
except Exception: cloudhub=None

def _t(ui,zh,en):
 try:return ui.t(zh,en)
 except Exception:return zh
def _root(app):return getattr(app,'root',None) or getattr(app,'tk',None)
def _run_async(root,work,done,busy=None):
 q=queue.Queue(maxsize=1)
 if busy:busy(True)
 def poll():
  try:r,e=q.get_nowait()
  except queue.Empty:
   root.after(60,poll);return
  if busy:busy(False)
  done(r,e)
 root.after(60,poll)
 def worker():
  try:q.put((work(),None))
  except Exception as exc:q.put((None,exc))
 threading.Thread(target=worker,daemon=True).start()
def _selftest():
 class R:
  def after(self,ms,cb):threading.Timer(max(.01,ms/1000),cb).start()
 seen=[];ev=threading.Event();_run_async(R(),lambda:7,lambda r,e:(seen.append((r,e)),ev.set()));assert ev.wait(2) and seen==[(7,None)];print('SELFTEST OK')

def build_cloudhub_page(app,parent):
 if _UI is None:
  box=tk.Frame(parent);box.pack(fill='both',expand=True);tk.Label(box,text='Cloud hub 模块未就绪 / Cloud hub module not ready',anchor='w').pack(padx=16,pady=20);return box
 ui=_UI(app,parent);page=ScrollPage(parent,ui);page.pack(fill='both',expand=True);content=page.content;content.columnconfigure(0,weight=1)
 h=_page_header(content,ui,'CLOUD',_t(ui,'Cloud hub / 多服务商聚合','Cloud hub / Providers'),_t(ui,'统一查看服务商；密钥只检测是否存在。','View providers; keys are checked only for presence.'))
 h.grid(row=0,column=0,sticky='ew');host=tk.Frame(content,bg=ui.theme['bg']);host.grid(row=1,column=0,sticky='ew');host.columnconfigure(0,weight=1)
 if cloudhub is None:
  _label(host,text=_t(ui,'Cloud hub 模块未就绪','Cloud hub module not ready'),fg=ui.theme['err'],bg=ui.theme['bg']).pack(anchor='w');return page
 root=_root(app);days=tk.IntVar(value=7);allow=tk.BooleanVar(value=False);buttons=[]
 # status 放在 host 之外：render() 会清空 host 的子控件
 status=tk.Label(content,text='',anchor='w',bg=ui.theme['bg'],fg=ui.theme['text_muted'])
 def say(text,error=False):
  try:
   status.configure(text=text,fg=ui.theme['err'] if error else ui.theme['text_muted'])
   status.grid(row=2,column=0,sticky='ew',pady=2)
  except Exception:
   pass
 def busy(v):
  for b,l in buttons:
   try:b.configure(state='disabled' if v else 'normal');l.configure(text=_t(ui,'处理中…','Working…') if v else '')
   except Exception:pass
 def action(parent,text,fn):
  w=tk.Frame(parent,bg=ui.theme['card']);w.pack(side='left',padx=3);b=PillButton(w,ui,text,command=fn,kind='ghost',bg=ui.theme['card']);b.pack(side='left');l=tk.Label(w,text='',bg=ui.theme['card']);l.pack(side='left');buttons.append((b,l))
 def card(title,row):
  c=RoundedCard(host,ui,fill=ui.theme['card'],pad=10,radius=10);c.grid(row=row,column=0,sticky='ew',pady=4);_label(c.body,text=title,fg=ui.theme['text'],bg=ui.theme['card']).pack(anchor='w');return c.body
 def load():
  def done(data,err):
   # 页内提示，绝不用模态对话框（否则 --selftest / 无人值守会永久阻塞）
   if err:say(_t(ui,'加载失败：','Load failed: ')+str(err),True);return
   render(data[0],data[1])
  # Tk 变量只能在主线程读；worker 线程里 days.get() 会抛 "main thread is not in main loop"
  span=days.get()
  _run_async(root,lambda:(cloudhub.providers(),cloudhub.usage_summary(span)),done,busy)
 def render(providers,usage):
  for x in host.winfo_children():x.destroy()
  buttons.clear()
  bar=card(_t(ui,'控制','Controls'),2)
  tk.Radiobutton(bar,text='7 days',variable=days,value=7,command=load).pack(side='left')
  tk.Radiobutton(bar,text='30 days',variable=days,value=30,command=load).pack(side='left')
  action(bar,_t(ui,'刷新','Refresh'),load)
  def export():
   path=filedialog.asksaveasfilename(defaultextension='.json')
   if path:
    _run_async(root,lambda:cloudhub.export_summary(path),
               lambda r,e:say(_t(ui,'已导出：','Exported: ')+str((r or {}).get('path',path))) if not e else say(_t(ui,'导出失败：','Export failed: ')+str(e),True),busy)
  action(bar,_t(ui,'导出汇总','Export'),export)
  total=usage.get('total',{});s=card(_t(ui,'总计','Total'),3)
  _label(s,text='calls %s · $%s · ¥%s'%(total.get('calls',0),total.get('usd',0),total.get('cny',0)),fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
  for i,p in enumerate(providers,4):
   b=card(str(p.get('name') or p.get('id')),i)
   _label(b,text='%s · %s'%(p.get('kind','cloud'),p.get('base_url','-')),fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
   ms=list(p.get('models') or [])
   _label(b,text=', '.join(map(str,ms[:4]))+(' +%d'%(len(ms)-4) if len(ms)>4 else ''),fg=ui.theme['text'],bg=ui.theme['card']).pack(anchor='w')
   _label(b,text=_t(ui,'已配置','Configured') if p.get('configured') else _t(ui,'未检测到 API Key（仅检查环境变量）','No API key detected (env check only)'),
          fg=ui.theme['text_muted'] if p.get('configured') else ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
  base=len(providers)+4
  u=card(_t(ui,'用量','Usage'),base)
  rows=usage.get('rows',[])
  if not rows:_label(u,text=_t(ui,'暂无用量记录','No usage yet'),fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
  for row in rows:
   _label(u,text='%s: calls %s · prompt %s · completion %s · $%s · ¥%s'%(row.get('provider'),row.get('calls',0),row.get('prompt',0),row.get('completion',0),row.get('usd',0),row.get('cny',0)),fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
  hc=card(_t(ui,'连通性对比','Connectivity comparison'),base+1)
  tk.Checkbutton(hc,text=_t(ui,'允许联网探测（默认关闭）','Allow network probes (off by default)'),variable=allow,bg=ui.theme['card']).pack(side='left')
  _label(hc,text=_t(ui,'未开启联网探测','Network probing is not enabled')+' [offline]',fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
  def health():
   ok=bool(allow.get())
   provider_id=None
   def done(r,e):
    if e:say(_t(ui,'探测失败：','Probe failed: ')+str(e),True);return
    if not isinstance(r,dict) or not r.get('ok'):
     err=(r or {}).get('error','network_disabled') if isinstance(r,dict) else str(r)
     if err=='network_disabled':
      _label(hc,text=_t(ui,'未开启联网探测','Network probing is not enabled'),fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
     else:say(_t(ui,'探测未完成：','Probe incomplete: ')+str(err),True)
    rows=sorted((r or {}).get('providers',[]) if isinstance(r,dict) else [],key=lambda x:(x.get('latency_ms') if x.get('status')=='ok' else float('inf')))
    for x in rows:
     _label(hc,text='%s: %s (%sms)%s'%(x.get('name') or x.get('id'),x.get('status','error'),x.get('latency_ms',0),(' - '+str(x.get('error'))) if x.get('error') else ''),fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
   _run_async(root,lambda:cloudhub.probe(provider_id=provider_id,timeout=8,allow_network=ok),done,busy)
  action(hc,_t(ui,'对比连通性','Compare'),health)
  rc=card(_t(ui,'用量对账','Usage reconciliation'),base+2)
  def reconcile():
   span=days.get()
   def done(r,e):
    if e:say(_t(ui,'对账失败：','Reconciliation failed: ')+str(e),True);return
    if not isinstance(r,dict) or not r.get('ok'):
     say(_t(ui,'对账数据不完整：','Incomplete reconciliation: ')+str((r or {}).get('error','missing source')),True)
    for key in ('gateway','tokens','delta'):
     row=(r or {}).get(key)
     if isinstance(row,dict):
      mismatch=key=='delta' and any(row.get(k,0) for k in ('calls','prompt','completion'))
      _label(rc,text='%s: calls %s · prompt %s · completion %s'%(key,row.get('calls',0),row.get('prompt',0),row.get('completion',0)),fg='#d97706' if mismatch else ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
    models=(r or {}).get('by_model',[])
    if models:_label(rc,text=_t(ui,'按模型：','By model: ')+', '.join(str(x.get('model','')) for x in models if isinstance(x,dict)),fg=ui.theme['text_muted'],bg=ui.theme['card']).pack(anchor='w')
   _run_async(root,lambda:cloudhub.reconcile(days=span),done,busy)
  action(rc,_t(ui,'运行对账','Reconcile'),reconcile)
  say(_t(ui,'就绪（默认离线）','Ready (offline by default)'))
 load()
 return page

if __name__=='__main__' and '--selftest' in sys.argv:_selftest()
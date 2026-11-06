# -*- coding: utf-8 -*-
from __future__ import annotations
import sys, threading, tkinter as tk, queue
from itertools import islice
from collections.abc import Sequence
from tkinter import messagebox, simpledialog
try:
 from pages_modern import _UI, ScrollPage, RoundedCard, PillButton, _label, _page_header, _tag
except Exception: _UI=ScrollPage=RoundedCard=PillButton=_label=_page_header=_tag=None
try: from hxcore import sessions
except Exception: sessions=None
def _fmt_size(value):
 try:n=float(value or 0)
 except Exception:n=0
 for unit in ('B','KB','MB','GB'):
  if n<1024 or unit=='GB':return f'{n:.0f} {unit}' if unit=='B' else f'{n:.1f} {unit}'
  n/=1024
 return '0 B'
def _truncate(value,limit=2000):
 s=str(value or '');return (s[:limit],True) if len(s)>limit else (s,False)
def visible_slice(items, shown=100):
 limit=max(0,int(shown))
 if items is None:return [],0
 if isinstance(items,Sequence):
  total=len(items);return items[:limit],max(0,total-limit)
 values=list(islice(iter(items),limit+1));return values[:limit],len(values)>limit
def _backend():
 global sessions
 if sessions is not None:return sessions
 try:from hxcore import sessions as api;sessions=api;return api
 except Exception:return None
def build_sessions_page(app,parent):
 try:
  ui=_UI(app,parent);theme=ui.theme;t=lambda z,e:ui.t(z,e);backend=_backend()
  if backend is None:tk.Label(parent,text=t('多会话模块未就绪','Sessions module not ready')).pack(fill='both',expand=True);return
  page=ScrollPage(parent,ui);page.pack(fill='both',expand=True);content=page.content;content.columnconfigure(0,weight=1);content.rowconfigure(4,weight=1)
  _page_header(content,ui,'SESSIONS',t('会话管理','Sessions'),t('管理多个对话会话与消息。','Manage multiple conversations and messages.')).grid(row=0,column=0,sticky='ew')
  controls=tk.Frame(content,bg=theme['bg']);controls.grid(row=1,column=0,sticky='ew',pady=(8,6));query=tk.StringVar();stats=tk.StringVar();hint=tk.StringVar();results=queue.Queue();state={'rows':[],'selected':'','seq':0,'busy':False,'after':None,'list_limit':50,'msg_limit':100,'list_done':False,'msg_done':False}
  def poll():
   try:
    while True:
     seq,kind,result,error=results.get_nowait()
     if seq!=state['seq']:continue
     state['busy']=False
     if error:hint.set(t('多会话模块未就绪','Sessions module not ready'));continue
     hint.set('')
     if kind=='list':
      rows,data=result;state['rows']=rows if isinstance(rows,list) else [];state['list_done']=len(state['rows'])<state['list_limit'];render_rows(state['rows']);
      if state['rows'] and not state['selected']:
       state['selected']=str(state['rows'][0].get('id',''));render_rows(state['rows']);begin('messages',sid=state['selected'],limit=state['msg_limit'])
      stats.set(t('会话','Sessions')+f" {data.get('sessions',len(state['rows']))} · "+t('消息','Messages')+f" {data.get('messages',0)} · "+t('数据量','Size')+' '+_fmt_size(data.get('bytes',0)))
     elif kind=='messages':
       rows=result if isinstance(result,list) else [];state['msg_done']=len(rows)<state['msg_limit'];render_messages(rows)
     else:hint.set(t('操作已完成','Operation completed'));begin('list',query=query.get().strip())
   except queue.Empty:pass
   try:page.after(60,poll)
   except tk.TclError:pass
  def worker(seq,kind,kw):
   try:
    if kind=='list':result=(backend.list_sessions(limit=kw.get('limit',50),query=kw.get('query','')),backend.stats() or {})
    elif kind=='messages':result=backend.messages(kw['sid'],limit=kw.get('limit',100),query='')
    elif kind=='create':result=backend.create(title='')
    elif kind=='rename':result=backend.rename(kw['sid'],kw['title'])
    else:result=backend.delete(kw['sid'])
    results.put((seq,kind,result,None))
   except Exception as exc:results.put((seq,kind,None,str(exc)))
  def begin(kind,**kw):
   if state['busy']:return
   state['busy']=True;state['seq']+=1;seq=state['seq'];hint.set(t('加载中…','Loading…'));threading.Thread(target=worker,args=(seq,kind,kw),daemon=True).start()
  def refresh():
   state['seq']+=1;state['busy']=False
   state['msg_limit']=100;state['msg_done']=False
   state['list_limit']=50;state['list_done']=False
   for child in message_box.winfo_children():child.destroy()
   begin('list',query=query.get().strip(),limit=state['list_limit'])
  def create():
   if messagebox.askyesno(t('新建会话','New session'),t('确认新建会话？','Create a new session?'),parent=ui.root):begin('create')
  def rename(sid,current):
   title=simpledialog.askstring(t('重命名','Rename'),t('新标题','New title'),initialvalue=current,parent=ui.root)
   if title and messagebox.askyesno(t('确认重命名','Confirm rename'),t('确认修改会话标题？','Confirm changing the session title?'),parent=ui.root):begin('rename',sid=sid,title=title)
  def delete(sid):
   if messagebox.askyesno(t('删除会话','Delete session'),t('将备份到 logs/backup 后删除，继续吗？','A backup will be kept in logs/backup. Continue?'),parent=ui.root):begin('delete',sid=sid)
  def render_messages(rows):
   for c in message_box.winfo_children():c.destroy()
   if not rows:_label(message_box,text=t('该会话没有消息','This session has no messages'),fg=theme['text_muted'],bg=theme['card']).pack(anchor='w');return
   state['msg_done'] = state['msg_done'] or len(rows) < state['msg_limit']
   visible, _remaining = visible_slice(sorted(rows,key=lambda x:str(x.get('ts','')) if isinstance(x,dict) else ''), state['msg_limit'])
   for item in visible:
    item=item if isinstance(item,dict) else {};role=str(item.get('role','system'));text,clipped=_truncate(item.get('text',''));r=tk.Frame(message_box,bg=theme['card']);r.pack(fill='x',pady=(0,8));fill=theme['accent'] if role=='user' else theme['ok'] if role=='assistant' else theme['text_muted'];_tag(r,ui,role.upper(),theme['card'],fill=fill,fg='#fff').pack(anchor='w');_label(r,text=text+(' ['+t('已截断','Truncated')+']' if clipped else ''),fg=theme['text'],bg=theme['card'],wraplength=ui.px(700),anchor='w',justify='left').pack(fill='x')
   if not state['msg_done']:
    PillButton(message_box,ui,t('加载更多','Load more'),command=lambda: (state.__setitem__('msg_limit',state['msg_limit']+100),begin('messages',sid=state['selected'],limit=state['msg_limit'])),kind='ghost',bg=theme['card']).pack(anchor='w')
   else:
    _label(message_box,text=t('已全部加载','All loaded'),fg=theme['text_muted'],bg=theme['card']).pack(anchor='w')
  def select(sid):state['selected']=sid;state['msg_limit']=100;state['msg_done']=False;render_rows(state['rows']);begin('messages',sid=sid,limit=state['msg_limit'])
  def render_rows(rows):
   for c in list_box.winfo_children():c.destroy()
   if not rows:_label(list_box,text=t('暂无会话','No sessions'),fg=theme['text_muted'],bg=theme['card']).pack(anchor='w');return
   for item in rows:
    sid=str(item.get('id',''));title=str(item.get('title') or sid);r=tk.Frame(list_box,bg=theme['accent_soft'] if sid==state['selected'] else theme['card']);r.pack(fill='x',pady=(0,5));_label(r,text=title,fg=theme['text'],bg=r['bg'],anchor='w').pack(fill='x');_label(r,text=f"{item.get('count',0)}  {item.get('last_ts','')}",fg=theme['text_muted'],bg=r['bg'],anchor='w').pack(fill='x');r.bind('<Button-1>',lambda e,s=sid:select(s));buttons=tk.Frame(r,bg=r['bg']);buttons.pack(anchor='e');PillButton(buttons,ui,t('重命名','Rename'),command=lambda s=sid,n=title:rename(s,n),kind='ghost',bg=r['bg']).pack(side='left');PillButton(buttons,ui,t('删除','Delete'),command=lambda s=sid:delete(s),kind='ghost',bg=r['bg']).pack(side='left')
   if not state['list_done']:
    PillButton(list_box,ui,t('加载更多','Load more'),command=lambda: (state.__setitem__('list_limit',state['list_limit']+50),begin('list',query=query.get().strip(),limit=state['list_limit'])),kind='ghost',bg=theme['card']).pack(anchor='w')
   else:
    _label(list_box,text=t('已全部加载','All loaded'),fg=theme['text_muted'],bg=theme['card']).pack(anchor='w')
  ent=tk.Entry(controls,textvariable=query,bg=theme['input_bg'],fg=theme['text'],relief='flat');ent.pack(side='left',fill='x',expand=True);PillButton(controls,ui,t('新建会话','New session'),command=create,kind='ghost',bg=theme['bg']).pack(side='left');PillButton(controls,ui,t('刷新','Refresh'),command=refresh,kind='ghost',bg=theme['bg']).pack(side='left');_label(content,textvariable=stats,fg=theme['text_muted'],bg=theme['bg']).grid(row=2,column=0,sticky='w');_label(content,textvariable=hint,fg=theme['accent'],bg=theme['bg']).grid(row=3,column=0,sticky='w')
  columns=tk.Frame(content,bg=theme['bg']);columns.grid(row=4,column=0,sticky='nsew',pady=(6,0));columns.columnconfigure(0,weight=0,minsize=ui.px(300));columns.columnconfigure(1,weight=1);columns.rowconfigure(0,weight=1);left=RoundedCard(columns,ui,pad=10,radius=8,shadow=False);right=RoundedCard(columns,ui,pad=10,radius=8,shadow=False);left.grid(row=0,column=0,sticky='nsew',padx=(0,ui.px(5)));right.grid(row=0,column=1,sticky='nsew',padx=(ui.px(5),0));_label(left.body,text=t('会话','Sessions'),fg=theme['text'],bg=theme['card']).pack(anchor='w');_label(right.body,text=t('消息','Messages'),fg=theme['text'],bg=theme['card']).pack(anchor='w')
  list_wrap=tk.Frame(left.body,bg=theme['card']);list_wrap.pack(fill='both',expand=True);list_canvas=tk.Canvas(list_wrap,bg=theme['card'],highlightthickness=0,width=ui.px(280));list_scroll=tk.Scrollbar(list_wrap,orient='vertical',command=list_canvas.yview);list_canvas.configure(yscrollcommand=list_scroll.set);list_scroll.pack(side='right',fill='y');list_canvas.pack(side='left',fill='both',expand=True);list_box=tk.Frame(list_canvas,bg=theme['card']);list_window=list_canvas.create_window((0,0),window=list_box,anchor='nw');list_box.bind('<Configure>',lambda e:list_canvas.configure(scrollregion=list_canvas.bbox('all')));list_canvas.bind('<Configure>',lambda e:list_canvas.itemconfigure(list_window,width=e.width));message_box=tk.Frame(right.body,bg=theme['card']);message_box.pack(fill='both',expand=True)
  def schedule(*_):
   if state['after']:page.after_cancel(state['after'])
   state['after']=page.after(300,refresh)
  query.trace_add('write',schedule);ent.bind('<Return>',lambda e:refresh());page.after(60,poll);refresh();page.bind_wheel()
 except Exception:
  try:tk.Label(parent,text=t('多会话模块未就绪','Sessions module not ready')).pack(fill='both',expand=True)
  except Exception:pass
def _selftest():
 assert _fmt_size(0)=='0 B';assert _fmt_size(1024)=='1.0 KB';assert _truncate('x'*2001,2000)[1];assert not _truncate('ok')[1];print('SELFTEST OK')
if __name__=='__main__' and '--selftest' in sys.argv:_selftest()

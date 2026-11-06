# -*- coding: utf-8 -*-
from __future__ import annotations
import datetime, json, os, time
try:
 from hxcore.tokens import estimate_tokens
except Exception:
 def estimate_tokens(text):
  return len(text or '')

def _messages(ms): return isinstance(ms,list) and all(isinstance(x,dict) and isinstance(x.get('content',''),str) for x in ms)
def estimate_text(text):
 try:return int(estimate_tokens(text if isinstance(text,str) else ''))
 except Exception:return 0
def _total(ms):
 return sum(estimate_text(x.get('content','')) for x in ms if isinstance(x,dict))
def plan(messages,max_tokens=4000,keep_last=4):
 try:
  if not _messages(messages): return {'ok':False,'keep':0,'drop':0,'ranges':[],'total_tokens':0,'target':0,'reason':'invalid_input'}
  target=max(0,int(max_tokens)); kl=max(0,int(keep_last)); total=_total(messages)
  base={'ok':False,'keep':len(messages),'drop':0,'ranges':[],'total_tokens':total,'target':target,'reason':'within_budget'}
  if total<=target:return base
  protected=set(range(max(0,len(messages)-kl),len(messages)))|{i for i,m in enumerate(messages) if m.get('role')=='system'}
  candidates=[i for i in range(len(messages)) if i not in protected]
  drops=[]
  def build():
   ranges=[]
   for i in drops:
    tok=estimate_text(messages[i].get('content',''))
    if ranges and ranges[-1]['end']==i:ranges[-1]['end']=i+1; ranges[-1]['tokens']+=tok
    else:ranges.append({'start':i,'end':i+1,'tokens':tok})
   return ranges
  while True:
   selected=[messages[i] for i in drops]
   summary_tokens=summarize(selected)['tokens'] if selected else 0
   remaining=total-sum(estimate_text(messages[i].get('content','')) for i in drops)+summary_tokens
   if remaining<=target or len(drops)>=len(candidates):
    ranges=build(); overflow=max(0,remaining-target)
    return {'ok':True,'keep':len(messages)-len(drops),'drop':len(drops),'ranges':ranges,'total_tokens':total,'target':target,'reason':'over_budget' if not overflow else 'best_effort','overflow_tokens':overflow}
   drops.append(candidates[len(drops)])
 except Exception:return {'ok':False,'keep':0,'drop':0,'ranges':[],'total_tokens':0,'target':0,'reason':'invalid_input'}
def summarize(messages):
 try:
  if not isinstance(messages,list):return {'text':'','tokens':0}
  rows=[]
  for m in messages[:12]:
   if not isinstance(m,dict):continue
   role='用户' if m.get('role')=='user' else ('助手' if m.get('role')=='assistant' else str(m.get('role','system')))
   text=str(m.get('content','')).replace('\n',' ')[:60]
   rows.append('%s：%s'%(role,text))
  if len(messages)>12:rows.append('…共 %d 条'%len(messages))
  if not rows:return {'text':'','tokens':0}
  text='[摘要] '+'；'.join(rows)
  return {'text':text,'tokens':estimate_text(text)}
 except Exception:return {'text':'','tokens':0}
def apply(messages,plan_result):
 fail={'ok':False,'messages':[],'summary':'','saved_tokens':0,'kept':0,'error':'invalid_input'}
 try:
  if not _messages(messages) or not isinstance(plan_result,dict) or not plan_result.get('ok'): return fail
  drops=set()
  for r in plan_result.get('ranges',[]):
   a,b=int(r['start']),int(r['end']); drops.update(range(a,b))
  if drops and (min(drops)<0 or max(drops)>=len(messages)):return dict(fail,error='invalid_plan')
  if not drops:
   return {'ok':True,'messages':list(messages),'summary':'','saved_tokens':0,'kept':len(messages),'error':''}
  selected=[messages[i] for i in sorted(drops)]; summary=summarize(selected)['text']; out=[]; inserted=False
  for i,m in enumerate(messages):
   if i in drops:
    if not inserted:out.append({'role':'system','content':summary}); inserted=True
   else:out.append(m)
  before=_total(messages); after=_total(out)
  return {'ok':True,'messages':out,'summary':summary,'saved_tokens':max(0,before-after),'kept':len(out),'error':''}
 except Exception:return fail
def _logdir():
 try:return os.path.join(os.environ.get('HYMNIX_LOG_DIR') or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),'logs'),'compress')
 except Exception:return 'logs/compress'
def record(plan_result,result):
 try:
  d=_logdir(); os.makedirs(d,exist_ok=True); now=datetime.datetime.now(); path=os.path.join(d,now.strftime('%Y%m%d-%H%M%S')+'-%d.json'%os.getpid()); saved=int(result.get('saved_tokens',0)) if isinstance(result,dict) else 0
  with open(path,'w',encoding='utf-8') as f:json.dump({'ts':now.isoformat(),'plan':plan_result,'result':result,'saved':saved},f,ensure_ascii=False)
  return path
 except Exception:return ''
def stats(days=7):
 out={'events':0,'saved_tokens':0,'by_day':{}}
 try:
  cut=datetime.date.today()-datetime.timedelta(days=max(0,int(days))-1)
  for n in os.listdir(_logdir()):
   if not n.endswith('.json'):continue
   try:
    with open(os.path.join(_logdir(),n),encoding='utf-8') as f:r=json.load(f)
    d=str(r.get('ts',''))[:10]; day=datetime.date.fromisoformat(d)
    if day<cut or day>datetime.date.today():continue
    s=int(r.get('saved',0)); out['events']+=1; out['saved_tokens']+=s; out['by_day'].setdefault(d,0); out['by_day'][d]+=s
   except Exception:continue
 except Exception:pass
 return out
# -*- coding: utf-8 -*-
from __future__ import annotations
import datetime, json, math, os
from hxcore.paths import logs_dir, append_jsonl
USD_TO_CNY=7.2
DEFAULT_PRICE={"in":0.0,"out":0.0,"currency":"USD"}
_PRICES={"deepseek-chat":{"in":0.27,"out":1.10,"currency":"USD"},"deepseek-reasoner":{"in":0.55,"out":2.19,"currency":"USD"},"gpt-4o":{"in":2.50,"out":10.00,"currency":"USD"},"gpt-4o-mini":{"in":0.15,"out":0.60,"currency":"USD"},"qwen3:8b":{"in":0.0,"out":0.0,"currency":"USD","local":True}}
def estimate_tokens(text):
 try:
  if not isinstance(text,str) or not text:return 0
  c=sum(1 for x in text if "\u2e80"<=x<="\u9fff" or "\u3400"<=x<="\u4dbf")
  return c+(math.ceil((len(text)-c)/4) if len(text)>c else 0)
 except Exception:return 0
def count_messages(messages):
 try:return sum(estimate_tokens(x.get("content",""))+4 for x in messages if isinstance(x,dict)) if isinstance(messages,(list,tuple)) else 0
 except Exception:return 0
def price_for(model):
 try:return dict(_PRICES.get(str(model),DEFAULT_PRICE))
 except Exception:return dict(DEFAULT_PRICE)
def cost(prompt_tokens,completion_tokens,model=""):
 try:
  p=price_for(model); a=max(0,int(prompt_tokens)); b=max(0,int(completion_tokens)); u=(a*p["in"]+b*p["out"])/1000000
  return {"usd":round(u,10),"cny":round(u*USD_TO_CNY,10),"model":model,"in_price":p["in"],"out_price":p["out"]}
 except Exception:return {"usd":0.0,"cny":0.0,"model":model,"in_price":0.0,"out_price":0.0}
def _path():return os.path.join(logs_dir(),"usage","tokens.jsonl")
def record(model,prompt_tokens,completion_tokens,source="chat"):
 try:
  a=max(0,int(prompt_tokens)); b=max(0,int(completion_tokens)); now=datetime.datetime.now().astimezone(); row={"ts":now.isoformat(),"date":now.strftime("%Y-%m-%d"),"model":str(model),"prompt":a,"completion":b,"total":a+b,"source":str(source),**cost(a,b,model)}; append_jsonl(_path(),row)
 except Exception:pass
def summary(days=7):
 try:days=max(0,int(days))
 except Exception:days=7
 out={"days":days,"calls":0,"prompt":0,"completion":0,"total":0,"usd":0.0,"cny":0.0,"by_model":{},"by_day":{}}
 try:
  cut=datetime.date.today()-datetime.timedelta(days=max(0,days-1))
  with open(_path(),encoding="utf-8") as f:
   for line in f:
    try:
     r=json.loads(line); d=str(r.get("date") or str(r.get("ts",""))[:10]); day=datetime.date.fromisoformat(d)
     if day<cut or day>datetime.date.today():continue
     m=str(r.get("model","")); a=int(r.get("prompt",0)); b=int(r.get("completion",0)); cc=cost(a,b,m); out["calls"]+=1; out["prompt"]+=a; out["completion"]+=b; out["total"]+=a+b; out["usd"]+=cc["usd"]; out["cny"]+=cc["cny"]
     x=out["by_model"].setdefault(m,{"calls":0,"prompt":0,"completion":0,"usd":0.0}); x["calls"]+=1; x["prompt"]+=a; x["completion"]+=b; x["usd"]+=cc["usd"]
     x=out["by_day"].setdefault(d,{"calls":0,"prompt":0,"completion":0,"usd":0.0}); x["calls"]+=1; x["prompt"]+=a; x["completion"]+=b; x["usd"]+=cc["usd"]
    except Exception:continue
 except Exception:pass
 out["usd"]=round(out["usd"],10); out["cny"]=round(out["cny"],10); return out
def format_tokens(n):
 try:
  n=float(n)
  if n>=1000000:return "%.1fM"%(n/1000000)
  if n>=1000:return "%.1fK"%(n/1000)
  return str(int(n))
 except Exception:return "0"

# -*- coding: utf-8 -*-
from __future__ import annotations
import fnmatch, os, time
from pathlib import Path
try:
 from hxcore.paths import root_dir
except Exception:
 def root_dir(): return str(Path(__file__).resolve().parents[2])
_ERR=''
_IGNORE_DIR={'.git','__pycache__','node_modules','.venv','dist','build'}; _IGNORE_PART={'logs/backup','logs/tmp'}

def _fail(e):
 global _ERR; _ERR=str(e); return []
def root()->str:
 try:return str(Path(root_dir()).resolve())
 except Exception:return ''
def _base(path):
 try:
  b=Path(root()); p=(b/str(path)).resolve(); p.relative_to(b); return b,p
 except Exception: return None,None
def _skip(rel,name,isdir=False):
 if isdir and name in _IGNORE_DIR:return True
 if rel in _IGNORE_PART or any(rel.startswith(x+'/') for x in _IGNORE_PART):return True
 return (not isdir and (name.lower().endswith(('.exe','.pkg'))))
def tree(path='.',depth=1,limit=500):
 try:
  b,p=_base(path)
  if not b:return _fail('out_of_scope')
  out=[]; maxd=max(0,int(depth)); lim=min(max(1,int(limit)),5000)
  for cur,dirs,files in os.walk(p):
   relcur=Path(cur).relative_to(b).as_posix(); d=0 if relcur=='.' else len(Path(relcur).parts)
   dirs[:]=[x for x in dirs if not _skip((Path(relcur)/x).as_posix(),x,True)]
   if d>=maxd: dirs[:]=[]
   for name in dirs+files:
    rel=(Path(relcur)/name).as_posix(); full=Path(cur)/name
    if _skip(rel,name,False):continue
    try: st=full.stat()
    except Exception:continue
    out.append({'name':name,'rel':rel,'is_dir':full.is_dir(),'size':0 if full.is_dir() else st.st_size,'mtime':st.st_mtime,'ext':full.suffix.lower()})
    if len(out)>=lim:return out
  return sorted(out,key=lambda x:x['rel'])
 except Exception as e:return _fail(e)
def search_text(query,path='.',include=None,limit=200):
 try:
  b,p=_base(path)
  if not b:return _fail('out_of_scope')
  pats=[include] if isinstance(include,str) and '*' in include else ([('*.'+x.strip().lstrip('.')) for x in include.split(',')] if include else None); out=[]; scanned=0
  for cur,dirs,files in os.walk(p):
   relcur=Path(cur).relative_to(b).as_posix(); dirs[:]=[x for x in dirs if not _skip((Path(relcur)/x).as_posix(),x,True)]
   for name in files:
    rel=(Path(relcur)/name).as_posix();
    if _skip(rel,name) or (pats and not any(fnmatch.fnmatch(name,z) for z in pats)):continue
    try:
     if Path(cur,name).stat().st_size>2*1024*1024:continue
     with open(Path(cur,name),'r',encoding='utf-8',errors='ignore') as f:
      for no,line in enumerate(f,1):
       if str(query).lower() in line.lower():out.append({'rel':rel,'line':no,'text':line.rstrip()[:4000]})
       if len(out)>=min(max(1,int(limit)),5000):return out
    except Exception:continue
  return out
 except Exception as e:return _fail(e)
def search_name(query,limit=200):
 try:
  b=Path(root()); out=[]
  for cur,dirs,files in os.walk(b):
   relcur=Path(cur).relative_to(b).as_posix(); dirs[:]=[x for x in dirs if not _skip((Path(relcur)/x).as_posix(),x,True)]
   for n in dirs+files:
    rel=(Path(relcur)/n).as_posix()
    if _skip(rel,n, n in dirs):continue
    if str(query).lower() in n.lower():out.append({'rel':rel,'is_dir':Path(cur,n).is_dir()})
    if len(out)>=min(max(1,int(limit)),5000):return out
  return out
 except Exception as e:return _fail(e)
def stats():
 try:
  b=Path(root()); files=dirs=scanned=0; t=time.perf_counter()
  for cur,ds,fs in os.walk(b):
   rel=Path(cur).relative_to(b).as_posix(); ds[:]=[x for x in ds if not _skip((Path(rel)/x).as_posix(),x,True)]; dirs+=len(ds); files+=sum(not _skip((Path(rel)/x).as_posix(),x) for x in fs); scanned+=len(ds)+len(fs)
   if scanned>=20000:return {'root':str(b),'files':files,'dirs':dirs,'scanned':scanned,'ms':(time.perf_counter()-t)*1000,'truncated':True}
  return {'root':str(b),'files':files,'dirs':dirs,'scanned':scanned,'ms':(time.perf_counter()-t)*1000,'truncated':False}
 except Exception as e:return {'root':root(),'files':0,'dirs':0,'scanned':0,'ms':0,'error':str(e)}
def last_error():return _ERR

import fs from 'node:fs';
const file='src/renderer/main.tsx';
let s=fs.readFileSync(file,'utf8');
const a=s.indexOf('  function renderModels() {');
const b=s.indexOf('  function renderTerminal() {',a);
if(a<0||b<0) throw new Error('markers');
const block=[
  '  function renderModels() {',
  '    const installedNames = new Set(models.map((item) => item.name));',
  '    const query = modelQuery.trim().toLowerCase();',
  '    const catalogAvailable = RECOMMENDED.filter((entry) => !installedNames.has(entry.name)).filter((entry) => !query || entry.name.toLowerCase().includes(query) || t(entry.tag).toLowerCase().includes(query));',
  '    return <section className="view-page">',
  '      <div className="view-heading"><div><label>{t("MODEL CATALOG")}</label><h2>{t("Models")}</h2><p>{t("Discover models served by the local gateway.")}</p></div><button className="btn primary" onClick={() => void loadModels()}>{t("Refresh models")}</button></div>',
  '      {!health?.ollama && <div className="card offline-card"><div><strong>{t("Model service is offline")}</strong><span>{t("Start Ollama to list and run local models.")}</span></div><button className="btn primary" onClick={() => { setModelNote(t("Starting Ollama...")); void window.hymnix.ollama.control("start").then(() => { void loadHealth(); void loadModels(); }).catch((reason) => setModelNote(reason instanceof Error ? reason.message : String(reason))); }}>{t("Start Ollama")}</button></div>}',
  '      <div className="card">',
  '        <h3 className="card-title">{t("Installed models")} · {models.length}</h3>',
  '        {models.length === 0 ? <p className="subtitle">{t("No model installed yet.")}</p> : <div className="catalog">{models.map((item) => <div className="catalog-row" key={item.name}>',
  '          <span className="model-mark">AI</span>',
  '          <span className="catalog-main"><strong>{item.name}</strong><small>{item.loaded ? t("Loaded") : t("Available model")}</small></span>',
  '          <button className="btn" onClick={() => setModel(item.name)}>{model === item.name ? t("Selected") : t("Select")}</button>',
  '          <button className="btn" onClick={() => void modelAction(item.loaded ? "stop" : "start", item.name)} disabled={modelBusy === item.name}>{item.loaded ? t("Stop") : t("Start")}</button>',
  '          <button className="btn" onClick={() => void modelAction("delete", item.name)} disabled={modelBusy === item.name}>{t("Delete")}</button>',
  '        </div>)}</div>}',
  '      </div>',
  '      <div className="card">',
  '        <h3 className="card-title">{t("Downloadable models")} · {catalogAvailable.length}</h3>',
  '        <div className="catalog-search-row"><input className="catalog-search" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={t("Search models…")} /><button className="btn" onClick={() => setModelQuery("")} disabled={!modelQuery}>{t("Clear")}</button></div>',
  '        {catalogAvailable.length === 0 ? <p className="subtitle">{t("Everything in the catalog is already installed.")}</p> : <div className="catalog-scroll">{catalogAvailable.map((entry) => <div className="catalog-row" key={entry.name}>',
  '          <span className="model-mark">AI</span>',
  '          <span className="catalog-main"><strong>{entry.name}</strong><small>{entry.size} · {t(entry.tag)}</small></span>',
  '          <button className="btn" disabled={!!modelBusy} onClick={() => void pullModelByName(entry.name)}>{modelBusy === entry.name ? t("Working...") : t("Download")}</button>',
  '        </div>)}</div>}',
  '        {modelNote && <p className="subtitle">{modelNote}</p>}',
  '      </div>',
  '    </section>;',
  '  }',
  ''
].join(String.fromCharCode(10));
s=s.slice(0,a)+block+s.slice(b);
fs.writeFileSync(file,s);
console.log('models_rewritten');
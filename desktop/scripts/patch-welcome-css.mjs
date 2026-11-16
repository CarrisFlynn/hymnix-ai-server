import fs from "node:fs";
fs.appendFileSync("src/renderer/styles.css", `
.connbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.conn-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 999px;
  background: var(--surface); color: var(--muted); font-size: 11px; font-weight: 600;
}
.conn-chip b { color: var(--ink); font-weight: 600; }
.conn-chip.ready { border-color: #9bd2b8; }
.notice {
  flex: 0 0 auto; margin: 0 clamp(20px, 5vw, 72px) var(--s3);
  padding: var(--s2) var(--s3); border: 1px solid #a8dbc4; border-radius: var(--radius-sm);
  background: #eefaf4; color: #1c6b4c; font-size: var(--fs-meta);
}
.welcome-mask {
  position: fixed; inset: 0; z-index: 50; display: grid; place-items: center;
  background: rgba(43, 16, 23, .45); backdrop-filter: blur(2px);
}
.welcome-card {
  width: min(560px, 92vw); max-height: 90vh; overflow: auto;
  padding: var(--s5); border: 1px solid var(--line); border-radius: var(--radius-lg);
  background: var(--surface); box-shadow: 0 24px 60px rgba(43,16,23,.28);
}
.welcome-brand { display: flex; align-items: center; gap: 10px; margin-bottom: var(--s4); }
.welcome-brand img { width: 34px; height: 34px; border-radius: 8px; }
.welcome-brand strong { display: block; font-size: 15px; font-weight: 650; }
.welcome-brand small { color: var(--muted); font-size: 11px; }
.welcome-card h2 { margin: 0 0 var(--s2); font-size: 22px; font-weight: 650; }
.welcome-card > p { margin: 0 0 var(--s4); color: var(--muted); font-size: var(--fs-body); line-height: 1.6; }
.welcome-actions { display: flex; justify-content: flex-end; margin-top: var(--s4); }
`);
console.log("welcome_css_ok");

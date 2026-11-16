import fs from "node:fs";
fs.appendFileSync("src/renderer/styles.css", `
.account {
  display: flex; align-items: center; gap: 10px; width: 100%;
  margin-top: auto; padding: 10px 8px;
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--surface); text-align: left;
}
.account:hover { background: var(--red-050); border-color: var(--line-strong); }
.account .avatar {
  display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px;
  border-radius: 50%; background: var(--red-050); border: 1px solid var(--line-strong);
  color: var(--red-700); font-size: 11px; font-weight: 700;
}
.account strong { display: block; font-size: var(--fs-meta); font-weight: 600; }
.account small { display: block; color: var(--muted); font-size: 11px; }
.side-status { margin-top: 8px; border-top: 0; padding-top: 0; }
`);
console.log("account_css_ok");

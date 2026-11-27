import { _electron as electron } from "@playwright/test";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
const cwd = resolve(process.cwd());
const outside = mkdtempSync(join(tmpdir(), 'hx-out-'));
writeFileSync(join(outside, 'secret.txt'), 'TOPSECRET_OUTSIDE');
const link = join(cwd, '.hx-escape');
try { rmSync(link, { recursive: true, force: true }); } catch {}
symlinkSync(outside, link, 'junction');
console.log('JUNCTION ' + existsSync(link));

const srv = createServer((req, res) => { res.writeHead(200); res.end('LOCAL_SECRET_SERVICE'); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["--user-data-dir=C:\\Users\\xiaoy\\AppData\\Local\\Temp\\hymnix-sec", "."], cwd, env });
const win = await app.firstWindow();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
await win.evaluate(() => { localStorage.setItem("hymnix.welcome","1"); localStorage.setItem("hymnix.whatsNew","1.4.3"); });
await win.reload();
await win.waitForFunction(() => Boolean(window.__hymnixDev), null, { timeout: 60000 });
for (let i = 0; i < 40; i += 1) { const b = await win.evaluate(() => window.hymnix.bootstrap()); if (b.ready) break; await win.waitForTimeout(400); }
const call = (tool, args) => win.evaluate(async ([t, a]) => window.hymnix.tools.call({ requestId: "sec-" + Math.random().toString(36).slice(2), tool: t, args: a }), [tool, args]);

const read = await call('fs.read', { path: '.hx-escape/secret.txt' });
console.log('SYMLINK_READ ok=' + read.ok + ' -> ' + JSON.stringify(read.ok ? (read.result.text || '').slice(0, 40) : read.error));
const write = await call('fs.write', { path: '.hx-escape/pwned.txt', content: 'x' });
console.log('SYMLINK_WRITE ok=' + write.ok + ' -> ' + (write.error || 'WROTE_OUTSIDE'));

for (const url of ['http://127.0.0.1:' + port + '/', 'http://[::1]:' + port + '/', 'http://[::ffff:127.0.0.1]:' + port + '/']) {
  const out = await call('web.fetch', { url });
  console.log('SSRF ' + url + ' ok=' + out.ok + ' -> ' + (out.ok ? (out.result.text || '').slice(0, 30) : out.error));
}
await app.close();
srv.close();
try { rmSync(link, { recursive: true, force: true }); } catch {}

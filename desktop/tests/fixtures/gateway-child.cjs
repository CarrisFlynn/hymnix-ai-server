const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const dir = process.env.HYMNIX_DESKTOP_CONTROL_DIR;
const mode = process.argv[2];
if (mode === "exit") process.exit(13);
const server = http.createServer((_, res) => res.end(JSON.stringify({ok: true, gateway: "1.3.2"})));
if (mode === "ready") {
  server.listen(0, "127.0.0.1", () => {
    const tmp = path.join(dir, "ready.tmp");
    fs.writeFileSync(tmp, JSON.stringify({port: server.address().port, version: "1.3.2"}));
    fs.renameSync(tmp, path.join(dir, "ready.json"));
  });
}
const timer = setInterval(() => {
  if (!fs.existsSync(path.join(dir, "stop"))) return;
  clearInterval(timer);
  process.stdout.write("clean shutdown\n", () => server.close());
}, 15);

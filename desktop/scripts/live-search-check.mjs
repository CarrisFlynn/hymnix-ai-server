import { searchWeb } from "../src/main/web-search.ts";
for (const q of ["python asyncio", "深度求索 开源 模型", "electron 打包 教程", "hymnix orbit electron"]) {
  const r = await searchWeb({ query: q, count: 4 });
  console.log("\nQ=" + q + " -> ok=" + r.ok + " provider=" + (r.provider || "-") + " hits=" + r.hits.length + (r.error ? " err=" + r.error : ""));
  for (const h of r.hits.slice(0, 3)) console.log("   - " + h.title.slice(0, 60) + "\n     " + h.url.slice(0, 80));
}

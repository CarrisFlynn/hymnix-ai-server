import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupe, isRelevant, parseBaidu, parseBingRss, queryTokens, searchWeb, textOf } from "../src/main/web-search.ts";

/** Markup copied from the shapes the live endpoints actually serve. */
const BING_RSS = [
  '<?xml version="1.0"?><rss><channel>',
  "<item><title>Python asyncio 模块 - 菜鸟教程</title>",
  "<link>https://www.runoob.com/python3/python-asyncio.html</link>",
  "<description>asyncio 是 Python 标准库中的一个模块 &amp; 更多</description></item>",
  "<item><title>asyncio — Asynchronous I/O</title>",
  "<link>https://docs.python.org/3/library/asyncio.html</link>",
  "<description>asyncio is a library to write concurrent code</description></item>",
  "<item><title>No link</title></item>",
  "</channel></rss>",
].join("");

const BAIDU = [
  '<div class="result c-container xpath-log new-pmd" mu="https://docs.python.org/zh-cn/3/library/asyncio.html" id="3">',
  '<h3 class="t"><a href="http://www.baidu.com/link?url=abc">asyncio 文档</a></h3>',
  '<div class="c-abstract">异步 I/O 标准库</div></div>',
  '<div class="result c-container" mu="https://example.com/zh2">',
  '<h3 class="t"><a href="#">另一个 asyncio 页面</a></h3>',
  '<span class="content-right_8Zs40">另一段摘要</span></div>',
].join("");

test("parseBingRss reads items and decodes entities", () => {
  const hits = parseBingRss(BING_RSS);
  assert.equal(hits.length, 2, "an item without a link is dropped");
  assert.equal(hits[0].title, "Python asyncio 模块 - 菜鸟教程");
  assert.equal(hits[0].url, "https://www.runoob.com/python3/python-asyncio.html");
  assert.ok(hits[0].snippet.includes("asyncio 是 Python"));
  assert.ok(hits[0].snippet.includes("&"), "&amp; is decoded");
});

test("parseBaidu reads the real URL from mu=, not the redirect", () => {
  const hits = parseBaidu(BAIDU);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].url, "https://docs.python.org/zh-cn/3/library/asyncio.html");
  assert.equal(hits[0].title, "asyncio 文档");
  assert.equal(hits[0].snippet, "异步 I/O 标准库");
  assert.equal(hits[1].snippet, "另一段摘要");
});

test("textOf strips tags and decodes named and numeric entities", () => {
  assert.equal(textOf("<b>a</b> &amp; <i>b</i>"), "a & b");
  assert.equal(textOf("x&#39;y&#x27;z"), "x'y'z");
  assert.equal(textOf("<script>bad()</script>ok"), "ok");
});

test("dedupe collapses one page reached by two URLs", () => {
  const hits = [
    { title: "a", url: "https://example.com/x?utm=1", snippet: "" },
    { title: "b", url: "https://example.com/x", snippet: "" },
    { title: "c", url: "https://example.com/y", snippet: "" },
  ];
  assert.deepEqual(dedupe(hits, 10).map((hit) => hit.title), ["a", "c"]);
  assert.equal(dedupe(hits, 1).length, 1);
});

test("the relevance gate refuses a fallback page of unrelated links", () => {
  const unrelated = [{ title: "微博", url: "https://weibo.com/login.php", snippet: "" }];
  assert.equal(isRelevant(unrelated, "hymnix orbit electron"), false);
  assert.equal(isRelevant([{ title: "Hymnix Orbit 下载", url: "https://x.test/a", snippet: "" }], "hymnix orbit electron"), true);
  assert.deepEqual(queryTokens("python asyncio"), ["python", "asyncio"]);
  assert.ok(queryTokens("深度求索 模型").includes("深度求索"));
});

test("searchWeb reports no_relevant_results instead of serving junk", async () => {
  const junk = BING_RSS.replace(/Python asyncio|asyncio/g, "unrelated");
  const result = await searchWeb({ query: "hymnix orbit electron" }, async (url) => (url.includes("bing") ? junk : junk));
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_relevant_results");
  assert.deepEqual(result.hits, []);
});

test("searchWeb falls back to Baidu when Bing answers with nothing", async () => {
  const seen = [];
  const result = await searchWeb({ query: "asyncio" }, async (url) => {
    seen.push(url);
    return url.includes("bing.com") ? "<rss><channel></channel></rss>" : BAIDU;
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "baidu");
  assert.equal(seen.length, 2);
  assert.ok(result.hits.length > 0);
});

test("searchWeb reports failure when every provider errors", async () => {
  const failed = await searchWeb({ query: "x" }, async () => { throw new Error("search_http_403"); });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "search_unavailable");
  assert.deepEqual(failed.hits, []);
});

test("searchWeb refuses an empty query, clamps the count, honours a provider", async () => {
  assert.equal((await searchWeb({ query: "  " }, async () => BING_RSS)).error, "query_required");
  const one = await searchWeb({ query: "asyncio", count: 1 }, async () => BING_RSS);
  assert.equal(one.hits.length, 1);
  const seen = [];
  const forced = await searchWeb({ query: "asyncio", provider: "baidu" }, async (url) => { seen.push(url); return BAIDU; });
  assert.equal(forced.provider, "baidu");
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("baidu.com"));
});

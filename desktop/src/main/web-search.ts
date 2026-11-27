/**
 * Web search with no API key and no gateway dependency.
 *
 * The model has web.fetch but needed a URL first, which is useless when it does
 * not know the address. Three findings shaped this module, all from live probes:
 *
 * - DuckDuckGo is unreachable from a mainland network, so it cannot be the default.
 * - Bing's HTML page answers a scripted request with unrelated results, so the
 *   RSS view (format=rss) is used instead: same index, 3 KB instead of 100 KB,
 *   and structured items rather than markup to scrape.
 * - Baidu's HTML does vary between layouts and rate limits, so it is the fallback
 *   and its parser tolerates both of the card shapes it has served.
 *
 * Because no engine is obliged to answer honestly, every provider's output passes
 * a relevance gate. A page of plausible-looking but unrelated links is reported
 * as a failure, not handed to the model as if it were an answer.
 */

export type WebSearchHit = { title: string; url: string; snippet: string };

export type WebSearchProvider = "auto" | "bing" | "baidu";

export type WebSearchResult = {
  ok: boolean;
  provider?: string;
  query?: string;
  hits: WebSearchHit[];
  error?: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", middot: "·", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–",
};

/** Turn one fragment of markup into readable text. */
export function textOf(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_whole, code: string) => {
      const key = String(code).toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16) || 32);
      if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10) || 32);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Bing RSS: one <item> per organic result. */
export function parseBingRss(xml: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  for (const match of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = match[1];
    const link = (body.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "";
    const title = textOf((body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const snippet = textOf((body.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || "");
    const url = textOf(link).replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url) || !title) continue;
    hits.push({ title, url, snippet });
  }
  return hits;
}

/** Baidu: <div class="result c-container"> carries the real URL in mu="". */
export function parseBaidu(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  for (const part of String(html).split(/<div class="result(?:-op)? c-container/i).slice(1)) {
    const link = part.match(/\bmu="([^"]+)"/);
    const head = part.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!link || !head) continue;
    const url = textOf(link[1]).replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url)) continue;
    const title = textOf(head[1]);
    if (!title) continue;
    const abstract = part.match(/<div class="c-abstract[^"]*">([\s\S]*?)<\/div>/i)
      || part.match(/<span class="content-right[^"]*">([\s\S]*?)<\/span>/i);
    hits.push({ title, url, snippet: abstract ? textOf(abstract[1]).slice(0, 300) : "" });
  }
  return hits;
}

/**
 * True for a search engine's own result chrome rather than a page: image or
 * video tabs, "did you mean" links, and the row Baidu renders with the query as
 * its title. Those echo the query back and would otherwise defeat the relevance
 * gate — the first live probe returned "… - 百度图片" as a hit for a phrase that
 * has no results at all.
 */
export function isEngineEcho(hit: WebSearchHit, query: string): boolean {
  const url = hit.url.toLowerCase();
  if (/^https?:\/\/(?:image|img|v|video|m)\.(?:baidu|sogou|so)\.com\//.test(url)) return true;
  if (/^https?:\/\/www\.baidu\.com\/s\?/.test(url)) return true;
  if (/^https?:\/\/(?:www\.)?bing\.com\/(?:search|images|videos)\b/.test(url)) return true;
  if (/\/(?:link|l)\?url=/.test(url)) return true;
  const normalize = (value: string) => value.toLowerCase().replace(/[\s\-—_·|]+/g, "");
  return normalize(hit.title) === normalize(query);
}

/** Stable de-duplication: the same site often appears twice on one page. */
export function dedupe(hits: WebSearchHit[], limit: number): WebSearchHit[] {
  const seen = new Set<string>();
  const out: WebSearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url.replace(/[#?].*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** Query tokens worth matching: Latin words of 3+, or the whole CJK phrase. */
export function queryTokens(query: string): string[] {
  const latin = (query.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const cjk = (query.match(/[\u4e00-\u9fff]{2,}/g) || []);
  return [...new Set([...latin, ...cjk])];
}

/**
 * True when at least one hit actually mentions the query. This is the guard that
 * stops a fallback page of unrelated links from being reported as results.
 */
export function isRelevant(hits: WebSearchHit[], query: string): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return hits.length > 0;
  return hits.some((hit) => {
    const haystack = (hit.title + " " + hit.snippet + " " + hit.url).toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

const ENDPOINTS: Record<string, (query: string) => string> = {
  bing: (query) => "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&format=rss&count=20",
  baidu: (query) => "https://www.baidu.com/s?wd=" + encodeURIComponent(query) + "&rn=20",
};

const PARSERS: Record<string, (body: string) => WebSearchHit[]> = { bing: parseBingRss, baidu: parseBaidu };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchPage(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", Accept: "application/rss+xml,text/xml,text/html;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("search_http_" + response.status);
  return await response.text();
}

/**
 * One search, in the requested provider or in whichever answers with relevant
 * results first. Nothing is reported as a hit list unless it mentions the query.
 */
export async function searchWeb(
  input: { query?: unknown; count?: unknown; provider?: unknown },
  fetchImpl: (url: string, timeoutMs: number) => Promise<string> = fetchPage,
): Promise<WebSearchResult> {
  const query = String(input.query ?? "").trim().slice(0, 400);
  if (!query) return { ok: false, error: "query_required", hits: [] };
  const rawCount = Number(input.count);
  const count = Math.min(Math.max(Number.isFinite(rawCount) ? Math.floor(rawCount) : 8, 1), 20);
  const requested = String(input.provider ?? "auto");
  const order = requested === "bing" || requested === "baidu" ? [requested] : ["bing", "baidu"];

  let sawResults = false;
  for (const provider of order) {
    try {
      const body = await fetchImpl(ENDPOINTS[provider](query), 12_000);
      const hits = dedupe(PARSERS[provider](body), count).filter((hit) => !isEngineEcho(hit, query));
      if (!hits.length) continue;
      sawResults = true;
      if (!isRelevant(hits, query)) continue;
      return { ok: true, provider, query, hits };
    } catch {
      // A provider that errors or times out is skipped, not fatal: the next one
      // may still answer. Only the final failure is reported.
    }
  }
  return { ok: false, error: sawResults ? "no_relevant_results" : "search_unavailable", query, hits: [] };
}

/**
 * Framework-free helpers shared by the renderer and the node test runner.
 *
 * These live outside the .tsx files on purpose: they are the parts of the UI that
 * are worth asserting on (token estimates, slash parsing, error triage, password
 * scoring), and pulling them out keeps `tests/components.test.mjs` honest instead
 * of grepping source text. Plain JS plus a hand-written `pure.d.ts` because the
 * renderer tsconfig runs with `allowJs: false`.
 */

/** Rough token count: CJK glyphs are about one token each, Latin about four chars. */
export function estimateTokens(text) {
  const value = typeof text === "string" ? text : "";
  let cjk = 0;
  for (const char of value) {
    if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(char)) cjk++;
  }
  const latin = Math.max(0, value.length - cjk);
  return Math.round(cjk + latin / 4);
}

/** Split "/model llama3 8b" into { command: "model", argument: "llama3 8b" }. */
export function parseSlashCommand(input) {
  const text = typeof input === "string" ? input : "";
  if (!text.startsWith("/")) return { command: "", argument: "", isCommand: false };
  const [rawCommand, ...rest] = text.slice(1).split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  if (!command) return { command: "", argument: "", isCommand: false };
  return { command, argument: rest.join(" ").trim(), isCommand: true };
}

/**
 * Turn a raw transport failure into something a person can act on.
 * Categories drive which fix the error panel offers, so they are stable strings.
 */
export function classifyConnectError(message) {
  const text = String(message ?? "").toLowerCase();
  if (text.includes("bad_password") || text.includes("401") || text.includes("密码")) {
    return { category: "password", hint: "The host rejected the password. Ask for the current one." };
  }
  if (text.includes("version") || text.includes("协议")) {
    return { category: "version", hint: "The host runs a different Hymnix version. Update both apps." };
  }
  if (text.includes("timeout") || text.includes("enotfound") || text.includes("econnrefused") || text.includes("fetch") || text.includes("connect")) {
    return { category: "unreachable", hint: "The host is unreachable. Check the link and that sharing is running." };
  }
  return { category: "unknown", hint: "The connection failed. Check the link and try again." };
}

/** Decimal byte formatting (matches what file managers show for model sizes). */
export function downloadBytes(bytes, lang) {
  let value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) value = 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  let formatted;
  try {
    formatted = new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en", { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  } catch {
    formatted = String(Math.round(value * 10) / 10);
  }
  return formatted + " " + units[unit];
}

const WEAK_PASSWORDS = new Set([
  "password", "12345678", "123456789", "qwertyui", "11111111", "abc12345",
  "password1", "letmein1", "iloveyou", "admin123", "hymnix12"
]);

/**
 * Four-step password meter for the sharing dialog.
 *
 * The ladder is deliberately conservative: a long single-class password is still
 * weak, because friend-share passwords are short-lived and often typed on a phone.
 * Score 0 is empty, 4 is strong; labels are translated by the caller.
 */
export function passwordStrength(password) {
  const value = typeof password === "string" ? password : "";
  if (!value) return { score: 0, label: "empty" };
  if (value.length < 8) return { score: 1, label: "weak" };
  if (WEAK_PASSWORDS.has(value.toLowerCase())) return { score: 1, label: "weak" };
  if (/^(.)\1+$/.test(value)) return { score: 1, label: "weak" };
  const classes =
    (/[a-z]/.test(value) ? 1 : 0) +
    (/[A-Z]/.test(value) ? 1 : 0) +
    (/[0-9]/.test(value) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(value) ? 1 : 0);
  if (classes < 2) return value.length >= 20 ? { score: 2, label: "fair" } : { score: 1, label: "weak" };
  if (value.length >= 14 && classes >= 3) return { score: 4, label: "strong" };
  if (value.length >= 11) return { score: 3, label: "good" };
  return { score: 2, label: "fair" };
}

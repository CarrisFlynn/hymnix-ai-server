/* Runs before the body is parsed. Deferring this work was why the window painted
   white until React mounted: --bg only exists under [data-theme], so every launch
   flashed the browser default for one or two frames.
   Classic (non-module) script on purpose: modules are deferred by definition.
   src/renderer/index.html loads it in <head> and scripts/fix-renderer-html.mjs
   leaves tags that already carry a type alone. */
(() => {
  try {
    const themes = {
      "camellia-white": "light", "deep-sea-blue": "light", "ink-green": "light", "honey-crimson": "light",
      "cyan-dark": "dark", "orange-dark": "dark", "rog-red-black": "dark", "neon-black": "dark", "graphite-gold": "dark",
    };
    const saved = JSON.parse(localStorage.getItem("hymnix.appearance.v2") || "null");
    const legacy = localStorage.getItem("hymnix.theme");
    const mode = saved?.mode === "light" || saved?.mode === "dark" || saved?.mode === "auto" ? saved.mode : "auto";
    const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const activeMode = mode === "auto" ? system : mode;
    const legacyMode = themes[legacy] || "light";
    const theme = saved
      ? (activeMode === "dark" ? saved.darkTheme : saved.lightTheme)
      : activeMode === "dark" ? (legacyMode === "dark" ? legacy : "graphite-gold") : (legacyMode === "light" ? legacy : "camellia-white");
    const root = document.documentElement;
    root.dataset.mode = activeMode;
    root.dataset.theme = themes[theme] === activeMode ? theme : activeMode === "dark" ? "graphite-gold" : "camellia-white";
    root.style.colorScheme = activeMode;

    // The same personalisation React applies on mount. Doing it here too means the
    // first layout is already at the right density and text size instead of
    // reflowing once the app boots.
    const density = localStorage.getItem("hymnix.density") === "compact" ? "compact" : "comfortable";
    const scale = Math.min(150, Math.max(90, Number(localStorage.getItem("hymnix.textScale") || 100) || 100));
    root.dataset.density = density;
    root.dataset.textScale = scale >= 150 ? "large" : "normal";
    root.dataset.reduceMotion = localStorage.getItem("hymnix.reduceMotion") === "1" ? "true" : "false";
    root.dataset.softenAccent = localStorage.getItem("hymnix.softenAccent") === "1" ? "true" : "false";
    root.style.setProperty("--text-scale", String(scale / 100));
  } catch { /* React applies the default theme if storage is unavailable. */ }
})();

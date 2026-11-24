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
    document.documentElement.dataset.mode = activeMode;
    document.documentElement.dataset.theme = themes[theme] === activeMode ? theme : activeMode === "dark" ? "graphite-gold" : "camellia-white";
    document.documentElement.style.colorScheme = activeMode;
  } catch { /* React applies the default theme if storage is unavailable. */ }
})();

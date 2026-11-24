export type ThemeMode = "light" | "dark";
export type AppearanceMode = ThemeMode | "auto";
/** `swatch` mirrors `--accent` from the theme file so the first-run swatch row can
 *  preview each preset before it is applied. `tests/components.test.mjs` compares
 *  the two, so the copy cannot drift. */
export type ThemeDefinition = { id: string; mode: ThemeMode; label: string; swatch: string };
export type AppearancePreferences = { mode: AppearanceMode; lightTheme: string; darkTheme: string };

export const THEMES: ThemeDefinition[] = [
  { id: "camellia-white", mode: "light", label: "Camellia white", swatch: "#E72D48" },
  { id: "deep-sea-blue", mode: "light", label: "Deep sea blue", swatch: "#122E8A" },
  { id: "ink-green", mode: "light", label: "Ink green", swatch: "#236050" },
  { id: "honey-crimson", mode: "light", label: "Honey crimson", swatch: "#9B0A11" },
  { id: "cyan-dark", mode: "dark", label: "Cyan dark", swatch: "#00DFEA" },
  { id: "orange-dark", mode: "dark", label: "Orange dark", swatch: "#FF812C" },
  { id: "rog-red-black", mode: "dark", label: "ROG red black", swatch: "#C10000" },
  { id: "neon-black", mode: "dark", label: "Neon black", swatch: "#00FE92" },
  { id: "graphite-gold", mode: "dark", label: "Graphite gold", swatch: "#D4AF37" },
];

export const THEME_IDS = THEMES.map((theme) => theme.id);
export const DEFAULT_THEME = "camellia-white";
export const DEFAULT_DARK_THEME = "graphite-gold";
const APPEARANCE_KEY = "hymnix.appearance.v2";

export function modeOf(id: string): ThemeMode {
  return THEMES.find((theme) => theme.id === id)?.mode ?? "light";
}

export function systemMode(): ThemeMode {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readAppearance(): AppearancePreferences {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<AppearancePreferences>;
      const mode = value.mode === "light" || value.mode === "dark" || value.mode === "auto" ? value.mode : "auto";
      const lightTheme = THEMES.some((item) => item.id === value.lightTheme && item.mode === "light") ? value.lightTheme! : DEFAULT_THEME;
      const darkTheme = THEMES.some((item) => item.id === value.darkTheme && item.mode === "dark") ? value.darkTheme! : DEFAULT_DARK_THEME;
      return { mode, lightTheme, darkTheme };
    }
    const legacy = localStorage.getItem("hymnix.theme") || "";
    const id = THEME_IDS.includes(legacy) ? legacy : DEFAULT_THEME;
    return modeOf(id) === "dark"
      ? { mode: "auto", lightTheme: DEFAULT_THEME, darkTheme: id }
      : { mode: "auto", lightTheme: id, darkTheme: DEFAULT_DARK_THEME };
  } catch {
    return { mode: "auto", lightTheme: DEFAULT_THEME, darkTheme: DEFAULT_DARK_THEME };
  }
}

export function activeMode(preferences = readAppearance()): ThemeMode {
  return preferences.mode === "auto" ? systemMode() : preferences.mode;
}

export function selectedTheme(preferences = readAppearance()): string {
  return activeMode(preferences) === "dark" ? preferences.darkTheme : preferences.lightTheme;
}

export function readStoredTheme(): string { return selectedTheme(); }
export function readStoredMode(): AppearanceMode { return readAppearance().mode; }

export function persistAppearanceMode(mode: AppearanceMode): AppearancePreferences {
  const next = { ...readAppearance(), mode };
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/** Save the selection independently for its light or dark mode. */
export function persistTheme(id: string): AppearancePreferences {
  const theme = THEMES.find((item) => item.id === id);
  if (!theme) return readAppearance();
  const current = readAppearance();
  const next = theme.mode === "dark" ? { ...current, darkTheme: id } : { ...current, lightTheme: id };
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
    localStorage.setItem("hymnix.theme", id);
  } catch { /* private mode */ }
  return next;
}

/** Applies a preset to the document without touching React state. */
export function applyTheme(id: string, mode = modeOf(id)): void {
  const root = document.documentElement;
  root.dataset.theme = id;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
}

export function applyStoredAppearance(): void {
  const preferences = readAppearance();
  applyTheme(selectedTheme(preferences), activeMode(preferences));
}

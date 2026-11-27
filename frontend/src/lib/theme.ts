export type Theme = "auto" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const KEY = "filmlog.theme";

export function getThemePreference(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "auto" || stored === "light" || stored === "dark") return stored;
  } catch {
    // privater Modus o. Ä.
  }
  return "auto";
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "dark" || theme === "light") return theme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme, persist = true): void {
  const resolved = resolve(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = theme;
  if (persist) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Einstellung bleibt zumindest für diese Sitzung aktiv.
    }
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "light" ? "#f3eee4" : "#17130f";
}

export function initTheme(): void {
  applyTheme(getThemePreference(), false);
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  mq?.addEventListener("change", () => {
    if (getThemePreference() === "auto") applyTheme("auto", false);
  });
}
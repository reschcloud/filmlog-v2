export type Theme = "dark" | "light";

const KEY = "filmlog.theme";

export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // privater Modus o. Ä.
  }
  return "dark";
}

export function applyTheme(theme: Theme, persist = true): void {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Einstellung bleibt zumindest für diese Sitzung aktiv.
    }
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f3eee4" : "#17130f";
}

export function initTheme(): void {
  applyTheme(getTheme(), false);
}
interface StoredDraft<T> {
  at: number;
  data: T;
}

const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function saveDraft<T>(key: string, data: T): void {
  try {
    const stored: StoredDraft<T> = { at: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Speicher voll oder privater Modus: Entwurf ist optional.
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredDraft<T>;
    if (!stored || typeof stored.at !== "number" || Date.now() - stored.at > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return stored.data;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignorieren
  }
}
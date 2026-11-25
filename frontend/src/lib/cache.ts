import { api, isOfflineError } from "../api";

const PREFIX = "filmlog.cache.";

interface Entry<T> {
  t: number;
  data: T;
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), data } satisfies Entry<T>));
  } catch {
    /* Speicher voll oder gesperrt: Cache ist optional */
  }
}

export function cacheGet<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Entry<T>) : null;
  } catch {
    return null;
  }
}

export function cacheClear(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignorieren */
  }
}

export interface Cached<T> {
  data: T;
  /** true, wenn die Daten aus dem lokalen Cache stammen (Server nicht erreichbar) */
  stale: boolean;
}

/** GET mit localStorage-Fallback bei Netzwerkfehlern. */
export async function fetchCached<T>(key: string, path: string): Promise<Cached<T>> {
  const cached = cacheGet<T>(key);
  try {
    const data = await api.get<T>(path, cached ? { timeoutMs: 8000 } : undefined);
    cacheSet(key, data);
    return { data, stale: false };
  } catch (e) {
    if (cached && isOfflineError(e)) return { data: cached.data, stale: true };
    throw e;
  }
}

import { api, ApiError } from "../api";
import type { CreateFramePayload, Frame } from "../types";
import { EVT_QUEUE, EVT_SYNCED, emit } from "./events";

const DB_NAME = "filmlog";
const DB_VERSION = 2;
const STORE = "queue";
const FAILED = "failed";

export interface QueueItem {
  client_id: string;
  roll_number: number;
  payload: CreateFramePayload;
  label: string;
  created: number;
}

export interface FailedItem extends QueueItem {
  message: string;
  failed_at: number;
}

export interface FlushResult {
  sent: number;
  dropped: { item: QueueItem; message: string }[];
  remaining: number;
  skipped: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "client_id" });
        if (!db.objectStoreNames.contains(FAILED)) db.createObjectStore(FAILED, { keyPath: "client_id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("IndexedDB nicht verfügbar"));
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error("IndexedDB-Upgrade blockiert – App neu laden"));
      };
    });
  }
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB-Fehler"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB abgebrochen"));
  });
}

export async function listQueue(): Promise<QueueItem[]> {
  try {
    const items = await run<QueueItem[]>("readonly", (s) => s.getAll() as IDBRequest<QueueItem[]>);
    return items.sort((a, b) => a.created - b.created);
  } catch {
    return [];
  }
}

export async function queueCount(): Promise<number> {
  try {
    return await run<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

/** Anzahl wartender Aufnahmen (nicht Queue-Einträge). */
export async function queuedFrameCount(): Promise<number> {
  return (await listQueue()).reduce((n, it) => n + (it.payload.count ?? 1), 0);
}

export async function listFailed(): Promise<FailedItem[]> {
  try {
    const items = await run<FailedItem[]>("readonly", (s) => s.getAll() as IDBRequest<FailedItem[]>, FAILED);
    return items.sort((a, b) => a.created - b.created);
  } catch {
    return [];
  }
}

/** Anzahl dauerhaft abgelehnter Aufnahmen, die auf eine Entscheidung warten. */
export async function failedFrameCount(): Promise<number> {
  return (await listFailed()).reduce((n, it) => n + (it.payload.count ?? 1), 0);
}

export async function retryFailed(clientId: string): Promise<void> {
  const item = (await listFailed()).find((i) => i.client_id === clientId);
  if (!item) return;
  const queueItem: QueueItem = {
    client_id: item.client_id,
    roll_number: item.roll_number,
    payload: item.payload,
    label: item.label,
    created: item.created,
  };
  await run("readwrite", (s) => s.put(queueItem));
  await run("readwrite", (s) => s.delete(clientId), FAILED);
  await notify();
}

export async function discardFailed(clientId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(clientId), FAILED);
  await notify();
}

async function notify(): Promise<void> {
  emit(EVT_QUEUE, await queuedFrameCount());
}

export async function enqueue(payload: CreateFramePayload, rollNumber: number, label: string): Promise<void> {
  if (!payload.client_id) throw new Error("client_id fehlt");
  const item: QueueItem = {
    client_id: payload.client_id,
    roll_number: rollNumber,
    payload,
    label,
    created: Date.now(),
  };
  await run("readwrite", (s) => s.put(item));
  await notify();
}

async function removeItem(clientId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(clientId));
}

/** Eine noch nicht gesendete Aufnahme verwerfen (Undo nach Offline-Speichern). */
export async function removeQueued(clientId: string): Promise<void> {
  await removeItem(clientId);
  await run("readwrite", (s) => s.delete(clientId), FAILED);
  await notify();
}

async function moveToFailed(item: QueueItem, message: string): Promise<void> {
  const failed: FailedItem = { ...item, message, failed_at: Date.now() };
  await run("readwrite", (s) => s.put(failed), FAILED);
  await removeItem(item.client_id);
}

/** Anzahl wartender Aufnahmen je Film (inkl. count). */
export async function queuedFramesByRoll(): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (const it of await listQueue()) {
    map.set(it.roll_number, (map.get(it.roll_number) ?? 0) + (it.payload.count ?? 1));
  }
  return map;
}

let flushing: Promise<FlushResult> | null = null;

async function doFlush(): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, dropped: [], remaining: 0, skipped: false };
  const items = await listQueue();
  for (const item of items) {
    try {
      await api.post<Frame[]>(`/api/v2/rolls/${item.roll_number}/frames`, item.payload, { timeoutMs: 20000 });
      await removeItem(item.client_id);
      result.sent += 1;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Duplikat bzw. Konflikt: nicht erneut senden
        await removeItem(item.client_id);
        result.dropped.push({ item, message: e.message });
      } else if (e instanceof ApiError && e.status === 401) {
        break;
      } else if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        e.status !== 429
      ) {
        // Nicht endgültig löschen: sichtbar parken, damit im Feld nichts verloren geht.
        await moveToFailed(item, e.message);
        result.dropped.push({ item, message: e.message });
      } else {
        // Netz weg, 5xx, 401 o. Ä.: behalten und später erneut versuchen
        break;
      }
    }
  }
  result.remaining = await queueCount();
  return result;
}

/** Offline-Warteschlange nacheinander senden. Läuft nie doppelt (auch nicht in mehreren Tabs). */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return queueCount().then((remaining) => ({ sent: 0, dropped: [], remaining, skipped: true }));
  }
  const exec = async (): Promise<FlushResult> => {
    const locks = navigator.locks;
    let result: FlushResult;
    if (locks) {
      const r = await locks.request("filmlog-flush", { ifAvailable: true }, async (lock) => {
        if (!lock) return null;
        return doFlush();
      });
      result = r ?? { sent: 0, dropped: [], remaining: await queueCount(), skipped: true };
    } else {
      result = await doFlush();
    }
    await notify();
    if (result.sent > 0 || result.dropped.length > 0) emit(EVT_SYNCED, result);
    return result;
  };
  flushing = exec().finally(() => {
    flushing = null;
  });
  return flushing;
}

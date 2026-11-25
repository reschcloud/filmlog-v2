export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowTimeStr(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Lokaler Zeitstempel ohne Zeitzone, z. B. 2026-08-09T10:20:11 */
export function nowIsoLocal(): string {
  const d = new Date();
  return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 2026-08-09 -> 09.08.2026 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date;
}

/** 2026-08-09T10:20:11 -> 09.08.2026 10:20 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : formatDate(iso);
}

export function isFresh(iso: string | null | undefined, maxAgeMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && Date.now() - t <= maxAgeMs && Date.now() - t >= -60_000;
}

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** 2026-08 -> Aug 26 */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1].slice(2)}`;
}

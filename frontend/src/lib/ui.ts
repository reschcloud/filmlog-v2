import type { Frame, FilmType, Roll, RollStatus } from "../types";
import { escapeHtml } from "./escape";
import { formatDate } from "./dates";

export const TYPE_LABELS: Record<FilmType, string> = {
  sw: "S/W",
  farbe: "Farbe",
  dia: "Dia",
  anderes: "Anderes",
};

export const CAMERA_FORMATS: { value: string; label: string }[] = [
  { value: "35mm", label: "35mm" },
  { value: "halbformat", label: "Halbformat" },
  { value: "6x4.5", label: "6×4,5" },
  { value: "6x6", label: "6×6" },
  { value: "6x7", label: "6×7" },
  { value: "6x9", label: "6×9" },
  { value: "4x5", label: "4×5" },
  { value: "instant", label: "Sofortbild" },
  { value: "anderes", label: "Anderes" },
];

export const FILM_FORMATS: { value: string; label: string }[] = [
  { value: "35mm", label: "35mm" },
  { value: "120", label: "120" },
  { value: "4x5", label: "4×5" },
  { value: "instant", label: "Sofortbild" },
  { value: "anderes", label: "Anderes" },
];

export const FILM_TYPES: { value: string; label: string }[] = (Object.keys(TYPE_LABELS) as FilmType[]).map(
  (k) => ({ value: k, label: TYPE_LABELS[k] }),
);

export const STATUS_LABELS: Record<RollStatus, string> = {
  offen: "Offen",
  abgeschlossen: "Abgeschlossen",
  entwickelt: "Entwickelt",
  gescannt: "Gescannt",
  archiviert: "Archiviert",
};

export function typeCornerHtml(type: FilmType | string | null | undefined): string {
  if (type === "sw") return `<div class="dashboard-typ-ecke dashboard-typ-sw"></div>`;
  if (type === "farbe") return `<div class="dashboard-typ-ecke dashboard-typ-farbe"></div>`;
  if (type === "dia") return `<div class="dashboard-typ-ecke dashboard-typ-dia"></div>`;
  return "";
}

export function expiryPillHtml(years: number): string {
  if (!years || years <= 0) return "";
  return `<span class="ablauf-pille">${years} Jahr${years === 1 ? "" : "e"} abgelaufen</span>`;
}

export function fillBarHtml(count: number, capacity: number): string {
  if (!capacity) return "";
  const pct = Math.min(100, Math.round((count / capacity) * 100));
  const full = count >= capacity;
  return `<div class="dashboard-fill-track"><div class="dashboard-fill-bar${full ? " dashboard-fill-voll" : ""}" style="width:${pct}%"></div></div>`;
}

export function rollTitle(r: Pick<Roll, "number" | "film_stock">): string {
  return `${r.film_stock.name} #${r.number}`;
}

const COORD_RE = /^\s*-?\d{1,3}(?:[.,]\d+)?\s*,\s*-?\d{1,3}(?:[.,]\d+)?\s*$/;

export function isCoordinateText(text: string | null | undefined): boolean {
  return !!text && COORD_RE.test(text.trim());
}

/** Kleiner Standort-Pin statt roher Koordinaten. */
export function pinIconHtml(label = "Standort gefunden"): string {
  return `<span class="pin-icon" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg></span>`;
}

/** Ortsname, sonst Pin, wenn eine Position/Koordinate vorhanden ist. */
export function locationHtml(
  locationText: string | null | undefined,
  lat?: number | null,
  lon?: number | null,
): string {
  const text = (locationText ?? "").trim();
  if (text && !isCoordinateText(text)) return escapeHtml(text);
  if (text || (typeof lat === "number" && typeof lon === "number")) return pinIconHtml();
  return "";
}

/** Meta-Zeile einer Aufnahme: nur gesetzte Werte, Koordinaten als Pin. */
export function frameMetaHtml(f: Frame): string {
  return [
    f.lens_name ? escapeHtml(f.lens_name) : "",
    f.shutter ? escapeHtml(f.shutter) : "",
    f.aperture ? escapeHtml(f.aperture) : "",
    f.flash ? "Blitz" : "",
    escapeHtml(`${formatDate(f.date)} ${f.time || ""}`.trim()),
    locationHtml(f.location_text, f.lat, f.lon),
  ]
    .filter(Boolean)
    .join(" · ");
}

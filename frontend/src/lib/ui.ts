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

/** Meta-Zeile einer Aufnahme: Objektiv · Zeit · Blende · Blitz · Datum · Ort (bereits escaped) */
export function frameMetaHtml(f: Frame): string {
  return [
    f.lens_name,
    f.shutter,
    f.aperture,
    f.flash ? "⚡" : "",
    `${formatDate(f.date)} ${f.time || ""}`.trim(),
    f.location_text,
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
}

import { api } from "../api";
import { formatDate, formatMonth } from "../lib/dates";
import { qs, qsa, setErrorState, setLoading } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import type { ViewContext } from "../lib/view";
import type { FilmType, Stats, StatsItem } from "../types";

type Range = "30" | "365" | "alle";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<Range, { t: number; s: Stats }>();
let currentRange: Range = "30";

function cornerClass(type: FilmType | string | undefined): string {
  if (type === "sw") return "dashboard-typ-sw";
  if (type === "farbe") return "dashboard-typ-farbe";
  if (type === "dia") return "dashboard-typ-dia";
  return "";
}

function ranking(title: string, items: StatsItem[]): string {
  if (!items.length) return "";
  const max = Math.max(1, ...items.map((i) => i.count));
  const rows = items
    .map((i) => {
      const cls = cornerClass(i.type ?? i.key);
      return `
      <div class="stats-zeile">
        ${cls ? `<div class="dashboard-typ-ecke ${cls}"></div>` : ""}
        <div class="stats-kopf">
          <span class="stats-name">${escapeHtml(i.name)}</span>
          <span class="stats-anzahl">${i.count}</span>
        </div>
        <div class="stats-bar"><div class="stats-bar-fill" style="width:${Math.round((i.count / max) * 100)}%"></div></div>
      </div>`;
    })
    .join("");
  return `<p class="dashboard-label">${escapeHtml(title)}</p><div class="stats-karte">${rows}</div>`;
}

/** Verteilung in Server-Reihenfolge (nach Zeit/Blende sortiert, nicht nach Anzahl) */
function distribution(title: string, items: StatsItem[]): string {
  if (!items.length) return "";
  const max = Math.max(1, ...items.map((i) => i.count));
  const rows = items
    .map(
      (i) => `
      <div class="dist-row">
        <span class="dist-label">${escapeHtml(i.name)}</span>
        <span class="dist-track"><span class="dist-fill" style="width:${Math.max(2, Math.round((i.count / max) * 100))}%"></span></span>
        <span class="dist-count">${i.count}</span>
      </div>`,
    )
    .join("");
  return `<p class="dashboard-label">${escapeHtml(title)}</p><div class="stats-karte dist-card">${rows}</div>`;
}

function monthChart(months: Stats["by_month"]): string {
  if (!months.length) return "";
  const max = Math.max(1, ...months.map((m) => m.frames));
  // Bei vielen Monaten zeigt jedes zweite Spalte ein Label (das letzte immer), damit nichts gedrängt wirkt.
  const showLabel = (i: number) => months.length <= 8 || i % 2 === 0 || i === months.length - 1;
  const cols = months
    .map((m, i) => {
      const h = Math.max(2, Math.round((m.frames / max) * 100));
      return `
      <div class="month-col" title="${escapeHtml(formatMonth(m.month))}: ${m.frames} Aufnahmen, ${m.rolls} Filme">
        <span class="month-val">${m.frames}</span>
        <span class="month-bar" style="height:${h}px"></span>
        ${showLabel(i) ? `<span class="month-label">${escapeHtml(formatMonth(m.month))}</span>` : ""}
      </div>`;
    })
    .join("");
  return `<p class="dashboard-label">Aufnahmen pro Monat</p><div class="stats-karte month-chart"><div class="month-scroll">${cols}</div></div>`;
}

let activeMap: { remove: () => void } | null = null;

async function drawMap(container: HTMLElement, locations: Stats["locations"], alive: () => boolean): Promise<void> {
  activeMap?.remove();
  activeMap = null;
  const pts = locations.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon));
  if (!pts.length) return;
  const [mod] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
  if (!alive() || !container.isConnected) return;
  const L = ((mod as unknown as { default?: typeof import("leaflet") }).default ?? mod) as typeof import("leaflet");
  // Mausrad-Zoom erst nach einem Klick in die Karte (sonst "klaut" das Rad das Scrollen der Seite);
  // beim Verlassen der Karte wieder aus. Capture-Phase, damit auch Marker-Klicks aktivieren.
  const map = L.map(container, { scrollWheelZoom: false });
  container.addEventListener("click", () => map.scrollWheelZoom.enable(), true);
  map.on("mouseout", () => map.scrollWheelZoom.disable());
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const bounds = L.latLngBounds([]);
  for (const p of pts) {
    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 7,
      color: "#7c2a1e",
      weight: 2,
      fillColor: "#b23c2a",
      fillOpacity: 0.85,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${escapeHtml(p.motif || "(kein Motiv)")}</strong><br>#${p.roll_number} · Nr. ${p.position}<br>${escapeHtml(formatDate(p.date))}`,
    );
    bounds.extend([p.lat, p.lon]);
  }
  if (pts.length === 1) map.setView([pts[0]!.lat, pts[0]!.lon], 14);
  else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
  activeMap = map;
}

export async function renderStats(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Stats</h1>
    <p class="view-hint">Aufnahmen zählen nach Aufnahmedatum, Filme nach Anlegedatum.</p>
    <div class="stats-tabs">
      <button type="button" class="stats-tab" data-range="30">30 Tage</button>
      <button type="button" class="stats-tab" data-range="365">365 Tage</button>
      <button type="button" class="stats-tab" data-range="alle">Alles</button>
    </div>
    <div id="statsContent"></div>`;
  const content = qs(el, "#statsContent");
  const tabs = qsa<HTMLButtonElement>(el, ".stats-tab");
  let seq = 0;

  function mark(): void {
    tabs.forEach((t) => t.classList.toggle("aktiv", t.dataset.range === currentRange));
  }

  function paint(s: Stats): void {
    activeMap?.remove();
    activeMap = null;
    if (!s.frames_total && !s.rolls_total) {
      content.innerHTML = `<p class="empty-state">Keine Aufnahmen in diesem Zeitraum.</p>`;
      return;
    }
    const hasMap = s.locations.some((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon));
    content.innerHTML = `
      <p class="stats-gesamt"><span>${s.frames_total}</span> ${s.frames_total === 1 ? "Aufnahme" : "Aufnahmen"} · <span>${s.rolls_total}</span> ${s.rolls_total === 1 ? "Film" : "Filme"}</p>
      ${hasMap ? `<p class="dashboard-label">Karte (${s.locations.length} Orte)</p><div id="statsMap" class="stats-map"></div>` : ""}
      ${ranking("Filmtyp", s.by_type)}
      ${ranking("Kamera", s.by_camera)}
      ${ranking("Filmstock", s.by_film_stock)}
      ${ranking("Filme pro Filmstock", s.rolls_by_film_stock)}
      ${ranking("Objektiv", s.by_lens)}
      ${distribution("Belichtungszeit", s.by_shutter)}
      ${distribution("Blende", s.by_aperture)}
      ${monthChart(s.by_month)}`;
    const month = content.querySelector<HTMLElement>(".month-scroll");
    if (month) month.scrollLeft = month.scrollWidth;
    const mapEl = content.querySelector<HTMLElement>("#statsMap");
    if (mapEl) {
      drawMap(mapEl, s.locations, ctx.alive).catch(() => {
        mapEl.innerHTML = `<p class="empty-state">Karte konnte nicht geladen werden (offline?).</p>`;
      });
    }
  }

  async function show(range: Range): Promise<void> {
    currentRange = range;
    mark();
    const my = ++seq;
    const cached = cache.get(range);
    if (cached && Date.now() - cached.t < CACHE_MS) {
      paint(cached.s);
      return;
    }
    setLoading(content);
    try {
      const s = await api.get<Stats>(`/api/v2/stats?range=${range}`);
      cache.set(range, { t: Date.now(), s });
      if (my === seq && ctx.alive()) paint(s);
    } catch (e) {
      if (my === seq && ctx.alive()) setErrorState(content, e);
    }
  }

  tabs.forEach((t) => {
    t.onclick = () => void show(t.dataset.range as Range);
  });
  await show(currentRange);
}

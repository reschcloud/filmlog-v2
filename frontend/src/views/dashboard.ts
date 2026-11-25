import { api, errMsg } from "../api";
import { getDashboard } from "../lib/data";
import { formatDate, isFresh } from "../lib/dates";
import { qs, qsa, toast, withBusy } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { navigate } from "../lib/nav";
import { queuedFramesByRoll } from "../lib/queue";
import { expiryPillHtml, fillBarHtml, TYPE_LABELS, typeCornerHtml } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { Dashboard, Hint, Roll } from "../types";

const HINT_ICONS: Record<Hint["kind"], string> = {
  voll: "🎞️",
  lange_in_kamera: "⏳",
  entwickeln: "🧪",
  abgelaufen: "📅",
};

function rollCardHtml(r: Roll, queued: number): string {
  const count = r.frame_count + queued;
  const full = r.is_full || (r.capacity > 0 && count >= r.capacity);
  return `
    <div class="dashboard-card" data-roll="${r.number}" tabindex="0" role="button">
      ${typeCornerHtml(r.film_stock.type)}
      ${full ? `<button type="button" class="dashboard-done-btn" data-done="${r.number}" title="Film abschließen" aria-label="Film #${r.number} abschließen">✓</button>` : ""}
      <div class="dashboard-info">
        <div class="dashboard-kamera">${escapeHtml(r.camera.name)}</div>
        <div class="dashboard-film">${escapeHtml(r.film_stock.name)} #${r.number} ${expiryPillHtml(r.expired_years)}</div>
      </div>
      <div class="dashboard-right">
        <div class="dashboard-count">${count}${r.capacity ? `<span class="dashboard-max">/${r.capacity}</span>` : ""}</div>
        ${fillBarHtml(count, r.capacity)}
      </div>
    </div>`;
}

function lastFrameHtml(d: Dashboard): string {
  const f = d.last_frame;
  if (!f) return "";
  const fresh = isFresh(f.recorded_at, 2 * 60 * 1000);
  const settings = [f.lens_name, f.shutter, f.aperture, f.flash ? "⚡" : ""].filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <p class="dashboard-label">Zuletzt${fresh ? ` <span class="frisch-punkt" title="Vor weniger als 2 Minuten aufgenommen"></span>` : ""}</p>
    <a class="frame letzte-aufnahme" href="#zuletzt">
      ${typeCornerHtml(f.roll.type)}
      <div>
        ${f.motif ? `<div class="frame-motiv">${escapeHtml(f.motif)}</div>` : ""}
        <div class="frame-film">${escapeHtml(f.roll.camera_name)} · ${escapeHtml(f.roll.film_stock_name)} #${f.roll_number} · Nr. ${f.position}</div>
        <div class="frame-meta">${escapeHtml(formatDate(f.date))} ${escapeHtml(f.time)}</div>
        ${settings ? `<div class="frame-meta">${settings}</div>` : ""}
      </div>
    </a>`;
}

function developDesc(d: Dashboard): string {
  const t = d.to_develop;
  if (!t.total) return "Protokolle, Status und Export";
  const parts = (["sw", "farbe", "dia", "anderes"] as const)
    .filter((k) => t[k] > 0)
    .map((k) => `${TYPE_LABELS[k]} ${t[k]}`);
  return `Zu entwickeln: ${t.total}${parts.length > 1 ? ` (${parts.join(" · ")})` : ""}`;
}

export async function renderDashboard(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <div id="dashTop"><p class="empty-state">Wird geladen …</p></div>
    <p class="dashboard-label">Funktionen</p>
    <div class="tile-grid">
      <a class="tile" href="#neue-aufnahme">
        <span class="tile-glyph">📷</span>
        <span class="tile-title">Aufnahme</span>
        <span class="tile-desc">Neue Aufnahme eintragen</span>
      </a>
      <a class="tile" href="#neuer-film">
        <span class="tile-glyph">🎞️</span>
        <span class="tile-title">Neu</span>
        <span class="tile-desc">Neue Film-Kamera-Kombination beginnen</span>
      </a>
      <a class="tile" href="#filme">
        <span class="tile-glyph">📝</span>
        <span class="tile-title">Filme</span>
        <span class="tile-desc" id="filmeDesc">Protokolle, Status und Export</span>
      </a>
      <a class="tile" href="#suche">
        <span class="tile-glyph">🔍</span>
        <span class="tile-title">Suche</span>
        <span class="tile-desc">Motive, Orte, Filme und Kameras durchsuchen</span>
      </a>
      <a class="tile" href="#stats">
        <span class="tile-glyph">📊</span>
        <span class="tile-title">Stats</span>
        <span class="tile-desc">Auswertungen, Verteilungen und Karte</span>
      </a>
      <a class="tile" href="#optionen">
        <span class="tile-glyph">⚙️</span>
        <span class="tile-title">Optionen</span>
        <span class="tile-desc">Kameras, Objektive, Filme &amp; Co. verwalten</span>
      </a>
      <a class="tile" href="#einstellungen">
        <span class="tile-glyph">🔧</span>
        <span class="tile-title">Einstellungen</span>
        <span class="tile-desc">Passwort, API-Tokens, Import, Backup</span>
      </a>
    </div>`;

  const top = qs(el, "#dashTop");
  let result;
  try {
    result = await getDashboard();
  } catch (e) {
    if (ctx.alive()) top.innerHTML = `<p class="error-msg">${escapeHtml(errMsg(e))}</p>`;
    return;
  }
  if (!ctx.alive()) return;
  const d = result.data;
  const queued = result.stale ? await queuedFramesByRoll() : new Map<number, number>();
  if (!ctx.alive()) return;

  const hints = d.hints
    .map(
      (h) => `<a class="hint hint-${escapeHtml(h.kind)}" href="#film/${h.roll_number}">
        <span class="hint-icon">${HINT_ICONS[h.kind] ?? "ℹ️"}</span><span>${escapeHtml(h.text)}</span></a>`,
    )
    .join("");

  top.innerHTML = `
    ${result.stale ? `<p class="offline-note">Offline – zuletzt geladene Daten.</p>` : ""}
    <p class="dashboard-label">Aktiv</p>
    ${
      d.open_rolls.length
        ? `<div class="dashboard-grid">${d.open_rolls.map((r) => rollCardHtml(r, queued.get(r.number) ?? 0)).join("")}</div>`
        : `<p class="empty-state">Lege einen neuen Film an, um zu beginnen.</p>`
    }
    ${hints ? `<div class="hint-list">${hints}</div>` : ""}
    ${lastFrameHtml(d)}`;
  qs(el, "#filmeDesc").textContent = developDesc(d);

  qsa(top, ".dashboard-card").forEach((card) => {
    const open = () => navigate(`neue-aufnahme/${card.dataset.roll}`);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target === card) {
        ev.preventDefault();
        open();
      }
    });
  });
  qsa<HTMLButtonElement>(top, ".dashboard-done-btn").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const n = Number(btn.dataset.done);
      const roll = d.open_rolls.find((r) => r.number === n);
      if (!confirm(`Film #${n} (${roll?.camera.name ?? ""}) wirklich abschließen?`)) return;
      await withBusy(btn, async () => {
        try {
          await api.post(`/api/v2/rolls/${n}/status`, { status: "abgeschlossen" });
          toast(`Film #${n} abgeschlossen.`, "ok");
          navigate("start");
        } catch (e) {
          toast(errMsg(e), "error");
        }
      });
    });
  });
}

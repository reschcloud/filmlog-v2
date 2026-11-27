import { errMsg } from "../api";
import { getDashboard } from "../lib/data";
import { formatDate, isFresh } from "../lib/dates";
import { qs, qsa } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { navigate } from "../lib/nav";
import { queuedFramesByRoll } from "../lib/queue";
import { expiryPillHtml, fillBarHtml, typeCornerHtml } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { Dashboard, Roll } from "../types";

function rollCardHtml(r: Roll, queued: number): string {
  const count = r.frame_count + queued;
  return `
    <div class="dashboard-card" data-roll="${r.number}" tabindex="0" role="button" aria-label="Film #${r.number} – neue Aufnahme">
      ${typeCornerHtml(r.film_stock.type)}
      <div class="dashboard-info">
        <div class="dashboard-kamera">${escapeHtml(r.camera.name)}</div>
        <div class="dashboard-film">#${r.number} · ${escapeHtml(r.film_stock.name)} ${expiryPillHtml(r.expired_years)}</div>
        <a class="dashboard-details" href="#film/${r.number}" aria-label="Film #${r.number} Details">Details</a>
      </div>
      <div class="dashboard-right">
        <div class="dashboard-count">${count}${r.capacity ? `<span class="dashboard-max">/${r.capacity}</span>` : ""}</div>
        ${fillBarHtml(count, r.capacity)}
      </div>
    </div>`;
}

/** Filme, die auf Entwicklung warten: eine Summe, aufgeteilt nur nach S/W und Farbe. */
function developCardHtml(t: Dashboard["to_develop"]): string {
  if (!t.total) return "";
  const parts = [t.farbe ? `Farbe ${t.farbe}` : "", t.sw ? `S/W ${t.sw}` : ""].filter(Boolean);
  return `
    <a class="develop-card" href="#filme">
      <div class="develop-info">
        <div class="develop-title">Zu entwickeln</div>
        ${parts.length ? `<div class="develop-detail">${parts.join(" · ")}</div>` : ""}
      </div>
      <div class="develop-count">${t.total} <span class="develop-unit">${t.total === 1 ? "Film" : "Filme"}</span></div>
    </a>`;
}

function lastFrameHtml(d: Dashboard): string {
  const f = d.last_frame;
  if (!f) return "";
  const fresh = isFresh(f.recorded_at, 2 * 60 * 1000);
  const settings = [f.lens_name, f.shutter, f.aperture, f.flash ? "Blitz" : ""].filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <p class="dashboard-label">Zuletzt${fresh ? ` <span class="frisch-text">neu</span>` : ""}</p>
    <a class="frame letzte-aufnahme" href="#zuletzt">
      ${typeCornerHtml(f.roll.type)}
      <div>
        ${f.motif ? `<div class="frame-motiv">${escapeHtml(f.motif)}</div>` : ""}
        <div class="frame-film">${escapeHtml(f.roll.camera_name)} · #${f.roll_number} · Nr. ${f.position}</div>
        <div class="frame-meta">${escapeHtml(formatDate(f.date))} ${escapeHtml(f.time)}</div>
        ${settings ? `<div class="frame-meta">${settings}</div>` : ""}
      </div>
    </a>`;
}

export async function renderDashboard(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="visually-hidden">Start</h1>
    <div id="dashTop"><p class="empty-state">Wird geladen …</p></div>`;

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
    .filter((h) => h.kind === "abgelaufen")
    .map((h) => `<a class="hint hint-${escapeHtml(h.kind)}" href="#film/${h.roll_number}">${escapeHtml(h.text)}</a>`)
    .join("");

  top.innerHTML = `
    ${result.stale ? `<p class="offline-note">Offline – zuletzt geladene Daten.</p>` : ""}
    <p class="dashboard-label">Offene Filme</p>
    ${
      d.open_rolls.length
        ? `<div class="dashboard-grid">${d.open_rolls.map((r) => rollCardHtml(r, queued.get(r.number) ?? 0)).join("")}</div>`
        : `<p class="empty-state">Noch kein aktiver Film.</p>`
    }
    ${developCardHtml(d.to_develop)}
    ${hints ? `<div class="hint-list">${hints}</div>` : ""}
    ${lastFrameHtml(d)}`;

  qsa(top, ".dashboard-card").forEach((card) => {
    const open = () => navigate(`neue-aufnahme/${card.dataset.roll}`);
    card.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("a,button")) return;
      open();
    });
    card.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target === card) {
        ev.preventDefault();
        open();
      }
    });
  });
  }

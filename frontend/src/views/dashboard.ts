import { api, errMsg } from "../api";
import { getDashboard } from "../lib/data";
import { formatDate, isFresh } from "../lib/dates";
import { qs, qsa, toast, withBusy } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { navigate } from "../lib/nav";
import { queuedFramesByRoll } from "../lib/queue";
import { expiryPillHtml, fillBarHtml, typeCornerHtml } from "../lib/ui";
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
      ${full ? `<button type="button" class="dashboard-done-btn" data-done="${r.number}" title="Film abschließen" aria-label="Film #${r.number} abschließen">✓</button>` : ""}
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
        <div class="frame-film">${escapeHtml(f.roll.camera_name)} · #${f.roll_number} · Nr. ${f.position}</div>
        <div class="frame-meta">${escapeHtml(formatDate(f.date))} ${escapeHtml(f.time)}</div>
        ${settings ? `<div class="frame-meta">${settings}</div>` : ""}
      </div>
    </a>`;
}

function continueHtml(d: Dashboard, queued: Map<number, number>): string {
  const r = d.open_rolls[0];
  if (!r) {
    return `
      <a class="continue-card" href="#neuer-film">
        <div class="continue-main">
          <div class="continue-kicker">Loslegen</div>
          <div class="continue-title">Neuen Film anlegen</div>
          <div class="continue-meta">Kamera und Film wählen</div>
        </div>
        <span class="continue-arrow">→</span>
      </a>`;
  }
  const count = r.frame_count + (queued.get(r.number) ?? 0);
  return `
    <a class="continue-card" href="#neue-aufnahme/${r.number}">
      <div class="continue-main">
        <div class="continue-kicker">Weiter · ${count}${r.capacity ? `/${r.capacity}` : ""} Aufnahmen</div>
        <div class="continue-title">#${r.number} · ${escapeHtml(r.film_stock.name)}</div>
        <div class="continue-meta">${escapeHtml(r.camera.name)}</div>
      </div>
      <span class="continue-arrow">→</span>
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
    .filter((h) => h.kind !== "voll" && h.kind !== "lange_in_kamera")
    .map(
      (h) => `<a class="hint hint-${escapeHtml(h.kind)}" href="#film/${h.roll_number}">
        <span class="hint-icon">${HINT_ICONS[h.kind] ?? "ℹ️"}</span><span>${escapeHtml(h.text)}</span></a>`,
    )
    .join("");

  top.innerHTML = `
    ${result.stale ? `<p class="offline-note">Offline – zuletzt geladene Daten.</p>` : ""}
    ${continueHtml(d, queued)}
    <div class="section-head">
      <p class="dashboard-label">Aktiv</p>
      <a class="text-link" href="#neuer-film">+ Neuer Film</a>
    </div>
    ${
      d.open_rolls.length
        ? `<div class="dashboard-grid">${d.open_rolls.map((r) => rollCardHtml(r, queued.get(r.number) ?? 0)).join("")}</div>`
        : `<p class="empty-state">Noch kein aktiver Film.</p>`
    }
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

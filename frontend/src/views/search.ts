import { api, errMsg } from "../api";
import { debounce, qs, setLoading } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { expiryPillHtml, frameMetaHtml, STATUS_LABELS, typeCornerHtml } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { SearchResult } from "../types";

let lastQuery = "";

export function renderSearch(ctx: ViewContext): void {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Suche</h1>
    <p class="view-hint">Motive, Orte, Objektive, Kameras, Filme und Notizen.</p>
    <div class="card filter-sticky">
      <label>Suchbegriff
        <input type="search" id="searchInput" placeholder="z. B. Teich" autocomplete="off" value="${escapeHtml(lastQuery)}">
      </label>
    </div>
    <div id="searchResults"></div>`;
  const input = qs<HTMLInputElement>(el, "#searchInput");
  const out = qs(el, "#searchResults");
  let seq = 0;

  async function run(): Promise<void> {
    const q = input.value.trim();
    lastQuery = q;
    const my = ++seq;
    if (!q) {
      out.innerHTML = "";
      return;
    }
    setLoading(out, "Suche …");
    try {
      const res = await api.get<SearchResult>(`/api/v2/search?q=${encodeURIComponent(q)}`);
      if (my !== seq || !ctx.alive()) return;
      if (!res.frames.length && !res.rolls.length) {
        out.innerHTML = `<p class="empty-state">Keine Treffer.</p>`;
        return;
      }
      const frames = res.frames
        .map(
          (f) => `
        <a class="eintrag eintrag-zuletzt eintrag-link" href="#film/${f.roll_number}/${f.position}">
          ${typeCornerHtml(f.roll.type)}
          <div class="eintrag-info">
            <div class="eintrag-motiv">${f.motif ? escapeHtml(f.motif) : "(kein Motiv)"}</div>
            <div class="eintrag-film">${escapeHtml(f.roll.camera_name)} · ${escapeHtml(f.roll.film_stock_name)} #${f.roll_number} · Nr. ${f.position}</div>
            <div class="eintrag-meta">${frameMetaHtml(f)}</div>
          </div>
        </a>`,
        )
        .join("");
      const rolls = res.rolls
        .map(
          (r) => `
        <a class="eintrag eintrag-zuletzt eintrag-link" href="#film/${r.number}">
          ${typeCornerHtml(r.film_stock.type)}
          <div class="eintrag-info">
            <div class="eintrag-film">#${r.number} — ${escapeHtml(r.film_stock.name)} ${expiryPillHtml(r.expired_years)}</div>
            <div class="eintrag-meta">${escapeHtml(r.camera.name)} · ${r.frame_count} Aufnahmen · ${escapeHtml(STATUS_LABELS[r.status])}</div>
            ${r.notes ? `<div class="eintrag-meta">${escapeHtml(r.notes)}</div>` : ""}
          </div>
        </a>`,
        )
        .join("");
      const frameCount = res.frames.length >= 50 ? "50+" : String(res.frames.length);
      const rollCount = res.rolls.length >= 30 ? "30+" : String(res.rolls.length);
      out.innerHTML =
        (frames ? `<p class="dashboard-label">Aufnahmen (${frameCount})</p><div class="eintraege-liste eintraege-liste-abstand">${frames}</div>` : "") +
        (rolls ? `<p class="dashboard-label">Filme (${rollCount})</p><div class="eintraege-liste eintraege-liste-abstand">${rolls}</div>` : "");
    } catch (e) {
      if (my === seq && ctx.alive()) out.innerHTML = `<p class="error-msg">${escapeHtml(errMsg(e))}</p>`;
    }
  }

  input.addEventListener("input", debounce(() => void run(), 300));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void run();
    }
  });
  if (lastQuery) void run();
  else input.focus();
}

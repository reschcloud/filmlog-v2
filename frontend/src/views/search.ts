import { api, errMsg } from "../api";
import { debounce, qs, setLoading, toast, withBusy } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { expiryPillHtml, frameMetaHtml, STATUS_LABELS, typeCornerHtml } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { FrameWithRoll, Roll, SearchResult } from "../types";

let lastQuery = "";

interface SearchState {
  q: string;
  frames: FrameWithRoll[];
  rolls: Roll[];
  framesHasMore: boolean;
  rollsHasMore: boolean;
}

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
  let state: SearchState = { q: "", frames: [], rolls: [], framesHasMore: false, rollsHasMore: false };

  function frameHtml(f: FrameWithRoll): string {
    return `
      <a class="eintrag eintrag-zuletzt eintrag-link" href="#film/${f.roll_number}/${f.position}">
        ${typeCornerHtml(f.roll.type)}
        <div class="eintrag-info">
          <div class="eintrag-motiv">${f.motif ? escapeHtml(f.motif) : "(kein Motiv)"}</div>
          <div class="eintrag-film">${escapeHtml(f.roll.camera_name)} · #${f.roll_number} · ${escapeHtml(f.roll.film_stock_name)} · Nr. ${f.position}</div>
          <div class="eintrag-meta">${frameMetaHtml(f)}</div>
        </div>
      </a>`;
  }

  function rollHtml(r: Roll): string {
    return `
      <a class="eintrag eintrag-zuletzt eintrag-link" href="#film/${r.number}">
        ${typeCornerHtml(r.film_stock.type)}
        <div class="eintrag-info">
          <div class="eintrag-film">#${r.number} — ${escapeHtml(r.film_stock.name)} ${expiryPillHtml(r.expired_years)}</div>
          <div class="eintrag-meta">${escapeHtml(r.camera.name)} · ${r.frame_count} Aufnahmen · ${escapeHtml(STATUS_LABELS[r.status])}</div>
          ${r.notes ? `<div class="eintrag-meta">${escapeHtml(r.notes)}</div>` : ""}
        </div>
      </a>`;
  }

  function paint(): void {
    if (!state.q) {
      out.innerHTML = "";
      return;
    }
    if (!state.frames.length && !state.rolls.length) {
      out.innerHTML = `<p class="empty-state">Keine Treffer.</p>`;
      return;
    }
    const frames = state.frames.map(frameHtml).join("");
    const rolls = state.rolls.map(rollHtml).join("");
    out.innerHTML =
      (frames
        ? `<p class="dashboard-label">Aufnahmen (${state.frames.length}${state.framesHasMore ? "+" : ""})</p>
           <div class="eintraege-liste eintraege-liste-abstand">${frames}</div>
           ${state.framesHasMore ? `<button type="button" class="mehr-anzeigen-btn" data-more="frames">Mehr Aufnahmen</button>` : ""}`
        : "") +
      (rolls
        ? `<p class="dashboard-label">Filme (${state.rolls.length}${state.rollsHasMore ? "+" : ""})</p>
           <div class="eintraege-liste eintraege-liste-abstand">${rolls}</div>
           ${state.rollsHasMore ? `<button type="button" class="mehr-anzeigen-btn" data-more="rolls">Mehr Filme</button>` : ""}`
        : "");
  }

  async function load(q: string, frameOffset: number, rollOffset: number, mode: "replace" | "frames" | "rolls"): Promise<void> {
    const my = ++seq;
    if (mode === "replace") setLoading(out, "Suche …");
    try {
      const params = new URLSearchParams({
        q,
        frame_offset: String(frameOffset),
        roll_offset: String(rollOffset),
      });
      // Beim Nachladen nur die angeforderte Liste holen.
      if (mode === "frames") params.set("roll_limit", "1");
      if (mode === "rolls") params.set("frame_limit", "1");
      const res = await api.get<SearchResult>(`/api/v2/search?${params.toString()}`);
      if (my !== seq || !ctx.alive()) return;
      if (mode === "replace") {
        state = {
          q,
          frames: res.frames,
          rolls: res.rolls,
          framesHasMore: res.frames_has_more,
          rollsHasMore: res.rolls_has_more,
        };
      } else if (mode === "frames") {
        const seen = new Set(state.frames.map((f) => f.id));
        state.frames = [...state.frames, ...res.frames.filter((f) => !seen.has(f.id))];
        state.framesHasMore = res.frames_has_more;
      } else {
        const seen = new Set(state.rolls.map((r) => r.number));
        state.rolls = [...state.rolls, ...res.rolls.filter((r) => !seen.has(r.number))];
        state.rollsHasMore = res.rolls_has_more;
      }
      paint();
    } catch (e) {
      if (my !== seq || !ctx.alive()) return;
      if (mode === "replace") {
        out.innerHTML = `<p class="error-msg">${escapeHtml(errMsg(e))}</p>`;
      } else {
        toast(errMsg(e), "error");
      }
    }
  }

  async function run(): Promise<void> {
    const q = input.value.trim();
    lastQuery = q;
    if (!q) {
      seq++;
      state = { q: "", frames: [], rolls: [], framesHasMore: false, rollsHasMore: false };
      out.innerHTML = "";
      return;
    }
    await load(q, 0, 0, "replace");
  }

  out.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-more]");
    if (!btn) return;
    const mode = btn.dataset.more === "frames" ? "frames" : "rolls";
    const frameOffset = mode === "frames" ? state.frames.length : 0;
    const rollOffset = mode === "rolls" ? state.rolls.length : 0;
    void withBusy(btn, () => load(lastQuery, frameOffset, rollOffset, mode));
  });

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
import { api, errMsg } from "../api";
import { optionsHtml, qs, setErrorState, setLoading, toast, withBusy } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { todayStr } from "../lib/dates";
import { navigate } from "../lib/nav";
import { frameMetaHtml, typeCornerHtml } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { FrameWithRoll, RecentFrames, Roll } from "../types";

let filterRoll = "";

export async function renderRecent(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Zuletzt eingetragene Aufnahmen</h1>
    <div class="card filter-sticky">
      <label>Film
        <select id="rollFilter"><option value="">Alle</option></select>
      </label>
    </div>
    <div id="recentList" class="frame-list"></div>`;
  const select = qs<HTMLSelectElement>(el, "#rollFilter");
  const list = qs(el, "#recentList");

  let items: FrameWithRoll[] = [];
  let cursor: string | null = null;

  api
    .get<Roll[]>("/api/v2/rolls?sort=recent")
    .then((rolls) => {
      if (!ctx.alive()) return;
      const opts = rolls.map((r) => ({ value: r.number, label: `#${r.number} · ${r.camera.name} · ${r.film_stock.name}` }));
      if (filterRoll && !opts.some((o) => String(o.value) === filterRoll)) {
        opts.push({ value: Number(filterRoll), label: `#${filterRoll}` });
      }
      select.innerHTML = optionsHtml(opts, filterRoll, "Alle");
    })
    .catch(() => undefined);

  function cardHtml(f: FrameWithRoll, i: number): string {
    return `
      <div class="eintrag eintrag-zuletzt">
        ${typeCornerHtml(f.roll.type)}
        <div class="eintrag-info">
          <div class="eintrag-motiv">${f.motif ? escapeHtml(f.motif) : "(kein Motiv)"}</div>
          <div class="eintrag-film">${escapeHtml(f.roll.camera_name)} · #${f.roll_number} · ${escapeHtml(f.roll.film_stock_name)} · Nr. ${f.position}</div>
          <div class="eintrag-meta">${frameMetaHtml(f)}</div>
        </div>
        <div class="eintrag-aktionen">
          <button type="button" class="eintrag-edit-btn" data-act="edit" data-i="${i}" title="${f.roll.status === "archiviert" ? "Ansehen" : "Bearbeiten"}" aria-label="Aufnahme ansehen oder bearbeiten">${f.roll.status === "archiviert" ? "👁️" : "✏️"}</button>
          ${f.roll.status === "archiviert" ? "" : `<button type="button" class="eintrag-del-btn" data-act="del" data-i="${i}" title="Löschen" aria-label="Aufnahme löschen">🗑️</button>`}
        </div>
      </div>`;
  }

  function paint(): void {
    if (!items.length) {
      list.innerHTML = `<p class="empty-state">Noch keine Aufnahmen protokolliert.</p>`;
      return;
    }
    const today = todayStr();
    const section = (title: string, test: (f: FrameWithRoll) => boolean): string => {
      const cards = items.map((f, i) => (test(f) ? cardHtml(f, i) : "")).join("");
      return cards ? `<p class="dashboard-label">${title}</p><div class="eintraege-liste eintraege-liste-abstand">${cards}</div>` : "";
    };
    list.innerHTML =
      section("Heute", (f) => f.date === today) +
      section("Älter", (f) => f.date !== today) +
      (cursor ? `<button type="button" class="mehr-anzeigen-btn" data-act="more">Mehr anzeigen</button>` : "");
  }

  async function load(reset: boolean): Promise<void> {
    if (reset) {
      items = [];
      cursor = null;
      setLoading(list);
    }
    const limit = filterRoll ? 36 : 25;
    const params = new URLSearchParams({ limit: String(limit) });
    if (filterRoll) params.set("roll", filterRoll);
    if (!reset && cursor) params.set("cursor", cursor);
    try {
      const res = await api.get<RecentFrames>(`/api/v2/frames/recent?${params.toString()}`);
      if (!ctx.alive()) return;
      items = reset ? res.items : [...items, ...res.items];
      cursor = res.next_cursor;
      paint();
    } catch (e) {
      if (!ctx.alive()) return;
      if (reset) setErrorState(list, e);
      else {
        toast(errMsg(e), "error");
        paint();
      }
    }
  }

  select.onchange = () => {
    filterRoll = select.value;
    void load(true);
  };

  list.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "more") {
      await withBusy(btn, () => load(false));
      return;
    }
    const f = items[Number(btn.dataset.i)];
    if (!f) return;
    if (btn.dataset.act === "edit") {
      navigate(`film/${f.roll_number}/${f.position}`);
      return;
    }
    const name = f.motif || `Aufnahme ${f.position}`;
    if (!confirm(`„${name}“ (${f.roll.camera_name} · ${f.roll.film_stock_name}, Nr. ${f.position}) wirklich löschen? Die folgenden Aufnahmen dieses Films rücken nach.`)) return;
    await withBusy(btn, async () => {
      try {
        await api.del(`/api/v2/frames/${f.id}`);
        items = items
          .filter((x) => x.id !== f.id)
          .map((x) => (x.roll_number === f.roll_number && x.position > f.position ? { ...x, position: x.position - 1 } : x));
        paint();
        toast("Aufnahme gelöscht.", "ok");
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
  });

  await load(true);
}

import { api, errMsg } from "../api";
import { formatDate } from "../lib/dates";
import { qs, setErrorState, setLoading, toast } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { navigate } from "../lib/nav";
import { NEXT, PREV, STATUS_DATE_LABEL } from "../lib/rollStatus";
import { expiryPillHtml, filmWithTypeHtml, STATUS_LABELS } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { Roll, RollStatus } from "../types";

let showArchived = false;

function rowHtml(r: Roll): string {
  const next = NEXT[r.status];
  const prev = PREV[r.status];
  const statusDate =
    r.status === "archiviert" ? r.archived_at
    : r.status === "gescannt" ? r.scanned_at
    : r.status === "entwickelt" ? r.developed_at
    : r.status === "abgeschlossen" ? r.completed_at
    : r.created_at;
  return `
    <div class="download-row roll-row download-row-klickbar" data-roll="${r.number}">
      <div class="download-row-info">
        <div class="download-row-title">#${r.number} — ${filmWithTypeHtml(r.film_stock.name, r.film_stock.type)}</div>
        <div class="download-row-meta">${escapeHtml(r.camera.name)} · ${r.frame_count}${r.capacity ? `/${r.capacity}` : ""} Aufnahmen ${expiryPillHtml(r.expired_years)}</div>
        ${statusDate ? `<div class="download-row-meta">${STATUS_DATE_LABEL[r.status]}: ${formatDate(statusDate)}</div>` : ""}
      </div>
      <div class="roll-actions">
        ${r.status === "offen" ? `<a class="roll-details" href="#film/${r.number}" aria-label="Film #${r.number} Details">Details</a>` : ""}
        ${prev ? `<button type="button" class="status-btn status-btn-back" data-act="prev" data-roll="${r.number}">↩ ${escapeHtml(prev.label)}</button>` : ""}
        ${next ? `<button type="button" class="status-btn" data-act="next" data-roll="${r.number}">${escapeHtml(next.label)}</button>` : ""}
      </div>
    </div>`;
}

function group(title: string, rolls: Roll[]): string {
  return rolls.length ? `<p class="dashboard-label">${escapeHtml(title)} (${rolls.length})</p><div class="download-list">${rolls.map(rowHtml).join("")}</div>` : "";
}

export async function renderRolls(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Filme</h1>
    <label class="archiv-toggle filter-sticky">
      <input type="checkbox" id="archivCheckbox"${showArchived ? " checked" : ""}>
      Archivierte anzeigen
    </label>
    <div id="rollList"></div>`;
  const list = qs(el, "#rollList");
  const toggle = qs<HTMLInputElement>(el, "#archivCheckbox");
  toggle.onchange = () => {
    showArchived = toggle.checked;
    void load();
  };

  let rolls: Roll[] = [];

  function paint(): void {
    const by = (s: RollStatus) => rolls.filter((r) => r.status === s);
    let html =
      group("Offen", by("offen")) +
      group("Abgeschlossen (nicht entwickelt)", by("abgeschlossen")) +
      group("Entwickelt", by("entwickelt")) +
      group("Gescannt", by("gescannt"));
    const arch = by("archiviert");
    if (showArchived && arch.length) {
      const perYear = new Map<string, Roll[]>();
      for (const r of arch) {
        const y = (r.archived_at || r.completed_at || r.created_at || "").slice(0, 4) || "Unbekannt";
        perYear.set(y, [...(perYear.get(y) ?? []), r]);
      }
      html += `<p class="dashboard-label">${STATUS_LABELS.archiviert} (${arch.length})</p>`;
      for (const y of [...perYear.keys()].sort((a, b) => b.localeCompare(a))) {
        html += `<p class="dashboard-label dashboard-label-jahr">${escapeHtml(y)}</p><div class="download-list">${(perYear.get(y) ?? []).map(rowHtml).join("")}</div>`;
      }
    }
    list.innerHTML = html || `<p class="empty-state">Noch keine Filme vorhanden.</p>`;
  }

  async function load(): Promise<void> {
    if (!list.childElementCount) setLoading(list);
    try {
      const statuses = ["offen", "abgeschlossen", "entwickelt", "gescannt"];
      if (showArchived) statuses.push("archiviert");
      rolls = await api.get<Roll[]>(`/api/v2/rolls?status=${statuses.join(",")}`);
      if (ctx.alive()) paint();
    } catch (e) {
      if (ctx.alive()) setErrorState(list, e);
    }
  }

  list.addEventListener("click", async (ev) => {
    const target = ev.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>("button[data-act]");
    if (btn) {
      ev.stopPropagation();
      const roll = rolls.find((r) => r.number === Number(btn.dataset.roll));
      if (!roll) return;
      const act = btn.dataset.act;
      btn.disabled = true;
      try {
        const step = act === "next" ? NEXT[roll.status] : PREV[roll.status];
        if (!step || !confirm(step.confirm(roll))) return;
        await api.post(`/api/v2/rolls/${roll.number}/status`, { status: step.to });
        await load();
      } catch (e) {
        toast(errMsg(e), "error");
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (target.closest("a")) return;
    const row = target.closest<HTMLElement>(".roll-row");
    if (row) {
      const roll = rolls.find((r) => r.number === Number(row.dataset.roll));
      if (roll) navigate(roll.status === "offen" ? `neue-aufnahme/${roll.number}` : `film/${roll.number}`);
    }
  });

  await load();
}

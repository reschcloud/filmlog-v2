import { api, errMsg } from "../api";
import { formatDate } from "../lib/dates";
import { qs, setErrorState, setLoading, toast } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { navigate } from "../lib/nav";
import { expiryPillHtml, STATUS_LABELS, typeCornerHtml } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { Roll, RollStatus } from "../types";

interface Step {
  to: RollStatus;
  label: string;
  confirm: (r: Roll) => string;
}

const NEXT: Partial<Record<RollStatus, Step>> = {
  offen: {
    to: "abgeschlossen",
    label: "Abschließen",
    confirm: (r) => `Film #${r.number} (${r.camera.name}) wirklich abschließen?`,
  },
  abgeschlossen: { to: "entwickelt", label: "Entwickelt", confirm: (r) => `Film #${r.number} als entwickelt markieren?` },
  entwickelt: { to: "gescannt", label: "Gescannt", confirm: (r) => `Film #${r.number} als gescannt markieren?` },
  gescannt: { to: "archiviert", label: "Archivieren", confirm: (r) => `Film #${r.number} archivieren? Archivierte Filme sind nur noch lesbar.` },
};

const PREV: Partial<Record<RollStatus, Step>> = {
  abgeschlossen: {
    to: "offen",
    label: "Wieder öffnen",
    confirm: (r) => `Film #${r.number} wieder öffnen? Danach können erneut Aufnahmen hinzugefügt werden.`,
  },
  entwickelt: { to: "abgeschlossen", label: "Nicht entwickelt", confirm: (r) => `Film #${r.number} wieder auf „abgeschlossen“ zurücksetzen?` },
  gescannt: { to: "entwickelt", label: "Nicht gescannt", confirm: (r) => `Film #${r.number} wieder auf „entwickelt“ zurücksetzen?` },
  archiviert: { to: "gescannt", label: "Dearchivieren", confirm: (r) => `Film #${r.number} dearchivieren?` },
};

let showArchived = false;

function rowHtml(r: Roll): string {
  const next = NEXT[r.status];
  const prev = PREV[r.status];
  const dates: string[] = [];
  if (r.created_at) dates.push(`Angelegt: ${formatDate(r.created_at)}`);
  if (r.completed_at) dates.push(`Abgeschlossen: ${formatDate(r.completed_at)}`);
  if (r.developed_at) dates.push(`Entwickelt: ${formatDate(r.developed_at)}`);
  if (r.scanned_at) dates.push(`Gescannt: ${formatDate(r.scanned_at)}`);
  if (r.archived_at) dates.push(`Archiviert: ${formatDate(r.archived_at)}`);
  return `
    <div class="download-row roll-row download-row-klickbar" data-roll="${r.number}">
      ${typeCornerHtml(r.film_stock.type)}
      <div class="download-row-info">
        <div class="download-row-title">#${r.number} — ${escapeHtml(r.film_stock.name)}</div>
        <div class="download-row-meta">${escapeHtml(r.camera.name)} · ${r.frame_count}${r.capacity ? `/${r.capacity}` : ""} Aufnahmen ${expiryPillHtml(r.expired_years)}</div>
        ${dates.map((d) => `<div class="download-row-meta">${escapeHtml(d)}</div>`).join("")}
      </div>
      <div class="roll-actions">
        ${prev ? `<button type="button" class="status-btn status-btn-back" data-act="prev" data-roll="${r.number}">↩ ${escapeHtml(prev.label)}</button>` : ""}
        ${next ? `<button type="button" class="status-btn" data-act="next" data-roll="${r.number}">${escapeHtml(next.label)}</button>` : ""}
        <a class="download-btn" href="/api/v2/rolls/${r.number}/export.csv" download title="Als CSV herunterladen" aria-label="CSV herunterladen">📥</a>
        ${r.status !== "offen" ? `<button type="button" class="eintrag-del-btn" data-act="del" data-roll="${r.number}" title="Film löschen" aria-label="Film #${r.number} löschen">🗑️</button>` : ""}
      </div>
    </div>`;
}

function group(title: string, rolls: Roll[]): string {
  return rolls.length ? `<p class="dashboard-label">${escapeHtml(title)} (${rolls.length})</p><div class="download-list">${rolls.map(rowHtml).join("")}</div>` : "";
}

export async function renderRolls(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Filme &amp; Protokolle</h1>
    <label class="archiv-toggle">
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
    setLoading(list);
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
        if (act === "del") {
          if (!confirm(`Film #${roll.number} (${roll.film_stock.name}) mit allen ${roll.frame_count} Aufnahmen endgültig löschen?`)) return;
          await api.del(`/api/v2/rolls/${roll.number}`);
          toast(`Film #${roll.number} gelöscht.`, "ok");
        } else {
          const step = act === "next" ? NEXT[roll.status] : PREV[roll.status];
          if (!step || !confirm(step.confirm(roll))) return;
          await api.post(`/api/v2/rolls/${roll.number}/status`, { status: step.to });
        }
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
    if (row) navigate(`film/${row.dataset.roll}`);
  });

  await load();
}

import { errMsg } from "../api";
import { withBusy, toast } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { discardFailed, flushQueue, listFailed, retryFailed } from "../lib/queue";
import type { ViewContext } from "../lib/view";

export async function renderMore(ctx: ViewContext): Promise<void> {
  const failed = await listFailed();
  if (!ctx.alive()) return;
  const failedCount = failed.reduce((n, i) => n + (i.payload.count ?? 1), 0);

  ctx.el.innerHTML = `
    <h1 class="view-title">Mehr</h1>
    ${
      failed.length
        ? `<p class="dashboard-label">Nicht gesendet (${failedCount})</p>
           <div class="failed-list">
             ${failed
               .map(
                 (i) => `<div class="failed-item">
                   <div class="failed-info">
                     <div class="cat-title">${escapeHtml(i.label)}</div>
                     <div class="failed-meta">Film #${i.roll_number} · ${i.payload.count ?? 1} Aufnahme(n)</div>
                     <div class="failed-error">${escapeHtml(i.message)}</div>
                   </div>
                   <div class="failed-actions">
                     <button type="button" class="status-btn" data-retry="${escapeHtml(i.client_id)}">Erneut senden</button>
                     <button type="button" class="status-btn status-btn-back" data-discard="${escapeHtml(i.client_id)}">Verwerfen</button>
                   </div>
                 </div>`,
               )
               .join("")}
           </div>`
        : ""
    }
    <p class="dashboard-label">Seiten</p>
    <div class="more-list">
      <a class="more-item" href="#neuer-film">Neuer Film</a>
      <a class="more-item" href="#zuletzt">Zuletzt eingetragen</a>
      <a class="more-item" href="#stats">Stats</a>
      <a class="more-item" href="#optionen">Auswahllisten</a>
      <a class="more-item" href="#einstellungen">Einstellungen</a>
    </div>`;

  ctx.el.querySelectorAll<HTMLButtonElement>("button[data-retry]").forEach((btn) => {
    btn.onclick = () =>
      void withBusy(btn, async () => {
        try {
          await retryFailed(btn.dataset.retry ?? "");
          const res = await flushQueue();
          if (res.sent > 0) toast(`${res.sent} Aufnahme(n) gesendet.`, "ok");
          else if (res.remaining > 0) toast("Weiterhin offline – später erneut versuchen.", "error");
          await renderMore(ctx);
        } catch (e) {
          toast(errMsg(e), "error");
        }
      });
  });

  ctx.el.querySelectorAll<HTMLButtonElement>("button[data-discard]").forEach((btn) => {
    btn.onclick = () =>
      void withBusy(btn, async () => {
        if (!confirm("Diese nicht gesendete Aufnahme endgültig verwerfen?")) return;
        try {
          await discardFailed(btn.dataset.discard ?? "");
          toast("Aufnahme verworfen.", "ok");
          await renderMore(ctx);
        } catch (e) {
          toast(errMsg(e), "error");
        }
      });
  });
}
import { api, errMsg } from "../api";
import { logout, session } from "../lib/auth";
import { cacheClear } from "../lib/cache";
import { formatDateTime } from "../lib/dates";
import { qs, qsa, setErrorState, showError, toast, withBusy } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { queueCount } from "../lib/queue";
import type { ViewContext } from "../lib/view";
import type { ImportReport, NewToken, TokenInfo } from "../types";

function reportHtml(r: ImportReport): string {
  const rows: [string, number][] = [
    ["Filme", r.rolls],
    ["Aufnahmen", r.frames],
    ["Kameras", r.cameras],
    ["Objektive", r.lenses],
    ["Filmstocks", r.film_stocks],
    ["Belichtungszeiten", r.shutter_speeds],
    ["Blenden", r.apertures],
    ["Übersprungene Filme", r.skipped_rolls],
  ];
  return `
    <div class="result-card">
      <span class="stamp">${r.dry_run ? "Probelauf" : "Import fertig"}</span>
      <table class="report-table">
        ${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join("")}
      </table>
      ${
        r.warnings.length
          ? `<p class="dashboard-label">Hinweise (${r.warnings.length})</p><ul class="warn-list">${r.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
          : ""
      }
    </div>`;
}

async function copyText(text: string, input?: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!input) return false;
    input.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

export function renderSettings(ctx: ViewContext): void {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Einstellungen</h1>

    <p class="dashboard-label">Passwort ändern</p>
    <form class="card" id="pwForm" autocomplete="off">
      <label>Aktuelles Passwort<input type="password" name="current" autocomplete="current-password" required></label>
      <label>Neues Passwort <span class="field-optional">(mind. 8 Zeichen)</span><input type="password" name="new" autocomplete="new-password" minlength="8" required></label>
      <label>Neues Passwort wiederholen<input type="password" name="repeat" autocomplete="new-password" minlength="8" required></label>
      <button type="submit" class="btn-primary">Passwort ändern</button>
    </form>

    <p class="dashboard-label">API-Tokens (EXIF-Client)</p>
    <div class="card" id="tokenCard">
      <div id="tokenList"><p class="empty-state">Wird geladen …</p></div>
      <form id="tokenForm" class="inline-form">
        <input type="text" name="name" placeholder="Name, z. B. Laptop" required maxlength="80">
        <button type="submit" class="btn-primary">Anlegen</button>
      </form>
      <div id="tokenNew"></div>
      <a class="btn-link" href="/client/download" download>💻 EXIF-Client herunterladen</a>
    </div>

    <p class="dashboard-label">Import aus Filmlog v1</p>
    <form class="card" id="importForm">
      <label>db.yaml <input type="file" name="db" accept=".yaml,.yml,text/yaml,text/plain" required></label>
      <label>optionen.yaml <span class="field-optional">(optional)</span><input type="file" name="optionen" accept=".yaml,.yml,text/yaml,text/plain"></label>
      <p class="field-note">Zuerst Probelauf und Vorschau, danach Import bestätigen.</p>
      <button type="submit" class="btn-primary" id="dryBtn">Probelauf &amp; Vorschau</button>
      <div id="importResult"></div>
    </form>

    <p class="dashboard-label">Export &amp; Backup</p>
    <div class="card">
      <a class="btn-link" href="/api/v2/export.json" download>📄 Export als JSON</a>
      <a class="btn-link" href="/api/v2/backup.sqlite" download>🗄️ Backup (SQLite)</a>
    </div>

    <p class="dashboard-label">Konto</p>
    <div class="card">
      <p class="field-note">Angemeldet als <strong>${escapeHtml(session.username ?? "–")}</strong></p>
      <p class="field-note">Version ${__APP_VERSION__}</p>
      <button type="button" class="status-btn status-btn-back" id="logoutBtn">Abmelden</button>
    </div>`;

  // ---- Abmelden ----
  const logoutBtn = qs<HTMLButtonElement>(el, "#logoutBtn");
  logoutBtn.onclick = async () => {
    const pending = await queueCount();
    const msg = pending
      ? `${pending} offline gespeicherte Aufnahme(n) sind noch nicht gesendet. Sie bleiben auf diesem Gerät und werden nach erneutem Anmelden gesendet. Trotzdem abmelden?`
      : "Wirklich abmelden?";
    if (!confirm(msg)) return;
    await withBusy(logoutBtn, async () => {
      try {
        await logout();
      } catch (e) {
        toast(errMsg(e), "error");
        cacheClear();
      }
      location.hash = "start";
      location.reload();
    });
  };

  // ---- Passwort ----
  const pwForm = qs<HTMLFormElement>(el, "#pwForm");
  pwForm.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(pwForm);
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("new") ?? "");
    if (next.length < 8) return showError(pwForm, "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
    if (next !== String(fd.get("repeat") ?? "")) return showError(pwForm, "Die neuen Passwörter stimmen nicht überein.");
    await withBusy(qs<HTMLButtonElement>(pwForm, "[type=submit]"), async () => {
      try {
        await api.post("/auth/password", { current, new: next });
        pwForm.reset();
        toast("Passwort geändert.", "ok");
      } catch (e) {
        showError(pwForm, errMsg(e));
      }
    });
  };

  // ---- Tokens ----
  const tokenList = qs(el, "#tokenList");
  const tokenForm = qs<HTMLFormElement>(el, "#tokenForm");
  const tokenNew = qs(el, "#tokenNew");

  async function loadTokens(): Promise<void> {
    try {
      const tokens = await api.get<TokenInfo[]>("/api/v2/tokens");
      if (!ctx.alive()) return;
      tokenList.innerHTML = tokens.length
        ? `<ul class="cat-list">${tokens
            .map(
              (t) => `
          <li class="cat-row">
            <div class="cat-info">
              <div class="cat-title">${escapeHtml(t.name)}</div>
              <div class="cat-sub">Erstellt ${escapeHtml(formatDateTime(t.created_at))} · Zuletzt benutzt ${t.last_used_at ? escapeHtml(formatDateTime(t.last_used_at)) : "nie"}</div>
            </div>
            <button type="button" class="status-btn status-btn-back" data-revoke="${t.id}" data-name="${escapeHtml(t.name)}">Widerrufen</button>
          </li>`,
            )
            .join("")}</ul>`
        : `<p class="empty-state">Noch keine Tokens.</p>`;
    } catch (e) {
      if (ctx.alive()) setErrorState(tokenList, e);
    }
  }
  tokenList.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-revoke]");
    if (!btn) return;
    if (!confirm(`Token „${btn.dataset.name ?? ""}“ widerrufen? Der Client kann dann nicht mehr zugreifen.`)) return;
    await withBusy(btn, async () => {
      try {
        await api.del(`/api/v2/tokens/${btn.dataset.revoke}`);
        toast("Token widerrufen.", "ok");
        await loadTokens();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
  });
  tokenForm.onsubmit = async (ev) => {
    ev.preventDefault();
    const name = String(new FormData(tokenForm).get("name") ?? "").trim();
    if (!name) return;
    await withBusy(qs<HTMLButtonElement>(tokenForm, "[type=submit]"), async () => {
      try {
        const t = await api.post<NewToken>("/api/v2/tokens", { name });
        tokenForm.reset();
        tokenNew.innerHTML = `
          <div class="result-card">
            <span class="stamp">Token</span>
            <p class="field-note">Dieser Token wird nur jetzt angezeigt. Bitte kopieren und sicher aufbewahren.</p>
            <div class="inline-form">
              <input type="text" id="tokenValue" readonly value="${escapeHtml(t.token)}">
              <button type="button" class="btn-primary" id="tokenCopy">Kopieren</button>
            </div>
          </div>`;
        const input = qs<HTMLInputElement>(tokenNew, "#tokenValue");
        input.select();
        qs<HTMLButtonElement>(tokenNew, "#tokenCopy").onclick = async () => {
          toast((await copyText(t.token, input)) ? "Kopiert." : "Kopieren nicht möglich – bitte manuell markieren.", "info");
        };
        await loadTokens();
      } catch (e) {
        showError(tokenForm, errMsg(e));
      }
    });
  };
  void loadTokens();

  // ---- Import ----
  const importForm = qs<HTMLFormElement>(el, "#importForm");
  const importResult = qs(el, "#importResult");
  const dryBtn = qs<HTMLButtonElement>(el, "#dryBtn");

  function buildForm(dry: boolean): FormData {
    const src = new FormData(importForm);
    const fd = new FormData();
    const db = src.get("db");
    const opt = src.get("optionen");
    if (db instanceof File) fd.append("db", db);
    if (opt instanceof File && opt.size > 0) fd.append("optionen", opt);
    fd.append("dry_run", dry ? "true" : "false");
    return fd;
  }

  qsa<HTMLInputElement>(importForm, "input[type=file]").forEach((i) =>
    i.addEventListener("change", () => (importResult.innerHTML = "")),
  );

  importForm.onsubmit = async (ev) => {
    ev.preventDefault();
    await withBusy(dryBtn, async () => {
      try {
        const report = await api.postForm<ImportReport>("/api/v2/import/v1", buildForm(true), { timeoutMs: 120000 });
        importResult.innerHTML = `${reportHtml(report)}<button type="button" class="btn-primary btn-danger" id="doImport">Jetzt importieren</button>`;
        const go = qs<HTMLButtonElement>(importResult, "#doImport");
        go.onclick = async () => {
          if (!confirm("Daten jetzt wirklich importieren?")) return;
          await withBusy([go, dryBtn], async () => {
            try {
              const done = await api.postForm<ImportReport>("/api/v2/import/v1", buildForm(false), { timeoutMs: 180000 });
              cacheClear();
              importResult.innerHTML = reportHtml(done);
              toast("Import abgeschlossen.", "ok");
            } catch (e) {
              showError(importForm, errMsg(e));
            }
          });
        };
      } catch (e) {
        importResult.innerHTML = "";
        showError(importForm, errMsg(e));
      }
    });
  };
}

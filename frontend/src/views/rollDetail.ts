import { api, errMsg } from "../api";
import { getCatalog } from "../lib/data";
import { nowTimeStr, todayStr } from "../lib/dates";
import { optionsHtml, qs, qsa, setErrorState, setLoading, toast, withBusy } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { expiryPillHtml, frameMetaHtml, STATUS_LABELS, TYPE_LABELS, typeCornerHtml } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { Catalog, Frame, RollDetail } from "../types";

type Mode = { typ: "edit" | "insert"; position: number } | null;

interface FormValues {
  motif?: string | null;
  lens_id?: number | null;
  lens_name?: string | null;
  flash?: boolean;
  shutter?: string | null;
  aperture?: string | null;
  date?: string;
  time?: string;
  location_text?: string | null;
}

function intOrNull(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export async function renderRollDetail(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  const number = parseInt(ctx.params[0] ?? "", 10);
  if (!number) {
    location.replace("#filme");
    return;
  }
  setLoading(el);

  let roll: RollDetail;
  let catalog: Catalog = { cameras: [], lenses: [], film_stocks: [], shutter_speeds: [], apertures: [] };
  try {
    const [r, c] = await Promise.all([
      api.get<RollDetail>(`/api/v2/rolls/${number}`),
      getCatalog().catch(() => null),
    ]);
    roll = r;
    if (c) catalog = c.data;
  } catch (e) {
    if (ctx.alive()) setErrorState(el, e);
    return;
  }
  if (!ctx.alive()) return;

  let mode: Mode = null;
  let metaOpen = false;
  let scrollTo: { position: number; center: boolean } | null = null;

  const wanted = parseInt(ctx.params[1] ?? "", 10);
  if (wanted >= 1 && roll.frames.some((f) => f.position === wanted)) {
    if (roll.status !== "archiviert") mode = { typ: "edit", position: wanted };
    scrollTo = { position: wanted, center: true };
  }
  if (ctx.params[1] !== undefined) history.replaceState(null, "", `#film/${number}`);

  const readOnly = (): boolean => roll.status === "archiviert";

  async function reload(): Promise<void> {
    roll = await api.get<RollDetail>(`/api/v2/rolls/${number}`);
    if (ctx.alive()) paint();
  }

  function lensOptions(selectedId: number | null | undefined, currentName: string | null | undefined): string {
    const items = catalog.lenses.filter((l) => !l.archived || l.id === selectedId).map((l) => ({ value: l.id, label: l.name }));
    if (selectedId && !items.some((i) => i.value === selectedId)) {
      items.push({ value: selectedId, label: currentName ?? `Objektiv ${selectedId}` });
    }
    return optionsHtml(items, selectedId ?? "", "– kein Objektiv –");
  }

  function labelOptions(labels: string[], selected: string | null | undefined): string {
    const list = selected && !labels.includes(selected) ? [...labels, selected] : labels;
    return optionsHtml(
      list.map((l) => ({ value: l, label: l })),
      selected ?? "",
      "– keine Angabe –",
    );
  }

  function frameRowHtml(f: Frame, pos: number): string {
    const hl = scrollTo && scrollTo.position === f.position && readOnly() ? " eintrag-highlight" : "";
    return `
      <div class="eintrag${hl}" data-pos="${f.position}">
        <div class="eintrag-nr">${pos}</div>
        <div class="eintrag-info">
          <div class="eintrag-motiv">${f.motif ? escapeHtml(f.motif) : "(kein Motiv)"}</div>
          <div class="eintrag-meta">${frameMetaHtml(f)}</div>
        </div>
        ${
          readOnly()
            ? ""
            : `<div class="eintrag-aktionen">
          <button type="button" class="eintrag-edit-btn" data-act="edit" data-pos="${pos}" title="Bearbeiten" aria-label="Aufnahme ${pos} bearbeiten">✏️</button>
          <button type="button" class="eintrag-del-btn" data-act="del" data-pos="${pos}" title="Löschen" aria-label="Aufnahme ${pos} löschen">🗑️</button>
        </div>`
        }
      </div>`;
  }

  function slotHtml(pos: number): string {
    const text = roll.frames.length === 0 ? "+ Aufnahme hinzufügen" : "+";
    return `<button type="button" class="eintrag-plus" data-act="insert" data-pos="${pos}" title="Hier einfügen" aria-label="Hier als Nr. ${pos} einfügen">${text}</button>`;
  }

  function formHtml(typ: "edit" | "insert", pos: number): string {
    const title = typ === "edit" ? `Aufnahme ${pos} bearbeiten` : `Neue Aufnahme als Nr. ${pos}`;
    return `
      <form class="card eintrag-form" data-typ="${typ}" data-pos="${pos}">
        <div class="eintrag-form-titel">${title}</div>
        <label>Motivbeschreibung
          <textarea name="motif" rows="2" placeholder="Was ist auf dem Bild zu sehen?"></textarea>
        </label>
        <div class="field-row">
          <label>Objektiv <select name="lens"></select></label>
          <div class="blitz-feld">
            <label class="blitz-toggle"><input type="checkbox" name="flash"> Blitz</label>
          </div>
        </div>
        <div class="field-row">
          <label>Belichtungszeit <select name="shutter"></select></label>
          <label>Blende <select name="aperture"></select></label>
        </div>
        <div class="field-row">
          <label>Datum <input type="date" name="date" required></label>
          <label>Uhrzeit <input type="time" name="time" required></label>
        </div>
        <label>Ort <input type="text" name="location_text" placeholder="Ort (nur Text)"></label>
        <div class="eintrag-form-aktionen">
          <button type="submit" class="btn-primary">Speichern</button>
          <button type="button" class="eintrag-abbrechen-btn" data-act="cancel">Abbrechen</button>
        </div>
      </form>`;
  }

  function fillForm(form: HTMLFormElement, v: FormValues): void {
    const f = form.elements;
    (f.namedItem("motif") as HTMLTextAreaElement).value = v.motif ?? "";
    (f.namedItem("lens") as HTMLSelectElement).innerHTML = lensOptions(v.lens_id, v.lens_name);
    (f.namedItem("flash") as HTMLInputElement).checked = !!v.flash;
    (f.namedItem("shutter") as HTMLSelectElement).innerHTML = labelOptions(
      catalog.shutter_speeds.map((s) => s.label),
      v.shutter,
    );
    (f.namedItem("aperture") as HTMLSelectElement).innerHTML = labelOptions(
      catalog.apertures.map((a) => a.label),
      v.aperture,
    );
    (f.namedItem("date") as HTMLInputElement).value = v.date ?? "";
    (f.namedItem("time") as HTMLInputElement).value = v.time ?? "";
    (f.namedItem("location_text") as HTMLInputElement).value = v.location_text ?? "";
  }

  function insertTemplate(pos: number): FormValues {
    const neighbor = roll.frames[pos - 2] ?? roll.frames[pos - 1];
    if (!neighbor) return { date: todayStr(), time: nowTimeStr() };
    return {
      lens_id: neighbor.lens_id,
      lens_name: neighbor.lens_name,
      shutter: neighbor.shutter,
      aperture: neighbor.aperture,
      date: neighbor.date,
      time: neighbor.time,
    };
  }

  function metaFormHtml(): string {
    return `
      <form class="card eintrag-form" id="metaForm">
        <div class="eintrag-form-titel">Film bearbeiten</div>
        <div class="field-row">
          <label>Anzahl Aufnahmen <input type="number" name="capacity" min="1" max="999" inputmode="numeric" value="${escapeHtml(roll.capacity)}" required></label>
          <label>Ablaufjahr <input type="number" name="expiry_year" min="1900" max="2900" inputmode="numeric" value="${escapeHtml(roll.expiry_year ?? "")}"></label>
        </div>
        <label>ISO abweichend <span class="field-optional">(Push/Pull)</span>
          <input type="number" name="iso_override" min="1" max="25600" inputmode="numeric" value="${escapeHtml(roll.iso_override ?? "")}">
        </label>
        <label>Notizen <textarea name="notes" rows="2">${escapeHtml(roll.notes ?? "")}</textarea></label>
        <div class="eintrag-form-aktionen">
          <button type="submit" class="btn-primary">Speichern</button>
          <button type="button" class="eintrag-abbrechen-btn" data-act="meta-cancel">Abbrechen</button>
        </div>
      </form>`;
  }

  function paint(): void {
    const total = roll.frames.length;
    const iso = roll.iso_override ?? roll.iso;
    const info = [
      roll.camera.name,
      `${total}${roll.capacity ? `/${roll.capacity}` : ""} Aufnahmen`,
      STATUS_LABELS[roll.status],
      TYPE_LABELS[roll.film_stock.type] ?? roll.film_stock.type,
      iso ? `ISO ${iso}${roll.iso_override ? " (abweichend)" : ""}` : "",
    ]
      .filter(Boolean)
      .map(escapeHtml)
      .join(" · ");

    let html = `
      <a class="detail-zurueck" href="#filme">‹ Filme</a>
      <h1 class="view-title detail-title">${typeCornerHtml(roll.film_stock.type)}#${roll.number} — ${escapeHtml(roll.film_stock.name)}</h1>
      <p class="view-hint">${info} ${expiryPillHtml(roll.expired_years)}</p>
      ${roll.notes ? `<p class="view-hint">${escapeHtml(roll.notes)}</p>` : ""}
      <div class="detail-actions">
        ${roll.status === "offen" ? `<a class="status-btn" href="#neue-aufnahme/${roll.number}">+ Aufnahme</a>` : ""}
        ${readOnly() ? "" : `<button type="button" class="status-btn status-btn-back" data-act="meta">✏️ Film bearbeiten</button>`}
        <a class="status-btn status-btn-back" href="/api/v2/rolls/${roll.number}/export.csv" download>📥 CSV</a>
      </div>
      ${readOnly() ? `<p class="offline-note">Archivierte Filme sind nur lesbar.</p>` : ""}
      ${metaOpen && !readOnly() ? metaFormHtml() : ""}
      <div class="eintraege-liste detail-liste">`;

    if (readOnly()) {
      html += roll.frames.map((f) => frameRowHtml(f, f.position)).join("");
      if (!roll.frames.length) html += `<p class="empty-state">Keine Aufnahmen.</p>`;
    } else {
      for (let pos = 1; pos <= total + 1; pos++) {
        html += mode && mode.typ === "insert" && mode.position === pos ? formHtml("insert", pos) : slotHtml(pos);
        const f = roll.frames[pos - 1];
        if (f) {
          html += mode && mode.typ === "edit" && mode.position === pos ? formHtml("edit", pos) : frameRowHtml(f, pos);
        }
      }
    }
    html += `</div>`;
    el.innerHTML = html;
    bind();
  }

  function bind(): void {
    const metaBtn = el.querySelector<HTMLButtonElement>("[data-act=meta]");
    if (metaBtn) {
      metaBtn.onclick = () => {
        metaOpen = !metaOpen;
        paint();
      };
    }
    const metaForm = el.querySelector<HTMLFormElement>("#metaForm");
    if (metaForm) {
      qs(metaForm, "[data-act=meta-cancel]").onclick = () => {
        metaOpen = false;
        paint();
      };
      metaForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(metaForm);
        const body = {
          capacity: intOrNull(String(fd.get("capacity") ?? "")),
          expiry_year: intOrNull(String(fd.get("expiry_year") ?? "")),
          iso_override: intOrNull(String(fd.get("iso_override") ?? "")),
          notes: String(fd.get("notes") ?? "").trim() || null,
        };
        await withBusy(qs<HTMLButtonElement>(metaForm, "[type=submit]"), async () => {
          try {
            await api.patch(`/api/v2/rolls/${number}`, body);
            metaOpen = false;
            toast("Film gespeichert.", "ok");
            await reload();
          } catch (e) {
            toast(errMsg(e), "error");
          }
        });
      };
      metaForm.scrollIntoView({ block: "nearest" });
    }

    qsa<HTMLButtonElement>(el, "button[data-act=insert]").forEach((b) => {
      b.onclick = () => {
        mode = { typ: "insert", position: Number(b.dataset.pos) };
        paint();
      };
    });
    qsa<HTMLButtonElement>(el, "button[data-act=edit]").forEach((b) => {
      b.onclick = () => {
        mode = { typ: "edit", position: Number(b.dataset.pos) };
        paint();
      };
    });
    qsa<HTMLButtonElement>(el, "button[data-act=del]").forEach((b) => {
      b.onclick = async () => {
        const pos = Number(b.dataset.pos);
        const f = roll.frames[pos - 1];
        if (!f) return;
        const name = f.motif || `Aufnahme ${pos}`;
        if (!confirm(`„${name}“ (Nr. ${pos}) wirklich löschen? Die folgenden Aufnahmen rücken nach.`)) return;
        await withBusy(b, async () => {
          try {
            await api.del(`/api/v2/frames/${f.id}`);
            mode = null;
            await reload();
          } catch (e) {
            toast(errMsg(e), "error");
          }
        });
      };
    });

    const form = el.querySelector<HTMLFormElement>("form.eintrag-form[data-typ]");
    if (form) bindFrameForm(form);

    if (scrollTo) {
      const target = form ?? el.querySelector<HTMLElement>(`.eintrag[data-pos="${scrollTo.position}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: scrollTo.center ? "center" : "nearest" });
      scrollTo = null;
    }
  }

  function bindFrameForm(form: HTMLFormElement): void {
    const pos = Number(form.dataset.pos);
    const typ = form.dataset.typ as "edit" | "insert";
    fillForm(form, typ === "edit" ? (roll.frames[pos - 1] ?? {}) : insertTemplate(pos));
    if (!scrollTo) form.scrollIntoView({ behavior: "smooth", block: "nearest" });

    qs(form, "[data-act=cancel]").onclick = () => {
      mode = null;
      paint();
    };
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const f = form.elements;
      const val = (n: string) => (f.namedItem(n) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
      const base = {
        motif: val("motif").trim(),
        flash: (f.namedItem("flash") as HTMLInputElement).checked,
        date: val("date"),
        time: val("time"),
        location_text: val("location_text").trim(),
      };
      const lensId = intOrNull(val("lens"));
      const shutter = val("shutter") || null;
      const aperture = val("aperture") || null;
      await withBusy(qs<HTMLButtonElement>(form, "[type=submit]"), async () => {
        try {
          if (typ === "edit") {
            const frame = roll.frames[pos - 1];
            if (!frame) return;
            await api.patch(`/api/v2/frames/${frame.id}`, { ...base, lens_id: lensId, shutter, aperture });
          } else {
            const body: Record<string, unknown> = { ...base, position: pos };
            if (!base.motif) delete body.motif;
            if (!base.location_text) delete body.location_text;
            if (lensId !== null) body.lens_id = lensId;
            if (shutter) body.shutter = shutter;
            if (aperture) body.aperture = aperture;
            await api.post(`/api/v2/rolls/${number}/frames`, body);
          }
          mode = null;
          await reload();
        } catch (e) {
          toast(errMsg(e), "error");
        }
      });
    };
  }

  paint();
}

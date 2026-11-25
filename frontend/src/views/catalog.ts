import { api, errMsg } from "../api";
import { reloadCatalog } from "../lib/data";
import { optionsHtml, qs, qsa, setErrorState, setLoading, showError, toast, withBusy } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { CAMERA_FORMATS, FILM_FORMATS, FILM_TYPES, TYPE_LABELS } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { Catalog, DeleteResult } from "../types";

type Item = { id: number; archived?: boolean } & Record<string, unknown>;

interface Field {
  name: string;
  label: string;
  kind: "text" | "number" | "select";
  required?: boolean;
  int?: boolean;
  step?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

interface Section {
  key: keyof Catalog;
  path: string;
  title: string;
  fields: Field[];
  archivable: boolean;
  lensPicker?: boolean;
  presets?: boolean;
  items: (c: Catalog) => Item[];
  title1: (i: Item) => string;
  sub: (i: Item) => string;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const label = (opts: { value: string; label: string }[], v: unknown): string =>
  opts.find((o) => o.value === v)?.label ?? str(v);

const SECTIONS: Section[] = [
  {
    key: "cameras",
    path: "cameras",
    title: "Kameras",
    archivable: true,
    lensPicker: true,
    fields: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "format", label: "Format", kind: "select", options: CAMERA_FORMATS, required: true },
      { name: "default_capacity", label: "Standard-Aufnahmen", kind: "number", int: true },
      { name: "notes", label: "Notizen", kind: "text" },
    ],
    items: (c) => c.cameras as unknown as Item[],
    title1: (i) => str(i.name),
    sub: (i) =>
      [
        label(CAMERA_FORMATS, i.format),
        i.default_capacity ? `${i.default_capacity} Aufn.` : "",
        Array.isArray(i.lens_ids) ? `${i.lens_ids.length} Objektiv${i.lens_ids.length === 1 ? "" : "e"}` : "",
        `${str(i.usage_count)}× genutzt`,
      ]
        .filter(Boolean)
        .join(" · "),
  },
  {
    key: "lenses",
    path: "lenses",
    title: "Objektive",
    archivable: true,
    fields: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "focal_length_mm", label: "Brennweite (mm)", kind: "number", int: true },
      { name: "max_aperture", label: "Max. Blende (f/…)", kind: "number", step: "0.1" },
    ],
    items: (c) => c.lenses as unknown as Item[],
    title1: (i) => str(i.name),
    sub: (i) =>
      [i.focal_length_mm ? `${i.focal_length_mm} mm` : "", i.max_aperture ? `f/${i.max_aperture}` : "", `${str(i.usage_count)}× genutzt`]
        .filter(Boolean)
        .join(" · "),
  },
  {
    key: "film_stocks",
    path: "film-stocks",
    title: "Filmstocks",
    archivable: true,
    fields: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "manufacturer", label: "Hersteller", kind: "text" },
      { name: "iso", label: "ISO", kind: "number", int: true },
      { name: "type", label: "Typ", kind: "select", options: FILM_TYPES, required: true },
      { name: "format", label: "Format", kind: "select", options: FILM_FORMATS, required: true },
      { name: "default_capacity", label: "Standard-Aufnahmen", kind: "number", int: true },
    ],
    items: (c) => c.film_stocks as unknown as Item[],
    title1: (i) => str(i.name),
    sub: (i) =>
      [
        str(i.manufacturer),
        i.iso ? `ISO ${i.iso}` : "",
        TYPE_LABELS[i.type as keyof typeof TYPE_LABELS] ?? str(i.type),
        label(FILM_FORMATS, i.format),
        i.default_capacity ? `${i.default_capacity} Aufn.` : "",
        `${str(i.usage_count)}× genutzt`,
      ]
        .filter(Boolean)
        .join(" · "),
  },
  {
    key: "shutter_speeds",
    path: "shutter-speeds",
    title: "Belichtungszeiten",
    archivable: false,
    presets: true,
    fields: [{ name: "label", label: "Belichtungszeit", kind: "text", required: true, placeholder: "z. B. 1/125 oder 2s" }],
    items: (c) => c.shutter_speeds as unknown as Item[],
    title1: (i) => str(i.label),
    sub: () => "",
  },
  {
    key: "apertures",
    path: "apertures",
    title: "Blenden",
    archivable: false,
    presets: true,
    fields: [{ name: "label", label: "Blende", kind: "text", required: true, placeholder: "z. B. 5.6 oder f/5.6" }],
    items: (c) => c.apertures as unknown as Item[],
    title1: (i) => str(i.label),
    sub: () => "",
  },
];

const PRESETS = [
  { value: "voll", label: "Voll" },
  { value: "halb", label: "Halb" },
  { value: "drittel", label: "Drittel" },
];

const openSections = new Set<string>();

export async function renderCatalog(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Optionen</h1>
    <p class="view-hint">Kameras, Objektive, Filmstocks, Belichtungszeiten und Blenden. Nicht mehr benötigte Einträge lassen sich archivieren.</p>
    <div id="catalogBody"></div>`;
  const body = qs(el, "#catalogBody");
  setLoading(body);

  let catalog: Catalog;
  try {
    catalog = await reloadCatalog();
  } catch (e) {
    if (ctx.alive()) setErrorState(body, e);
    return;
  }
  if (!ctx.alive()) return;

  let editing: { key: string; id: number | null } | null = null;

  function formHtml(sec: Section, item: Item | null): string {
    const fields = sec.fields
      .map((f) => {
        const v = item ? item[f.name] : f.kind === "select" ? f.options?.[0]?.value : "";
        if (f.kind === "select") {
          return `<label>${escapeHtml(f.label)}<select name="${f.name}">${optionsHtml(f.options ?? [], str(v))}</select></label>`;
        }
        if (f.kind === "number") {
          return `<label>${escapeHtml(f.label)}<input type="number" name="${f.name}" step="${f.step ?? "1"}" inputmode="decimal" min="0" value="${escapeHtml(str(v))}"></label>`;
        }
        return `<label>${escapeHtml(f.label)}<input type="text" name="${f.name}" value="${escapeHtml(str(v))}"${f.required ? " required" : ""}${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ""}></label>`;
      })
      .join("");
    let lenses = "";
    if (sec.lensPicker) {
      const assigned = new Set<number>(Array.isArray(item?.lens_ids) ? (item?.lens_ids as number[]) : []);
      const list = catalog.lenses.filter((l) => !l.archived || assigned.has(l.id));
      lenses = `
        <fieldset class="lens-picker">
          <legend>Passende Objektive</legend>
          ${
            list.length
              ? list
                  .map(
                    (l) =>
                      `<label class="check-label"><input type="checkbox" name="lens_ids" value="${l.id}"${assigned.has(l.id) ? " checked" : ""}> ${escapeHtml(l.name)}</label>`,
                  )
                  .join("")
              : `<p class="field-note">Noch keine Objektive angelegt.</p>`
          }
        </fieldset>`;
    }
    return `
      <form class="card eintrag-form cat-form" data-key="${sec.key}" data-id="${item ? item.id : ""}">
        <div class="eintrag-form-titel">${item ? "Bearbeiten" : "Neu anlegen"}</div>
        ${fields}${lenses}
        <div class="eintrag-form-aktionen">
          <button type="submit" class="btn-primary">Speichern</button>
          <button type="button" class="eintrag-abbrechen-btn" data-act="cancel">Abbrechen</button>
        </div>
      </form>`;
  }

  function rowHtml(sec: Section, item: Item): string {
    if (editing && editing.key === sec.key && editing.id === item.id) return `<li class="cat-edit">${formHtml(sec, item)}</li>`;
    const sub = sec.sub(item);
    return `
      <li class="cat-row${item.archived ? " cat-archived" : ""}">
        <div class="cat-info">
          <div class="cat-title">${escapeHtml(sec.title1(item))}${item.archived ? ` <span class="badge">archiviert</span>` : ""}</div>
          ${sub ? `<div class="cat-sub">${escapeHtml(sub)}</div>` : ""}
        </div>
        <div class="eintrag-aktionen">
          <button type="button" class="eintrag-edit-btn" data-act="edit" data-key="${sec.key}" data-id="${item.id}" title="Bearbeiten" aria-label="Bearbeiten">✏️</button>
          ${
            sec.archivable
              ? `<button type="button" class="eintrag-edit-btn" data-act="archive" data-key="${sec.key}" data-id="${item.id}" title="${item.archived ? "Reaktivieren" : "Archivieren"}" aria-label="${item.archived ? "Reaktivieren" : "Archivieren"}">${item.archived ? "♻️" : "📦"}</button>`
              : ""
          }
          <button type="button" class="eintrag-del-btn" data-act="delete" data-key="${sec.key}" data-id="${item.id}" title="Löschen" aria-label="Löschen">🗑️</button>
        </div>
      </li>`;
  }

  function sectionHtml(sec: Section): string {
    const items = sec.items(catalog);
    const adding = editing && editing.key === sec.key && editing.id === null;
    return `
      <details class="cat-section" data-key="${sec.key}"${openSections.has(sec.key) ? " open" : ""}>
        <summary>${escapeHtml(sec.title)} <span class="cat-count">${items.length}</span></summary>
        <div class="cat-body">
          <ul class="cat-list">${items.map((i) => rowHtml(sec, i)).join("") || `<li class="empty-state">Noch keine Einträge.</li>`}</ul>
          ${adding ? formHtml(sec, null) : `<button type="button" class="status-btn" data-act="new" data-key="${sec.key}">+ Neu</button>`}
          ${
            sec.presets
              ? `<div class="preset-row"><span class="field-note">Preset anwenden:</span>${PRESETS.map((p) => `<button type="button" class="status-btn status-btn-back" data-act="preset" data-key="${sec.key}" data-preset="${p.value}">${p.label}</button>`).join("")}</div>`
              : ""
          }
        </div>
      </details>`;
  }

  function paint(): void {
    body.innerHTML = SECTIONS.map(sectionHtml).join("");
    qsa<HTMLDetailsElement>(body, "details.cat-section").forEach((d) => {
      d.addEventListener("toggle", () => {
        const k = d.dataset.key ?? "";
        if (d.open) openSections.add(k);
        else openSections.delete(k);
      });
    });
    qsa<HTMLFormElement>(body, "form.cat-form").forEach(bindForm);
  }

  async function refresh(): Promise<void> {
    catalog = await reloadCatalog();
    if (ctx.alive()) paint();
  }

  const secOf = (key: string | undefined): Section | undefined => SECTIONS.find((s) => s.key === key);

  function bindForm(form: HTMLFormElement): void {
    const sec = secOf(form.dataset.key);
    if (!sec) return;
    const id = form.dataset.id ? Number(form.dataset.id) : null;
    qs(form, "[data-act=cancel]").onclick = () => {
      editing = null;
      paint();
    };
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const payload: Record<string, unknown> = {};
      for (const f of sec.fields) {
        const input = form.elements.namedItem(f.name) as HTMLInputElement | HTMLSelectElement;
        const raw = input.value.trim();
        if (f.kind === "number") {
          const n = f.int ? parseInt(raw, 10) : parseFloat(raw);
          if (Number.isFinite(n)) payload[f.name] = n;
          else if (id !== null) payload[f.name] = null;
        } else if (raw || id !== null || f.required) {
          payload[f.name] = raw;
        }
      }
      if (sec.lensPicker) {
        payload.lens_ids = qsa<HTMLInputElement>(form, "input[name=lens_ids]:checked").map((c) => Number(c.value));
      }
      await withBusy(qs<HTMLButtonElement>(form, "[type=submit]"), async () => {
        try {
          if (id === null) await api.post(`/api/v2/${sec.path}`, payload);
          else await api.patch(`/api/v2/${sec.path}/${id}`, payload);
          editing = null;
          toast("Gespeichert.", "ok");
          await refresh();
        } catch (e) {
          showError(form, errMsg(e));
        }
      });
    };
    const first = form.querySelector<HTMLInputElement>("input[type=text]");
    first?.focus({ preventScroll: true });
  }

  body.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn || btn.dataset.act === "cancel") return;
    const sec = secOf(btn.dataset.key);
    if (!sec) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id ? Number(btn.dataset.id) : null;
    const item = id !== null ? sec.items(catalog).find((i) => i.id === id) : undefined;

    if (act === "new") {
      editing = { key: sec.key, id: null };
      paint();
      return;
    }
    if (act === "edit" && item) {
      editing = { key: sec.key, id: item.id };
      paint();
      return;
    }
    await withBusy(btn, async () => {
      try {
        if (act === "archive" && item) {
          await api.patch(`/api/v2/${sec.path}/${item.id}`, { archived: !item.archived });
          await refresh();
        } else if (act === "delete" && item) {
          if (!confirm(`„${sec.title1(item)}“ wirklich löschen?`)) return;
          const res = await api.del<DeleteResult>(`/api/v2/${sec.path}/${item.id}`);
          if (res.deleted === false && res.archived) {
            toast(`„${sec.title1(item)}“ wird noch verwendet und wurde archiviert.`, "info", 6000);
          } else {
            toast("Gelöscht.", "ok");
          }
          await refresh();
        } else if (act === "preset") {
          const preset = btn.dataset.preset ?? "";
          if (!confirm(`Preset „${preset}“ für ${sec.title} anwenden?`)) return;
          await api.post(`/api/v2/${sec.path}/presets`, { preset });
          toast("Preset angewendet.", "ok");
          await refresh();
        }
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
  });

  paint();
}

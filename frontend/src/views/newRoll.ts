import { api, errMsg } from "../api";
import { getCatalog, reloadCatalog } from "../lib/data";
import { optionsHtml, qs, showError, toast, withBusy } from "../lib/dom";
import { navigate } from "../lib/nav";
import { CAMERA_FORMATS, FILM_FORMATS, FILM_TYPES, TYPE_LABELS } from "../lib/ui";
import type { ViewContext } from "../lib/view";
import type { Camera, Catalog, FilmStock, Roll, RollSuggestion } from "../types";

function intOrNull(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export async function renderNewRoll(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `
    <h1 class="view-title">Neuer Film</h1>
    <p class="view-hint">Jeder Film bekommt eine eindeutige Filmnummer (z. B. #42).</p>
    <form id="rollForm" class="card">
      <label>Filmstock
        <span class="select-with-add">
          <select name="film_stock_id" id="stockSel" required></select>
          <button type="button" class="add-btn" id="addStockBtn" title="Neuen Filmstock anlegen" aria-label="Neuen Filmstock anlegen">+</button>
        </span>
      </label>
      <div class="quick-form" id="quickStock" hidden>
        <div class="eintrag-form-titel">Neuer Filmstock</div>
        <label>Name<input type="text" id="qsName" placeholder="z. B. Kodak Tri-X 400"></label>
        <div class="field-row">
          <label>ISO<input type="number" id="qsIso" min="1" max="25600" inputmode="numeric"></label>
          <label>Typ<select id="qsType">${optionsHtml(FILM_TYPES, "sw")}</select></label>
        </div>
        <label>Format<select id="qsFormat">${optionsHtml(FILM_FORMATS, "35mm")}</select></label>
        <div class="eintrag-form-aktionen">
          <button type="button" class="btn-primary" id="qsSave">Anlegen</button>
          <button type="button" class="eintrag-abbrechen-btn" id="qsCancel">Abbrechen</button>
        </div>
      </div>

      <label>Kamera
        <span class="select-with-add">
          <select name="camera_id" id="camSel" required></select>
          <button type="button" class="add-btn" id="addCamBtn" title="Neue Kamera anlegen" aria-label="Neue Kamera anlegen">+</button>
        </span>
      </label>
      <div class="quick-form" id="quickCam" hidden>
        <div class="eintrag-form-titel">Neue Kamera</div>
        <label>Name<input type="text" id="qcName" placeholder="z. B. Zenit TTL"></label>
        <label>Format<select id="qcFormat">${optionsHtml(CAMERA_FORMATS, "35mm")}</select></label>
        <div class="eintrag-form-aktionen">
          <button type="button" class="btn-primary" id="qcSave">Anlegen</button>
          <button type="button" class="eintrag-abbrechen-btn" id="qcCancel">Abbrechen</button>
        </div>
      </div>

      <p class="field-note" id="stockInfo"></p>

      <div class="field-row">
        <label>Anzahl Aufnahmen
          <input type="number" name="capacity" id="capInput" min="1" max="999" step="1" inputmode="numeric" placeholder="z. B. 36" required>
        </label>
        <label>Ablaufjahr <span class="field-optional">(optional)</span>
          <input type="number" name="expiry_year" id="expInput" min="1900" max="2900" step="1" inputmode="numeric" placeholder="z. B. 2027">
        </label>
      </div>
      <label>ISO abweichend <span class="field-optional">(Push/Pull, optional)</span>
        <input type="number" name="iso_override" min="1" max="25600" step="1" inputmode="numeric" placeholder="z. B. 800">
      </label>
      <label>Notizen <span class="field-optional">(optional)</span>
        <textarea name="notes" rows="2"></textarea>
      </label>
      <button type="submit" class="btn-primary" id="rollSubmit">Film anlegen</button>
    </form>`;

  const form = qs<HTMLFormElement>(el, "#rollForm");
  const stockSel = qs<HTMLSelectElement>(el, "#stockSel");
  const camSel = qs<HTMLSelectElement>(el, "#camSel");
  const capInput = qs<HTMLInputElement>(el, "#capInput");
  const expInput = qs<HTMLInputElement>(el, "#expInput");
  const info = qs(el, "#stockInfo");
  const submit = qs<HTMLButtonElement>(el, "#rollSubmit");

  let catalog: Catalog;
  try {
    catalog = (await getCatalog()).data;
  } catch (e) {
    showError(form, `Auswahllisten konnten nicht geladen werden: ${errMsg(e)}`);
    return;
  }
  if (!ctx.alive()) return;

  const stocks = (): FilmStock[] => catalog.film_stocks.filter((s) => !s.archived);
  const cams = (): Camera[] => catalog.cameras.filter((c) => !c.archived);

  function fillStocks(selectId?: number): void {
    const list = stocks();
    stockSel.innerHTML = list.length
      ? optionsHtml(
          list.map((s) => ({ value: s.id, label: s.name })),
          selectId,
        )
      : `<option value="">– noch keine Filmstocks, bitte über + anlegen –</option>`;
  }
  function fillCams(selectId?: number): void {
    const list = cams();
    camSel.innerHTML = list.length
      ? optionsHtml(
          list.map((c) => ({ value: c.id, label: c.name })),
          selectId,
        )
      : `<option value="">– noch keine Kameras, bitte über + anlegen –</option>`;
  }

  let seq = 0;
  async function suggest(): Promise<void> {
    const stockId = intOrNull(stockSel.value);
    const camId = intOrNull(camSel.value);
    const stock = catalog.film_stocks.find((s) => s.id === stockId);
    info.textContent = stock
      ? `Typ: ${TYPE_LABELS[stock.type] ?? stock.type}${stock.iso ? ` · ISO ${stock.iso}` : ""}`
      : "";
    if (stockId === null || camId === null) return;
    const my = ++seq;
    try {
      const s = await api.get<RollSuggestion>(
        `/api/v2/suggestions/roll?camera_id=${camId}&film_stock_id=${stockId}`,
        { timeoutMs: 8000 },
      );
      if (my !== seq || !ctx.alive()) return;
      if (s.capacity) capInput.value = String(s.capacity);
      expInput.value = s.expiry_year ? String(s.expiry_year) : "";
      const type = s.type ?? stock?.type;
      const iso = s.iso ?? stock?.iso;
      info.textContent = `Typ: ${type ? (TYPE_LABELS[type] ?? type) : "–"}${iso ? ` · ISO ${iso}` : ""}`;
    } catch {
      /* Vorbelegung ist optional */
    }
  }

  fillStocks();
  fillCams();
  stockSel.onchange = () => void suggest();
  camSel.onchange = () => void suggest();
  void suggest();

  const quickStock = qs(el, "#quickStock");
  const quickCam = qs(el, "#quickCam");
  const bindEnter = (box: HTMLElement, saveId: string) => {
    box.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target instanceof HTMLInputElement) {
        ev.preventDefault();
        qs<HTMLButtonElement>(box, saveId).click();
      }
    });
  };
  bindEnter(quickStock, "#qsSave");
  bindEnter(quickCam, "#qcSave");

  qs(el, "#addStockBtn").onclick = () => {
    quickStock.hidden = !quickStock.hidden;
    if (!quickStock.hidden) qs<HTMLInputElement>(el, "#qsName").focus();
  };
  qs(el, "#addCamBtn").onclick = () => {
    quickCam.hidden = !quickCam.hidden;
    if (!quickCam.hidden) qs<HTMLInputElement>(el, "#qcName").focus();
  };
  qs(el, "#qsCancel").onclick = () => (quickStock.hidden = true);
  qs(el, "#qcCancel").onclick = () => (quickCam.hidden = true);

  const qsSave = qs<HTMLButtonElement>(el, "#qsSave");
  qsSave.onclick = async () => {
    const name = qs<HTMLInputElement>(el, "#qsName").value.trim();
    if (!name) return showError(form, "Bitte einen Namen eingeben.");
    const body: Record<string, unknown> = {
      name,
      type: qs<HTMLSelectElement>(el, "#qsType").value,
      format: qs<HTMLSelectElement>(el, "#qsFormat").value,
    };
    const iso = intOrNull(qs<HTMLInputElement>(el, "#qsIso").value);
    if (iso !== null) body.iso = iso;
    await withBusy(qsSave, async () => {
      try {
        const created = await api.post<FilmStock>("/api/v2/film-stocks", body);
        catalog = await reloadCatalog();
        fillStocks(created.id);
        quickStock.hidden = true;
        qs<HTMLInputElement>(el, "#qsName").value = "";
        void suggest();
      } catch (e) {
        showError(form, errMsg(e));
      }
    });
  };

  const qcSave = qs<HTMLButtonElement>(el, "#qcSave");
  qcSave.onclick = async () => {
    const name = qs<HTMLInputElement>(el, "#qcName").value.trim();
    if (!name) return showError(form, "Bitte einen Namen eingeben.");
    const body = { name, format: qs<HTMLSelectElement>(el, "#qcFormat").value };
    await withBusy(qcSave, async () => {
      try {
        const created = await api.post<Camera>("/api/v2/cameras", body);
        catalog = await reloadCatalog();
        fillCams(created.id);
        quickCam.hidden = true;
        qs<HTMLInputElement>(el, "#qcName").value = "";
        void suggest();
      } catch (e) {
        showError(form, errMsg(e));
      }
    });
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const stockId = intOrNull(stockSel.value);
    const camId = intOrNull(camSel.value);
    const capacity = intOrNull(capInput.value);
    if (stockId === null || camId === null) return showError(form, "Bitte Filmstock und Kamera auswählen.");
    if (capacity === null || capacity <= 0) return showError(form, "Bitte Anzahl Aufnahmen angeben.");
    const fd = new FormData(form);
    const body: Record<string, unknown> = { film_stock_id: stockId, camera_id: camId, capacity };
    const exp = intOrNull(String(fd.get("expiry_year") ?? ""));
    if (exp !== null) body.expiry_year = exp;
    const isoOv = intOrNull(String(fd.get("iso_override") ?? ""));
    if (isoOv !== null) body.iso_override = isoOv;
    const notes = String(fd.get("notes") ?? "").trim();
    if (notes) body.notes = notes;
    await withBusy(submit, async () => {
      try {
        const roll = await api.post<Roll>("/api/v2/rolls", body);
        toast(`Film #${roll.number} angelegt.`, "ok");
        navigate("start");
      } catch (e) {
        showError(form, errMsg(e));
      }
    });
  };
}

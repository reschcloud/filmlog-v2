import { api, errMsg, isOfflineError } from "../api";
import { getCatalog, getDashboard, getFrameSuggestion } from "../lib/data";
import { formatDate, nowIsoLocal, nowTimeStr, todayStr } from "../lib/dates";
import { clearDraft, loadDraft, saveDraft } from "../lib/draft";
import { debounce, optionsHtml, qs, qsa, showError, toast, withBusy, type ToastAction } from "../lib/dom";
import { escapeHtml } from "../lib/escape";
import { uuid } from "../lib/ids";
import { navigate } from "../lib/nav";
import { enqueue, flushQueue, queueCount, queuedFramesByRoll, removeQueued } from "../lib/queue";
import type { ViewContext } from "../lib/view";
import type { Catalog, CreateFramePayload, Dashboard, Frame, FrameSuggestion, PlaceSuggestion } from "../types";

const ALL_LENSES = "__all__";
const DRAFT_KEY = "filmlog:draft:newFrame";

interface FrameDraft {
  roll: string;
  motif: string;
  lens: string;
  flash: boolean;
  shutter: string;
  aperture: string;
  place: string;
  date: string;
  time: string;
  count: string;
}

export async function renderNewFrame(ctx: ViewContext): Promise<void> {
  const { el } = ctx;
  el.innerHTML = `<p class="empty-state">Wird geladen …</p>`;

  let dash: Dashboard;
  let catalog: Catalog;
  let stale = false;
  try {
    const [d, c] = await Promise.all([getDashboard(), getCatalog()]);
    dash = d.data;
    catalog = c.data;
    stale = d.stale || c.stale;
  } catch (e) {
    if (ctx.alive()) el.innerHTML = `<p class="error-msg">${escapeHtml(errMsg(e))}</p>`;
    return;
  }
  if (!ctx.alive()) return;

  if (!dash.open_rolls.length) {
    el.innerHTML = `
      <h1 class="view-title">Neue Aufnahme</h1>
      <p class="empty-state">Kein offener Film – bitte zuerst einen <a class="text-link" href="#neuer-film">neuen Film anlegen</a>.</p>`;
    return;
  }

  const queued = await queuedFramesByRoll();
  if (!ctx.alive()) return;

  el.innerHTML = `
    ${stale ? `<p class="offline-note">Offline – gespeicherte Auswahllisten. Aufnahmen werden lokal gespeichert und später gesendet.</p>` : ""}
    <form id="frameForm" class="card frame-form" autocomplete="off">
      <label>Kamera / Film
        <select name="roll" id="rollSel" required>
          ${dash.open_rolls
            .map((r) => {
              const n = r.frame_count + (queued.get(r.number) ?? 0);
              return `<option value="${r.number}">#${r.number} · ${escapeHtml(r.film_stock.name)} · ${n}/${r.capacity}</option>`;
            })
            .join("")}
        </select>
      </label>

      <label>Motivbeschreibung
        <div class="motiv-row">
          <textarea name="motif" id="motifInput" rows="1" placeholder="z. B. Teich"></textarea>
          <button type="button" class="now-btn" id="motifClear" title="Motivbeschreibung leeren" aria-label="Motivbeschreibung leeren">✕</button>
        </div>
      </label>
      <!-- Außerhalb des <label>: Klicks auf die Vorschläge dürfen das Textfeld nicht fokussieren. -->
      <div class="suggest-list" id="motifSuggest" hidden></div>
      <div class="chip-row motif-recent" id="motifRecent" hidden></div>

      <p class="capture-when">
        <span id="whenText"></span>
        <button type="button" class="when-edit" id="whenEdit">ändern</button>
      </p>

      <details class="frame-details" id="frameDetails">
        <summary id="detailsSummary">Details</summary>
        <div class="frame-details-body">
          <div class="field-row field-row-objektiv">
            <label>Objektiv
              <select name="lens" id="lensSel"></select>
            </label>
            <div class="blitz-feld">
              <label class="blitz-toggle">
                <input type="checkbox" name="flash" id="flashChk">
                Blitz
              </label>
            </div>
          </div>

          <div class="field-row field-row-pair">
            <label>Belichtungszeit
              <select name="shutter" id="shutterSel"></select>
            </label>
            <label>Blende
              <select name="aperture" id="apertureSel"></select>
            </label>
          </div>

          <label>Ort
            <input type="text" name="place" id="placeInput" placeholder="wird per GPS ermittelt, bei Bedarf anpassen">
            <span class="field-note" id="gpsStatus">GPS wird ermittelt …</span>
            <span class="chip-row" id="placeChips"></span>
          </label>

          <div class="field-row">
            <label>Datum
              <input type="date" name="date" id="dateInput">
            </label>
            <label>Uhrzeit
              <div class="uhrzeit-row">
                <input type="time" name="time" id="timeInput">
                <button type="button" class="now-btn" id="nowBtn" title="Aktuelles Datum &amp; Uhrzeit setzen">Jetzt</button>
              </div>
            </label>
          </div>
        </div>
      </details>

      <div class="save-bar">
        <div class="save-bar-inner">
          <div class="save-bar-main">
            <span class="save-count" id="rollCount"></span>
            <div class="anzahl-stepper">
              <button type="button" class="anzahl-btn" id="countMinus" aria-label="Weniger">−</button>
              <input type="number" name="count" id="countInput" min="1" max="50" step="1" value="1" aria-label="Anzahl Aufnahmen">
              <button type="button" class="anzahl-btn" id="countPlus" aria-label="Mehr">+</button>
            </div>
            <button type="button" class="save-done" id="doneBtn">Fertig</button>
          </div>
          <p class="field-note save-full" id="fullNote" hidden></p>
          <button type="submit" class="btn-primary" id="saveBtn">Aufnahme speichern</button>
        </div>
      </div>
    </form>`;

  const form = qs<HTMLFormElement>(el, "#frameForm");
  const rollSel = qs<HTMLSelectElement>(el, "#rollSel");
  const motif = qs<HTMLTextAreaElement>(el, "#motifInput");
  const motifSuggest = qs(el, "#motifSuggest");
  const motifRecent = qs(el, "#motifRecent");
  const lensSel = qs<HTMLSelectElement>(el, "#lensSel");
  const flashChk = qs<HTMLInputElement>(el, "#flashChk");
  const shutterSel = qs<HTMLSelectElement>(el, "#shutterSel");
  const apertureSel = qs<HTMLSelectElement>(el, "#apertureSel");
  const placeInput = qs<HTMLInputElement>(el, "#placeInput");
  const gpsStatus = qs(el, "#gpsStatus");
  const placeChips = qs(el, "#placeChips");
  const dateInput = qs<HTMLInputElement>(el, "#dateInput");
  const timeInput = qs<HTMLInputElement>(el, "#timeInput");
  const countInput = qs<HTMLInputElement>(el, "#countInput");
  const rollCount = qs(el, "#rollCount");
  const fullNote = qs(el, "#fullNote");
  const doneBtn = qs<HTMLButtonElement>(el, "#doneBtn");
  const whenText = qs(el, "#whenText");
  const whenEdit = qs<HTMLButtonElement>(el, "#whenEdit");
  const frameDetails = qs<HTMLDetailsElement>(el, "#frameDetails");
  const detailsSummary = qs(el, "#detailsSummary");
  const submits = qsa<HTMLButtonElement>(form, "button[type=submit]");

  const updateWhen = () => {
    whenText.textContent =
      dateInput.value && timeInput.value
        ? `${formatDate(dateInput.value)} · ${timeInput.value}`
        : "Datum/Uhrzeit fehlen";
  };
  const updateDetailsSummary = () => {
    const lens = lensSel.value ? (lensSel.selectedOptions[0]?.textContent ?? "Objektiv") : "kein Objektiv";
    const parts = [lens, shutterSel.value || "Zeit offen", apertureSel.value || "Blende offen"];
    if (flashChk.checked) parts.push("Blitz");
    if (placeInput.value.trim()) parts.push(placeInput.value.trim());
    detailsSummary.textContent = `Details · ${parts.join(" · ")}`;
  };
  whenEdit.onclick = () => {
    frameDetails.open = true;
    dateInput.focus();
  };

  const rollCounts = new Map<number, number>();
  for (const r of dash.open_rolls) rollCounts.set(r.number, r.frame_count + (queued.get(r.number) ?? 0));
  const selectedRoll = () => dash.open_rolls.find((r) => r.number === Number(rollSel.value));
  const currentCount = () => rollCounts.get(Number(rollSel.value)) ?? 0;
  const updateRollMeta = () => {
    const r = selectedRoll();
    const n = currentCount();
    const cap = r?.capacity ?? 0;
    rollCount.textContent = cap ? `${n}/${cap}` : String(n);
    fullNote.hidden = !cap || n < cap;
    fullNote.textContent = cap && n >= cap ? `Film voll (${n}/${cap}) – weitere Aufnahmen zählen als Bonus.` : "";
    const opt = rollSel.selectedOptions[0];
    if (opt && r) {
      opt.textContent = `#${r.number} · ${r.film_stock.name} · ${n}/${cap}${cap && n >= cap ? " · voll" : ""}`;
    }
  };

  const wanted = ctx.params[0];
  const wantedRoll = wanted && dash.open_rolls.some((r) => String(r.number) === wanted) ? wanted : "";
  if (wantedRoll) rollSel.value = wantedRoll;
  const savedDraft = loadDraft<FrameDraft>(DRAFT_KEY);
  if (savedDraft && !dash.open_rolls.some((r) => String(r.number) === savedDraft.roll)) {
    clearDraft(DRAFT_KEY);
  }
  const draft =
    savedDraft &&
    dash.open_rolls.some((r) => String(r.number) === savedDraft.roll) &&
    (!wantedRoll || wantedRoll === savedDraft.roll)
      ? savedDraft
      : null;
  if (draft) rollSel.value = draft.roll;
  updateRollMeta();

  // ---- Datum / Uhrzeit ----
  let dtTouched = false;
  const setNow = () => {
    dateInput.value = todayStr();
    timeInput.value = nowTimeStr();
    updateWhen();
  };
  setNow();
  if (draft?.date) {
    dateInput.value = draft.date;
    dtTouched = true;
  }
  if (draft?.time) {
    timeInput.value = draft.time;
    dtTouched = true;
  }
  updateWhen();
  dateInput.addEventListener("input", () => (dtTouched = true));
  timeInput.addEventListener("input", () => (dtTouched = true));
  qs(el, "#nowBtn").onclick = () => {
    setNow();
    dtTouched = false;
  };
  const onVisible = () => {
    if (!ctx.alive()) {
      document.removeEventListener("visibilitychange", onVisible);
      return;
    }
    if (document.visibilityState === "visible" && !dtTouched) setNow();
  };
  document.addEventListener("visibilitychange", onVisible);

  // ---- Anzahl ----
  const saveBtn = qs<HTMLButtonElement>(el, "#saveBtn");
  const updateSaveLabel = () => {
    const n = Math.min(50, Math.max(1, parseInt(countInput.value, 10) || 1));
    saveBtn.textContent = n === 1 ? "Aufnahme speichern" : `${n} Aufnahmen speichern`;
  };
  const stepCount = (delta: number) => {
    countInput.value = String(Math.min(50, Math.max(1, (parseInt(countInput.value, 10) || 1) + delta)));
    updateSaveLabel();
  };
  qs(el, "#countMinus").onclick = () => stepCount(-1);
  qs(el, "#countPlus").onclick = () => stepCount(1);
  countInput.addEventListener("input", updateSaveLabel);
  updateSaveLabel();
  if (draft?.count) {
    const n = parseInt(draft.count, 10);
    if (Number.isFinite(n)) {
      countInput.value = String(Math.min(50, Math.max(1, n)));
      updateSaveLabel();
    }
  }

  // ---- Auswahllisten ----
  const lensesActive = catalog.lenses.filter((l) => !l.archived);
  let sugg: FrameSuggestion | null = null;
  let showAllLenses = false;
  let lensTouched = false;
  let shutterTouched = false;
  let apertureTouched = false;

  function withCurrent(labels: string[], current: string | null | undefined): string[] {
    return current && !labels.includes(current) ? [...labels, current] : labels;
  }

  function fillLenses(selected: number | null): void {
    const restrictedIds = sugg?.lens_ids ?? [];
    const restricted = restrictedIds.length > 0 && !showAllLenses;
    const list = restricted
      ? restrictedIds.flatMap((id) => {
          const l = catalog.lenses.find((x) => x.id === id);
          return l ? [l] : [];
        })
      : lensesActive;
    const items = list.map((l) => ({ value: l.id, label: l.name }));
    let html = optionsHtml(items, selected, "– kein Objektiv –");
    if (restricted) html += `<option value="${ALL_LENSES}">Andere anzeigen …</option>`;
    lensSel.innerHTML = html;
  }
  lensSel.onchange = () => {
    lensTouched = true;
    if (lensSel.value === ALL_LENSES) {
      showAllLenses = true;
      fillLenses(null);
    }
  };
  shutterSel.onchange = () => (shutterTouched = true);
  apertureSel.onchange = () => (apertureTouched = true);

  function fillSelect(sel: HTMLSelectElement, labels: string[], selected: string | null | undefined): void {
    sel.innerHTML = optionsHtml(
      withCurrent(labels, selected).map((l) => ({ value: l, label: l })),
      selected ?? "",
      "keine",
    );
  }
  const shutterLabels = catalog.shutter_speeds.map((s) => s.label);
  const apertureLabels = catalog.apertures.map((a) => a.label);

  let lastMotif: string | null = null;

  function updateMotifRecent(): void {
    const recent = lastMotif?.trim();
    if (!recent || motif.value.trim()) {
      motifRecent.hidden = true;
      motifRecent.innerHTML = "";
      return;
    }
    motifRecent.hidden = false;
    motifRecent.innerHTML = `<button type="button" class="chip" data-motif="${escapeHtml(recent)}">wie zuletzt: ${escapeHtml(recent)}</button>`;
  }

  async function applySuggestion(roll: number): Promise<void> {
    let s: FrameSuggestion | null = null;
    try {
      s = (await getFrameSuggestion(roll)).data;
    } catch {
      s = null;
    }
    if (!ctx.alive() || String(roll) !== rollSel.value) return;
    sugg = s;
    showAllLenses = false;
    let lensId: number | null = s?.lens_id ?? null;
    const restricted = s?.lens_ids ?? [];
    if (lensId !== null && restricted.length && !restricted.includes(lensId)) showAllLenses = true;
    if (lensId === null && restricted.length) lensId = restricted[0] ?? null;
    if (!lensTouched) fillLenses(lensId);
    if (!shutterTouched) fillSelect(shutterSel, shutterLabels, s?.shutter ?? null);
    if (!apertureTouched) fillSelect(apertureSel, apertureLabels, s?.aperture ?? null);
    lastMotif = s?.motif ?? null;
    updateMotifRecent();
    updateDetailsSummary();
  }

  fillLenses(null);
  fillSelect(shutterSel, shutterLabels, null);
  fillSelect(apertureSel, apertureLabels, null);
  if (draft) {
    if (draft.lens) lensSel.value = draft.lens;
    if (draft.shutter) shutterSel.value = draft.shutter;
    if (draft.aperture) apertureSel.value = draft.aperture;
    motif.value = draft.motif;
    flashChk.checked = draft.flash;
    placeInput.value = draft.place;
    lensTouched = true;
    shutterTouched = true;
    apertureTouched = true;
  }
  updateDetailsSummary();
  rollSel.onchange = () => {
    lensTouched = false;
    shutterTouched = false;
    apertureTouched = false;
    updateRollMeta();
    void applySuggestion(Number(rollSel.value));
  };
  void applySuggestion(Number(rollSel.value));

  // ---- Motiv ----
  qs(el, "#motifClear").onclick = () => {
    motif.value = "";
    motifSuggest.hidden = true;
    updateMotifRecent();
    motif.focus();
  };
  let motifSeq = 0;
  const loadMotifs = debounce(async () => {
    const q = motif.value.trim();
    if (q.length < 2) {
      motifSuggest.hidden = true;
      return;
    }
    const my = ++motifSeq;
    try {
      const list = await api.get<string[]>(`/api/v2/suggestions/motifs?q=${encodeURIComponent(q)}`, { timeoutMs: 5000 });
      if (my !== motifSeq || !ctx.alive()) return;
      const shown = list.filter((m) => m !== motif.value);
      motifSuggest.innerHTML = shown
        .map((m) => `<button type="button" class="suggest-item" data-m="${escapeHtml(m)}">${escapeHtml(m)}</button>`)
        .join("");
      motifSuggest.hidden = shown.length === 0;
    } catch {
      motifSuggest.hidden = true;
    }
  }, 250);
  motif.addEventListener("input", () => {
    updateMotifRecent();
    loadMotifs();
  });
  motif.addEventListener("blur", () => window.setTimeout(() => (motifSuggest.hidden = true), 150));
  // Auswahl bei "click" statt "pointerdown": Die Liste bleibt bis zum Klick sichtbar, dadurch landet
  // der Klick auf dem Button und nicht (Ghost-Klick) auf dem dahinterliegenden Formularfeld. preventDefault
  // unterbindet zudem, dass das umgebende <label> das Textarea fokussiert (iOS-Tastatur geht sonst auf).
  motifSuggest.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".suggest-item");
    if (!btn) return;
    ev.preventDefault();
    motif.value = btn.dataset.m ?? "";
    motifSuggest.hidden = true;
    updateMotifRecent();
    motif.focus();
  });
  motifRecent.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".chip");
    if (!btn) return;
    ev.preventDefault();
    motif.value = btn.dataset.motif ?? "";
    updateMotifRecent();
    motif.focus();
  });

  // ---- Ort / GPS ----
  let lat: number | null = null;
  let lon: number | null = null;
  let autoPlace = "";
  const setPlace = (text: string, auto: boolean) => {
    placeInput.value = text;
    autoPlace = auto ? text : "";
    updateDetailsSummary();
  };
  placeInput.addEventListener("input", () => (autoPlace = ""));

  async function loadPlaces(): Promise<void> {
    if (lat === null || lon === null) return;
    try {
      const places = await api.get<PlaceSuggestion[]>(`/api/v2/suggestions/places?lat=${lat}&lon=${lon}`, { timeoutMs: 5000 });
      if (!ctx.alive()) return;
      placeChips.innerHTML = places
        .map(
          (p) =>
            `<button type="button" class="chip" data-place="${escapeHtml(p.location_text)}">${escapeHtml(p.location_text)} <small>${Math.round(p.distance_m)} m</small></button>`,
        )
        .join("");
      const first = places[0];
      if (first && first.distance_m <= 50 && (!placeInput.value || placeInput.value === autoPlace)) {
        setPlace(first.location_text, true);
      } else if (!first && !placeInput.value && lat !== null && lon !== null) {
        setPlace(`${lat.toFixed(5)}, ${lon.toFixed(5)}`, true);
      }
    } catch {
      if (!placeInput.value && lat !== null && lon !== null) setPlace(`${lat.toFixed(5)}, ${lon.toFixed(5)}`, true);
    }
  }
  placeChips.addEventListener("click", (ev) => {
    const chip = (ev.target as HTMLElement).closest<HTMLButtonElement>(".chip");
    if (!chip) return;
    // preventDefault: verhindert, dass das umgebende <label> das Ortsfeld fokussiert (iOS-Tastatur/Scroll).
    ev.preventDefault();
    setPlace(chip.dataset.place ?? "", false);
  });

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!ctx.alive()) return;
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        gpsStatus.textContent = `GPS: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        void loadPlaces();
      },
      () => {
        if (ctx.alive()) gpsStatus.textContent = "GPS nicht verfügbar – bitte Ort manuell eingeben.";
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  } else {
    gpsStatus.textContent = "GPS wird von diesem Browser nicht unterstützt.";
  }

  // ---- Speichern ----
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const roll = Number(rollSel.value);
    if (!roll) return showError(form, "Bitte einen Film auswählen.");
    if (!dateInput.value || !timeInput.value) {
      frameDetails.open = true;
      return showError(form, "Bitte Datum und Uhrzeit angeben.");
    }
    const count = Math.min(50, Math.max(1, parseInt(countInput.value, 10) || 1));
    const submittedAt = nowIsoLocal();
    const payload: CreateFramePayload = {
      client_id: uuid(),
      count,
      date: dateInput.value,
      time: timeInput.value,
      flash: flashChk.checked,
    };
    const m = motif.value.trim();
    if (m) payload.motif = m;
    const place = placeInput.value.trim();
    if (place) payload.location_text = place;
    if (lat !== null && lon !== null) {
      payload.lat = lat;
      payload.lon = lon;
    }
    const lensId = parseInt(lensSel.value, 10);
    if (Number.isFinite(lensId)) payload.lens_id = lensId;
    if (shutterSel.value) payload.shutter = shutterSel.value;
    if (apertureSel.value) payload.aperture = apertureSel.value;
    const rollInfo = dash.open_rolls.find((r) => r.number === roll);
    const label = m || `${rollInfo?.camera.name ?? "Film"} #${roll}`;
    const beforeCount = currentCount();

    const finishSave = (newCount: number, message: string, action?: ToastAction) => {
      rollCounts.set(roll, newCount);
      if (Number(rollSel.value) === roll) {
        if (!dtTouched) setNow();
        motif.value = "";
        motifSuggest.hidden = true;
        updateMotifRecent();
        countInput.value = "1";
        updateSaveLabel();
        clearDraft(DRAFT_KEY);
        motif.focus();
      }
      updateRollMeta();
      toast(message, "ok", action ? 9000 : 5000, action);
    };

    const saveOffline = async () => {
      payload.recorded_at = submittedAt;
      await enqueue(payload, roll, label);
      const clientId = payload.client_id;
      finishSave(
        beforeCount + count,
        `${count === 1 ? "Aufnahme" : `${count} Aufnahmen`} offline gespeichert – wird später gesendet.`,
        clientId
          ? {
              label: "Rückgängig",
              onClick: async () => {
                await removeQueued(clientId);
                rollCounts.set(roll, beforeCount);
                updateRollMeta();
                toast("Offline-Aufnahme verworfen.", "ok");
              },
            }
          : undefined,
      );
    };

    await withBusy(submits, async () => {
      try {
        if (navigator.onLine === false) return await saveOffline();
        if ((await queueCount()) > 0) await flushQueue().catch(() => undefined);
        const frames = await api.post<Frame[]>(`/api/v2/rolls/${roll}/frames`, payload, { timeoutMs: 15000 });
        const first = frames[0];
        const last = frames[frames.length - 1];
        const where =
          first && last ? (first.position === last.position ? ` (Nr. ${first.position})` : ` (Nr. ${first.position}–${last.position})`) : "";
        finishSave(
          beforeCount + count,
          `${count === 1 ? "Aufnahme" : `${count} Aufnahmen`} gespeichert${where}.`,
          frames.length
            ? {
                label: "Rückgängig",
                onClick: async () => {
                  try {
                    const ordered = [...frames].sort((a, b) => b.position - a.position);
                    for (const f of ordered) await api.del(`/api/v2/frames/${f.id}`);
                    rollCounts.set(roll, beforeCount);
                    updateRollMeta();
                    toast("Rückgängig gemacht.", "ok");
                  } catch (e) {
                    toast(errMsg(e), "error");
                  }
                },
              }
            : undefined,
        );
      } catch (e) {
        if (isOfflineError(e)) {
          try {
            await saveOffline();
          } catch (qe) {
            showError(form, `Speichern nicht möglich: ${errMsg(qe)}`);
          }
        } else {
          showError(form, errMsg(e));
        }
      }
    });
  };

  doneBtn.onclick = () => {
    const roll = Number(rollSel.value);
    clearDraft(DRAFT_KEY);
    if (roll) navigate(`film/${roll}`);
  };

  const draftData = (): FrameDraft => ({
    roll: rollSel.value,
    motif: motif.value,
    lens: lensSel.value,
    flash: flashChk.checked,
    shutter: shutterSel.value,
    aperture: apertureSel.value,
    place: placeInput.value,
    date: dateInput.value,
    time: timeInput.value,
    count: countInput.value,
  });
  const persistDraft = () => {
    saveDraft(DRAFT_KEY, draftData());
    updateWhen();
    updateDetailsSummary();
  };
  form.addEventListener("input", persistDraft);
  form.addEventListener("change", persistDraft);

  // Auf iOS liegt eine fixe Leiste sonst hinter der Tastatur.
  const vv = window.visualViewport;
  const updateKeyboardOffset = () => {
    if (!ctx.alive()) {
      vv?.removeEventListener("resize", updateKeyboardOffset);
      vv?.removeEventListener("scroll", updateKeyboardOffset);
      document.documentElement.style.removeProperty("--keyboard-offset");
      return;
    }
    const offset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
  };
  vv?.addEventListener("resize", updateKeyboardOffset);
  vv?.addEventListener("scroll", updateKeyboardOffset);
  updateKeyboardOffset();
}

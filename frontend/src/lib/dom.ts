import { errMsg } from "../api";
import { escapeHtml } from "./escape";

export function qs<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Element nicht gefunden: ${selector}`);
  return el;
}

export function qsa<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function toast(message: string, kind: "info" | "error" | "ok" = "info", ms = 3500): void {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), kind === "error" ? Math.max(ms, 6000) : ms);
}

/** Fehlermeldung oben in einen Container setzen (ersetzt vorherige). */
export function showError(container: HTMLElement, message: string): void {
  container.querySelectorAll(":scope > .error-msg.inline-error").forEach((e) => e.remove());
  const p = document.createElement("p");
  p.className = "error-msg inline-error";
  p.textContent = message;
  container.prepend(p);
  p.scrollIntoView({ block: "nearest", behavior: "smooth" });
  window.setTimeout(() => p.remove(), 8000);
}

export function setLoading(el: HTMLElement, text = "Wird geladen …"): void {
  el.innerHTML = `<p class="empty-state">${escapeHtml(text)}</p>`;
}

export function setErrorState(el: HTMLElement, e: unknown): void {
  el.innerHTML = `<p class="error-msg">${escapeHtml(errMsg(e))}</p>`;
}

type Btn = HTMLButtonElement | HTMLInputElement;

/** Buttons während eines Requests sperren (verhindert Mehrfach-Submits). */
export async function withBusy<T>(buttons: Btn | Btn[], fn: () => Promise<T>): Promise<T> {
  const list = Array.isArray(buttons) ? buttons : [buttons];
  list.forEach((b) => (b.disabled = true));
  try {
    return await fn();
  } finally {
    list.forEach((b) => (b.disabled = false));
  }
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: number | undefined;
  return (...args: A) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

export function optionsHtml(
  items: { value: string | number; label: string }[],
  selected?: string | number | null,
  blankLabel?: string,
): string {
  const blank = blankLabel !== undefined ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
  return (
    blank +
    items
      .map((i) => {
        const sel = selected !== null && selected !== undefined && String(selected) === String(i.value);
        return `<option value="${escapeHtml(i.value)}"${sel ? " selected" : ""}>${escapeHtml(i.label)}</option>`;
      })
      .join("")
  );
}

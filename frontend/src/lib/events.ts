export const EVT_QUEUE = "filmlog:queue";
export const EVT_SYNCED = "filmlog:synced";

export function emit(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

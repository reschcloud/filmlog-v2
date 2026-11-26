import type { Roll, RollStatus } from "../types";

export interface StatusStep {
  to: RollStatus;
  label: string;
  confirm: (r: Roll) => string;
}

export const NEXT: Partial<Record<RollStatus, StatusStep>> = {
  offen: {
    to: "abgeschlossen",
    label: "Abschließen",
    confirm: (r) => `Film #${r.number} (${r.camera.name}) wirklich abschließen?`,
  },
  abgeschlossen: { to: "entwickelt", label: "Entwickelt", confirm: (r) => `Film #${r.number} als entwickelt markieren?` },
  entwickelt: { to: "gescannt", label: "Gescannt", confirm: (r) => `Film #${r.number} als gescannt markieren?` },
  gescannt: { to: "archiviert", label: "Archivieren", confirm: (r) => `Film #${r.number} archivieren? Archivierte Filme sind nur noch lesbar.` },
};

export const PREV: Partial<Record<RollStatus, StatusStep>> = {
  abgeschlossen: {
    to: "offen",
    label: "Wieder öffnen",
    confirm: (r) => `Film #${r.number} wieder öffnen? Danach können erneut Aufnahmen hinzugefügt werden.`,
  },
  entwickelt: { to: "abgeschlossen", label: "Nicht entwickelt", confirm: (r) => `Film #${r.number} wieder auf „abgeschlossen“ zurücksetzen?` },
  gescannt: { to: "entwickelt", label: "Nicht gescannt", confirm: (r) => `Film #${r.number} wieder auf „entwickelt“ zurücksetzen?` },
  archiviert: { to: "gescannt", label: "Dearchivieren", confirm: (r) => `Film #${r.number} dearchivieren?` },
};

export const STATUS_DATE_LABEL: Record<RollStatus, string> = {
  offen: "Angelegt",
  abgeschlossen: "Abgeschlossen",
  entwickelt: "Entwickelt",
  gescannt: "Gescannt",
  archiviert: "Archiviert",
};
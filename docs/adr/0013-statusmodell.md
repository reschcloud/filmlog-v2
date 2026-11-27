# ADR-0013: Statusmodell für Filme

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

v1 hatte nur Flags (`entwickelt`, `archiviert`). Im analogen Workflow durchläuft ein Film mehrere klar
benannte Zustände, und die App soll den nächsten Schritt anbieten können.

## Entscheidung

- **Reihenfolge:** `offen → abgeschlossen → entwickelt → gescannt → archiviert`.
- Jeder erreichte Zustand hat ein Datumsfeld: `completed_at`, `developed_at`, `scanned_at`,
  `archived_at`; `offen` nutzt `created_at`.
- **Vorwärts:** Beim Erreichen eines Zustands wird dessen Datum gesetzt, sofern noch nicht vorhanden.
- **Rückwärts:** Beim Zurücksetzen werden die Daten aller späteren Zustände gelöscht; das Datum des
  Zielzustands bleibt, wenn es schon existiert.
- **Archiv:** `archiviert` ist nur lesbar; Frame- und Filmänderungen werden abgelehnt. Dearchivieren ist
  ein Rückschritt auf `gescannt`.
- **API:** `POST /api/v2/rolls/{n}/status` mit `{ "status": "…" }`; die UI bietet den nächsten und den
  vorherigen Schritt mit Bestätigung an.
- **Kapazität:** `rolls.capacity` ist eine Warnung, keine harte Sperre. Analoge Filme werden bewusst
  überzogen (Bonusframes); die App zeigt „voll“ und zählt weiter.
- **Hinweise:** Dashboard-Hinweise für „voll“, „lange in der Kamera“, „zu entwickeln“ und „abgelaufen“
  leiten sich aus Status, Datum und Kapazität ab.

## Konsequenzen

- Die App kann den nächsten Schritt vorschlagen und den Entwicklungsstand filtern.
- Rückschritte löschen spätere Datumsangaben; das ist bewusst und wird in der Bestätigung erklärt.
- Ein archivierter Film ist ein sicherer Endzustand; Korrekturen erfordern Dearchivieren.
- Status und Kapazität sind getrennt: Ein voller Film bleibt offen, bis er abgeschlossen wird.

## Alternativen

- **Nur Flags wie v1:** verworfen; keine Datumshistorie, keine nächsten Schritte.
- **Freie Statuswahl ohne Reihenfolge:** verworfen; Hinweise und Rückschritte wären inkonsistent.
- **Harte Kapazitätssperre:** verworfen; analoge Fotografie kennt Bonusframes und Überzüge.
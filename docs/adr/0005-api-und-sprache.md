# ADR-0005: API-Vertrag, Sprache und Zeitformate

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die App wird von Browser, PWA und einem externen ExifTool-Client genutzt. Ohne verbindlichen Vertrag
driften Frontend, Client und Backend auseinander. Gleichzeitig ist die Projektsprache Deutsch, während
JSON-Felder üblicherweise englisch sind.

## Entscheidung

- **API-Präfix:** `/api/v2/…`; Auth unter `/auth/…`; System unter `/healthz`, `/api/docs`.
- **Sprache:** UI, Fehlermeldungen, Docs und Commits auf Deutsch; JSON-Feldnamen der API englisch.
  Code-Identifier meist englisch.
- **Vertrag:** `docs/API.md` ist verbindlich. Bei API-Änderungen werden `docs/API.md` **und**
  `frontend/src/types.ts` im selben Commit nachgezogen.
- **Fehler:** immer `{"error": "deutsche Meldung"}`. Validierungsfehler (422) werden zentral in
  `main.py` in eine lesbare deutsche Meldung übersetzt.
- **Zeitformate:** Zeitstempel lokal naiv als `YYYY-MM-DDTHH:MM:SS`, Datum `YYYY-MM-DD`, Uhrzeit `HH:MM`.
  Keine Zeitzonen-Umrechnung im Backend; `TZ` bestimmt die lokale Zeit.
- **Booleans/Null:** echte JSON-Booleans, `null` für „keine Angabe“.
- **Auth:** Cookie-Session für den Browser, `Authorization: Bearer flt_…` für den Client; CSRF-Header
  `X-Filmlog: 1` nur bei Cookie-Schreibzugriffen.

## Konsequenzen

- Ein Client kann sich auf Feldnamen und Fehlerform verlassen; die Doku ist Teil der Definition of Done.
- Deutsche Meldungen sind direkt in der UI verwendbar, aber nicht für maschinelle Fehlercodes gedacht.
- Naive lokale Zeit ist einfach und passt zu einem einzelnen Haushalt, ist aber nicht für mehrere
  Zeitzonen gedacht.
- Neue Endpunkte müssen in `types.ts` typisiert und in `docs/API.md` beschrieben werden.

## Alternativen

- **Englische Fehlermeldungen:** verworfen; die UI müsste übersetzen.
- **UTC/zeitzonenbewusste Zeitstempel:** verworfen; die App protokolliert lokale Aufnahmezeit, v1-Daten
  sind ebenfalls lokal.
- **OpenAPI als einzige Quelle:** verworfen; die Markdown-Doku ist für Menschen und den Client leichter.
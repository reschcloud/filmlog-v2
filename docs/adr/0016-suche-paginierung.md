# ADR-0016: Suche mit Offsets und explizitem Nachladen

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die Suche liefert Aufnahmen und Filme. Eine feste Obergrenze ohne Nachladen versteckt ältere Treffer und
wirkt wie ein vollständiges Ergebnis. Gleichzeitig soll die erste Antwort klein und schnell bleiben.

## Entscheidung

- `GET /api/v2/search` akzeptiert:
  - `q`
  - `frame_offset`, `roll_offset` (ab 0)
  - `frame_limit` (Standard 50, 1–100), `roll_limit` (Standard 30, 1–100)
- Die Antwort enthält `frames`, `rolls`, `frames_has_more`, `rolls_has_more`. Es gibt bewusst **keine**
  Gesamtzahlen; die UI zeigt bei mehr Treffern `50+`/`30+`.
- Das Frontend lädt mit „Mehr Aufnahmen“/„Mehr Filme“ explizit nach; beim Nachladen wird nur die
  angeforderte Liste groß geliefert, die andere mit Limit 1.
- Doppelte Treffer werden clientseitig über `id` bzw. Filmnummer gefiltert.
- Die Suchsemantik bleibt FTS5 für Aufnahmen und `LIKE` für Filme (ADR-0008).

## Konsequenzen

- Ältere Treffer sind erreichbar, ohne die erste Antwort zu vergrößern.
- Der Client muss Offsets und `has_more` verstehen; `docs/API.md` und `types.ts` sind entsprechend
  erweitert.
- Es gibt keine „Treffer insgesamt“-Anzeige; das ist bewusst, um keine zusätzlichen Count-Queries zu
  brauchen.
- Reihenfolge und Offsets setzen eine stabile Sortierung voraus (FTS-Rang bzw. Filmnummer absteigend).

## Alternativen

- **Feste Limits ohne Nachladen:** verworfen; ältere Aufnahmen wären nicht auffindbar.
- **Alle Treffer auf einmal:** verworfen; langsam und unnötig große Antworten.
- **Cursor-Paginierung:** für die Suche verworfen; Offsets sind bei der begrenzten Trefferzahl einfacher.
  „Zuletzt“ nutzt weiterhin einen Cursor.
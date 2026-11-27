# ADR-0008: Volltextsuche mit SQLite FTS5

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Motive, Orte, Objektive und Notizen sollen schnell durchsuchbar sein, auch bei vielen Tausend Aufnahmen.
Ein externer Suchdienst wäre für eine Single-Container-App zu viel Betrieb.

## Entscheidung

- SQLite **FTS5** indiziert die Aufnahmen (`frames_fts`) über Motiv, Ort und Objektivname.
- Der virtuelle Tabellen-Index und seine Trigger stehen in `backend/filmlog/migrations/versions/0001_initial.py`.
  Änderungen daran gehören in eine neue Migration, nicht in `models.py`; die `FTS_DDL`-Konstante dort ist
  ungenutzt.
- Die Suche kombiniert:
  - FTS5 für Aufnahmen, sortiert nach `rank` (mit `LIMIT/OFFSET`),
  - `LIKE` über Kamera, Filmstock und Notizen für Filme, plus Treffer auf die Filmnummer (`#42`).
- Die Suche ist auf 50 Aufnahmen bzw. 30 Filme pro Seite begrenzt und paginierbar (siehe ADR-0016).
- Leere oder nur aus Sonderzeichen bestehende Anfragen liefern ein leeres Ergebnis, keinen Fehler.
- Updates an Aufnahmen halten den Index über Trigger synchron.

## Konsequenzen

- Kein zusätzlicher Suchdienst; die Suche läuft in derselben SQLite-Datei.
- Die FTS-Syntax ist nicht die der UI: Eingaben werden in eine sichere Prefix-Query übersetzt
  (`_fts_query`), Sonderzeichen dürfen keinen 500er auslösen.
- Der Index ist Teil des Schemas; ein Rebuild/Backup muss ihn berücksichtigen.
- Die Suche ist bewusst keine vollständige Relevanz-Suche; für Filme gilt `LIKE`.

## Alternativen

- **`LIKE` über alle Felder:** verworfen; langsam und ohne Ranking.
- **Externe Suchmaschine (Meilisearch/Elastic):** verworfen; zusätzlicher Dienst und Datenkopie.
- **Nur Frontend-Filter:** verworfen; lädt zu viele Daten und funktioniert offline nicht mit allen Daten.
# ADR-0006: Messwerte als Label plus numerischer Wert

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Belichtungszeiten und Blenden werden von Menschen sehr unterschiedlich geschrieben (`1/125s`, `125`,
`0,5`, `2"`, `5,6`, `f8`, `F/5.6`). Für Sortierung, Statistik und Vorschläge braucht die App aber
vergleichbare Zahlen. Gleichzeitig soll die ursprüngliche Schreibweise nicht verloren gehen.

## Entscheidung

- Jede Aufnahme speichert **Label und numerischen Wert**:
  - `shutter` (Label) + `shutter_seconds` (Sekunden),
  - `aperture` (Label) + `f_number`.
- `backend/filmlog/units.py` ist die einzige Quelle für Parser und Normalisierung:
  - `parse_shutter`: `1/125`, `1/125s`, `125` → `1/125` / `0.008`; `2s`, `2"` → `2s`; `B`/`T` → Sonderfälle.
  - `parse_aperture`: `5.6`, `5,6`, `f5.6`, `F/5.6`, `1:2.8` → `f/5.6` / `5.6`.
  - `shutter_sort_key`: kurz → lang, `B`/`T` ans Ende.
- Sortiert und gefiltert wird **nach dem numerischen Wert**, nicht nach dem Label.
- Die Funktionen sind rein (ohne DB), werden von API, Importer und Tests genutzt und sind umfangreich
  getestet.
- Katalogwerte (Belichtungszeiten/Blenden) sind eigene Tabellen mit Label und Sortierwert; Presets
  (volle/halbe/Drittelstufen) erzeugen daraus Einträge.

## Konsequenzen

- `1/125`, `1/125s` und `125` landen in derselben Statistik und Sortierung.
- Unbekannte Schreibweisen können als Label erhalten bleiben, haben aber keinen numerischen Wert; sie
  werden nicht sinnvoll einsortiert.
- Neue Einheiten oder Formate gehören in `units.py` und in die Tests, nicht in einzelne Router.
- Import und UI profitieren von derselben Normalisierung.

## Alternativen

- **Nur String speichern:** verworfen; Sortierung und Statistik wären falsch.
- **Nur Zahl speichern:** verworfen; `B`/`T` und Sonderfälle gingen verloren.
- **Normalisierung im Frontend:** verworfen; API, Importer und Client brauchen dieselbe Logik.
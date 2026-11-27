# ADR-0024: Zeichen nur für Richtung, Aktionen als deutsche Verben

- **Status:** Accepted
- **Datum:** 2026-11-27
- **Betrifft:** ADR-0015, ADR-0022, ADR-0023

## Kontext

Im Designexperiment „Rams × Tesla“ waren viele Aktionszeichen gemischt: `←`, `↓`, `✎`, `□`, `↺`, `×`,
`+`, `✓`, `›` und Emojis. Auf einem Handy im Feld gibt es keine Tooltips; ein Zeichen muss ohne Erklärung
dasselbe bedeuten. Die drei Perspektiven (Jobs, Ive, Rams) kamen überein, dass ein eigener SVG-Iconsatz
für fünf seltene Objektaktionen zu viel gelerntes Vokabular wäre.

## Entscheidung

- **Zeichen bleiben nur für Richtung und native Bedienung:**
  - `←` für zurück (Header, 44 px),
  - ein Disclosure-Chevron (`›`), geöffnet um 90° gedreht,
  - `−`/`+` im Anzahl-Stepper,
  - die Checkbox mit `✓`,
  - der native Select-Pfeil.
- **Objektaktionen werden zu deutschen Verben:**
  „CSV“, „Bearbeiten“, „Archivieren“, „Reaktivieren“, „Löschen“, „Abschließen“, „Einfügen“,
  „Verwerfen“, „Motiv leeren“, „Neu anlegen“.
- Das `+` bleibt nur als Wortbestandteil eines Labels („+ Aufnahme“, „+ Neuer Film“), nie als freistehendes
  Aktionsicon.
- **Kein eigener SVG-Iconsatz und keine Emojis.** Systemschrift-Glyphen und Emojis rendern je nach Gerät
  anders; Wörter sind plattformunabhängig.
- **Vier Wörter werden getrennt:**
  - *Löschen* entfernt Gespeichertes, nur am Objekt und mit Rückfrage.
  - *Verwerfen* gibt Ungespeichertes auf (Formular, Offline-Queue).
  - *Abbrechen* verlässt ein Formular ohne Änderung.
  - *Feld leeren* löscht nur Text.
- Destruktive Aktionen stehen im Bearbeiten-Formular des Objekts, nicht in der Lesezeile:
  Aufnahme löschen im Frame-Formular, Film löschen in den Filmangaben, Katalog-Löschen im Katalogformular.
- Die Filmzeile selbst ist der Editier-Link; es gibt keine Stift-/Papierkorb-Icons in Listen.

## Konsequenzen

- Listen werden ruhiger; die Aktionen brauchen etwas mehr Breite, sind aber ohne Erklärung verständlich.
- Seltene Aktionen (Einfügen, Löschen, Archivieren) sind einen Bearbeitungsschritt entfernt; das ist
  beabsichtigt, weil sie im Feld nicht zum schnellen Kernprozess gehören.
- „+ Aufnahme“ und „+ Neuer Film“ bleiben als benannte Aktionen sichtbar.
- Neue Aktionen brauchen eine deutsche Beschriftung; ein neues Icon braucht eine neue ADR.

## Alternativen

- **Eigener SVG-Iconsatz:** verworfen; fünf seltene Bedeutungen wären zu lernen und zu pflegen.
- **Emojis:** verworfen; plattformabhängig, farbig und nicht barrierefrei.
- **Icon-only mit Tooltip/aria-label:** verworfen; im Feld gibt es keinen Tooltip.

## Test

Eine Person, die die App nicht kennt, soll bei Sonne auf 375×667 mit 20 Aufnahmen „Nr. 12 bearbeiten,
Nr. 7 löschen, Film abschließen“ in unter 60 Sekunden finden – nur über Zeilen und Verben, ohne ein
Zeichen außer `←` zu drücken oder zu erklären.
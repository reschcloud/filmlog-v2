# ADR-0022: Lesbare Feldtypografie und sichtbare Zurück-Aktion

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die Aufnahme-Ansicht ist im Feld oft das einzige, was für Sekunden sichtbar ist: Sonne, Handschuhe,
Bewegung. Im Screenshot waren der „wie zuletzt“-Chip, die Aufnahmezeit und die Details-Zeile zu klein
(13–15 px, teils Großbuchstaben in Monospace), und der Zurück-Pfeil war als kleines Glyph kaum zu treffen
bzw. zu erkennen.

## Entscheidung

- **Grundgrößen** der UI-Tokens: `--x-small: 12px`, `--small: 14px`, `--medium: 16px`, `--large: 20px`.
  Eingaben bleiben bei 16 px (kein iOS-Zoom).
- **Aufnahmezeit** (`.capture-when`) ist 17 px, in `--ink` statt grau.
- **Details-Zeile** (`.frame-details summary`) ist 16 px, normale Groß-/Kleinschreibung und darf umbrechen;
  keine Ellipsis-Kürzung, keine 13-px-Großbuchstaben mehr.
- **Chips** („wie zuletzt“, Ortsvorschläge) sind 16 px, dürfen umbrechen und behalten 44 px Tap-Höhe.
- **Zurück-Button:** 44 × 44 px Ziel, 30 px großes Pfeil-Glyph, heller Hintergrund und sichtbarer Rand
  auf dem braunen Header; nicht nur ein nacktes Zeichen.
- Diese Mindestgrößen gelten für Field-Ansichten; Verwaltungsansichten dürfen dichter sein, aber nicht
  unter `--small` für relevante Texte.

## Konsequenzen

- Die Aufnahme-Ansicht wird etwas höher, dafür ohne Lupen-Effekt lesbar; die Details-Zeile kann zweizeilig
  werden.
- Der Zurück-Weg ist auch ohne Farbwahrnehmung/bei Sonne als Fläche erkennbar.
- Neue Komponenten müssen die Tokens verwenden, keine festen 11–13-px-Texte für Inhalte.
- Auf 320–430 px ist zu prüfen, dass Bottom-Nav, Speicherleiste und Details weiterhin passen.

## Alternativen

- **Nur die Screenshot-Stellen vergrößern:** verworfen; andere Feldtexte wären weiter zu klein.
- **13/15 px behalten und nur Kontrast erhöhen:** verworfen; die Größe war das Problem.
- **Zurück-Pfeil ohne Fläche:** verworfen; im Header zu leicht zu übersehen.
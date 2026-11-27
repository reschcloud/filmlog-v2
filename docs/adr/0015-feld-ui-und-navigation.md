# ADR-0015: Field-first-UI und Navigation

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die App wird auf einem Handy im Feld benutzt: Sonne, Handschuhe, eine Hand am Kameragriff, wenig Zeit,
oft kein Netz. Jede zusätzliche Ebene kostet Aufmerksamkeit und erhöht die Fehlerwahrscheinlichkeit.
Gleichzeitig braucht es Verwaltung (Filme, Stats, Katalog, Einstellungen).

## Entscheidung

- **Leitregel:** So wenig UI wie möglich, so viel wie im Feld nötig. Neue Bedienelemente müssen den
  Kernprozess „Aufnahme eintragen“ schneller oder sicherer machen; sonst gehören sie hinter „Mehr“.
- **Navigation:** feste untere Leiste mit **Start · Aufnahme · Filme · Suche · Mehr**; „Mehr“ enthält
  Zuletzt, Stats, Auswahllisten und Einstellungen. Auf der Startseite ist der erste Einstieg
  „Weiter · 21/36 Aufnahmen“ mit der Filmnummer. Ein Tap auf einen offenen Film öffnet die Aufnahme
  (ADR-0001).
- **Aufnahme-Modus:** Auf `#neue-aufnahme` ist die untere Leiste ausgeblendet. Eine feste Speicherleiste
  bleibt im Daumenbereich, weicht der iOS-Tastatur über `visualViewport` aus und enthält Zähler,
  Serienanzahl, „Speichern“ und „Fertig“. Nach dem Speichern bleibt der Screen stehen (Serienfluss).
- **Formular:** Sichtbar sind Film, Motiv und Aufnahmezeit; Objektiv, Blitz, Zeit, Blende, Ort und Datum
  liegen in einem eingeklappten „Details“-Bereich. Das Motiv wird nicht vorbelegt; „wie zuletzt“ ist ein
  optionaler Chip.
- **Größen:** interaktive Ziele mindestens 44 px, Eingaben 16 px (kein iOS-Zoom), hoher Kontrast
  Papier/Braun, sichtbare Fokus-/Sperrzustände.
- **Listen:** Sticky-Filter (Stats, Filme, Suche) unter dem Header; Zeilentipp ist die primäre Aktion,
  destruktive Aktionen sind getrennt und bestätigt.
- **Keine versteckten Gesten** (Long-Press, Doppeltipp, Swipe) für Kernfunktionen.

## Konsequenzen

- Die App ist auf dem Handy schnell, hat aber auf dem Desktop keine eigene „breite“ Informationsdichte.
- Stats, Katalog und Einstellungen sind einen Tap tiefer; das ist für Verwaltung akzeptabel.
- Jede neue Ansicht muss auf 320–430 px und mit einer Hand funktionieren.
- Die feste Speicherleiste und der Aufnahme-Modus sind zentrale UI-Verträge; Änderungen daran brauchen
  eine neue ADR.

## Alternativen

- **Kachel-Startseite mit allen Funktionen:** verworfen; die Aufnahme lag unter dem Fold und konkurrierte
  mit Einstellungen.
- **Hamburger-Menü/Top-Tabs:** verworfen; auf dem Handy schlechter mit dem Daumen erreichbar.
- **Alles in einem Formular:** verworfen; zu viel Scrollen und Fehlfelder vor dem Speichern.
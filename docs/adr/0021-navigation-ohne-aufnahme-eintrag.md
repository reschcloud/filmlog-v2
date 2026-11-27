# ADR-0021: Kein separater „Aufnahme“-Eintrag in der unteren Navigation

- **Status:** Accepted
- **Datum:** 2026-11-27
- **Ersetzt teilweise:** ADR-0015 (Navigationspunkte)

## Kontext

Die untere Navigation enthielt `Start · Aufnahme · Filme · Suche · Mehr`. Der Eintrag „Aufnahme“ öffnete
das generische Aufnahmeformular mit Filmauswahl. Im Feld ist der normale Weg aber bereits eindeutig:
Ein Tap auf einen offenen Film (Startkarte, offene Zeile) oder auf „Weiter“ öffnet die Aufnahme für genau
diesen Film. Der zusätzliche Navigationspunkt war damit redundant und bot eine unnötige Auswahl.

## Entscheidung

- Die untere Navigation hat vier Ziele: **Start · Filme · Suche · Mehr**.
- Es gibt **keinen** generischen „Aufnahme“-Eintrag mehr.
- Aufnahmen werden gestartet über:
  - die aktive Filmkarte oder „Weiter“ auf der Startseite (ADR-0001),
  - eine offene Zeile in der Filmliste,
  - „+ Aufnahme“ auf der Filmdetailseite.
- Die Route `#neue-aufnahme` bleibt bestehen (Deep-Link, Sonderfälle, keine offenen Filme), ist aber kein
  Navigationsziel.

## Konsequenzen

- Ein Navigationsziel weniger; die Leiste ist auf schmalen Geräten entlastet.
- Der Einstieg in die Aufnahme ist immer filmbezogen; das verhindert die Frage „welcher Film?“.
- Bei keinem offenen Film führt die Startseite über „Neuen Film anlegen“ weiter.
- QA prüft: Startkarte/offene Zeile → `#neue-aufnahme/{n}`, „Details“ → `#film/{n}`, keine Aufnahme-Nav.

## Alternativen

- **Fünfter Eintrag behalten:** verworfen; redundant zu Karte/Weiter und kostet Platz.
- **Aufnahme-Eintrag als einzigen Capture-Weg:** verworfen; dann müsste der Film im Formular gewählt werden.
- **Aufnahme-Eintrag nur bei fehlendem offenen Film:** verworfen; Zustandsabhängigkeit in der Navigation
  wäre unvorhersehbar.
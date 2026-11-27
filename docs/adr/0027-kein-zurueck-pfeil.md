# ADR-0027: Kein Zurück-Pfeil im Header

- **Status:** Accepted
- **Datum:** 2026-11-27
- **Ersetzt teilweise:** ADR-0015, ADR-0024 (dort war `←` noch als Ausnahme gelistet)

## Kontext

Die untere Navigation (Start, Filme, Suche, Mehr), die klickbare Marke und die Betriebssystem-/Browser-
Zurück-Geste decken die Navigation ab. Der zusätzliche Zurück-Pfeil im Header kostete Platz und war auf
vielen Ansichten ohne sinnvolles Ziel (z. B. nach einem Deep-Link).

## Entscheidung

- Der Header enthält **keinen Zurück-Pfeil** mehr.
- Navigation erfolgt über:
  - die feste untere Leiste,
  - die Marke `FILMLOG` als Startseite,
  - die System-/Browser-Zurück-Geste,
  - „Fertig“ im Aufnahme-Modus.
- Die frühere Inline-Zurück-Aktion im Filmdetail bleibt entfernt.
- Die Marke scrollt auf der Startseite nach oben; auf anderen Seiten führt sie zur Startseite.

## Konsequenzen

- Der Header ist ruhiger und auf schmalen Geräten breiter verfügbar.
- Es gibt keinen sichtbaren In-App-Verlauf zurück; Unterseiten werden über die vier Hauptziele verlassen.
- Auf tiefen Ansichten (Filmdetail, Einstellungen) ist der Weg zurück ein bewusster Navigationsschritt.
- Tests prüfen, dass kein `#backBtn`/`←` mehr existiert und die Bottom-Nav-Ziele erreichbar sind.

## Alternativen

- **Pfeil behalten:** verworfen; redundant und platzraubend.
- **Pfeil nur auf einigen Seiten:** verworfen; inkonsistent und schwer vorherzusagen.
- **Swipe-Geste als Ersatz:** verworfen; versteckt und auf Desktop nicht verfügbar.
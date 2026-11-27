# ADR-0023: Design-Experiment „Rams × Tesla“ auf eigenem Branch

- **Status:** Accepted
- **Datum:** 2026-11-27
- **Betrifft:** ADR-0001, ADR-0015, ADR-0022
- **Ersetzt teilweise:** ADR-0015 (visuelles System), ADR-0022 (Typografiegrößen)

## Kontext

Die Feld-App soll radikal anders aussehen als die aktuelle Papier/Braun-UI. Gewünscht ist eine Mischung
aus Braun-/Dieter-Rams-Reduktion und der aktuellen Tesla-Fahrzeug-UI: wenige Schriftgrößen, sehr gute
Lesbarkeit, große Flächen, klare Hierarchie, keine dekorativen Details. Unwichtiges soll **wegfallen**,
nicht in kleiner Schrift weiterleben.

Das Experiment darf die laufende App und `main` nicht beeinflussen. Es muss auf einem Handy im Feld
funktionieren und die Kernregeln (offener Film → Aufnahme, 44-px-Ziele, 16-px-Eingaben, keine versteckten
Gesten) erhalten.

## Entscheidung

- Eigener Git-Worktree auf Branch `design/rams-tesla`; `main` bleibt unverändert.
- Eigene Vorschau auf `127.0.0.1:8002` mit kopiertem Datenverzeichnis (nie zwei Instanzen auf einer
  SQLite-Datei, ADR-0003).
- Gestaltung als Theme-Schicht über der bestehenden Struktur, damit die App funktional vollständig bleibt:
  - warme Braun-/Off-White-Palette mit einem einzigen Akzent (Braun-Orange),
  - flache Flächen, keine Schlagschatten/Gradients, klare Kanten,
  - eine Body-Schrift (System-Sans), Display-Schrift nur für Marke/Überschriften,
  - vier Größen: 14 / 18 / 24 / 32 px; Sekundäres wird größer oder gestrichen, nicht kleiner,
  - normale Groß-/Kleinschreibung statt Mini-Uppercase-Labels,
  - große, daumenfreundliche Navigation und Aktionen.
- Unwichtiges wird aus dem Markup entfernt (z. B. erklärende Mini-Hints, dekorative Linien), nicht
  verkleinert.
- **Startseite:** keine separate „zuletzt genutzte Kamera“-Karte und kein Hero. Eine einzige, nach zuletzt
  genutzt sortierte Liste der offenen Filme; alle offenen Filme tragen das orange Flächenschema. Filme, die
  auf Entwicklung warten, erscheinen darunter als **eine Summe** (Gesamtzahl, aufgeteilt nur nach S/W und
  Farbe) statt einzelner Hinweise. „Neuer Film“ wird dort nicht angeboten; die Anlage liegt unter
  Mehr → Neuer Film. Der Filmtyp steht als kleiner runder Marker direkt hinter dem Filmnamen. Auf der
  Startseite stehen weder Filmnummer noch ein eigener Details-Link; ein Tap öffnet die Aufnahme.
- **Aufnahme:** Motivvorschläge liegen absolut über dem Formular (kein Layoutsprung); ein Tap auf
  „Aufnahme speichern“ bei offener Vorschlagsliste wird bereits am Pointerdown abgefangen und speichert.
- **Details-Zeile:** zeigt nur tatsächlich gesetzte Werte (kein „kein Objektiv“, „Blende offen“ o. Ä.).
  Für eine gefundene Position steht dort ein Pin-Icon statt roher Koordinaten; Koordinaten werden nie
  als Ortstext angezeigt.
- **Zeichen:** nur Richtung und native Bedienelemente; Objektaktionen sind deutsche Verben
  (ADR-0024). Kein SVG-Iconsatz, keine Emojis.
- Kein Versions-Bump, kein Tag und kein Merge nach `main`, solange die Feldkriterien nicht erfüllt sind.

## Konsequenzen

- Die Vorschau kann parallel zur stabilen v2.5.1 auf 8001 verglichen werden.
- Das Theme kann jederzeit verworfen werden, ohne die Produktion zu berühren.
- Ein späterer Merge würde eine bewusste Design-Entscheidung und ggf. eine ADR-Ablösung erfordern.
- Die funktionalen Kerne (ADR-0001/0015/0022) bleiben Leitplanken; das visuelle System darf sie nicht
  brechen.

## Alternativen

- **Direkt auf `main`:** verworfen; Designexperimente würden Release und Betrieb vermischen.
- **Nur Farbtokens ändern:** verworfen; gewünscht ist ein sichtbar anderes System, keine Politur.
- **Kompletter Neubau der Views:** verworfen; zu riskant für den Test, die vorhandene Struktur trägt die
  Feld-Workflows bereits.
# ADR-0019: Normalisierter Katalog statt Freitext

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

v1 speicherte Kamera, Objektiv und Film als Freitext. Dadurch gab es Tippfehler, keine verlässliche
Sortierung, keine Objektiv-Kamera-Zuordnung und keine sauberen Statistiken. Filmlog v2 soll Vorschläge
und Auswertungen auf Basis stabiler Stammdaten machen.

## Entscheidung

- Eigene Tabellen für **Kameras, Objektive, Filmstocks, Belichtungszeiten und Blenden**.
- **Kameras ↔ Objektive** über die m:n-Tabelle `camera_lenses`; nur passende Objektive werden bei einer
  Aufnahme vorgeschlagen, das zuletzt genutzte ist vorausgewählt.
- **Filmstocks** tragen Name, Hersteller, ISO, Typ (`sw|farbe|dia|anderes`), Format und
  Standardkapazität. **Kameras** tragen Format, Standardkapazität und Notizen.
- **Belichtungszeiten/Blenden** sind Katalogwerte mit Label und Sortierwert (ADR-0006).
- Einträge werden **archiviert statt gelöscht**, wenn sie nicht mehr genutzt werden; archivierte
  Einträge bleiben für alte Aufnahmen und Vorschläge lesbar.
- Aufnahmen referenzieren die Entitäten per ID und behalten zusätzlich den Label-Text, damit ein später
  gelöschter/archivierter Katalogwert die Anzeige nicht zerstört.
- Nutzungshäufigkeit/zuletzt genutzt fließt in die Sortierung der Auswahllisten ein.

## Konsequenzen

- Vorschläge, Statistiken und Filter arbeiten mit stabilen IDs, nicht mit Schreibweisen.
- Der Katalog muss gepflegt werden (Auswahllisten-Seite); unbekannte v1-Werte werden beim Import angelegt.
- Löschen ist restriktiver als Archivieren; referenzierte Einträge bleiben erhalten.
- Das Datenmodell ist größer als v1, dafür sind Auswertungen und Vorbelegung verlässlich.

## Alternativen

- **Freitext wie v1:** verworfen; Tippfehler und keine sinnvolle Auswertung.
- **Nur ein globales „Equipment“-Feld:** verworfen; Objektiv-Kamera-Zuordnung und Statistiken wären weg.
- **Harte Löschung nicht genutzter Einträge:** verworfen; alte Aufnahmen würden ihre Referenz verlieren.
# ADR-0012: Import aus Filmlog v1

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die Daten aus Filmlog v1 liegen in `db.yaml` und `optionen.yaml`. Der Umstieg muss ohne Datenverlust und
ohne doppelte Filme möglich sein; ein zweiter Import darf nichts kaputt machen.

## Entscheidung

- **Wege:** CLI `filmlog import-v1 <db.yaml> [optionen.yaml] [--dry-run]` und Upload in der UI
  (Einstellungen → Import) mit Probelauf und anschließender Bestätigung.
- **Reihenfolge:** zuerst `optionen.yaml` (Kameras, Objektive, Filmstocks, Belichtungszeiten, Blenden),
  dann `db.yaml` (Filme mit Positionen und Feldern).
- **Nummern:** Die v1-Filmnummer bleibt erhalten; `next_film_number` wird übernommen und die
  Nummernvergabe setzt fort.
- **Mapping:** Freitextwerte werden auf Entitäten gemappt; unbekannte Werte werden angelegt.
  ISO/Typ/Format werden heuristisch aus dem Filmnamen erkannt; Objektiv-Kamera-Zuordnungen aus der
  Historie abgeleitet.
- **Idempotenz:** Vorhandene Filmnummern werden übersprungen; ein erneuter Import erzeugt keine Duplikate.
- **Transaktion:** Der Import läuft in einer Transaktion; bei `--dry-run` wird zurückgerollt. Am Ende
  gibt es einen Bericht mit Anzahlen und Warnungen (z. B. normalisierte Werte, fehlende Filmtypen).
- **Tests:** Eine anonymisierte echte `db.yaml` dient als Fixture.

## Konsequenzen

- Der Umstieg ist wiederholbar und bricht bei einem Fehler nichts halb Fertiges hinter.
- Unbekannte v1-Werte können den Katalog erweitern; das ist gewollt, kann aber aufgeräumt werden müssen.
- Der Probelauf ist der Standardweg in der UI; der echte Import wird erst danach bestätigt.
- Heuristiken sind bewusst best-effort; der Bericht macht Unsicherheiten sichtbar.

## Alternativen

- **Einmaliger Ad-hoc-Import:** verworfen; nicht wiederholbar, kein Probelauf.
- **v1-Dateien dauerhaft weiterlesen:** verworfen; das langsame YAML-Modell soll enden.
- **Nummern neu vergeben:** verworfen; die Nummer ist die sichtbare Filmidentität.
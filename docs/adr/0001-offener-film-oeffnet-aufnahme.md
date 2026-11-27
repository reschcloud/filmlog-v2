# ADR-0001: Ein Tap auf einen offenen Film öffnet die Aufnahme

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Filmlog wird im Feld vor allem benutzt, um direkt nach dem Auslösen eine Aufnahme zu protokollieren.
Der häufigste Weg ist: App öffnen, aktiven Film antippen, Motiv eintragen, speichern. Die Detailseite
ist wichtig für Filmangaben, Statuswechsel und Korrekturen, aber sie ist nicht der nächste Schritt beim
Fotografieren.

Vorher öffnete ein Tap auf eine aktive Filmkarte die Detailseite; von dort führte ein zweiter Tap in die
Aufnahme. Das kostet im Feld Zeit, unterbricht den Rhythmus und macht den Kernprozess unnötig lang.

## Entscheidung

- Primäre Darstellungen eines offenen Films führen per Tap direkt zu `#neue-aufnahme/{nummer}`:
  - aktive Filmkarten auf der Startseite,
  - Zeilen der Filmliste mit Status `offen`.
- Die Detailseite bleibt über eine separate, sichtbare Sekundäraktion **„Details“** auf derselben Karte
  bzw. Zeile erreichbar. Sie ist mindestens 44 px hoch und klar beschriftet.
- Nicht offene Filme (`abgeschlossen`, `entwickelt`, `gescannt`, `archiviert`) öffnen beim Tap weiterhin
  die Detailseite; dort gibt es keine neue Aufnahme.
- Suchtreffer, die „Zuletzt“-Liste und Hinweise bleiben Detail-/Lookup-Ziele. Sie sind nicht die primäre
  Oberfläche für einen offenen Film.
- Keine versteckten Gesten (Long-Press, Doppeltipp) als Ersatz für „Details“.

## Konsequenzen

- Der Kernprozess braucht genau einen Tap; die Filmkarte und „Weiter“ führen zum selben Ziel.
- Karten und offene Zeilen haben zwei Ziele: Fläche = Aufnahme, „Details“ = Detail. Das ist bewusst
  und muss bei jeder UI-Änderung erhalten bleiben.
- Die Detailseite ist nicht mehr der Standardpfad für offene Filme. Statusaktionen bleiben in der
  Filmliste und auf der Detailseite verfügbar.
- QA/Tests prüfen die Routen: offene Karte/Zeile → `#neue-aufnahme/{n}`, „Details“ → `#film/{n}`,
  nicht offene Zeile → `#film/{n}`.

## Alternativen

- **Karte → Detail (bisher):** verworfen, weil zwei Taps bis zur Aufnahme und ein zusätzlicher
  Orientierungsschritt nötig sind.
- **Long-Press/Doppeltipp für Details:** verworfen, im Feld nicht entdeckbar und mit Handschuhen unzuverlässig.
- **Globaler Aufnahme-Button mit Filmauswahl:** bleibt für Sonderfälle (z. B. kein aktiver Film), ist aber
  für den häufigsten Fall ein zusätzlicher Schritt.
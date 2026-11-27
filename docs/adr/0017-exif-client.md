# ADR-0017: ExifTool-Client als eigenständiger API-Nutzer

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Nach dem Scannen sollen Aufnahmedaten (Film, Kamera, Objektiv, Datum, Ort) in die Bilddateien geschrieben
werden. Das passiert auf einem Rechner mit ExifTool, nicht im Browser und nicht im Container.

## Entscheidung

- Der Client liegt eigenständig unter `client/` (`filmlog_exif_writer.py`, README, Requirements) und
  nutzt die öffentliche API `/api/v2` mit `Authorization: Bearer flt_…`.
- API-Tokens werden in der App unter Einstellungen erzeugt und können dort widerrufen werden; nur der
  Hash wird gespeichert.
- Der Client hat eine lokale Konfigurationsdatei für URL und Token; `verify_ssl` ist standardmäßig
  **true** und nur für lokale Tests abschaltbar.
- Der Client wird in der App als ZIP (`/client/download`) verteilt; ExifTool selbst ist Voraussetzung
  auf dem Zielrechner.
- Der Client ist kein Teil des Frontend-Bundles und wird nicht im Container ausgeführt.

## Konsequenzen

- Der Client kann unabhängig vom Browser und ohne Cookie-Login laufen.
- Ein Token-Leak ist begrenzt widerrufbar; das Token liegt im Klartext in der Client-Konfiguration.
- Änderungen am API-Vertrag betreffen den Client; `docs/API.md` und `client/README.md` müssen mit.
- Die ZIP-Auslieferung ist einfach, aber kein signiertes Installationspaket.

## Alternativen

- **EXIF-Schreiben im Backend:** verworfen; ExifTool müsste im Container laufen und die Bilddateien
  hochgeladen werden.
- **Browser-Upload mit EXIF-Bibliothek:** verworfen; unzuverlässig für alle Formate und langsam.
- **Cookie-Auth im Client:** verworfen; ein CLI kann den Browser-Login-Flow nicht sinnvoll nutzen.
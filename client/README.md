# Filmlog → ExifTool

Interaktives Kommandozeilen-Skript (kein GUI nötig, läuft unter Windows,
macOS und Linux): liest einen abgeschlossenen Film aus
[Filmlog](../filmlog) und schreibt die Daten jeder einzelnen Aufnahme per
[ExifTool](https://exiftool.org) individuell in die passende gescannte
Bilddatei. Praktisches Gegenstück zu
[`metadata_writer`](https://github.com/reschcloud/metadata_writer), nur
eben mit pro Bild unterschiedlichen Werten statt einheitlicher Metadaten
für den ganzen Ordner.

## Voraussetzungen

1. **Python 3** (3.8 oder neuer reicht).
2. **`requests`-Paket:**
   ```bash
   pip install -r requirements.txt
   ```
3. **ExifTool** — von [exiftool.org](https://exiftool.org) laden. Unter
   Windows `exiftool(-k).exe` in `exiftool.exe` umbenennen. Muss im `PATH`
   erreichbar sein (`exiftool -ver` sollte in einem normalen Terminal
   funktionieren) — sonst `EXIFTOOL_PATH` oben im Skript auf den vollen
   Pfad setzen.
4. **Filmlog-Server (v2) erreichbar** und ein **API-Token**: in Filmlog unter
   *Einstellungen → API-Tokens* anlegen. Das Zertifikat wird geprüft; nur bei
   einem selbstsignierten Zertifikat in der Config `"verify_ssl": false` setzen.

## Ausführen

```bash
python3 filmlog_exif_writer.py
```

(unter Windows: `python filmlog_exif_writer.py`)

## Ablauf

1. Beim ersten Start nach der Filmlog-Server-URL (z. B.
   `https://filmlog.example.org`) und dem API-Token fragen — beides wird in
   `filmlog-exif-writer.config.json` neben dem Skript gespeichert. Ist das
   Token ungültig/widerrufen, wird es beim nächsten Start neu abgefragt.
2. Lädt alle **entwickelten bzw. gescannten, nicht archivierten** Filme und
   zeigt sie zur Auswahl.
3. Zeigt alle Aufnahmen des gewählten Films zur Kontrolle (Motiv, Datum,
   Uhrzeit, Objektiv) — Abbruch möglich, falls das nicht passt.
4. Fragt nach dem Ordner mit den gescannten Bildern (`.tif`, `.tiff`,
   `.jpg`, `.jpeg`, `.png`, alphabetisch sortiert).
5. Vergleicht die Anzahl der Filmlog-Einträge mit der Anzahl gefundener
   Bilddateien — bei Abweichung eine Warnung mit der Möglichkeit,
   trotzdem fortzufahren oder abzubrechen.
6. Zeigt die geplante Zuordnung **Dateiname → Motiv** zur letzten
   Kontrolle.
7. Erst nach ausdrücklicher Bestätigung: schreibt die Metadaten Datei für
   Datei mit `-overwrite_original` (keine `*_original`-Backups).
8. Protokolliert jede geschriebene Datei in `filmlog-exif-log.txt` im
   Zielordner.
9. Markiert den Film auf Wunsch als **gescannt** oder **archiviert**.

## Geschriebene EXIF-Tags

| Filmlog-Feld                      | EXIF-Tag                                                             |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Kamera                             | `Make`                                                                |
| Filmname                           | `Model` (EXIF hat kein eigenes Filmstock-Feld)                        |
| ISO (Film bzw. Push/Pull)          | `ISO`                                                                 |
| Objektiv                           | `LensModel`                                                           |
| Motivbeschreibung                  | `ImageDescription`, `XPTitle`                                         |
| Brennweite (aus Objektiv-Stammdaten) | `FocalLength`                                                       |
| Belichtungszeit                    | `ExposureTime`                                                        |
| Blende                             | `FNumber`                                                             |
| Blitz verwendet                    | `Flash` (nur gesetzt, wenn verwendet — sonst kein Tag)                |
| Datum + Uhrzeit                    | `DateTimeOriginal`, `CreateDate`                                       |
| GPS-Koordinaten (falls vorhanden)  | `GPSLatitude`/`GPSLatitudeRef`, `GPSLongitude`/`GPSLongitudeRef`       |

Leere/fehlende Felder werden übersprungen, nicht mit Platzhaltern befüllt.

## Bekannte Grenzen

- Die Zuordnung erfolgt rein über die **alphabetische Reihenfolge** der
  Dateinamen gegen die Reihenfolge der Aufnahmen in Filmlog — passt nur,
  wenn eure Scan-Dateien fortlaufend benannt sind (z. B. `001.tif`,
  `002.tif`, …) und in derselben Reihenfolge aufgenommen wurden. Es findet
  kein inhaltlicher Bildabgleich statt.
- Nutzt die Endpunkte `/api/v2/rolls`, `/api/v2/rolls/<nummer>`,
  `/api/v2/catalog` und `/api/v2/rolls/<nummer>/status` (siehe `docs/API.md`).

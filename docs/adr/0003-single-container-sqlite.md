# ADR-0003: Eine Instanz, eine SQLite-Datei, Backups als Datei

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die App ist ein persönliches Werkzeug. Ein Datenbank-Server, Replikation oder horizontale Skalierung
wären zusätzlicher Betrieb ohne Nutzen. Gleichzeitig müssen Daten und Migrationen verlässlich sein.

## Entscheidung

- Es läuft **genau eine** Filmlog-Instanz mit einer SQLite-Datei unter `FILMLOG_DATA_DIR`
  (Standard `/data/filmlog.db`).
- SQLite läuft mit `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`
  und `check_same_thread=False`.
- Schemaänderungen laufen über Alembic und werden beim App-Start automatisch angewendet.
- Backups erfolgen über die CLI/API mit `VACUUM INTO` (konsistente Kopie) oder durch Kopieren des
  Datenverzeichnisses bei gestopptem Container.
- Das Datenverzeichnis ist ein Docker-Volume; die App schreibt nur dort und in temporäre Uploads.

## Konsequenzen

- Backup und Umzug sind einfache Dateioperationen; kein DB-Dump nötig.
- Keine horizontale Skalierung und keine zwei Container auf derselben Datei. Für Single-User bewusst.
- Eine beschädigte oder migrierte Datei lässt sich nur über ein Backup zurückrollen; Migrationen sind
  vorwärtsgerichtet (siehe ADR-0007).
- WAL erzeugt `-wal`/`-shm`-Dateien; beim Kopieren im laufenden Betrieb ist `VACUUM INTO` vorzuziehen.

## Alternativen

- **DB-Server:** verworfen, zu viel Betrieb für einen Benutzer.
- **Nur `safe_dump`/YAML wie v1:** verworfen, langsam und ohne Transaktionen/Indizes.
- **Zwei App-Instanzen auf einer SQLite-Datei:** verworfen; SQLite ist dafür nicht ausgelegt.
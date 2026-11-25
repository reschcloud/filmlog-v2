# Filmlog v2

Webapp zur Dokumentation analoger Filme und ihrer Aufnahmen – mobil im Browser, als PWA installierbar,
auch offline nutzbar. Läuft als **ein Docker-Container** mit SQLite-Datei (kein eigener DB-Container).

Neu gegenüber v1: schnell auch bei vielen Tausend Aufnahmen, Login, Belichtungszeiten/Blenden sinnvoll sortiert
und normalisiert, Vorschläge (Objektiv pro Kamera, Kapazität, Motive, Orte in der Nähe), Statusmodell
offen → abgeschlossen → entwickelt → gescannt → archiviert, Volltextsuche, erweiterte Statistik mit Karte,
Offline-Warteschlange, YAML-Import aus v1, JSON-Export und SQLite-Backup.

## Schnellstart

```bash
cp .env.example .env              # Benutzername/Passwort eintragen
docker compose pull               # fertiges Image (amd64/arm64) von ghcr.io
docker compose up -d
```

Für eigene Änderungen am Code stattdessen `docker compose up -d --build` (baut lokal, auch auf einem Pi).

Die App läuft dann auf `http://127.0.0.1:8001` und gehört hinter einen Reverse-Proxy mit TLS
(GPS im Browser und der Service Worker brauchen HTTPS). Beispiel **Caddy**:

```
filmlog.example.org {
    reverse_proxy 127.0.0.1:8001
}
```

Nur im LAN ohne HTTPS: in `.env` `FILMLOG_SECURE_COOKIES=false` setzen, sonst funktioniert der Login nicht.

Die Daten liegen in `./data/filmlog.db` (SQLite, WAL-Modus). Datenbank-Migrationen laufen beim Start automatisch.

## Daten aus v1 übernehmen

Entweder in der App unter **Einstellungen → Import** (`db.yaml` + `optionen.yaml` hochladen, erst Probelauf,
dann importieren) oder per Kommandozeile:

```bash
cp /pfad/zu/v1/data/*.yaml ./data/
docker compose exec filmlog filmlog import-v1 /data/db.yaml /data/optionen.yaml --dry-run
docker compose exec filmlog filmlog import-v1 /data/db.yaml /data/optionen.yaml
```

Filmnummern bleiben erhalten, die Nummernvergabe setzt bei `next_film_number` fort. Belichtungszeiten und Blenden
werden normalisiert (`1/125s` → `1/125`, `5,6` → `f/5.6`), ISO/Typ/Format der Filme aus dem Namen erkannt,
passende Objektive je Kamera aus der Historie abgeleitet. Ein erneuter Import überspringt vorhandene Filme.

## Verwaltung

```bash
docker compose exec filmlog filmlog set-user admin          # Benutzer/Passwort setzen (beendet alle Sitzungen)
docker compose exec filmlog filmlog backup /data/backup.sqlite
docker compose logs -f filmlog
```

Backup geht auch in der App (Einstellungen → Backup) oder einfach durch Kopieren von `./data` bei gestopptem Container.

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `FILMLOG_ADMIN_USER` / `FILMLOG_ADMIN_PASSWORD` | – | Erster Benutzer, nur wenn noch keiner existiert |
| `FILMLOG_SECURE_COOKIES` | `true` | Session-Cookie nur über HTTPS |
| `FILMLOG_SESSION_DAYS` | `90` | Dauer „Angemeldet bleiben“ |
| `FILMLOG_SESSION_HOURS_SHORT` | `12` | Dauer ohne „Angemeldet bleiben“ |
| `FORWARDED_ALLOW_IPS` | private Netze | Proxys, deren `X-Forwarded-For` vertraut wird (für das Login-Rate-Limit) |
| `PUID` / `PGID` | `1000` | Benutzer/Gruppe, als die die App läuft; `./data` wird beim Start auf diese Werte umgestellt |
| `TZ` | `Europe/Berlin` | Zeitzone für Zeitstempel |

## EXIF-Writer

`client/filmlog_exif_writer.py` schreibt die Aufnahmedaten per ExifTool in gescannte Bilder (siehe
`client/README.md`). Er meldet sich mit einem **API-Token** an (Einstellungen → API-Tokens) und ist in der App
unter Einstellungen als ZIP herunterladbar.

## Entwicklung

```
backend/    FastAPI, SQLAlchemy 2, Alembic, pytest      → backend/filmlog/
frontend/   Vite + TypeScript, PWA                       → frontend/README.md
client/     EXIF-Writer
docs/API.md API-Vertrag
```

```bash
# Backend
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'
FILMLOG_DATA_DIR=./devdata FILMLOG_ADMIN_USER=admin FILMLOG_ADMIN_PASSWORD=geheim1234 \
  FILMLOG_SECURE_COOKIES=false uvicorn filmlog.main:app --reload
pytest && ruff check filmlog tests

# Frontend (Dev-Server mit Proxy auf :8000)
cd frontend && npm install && npm run dev
```

Schemaänderungen: Modell in `backend/filmlog/models.py` ändern und eine neue Migration erzeugen und prüfen:

```bash
python -c "from filmlog.migrate import alembic_config as a; from alembic import command; \
command.revision(a(), message='beschreibung', autogenerate=True)"
```

Die GitHub Action testet Backend und Frontend und baut bei Push auf `main` bzw. Tags `v*` ein Multi-Arch-Image
(amd64 + arm64) nach `ghcr.io/reschcloud/filmlog`.

## Herkunft

v2 ist ein Neubau von [filmlog v1](https://github.com/reschcloud/filmlog) (Flask + YAML-Datei, ohne Login).
Die Daten lassen sich übernehmen, siehe oben. Fragen und Fehler zu v1 gehören ins alte Repository.

## Lizenz

GPL-3.0-or-later, siehe `COPYING`. Schriftart TMT Limkin: siehe `frontend/src/fonts/TMT_limkin_license.txt`.

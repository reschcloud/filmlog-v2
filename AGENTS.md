# AGENTS.md

Filmlog v2: Webapp zum Dokumentieren analoger Filme. Ein FastAPI-Backend liefert eine
Vanilla-TS-PWA aus; alles läuft in einem Container mit SQLite (kein DB-Server).
Projektsprache ist **Deutsch** (UI, Fehlermeldungen, Docs, Commits); JSON-Feldnamen der API sind englisch.

## Aufbau

- `backend/filmlog/` – FastAPI-App. Einstieg `main.py::create_app` (Router, SPA-Fallback, Cache-Header).
  `models.py` (SQLAlchemy 2), `services.py` (Serialisierung, Nummernvergabe, Frames einfügen/löschen),
  `units.py` (Parser/Normalisierung für Belichtungszeit, Blende, ISO, Presets), `importer.py` (v1-YAML),
  `auth.py`, `cli.py`, `routers/*`.
- `frontend/` – Vite + TypeScript, Hashes als Router (`#film/42/5`), eine Datei pro Ansicht in `src/views/`.
  Wird im Docker-Build gebaut und vom Backend ausgeliefert.
- `client/` – eigenständiger ExifTool-Client (nutzt `/api/v2` mit Bearer-Token).
- `docs/API.md` – verbindlicher API-Vertrag. Bei API-Änderungen **immer** dort und in
  `frontend/src/types.ts` nachziehen.

## Befehle

```bash
# Backend (aus backend/)
pip install -e '.[dev]'
pytest                                  # alle Tests (~70, laufen gegen tmp-SQLite)
pytest tests/test_api.py -k roll        # einzelner Test(-block)
ruff check filmlog tests                # Lint, Zeilenlänge 120
```

```bash
# Frontend (aus frontend/) – build prüft auch die Typen
npm run build        # tsc --noEmit && vite build
npm run dev          # Dev-Server, Proxy auf localhost:8000
```

Node ist auf diesem Rechner oft nicht installiert; dann per Docker bauen:
`docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:26-alpine sh -c "npm install && npm run build"`.
Python-Abhängigkeiten ggf. ebenso in einem `python:3.12-slim`-Container (venv außerhalb des Repos).

## Tests

- `tests/conftest.py` setzt ENV-Variablen, leert `get_settings()`-Cache und die globalen Engine-Variablen in
  `filmlog.db`; `TestClient(app)` läuft als Kontextmanager, damit der Lifespan (Migrationen + Admin) läuft.
  Neue Fixtures müssen dieses Muster einhalten, sonst leaken Zustand und ENV zwischen Tests.
- Login: `admin` / `geheim1234`. Nach dem Login `X-Filmlog: 1` setzen, sonst 403 (CSRF).
- Migrationen laufen automatisch beim App-Start; Tests brauchen keine separaten Migrationsschritte.

## Datenbank / Migrationen

- SQLite mit WAL unter `FILMLOG_DATA_DIR` (Standard `/data`, Datei `filmlog.db`). Schemaänderung: Modell
  anpassen, dann Migration erzeugen:
  `python -c "from filmlog.migrate import alembic_config as a; from alembic import command; command.revision(a(), message='x', autogenerate=True)"`
- Migrationen laufen nur vorwärts; `rolls.number` wird nie wiederverwendet (`meta.next_roll_number`).
- Der FTS5-Index `frames_fts` samt Triggern steht in `migrations/versions/0001_initial.py` – dort ändern,
  nicht in `models.py` (die `FTS_DDL`-Konstante dort ist ungenutzt).
- `rolls.frame_count`/`last_frame_at` sind denormalisiert und werden in `services.refresh_roll_stats` gepflegt;
  nach Frame-Änderungen immer aufrufen. Frame-Positionen werden in `services.py` nachgerückt (kein UNIQUE,
  SQLite kann Constraints nicht verzögert prüfen).

## Auth / API

- Single-User: ein Datensatz in `users`. Beim Start wird er nur angelegt, wenn noch keiner existiert
  (`FILMLOG_ADMIN_USER`/`_PASSWORD`).
- Zwei Auth-Wege: Session-Cookie `filmlog_session` oder `Authorization: Bearer flt_…` (API-Token).
  **CSRF:** Bei Cookie-Auth brauchen alle Nicht-GET-Requests den Header `X-Filmlog: 1`; Bearer ist ausgenommen.
- Fehler immer als `{"error": "deutsche Meldung"}`; Validierungsfehler fängt ein Handler in `main.py` (422).
- Zeitstempel lokal naiv `YYYY-MM-DDTHH:MM:SS`, Datum `YYYY-MM-DD`, Uhrzeit `HH:MM`.
- Belichtungszeit/Blende werden serverseitig normalisiert (`1/125s`→`1/125`, `5,6`→`f/5.6`) und zusätzlich
  numerisch gespeichert (`shutter_seconds`, `f_number`) – danach wird sortiert, nicht nach dem Label.
- `FILMLOG_SECURE_COOKIES` ist standardmäßig `true`; für HTTP-Entwicklung auf `false` setzen.

## Docker / Betrieb

- Container-Port ist **8001** (uvicorn, Healthcheck, EXPOSE); Compose veröffentlicht nur `127.0.0.1:8001`.
  Der Dev-Server läuft dagegen auf **8000** – dieser Unterschied ist Absicht.
- `docker-entrypoint.sh` startet als root, korrigiert Besitzer von `/data` auf `PUID:PGID` und gibt Rechte ab.
  Deshalb **kein** `USER` im Dockerfile und keine Dateien als root im Datenverzeichnis anlegen.
  `filmlog`-CLI gibt root-Rechte ebenfalls ab.
- `pull_policy: missing` lässt `docker compose up` ohne Netz starten, hat aber eine Falle: `docker compose pull`
  überspringt das Laden, wenn der Tag `:2` lokal schon existiert. Updates daher mit
  `docker compose pull --policy always` (oder `up -d --pull always`). `--build` für lokale Änderungen.
- `setup.sh install|update` bündelt Erstinstallation und Update (Env, Image, Backup mit 7er-Aufbewahrung,
  Healthcheck); `status` zeigt Container, Health und Version. Compose ist optional, das Skript fällt auf
  reines `docker` zurück.
- Reverse-Proxy-Konfiguration (Apache/Caddy) gehört bewusst **nicht** ins Repo.
- v1-Daten: `filmlog import-v1 <db.yaml> [optionen.yaml] [--dry-run]` oder Upload in der UI. Der Import ist
  idempotent (überspringt vorhandene Filmnummern) und rollt bei `--dry-run` zurück.

## Architekturentscheidungen (ADRs)

- Grundlegende Entscheidungen liegen als nummerierte ADRs in `docs/adr/` (deutsch, Index in
  `docs/adr/README.md`). Neue Architektur-, Datenmodell-, Auth-, Offline- oder Field-UI-Grundsatzentscheidungen
  dort ergänzen und im Index verlinken.
- ADRs werden nicht umgeschrieben; eine geänderte Entscheidung bekommt eine neue Nummer mit
  `Ersetzt: ADR-XXXX`.
- **Kernprozess im Feld:** Ein Tap auf einen offenen Film öffnet immer direkt die Aufnahme; die
  Detailseite ist eine separate „Details“-Aktion (ADR-0001). Diese Regel nicht ohne neue ADR ändern.

## Konventionen

- UI-Texte, Fehlermeldungen und Kommentare auf Deutsch; Code-Identifier meist englisch.
- Kein Prettier/ESLint/Formatter im Repo: TypeScript strikt über `tsc --noEmit` (im `build`), Python über `ruff`.
- PWA: `index.html`/`sw.js`/Manifest mit `no-cache`, `/assets/*` immutable (siehe `main.py`). Cache-Regeln
  nicht im Reverse-Proxy überschreiben.
- Offline-Queue liegt in IndexedDB (`frontend/src/lib/queue.ts`); Frames werden mit `client_id` idempotent
  gesendet – beim Ändern von `POST /rolls/{n}/frames` diese Idempotenz erhalten.

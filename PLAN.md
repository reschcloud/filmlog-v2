# Filmlog v2 – Plan

Grundlage: Analyse von `reschcloud/filmlog` (Commit `596f984`): `app.py` (Flask, ~700 Zeilen),
`static/app.js` (Vanilla-JS-SPA, ~1070 Zeilen), `templates/index.html`, `static/style.css`,
`client/filmlog_exif_writer.py` (ExifTool-Client), Daten in `data/db.yaml` + `data/optionen.yaml`.

---

## 1. Warum v1 langsam ist

| Ursache | Wo | Wirkung |
|---|---|---|
| **Jeder Request liest und parst die komplette `db.yaml`** (`load_db()` in jedem Endpoint), mit dem reinen Python-Parser von PyYAML (kein `CSafeLoader`) | alle `/api/*` | Wächst linear mit der Anzahl Aufnahmen. PyYAML ist sehr langsam, bei ein paar tausend Aufnahmen sind das schnell 100–500 ms pro Request |
| **Jede Änderung schreibt die komplette Datei neu** (`save_db()` → `safe_dump`) | alle Schreib-Endpoints | Eine neue Aufnahme bedeutet: alles parsen **und** alles serialisieren |
| **Ein globaler Lock** um Parsen/Schreiben | `_lock` | Alle Requests laufen nacheinander, nichts parallel |
| **Startseite macht 3 Requests nacheinander** (`films?status=offen`, `aufnahmen/recent?limit=1`, `films?status=abgeschlossen`), und jeder parst die ganze DB | `initStart()` | Das 3-Fache der Parse-Zeit, bevor die Seite fertig ist |
| **„Anzahl × speichern“ schickt N POSTs nacheinander** | `initNeueAufnahme` | Bei 5 Aufnahmen 5× parsen und 5× schreiben |
| `/api/aufnahmen/recent` baut **alle** Aufnahmen aller Filme auf, sortiert sie und schneidet erst danach ab | `recent_aufnahmen` | O(n log n) pro Aufruf, nur um einen einzigen Eintrag zu holen |
| `/api/stats` läuft 3× über alle Aufnahmen | `stats` | Teuer, wird aber oft aufgerufen |
| **Flask-Entwicklungsserver mit Python-SSL** im Produktivbetrieb | `app.run(ssl_context=…)` | Langsamer TLS-Handshake, keine Kompression, keine Cache-Header für statische Dateien |
| Keine Cache-Header bzw. keine Versionierung für `app.js`/`style.css`/Fonts | statische Dateien | Auf dem Handy werden sie bei jedem Laden erneut übertragen |

**Fazit:** Der Hauptgrund ist das Datenmodell („die ganze Datenbank ist eine YAML-Datei, die pro Request
gelesen wird“). Mit SQLite plus Indizes kostet jeder Request nur noch Mikro- bis Millisekunden, egal wie viele Daten es gibt.

---

## 2. Zielarchitektur

```
┌──────────────── ein Docker-Container ────────────────┐
│  uvicorn (ASGI)                                      │
│   └─ FastAPI-App                                     │
│       ├─ /api/v2/*        JSON-API (Pydantic)        │
│       ├─ /auth/*          Login/Logout/Session       │
│       ├─ /                gebautes Frontend (static) │
│       └─ SQLAlchemy 2 ──► /data/filmlog.db (SQLite,  │
│                            WAL-Modus)                │
│  Volume: /data  (DB, Backups, Import-Uploads)        │
└──────────────────────────────────────────────────────┘
        ▲ TLS am besten über einen vorhandenen Reverse-Proxy (Caddy/Traefik/nginx),
          alternativ eigene Zertifikate per Volume mounten (wie bisher /etc/ssl)
```

### Stack (Empfehlung)
- **Backend:** Python 3.12, **FastAPI**, **SQLAlchemy 2** + **Alembic** (Migrationen), Pydantic v2,
  uvicorn. Bleibt Python, damit der bestehende Code und der EXIF-Client gut dazu passen.
- **DB:** **SQLite** im WAL-Modus, als Datei im Volume. Kein eigener DB-Container, Backup heißt Datei kopieren
  (zusätzlich ein eingebautes Backup per `VACUUM INTO`).
- **Frontend:** Die bestehende Mobile-UI (Design, Fonts, CSS) bleibt erhalten, wird aber auf
  **Vite + TypeScript** (ES-Module statt einer 1000-Zeilen-IIFE) umgebaut. Optional mit Preact/Svelte,
  falls die Komponentenlogik wächst. Das Frontend wird im Docker-Build gebaut und vom Backend als statische
  Dateien ausgeliefert, mit Hash im Dateinamen und `Cache-Control: immutable`.
- **PWA:** Manifest + Service Worker, die App lässt sich zum Homescreen hinzufügen. **Offline-Warteschlange**
  für neue Aufnahmen (im Feld oft ohne Netz), die bei Verbindung automatisch synchronisiert wird.

### Docker
- Multi-Stage-`Dockerfile`: Stage 1 `node:22-alpine` baut das Frontend, Stage 2 `python:3.12-slim` als Runtime.
  Läuft als Non-Root-User, mit `HEALTHCHECK` auf `/healthz`.
- `docker-compose.yml` mit einem Service, Volume `./data:/data` und Port `8001`.
- Konfiguration per ENV: `FILMLOG_SECRET_KEY`, `FILMLOG_ADMIN_USER`/`FILMLOG_ADMIN_PASSWORD` (nur beim ersten Start),
  `FILMLOG_BASE_URL`, `FILMLOG_TLS_CERT`/`FILMLOG_TLS_KEY` (optional), `TZ`.
- Beim Container-Start werden die Alembic-Migrationen automatisch ausgeführt.
- Optional: GitHub-Action, die das Image nach `ghcr.io/reschcloud/filmlog` baut (amd64 + arm64 für den Pi).

---

## 3. Datenmodell (normalisiert)

v1 speichert alles als Freitext-Strings (`"1/125"`, `"f/5.6"`, Kameraname, Filmname). In v2 werden Stammdaten
eigene Entitäten und Messwerte bekommen **numerische Werte**. Das ist die Grundlage für Sortierung und „Intelligenz“.

```
users            id, username, password_hash (argon2), created_at   (genau ein Eintrag)
api_tokens       id, user_id, name, token_hash, last_used_at        (für EXIF-Client)
sessions         id, user_id, expires_at, user_agent                 (oder signierte Cookies)

cameras          id, name, format (35mm|120|4x5|instant|…), mount, default_capacity,
                 notes, archived
lenses           id, name, focal_length_mm, max_aperture, mount, archived
camera_lenses    camera_id, lens_id                 (welche Objektive passen an welche Kamera)
film_stocks      id, name, manufacturer, iso, type (sw|farbe|dia|anderes), format,
                 default_capacity, archived
shutter_speeds   id, label ("1/125"), seconds (0.008), sort_key       ← sinnvoll sortiert
apertures        id, label ("f/5.6"), f_number (5.6)                  ← sinnvoll sortiert

rolls            id, number (fortlaufend, eindeutig – „#42“), film_stock_id, camera_id,
                 expiry_year, capacity, iso_override (Push/Pull), status (offen|abgeschlossen),
                 developed_at, archived_at, created_at, completed_at, notes
frames           id, roll_id, position, date, time, location_text, lat, lon,
                 lens_id, shutter_label, shutter_seconds, aperture_label, f_number,
                 flash, motif, recorded_at, created_at, updated_at
                 INDEX(roll_id, position), INDEX(recorded_at)
```

- Frame-Werte werden zusätzlich als Text gespeichert (`shutter_label`), damit nichts verloren geht, wenn ein
  Preset später gelöscht wird (dasselbe Problem löst v1 mit dem Workaround in `befuelleForm`).
- `position` bleibt explizit, damit Einfügen und Löschen mit Nachrücken (wie in v1) als eine Transaktion laufen.
- Statt über Listen-Indizes (`/aufnahmen/<index>`) laufen die API-Pfade über stabile IDs. Kein Risiko mehr, dass
  zwei Handys gleichzeitig die falsche Aufnahme bearbeiten.
- **Single-User:** Die Daten hängen an keinem Benutzer, `users` enthält nur den einen Account.

---

## 4. „Intelligenter“: Features

### Sortierung & Normalisierung
- **Belichtungszeiten** werden in Sekunden geparst (`1/8000` … `1/2`, `1"`, `2s`, `0.5`, `B`, `T`) und **physikalisch
  sortiert** (kurz → lang, `B`/`T` ans Ende). Eingaben werden normalisiert (`125` → `1/125`, `1/125s` → `1/125`,
  `2"` → `2s`), Duplikate werden erkannt.
- **Blenden** werden numerisch sortiert (`f/1.4 < f/2 < f/2.8 …`). Akzeptiert werden `5.6`, `5,6`, `f5.6`, `F/5.6`.
- **Kameras/Objektive/Filme**: sortiert nach **Nutzungshäufigkeit/zuletzt genutzt**, alphabetisch als Fallback.
  Selten genutzte Einträge lassen sich archivieren statt löschen.
- Vorgefertigte Sets (volle, halbe und Drittelstufen), die man mit einem Klick übernimmt.

### Smarte Vorbelegung
- **Objektiv pro Kamera:** Bei einer neuen Aufnahme stehen nur die Objektive zur Auswahl, die zur Kamera passen,
  das zuletzt an dieser Kamera genutzte ist vorausgewählt.
- **Kapazität automatisch** aus Filmformat und Kamera (35mm → 36, 120 mit 6×6 → 12, 6×9 → 8, Spinner → 5/8 …),
  überschreibbar.
- **Filmtyp und ISO automatisch** aus dem Filmstock (v1 fragt den Typ bei jedem Film neu ab). Die ISO wird beim
  Import aus dem Namen erkannt („Tri-X **400**“).
- Belichtungszeit und Blende werden **pro Film** aus der letzten Aufnahme übernommen (wie v1).
- **Motiv-Autovervollständigung** aus den bisherigen Motiven.
- **Ort:** GPS wie bisher, dazu Vorschläge aus Orten in der Nähe, die schon einmal verwendet wurden (ohne externen Dienst).

### Workflow
- Mehrfach-Aufnahme („Anzahl“) läuft als **ein** Request (`POST /frames` mit `count`).
- Ein Film wird automatisch als „voll“ markiert, und es gibt den Hinweis, ihn abzuschließen.
- Statusmodell: `geladen → abgeschlossen → entwickelt → gescannt → archiviert`, jeweils mit Datum
  (v1 hat dafür nur Flags).
- Hinweise im Dashboard: „3 Filme warten auf Entwicklung“, „Film #41 seit 60 Tagen in Kamera“, „abgelaufen seit 5 Jahren“.
- Volltextsuche über Motiv, Ort, Film und Kamera (SQLite FTS5).
- Erweiterte Stats: Belichtungsverteilung, Lieblingsblende pro Objektiv, Filme pro Monat, Karte der Aufnahmeorte.
- Export als CSV (Excel-kompatibel wie v1), **JSON/YAML-Vollexport** und Backup-Download der SQLite-Datei.

---

## 5. Authentifizierung

- **Login mit Benutzername und Passwort**, Hash mit **argon2id** (`argon2-cffi`), Rate-Limit und kurze Sperre bei
  Fehlversuchen.
- Sitzung über ein **HttpOnly-, Secure- und SameSite=Lax-Cookie** (serverseitige Session-Tabelle, „Angemeldet
  bleiben“ 90 Tage, damit man am Handy nicht ständig neu einloggen muss). CSRF-Schutz über SameSite plus
  Custom-Header bei Schreib-Requests.
- **Erster Admin** wird beim Start aus ENV angelegt oder per `docker compose exec filmlog filmlog create-user`.
- **API-Tokens** (Bearer) für den EXIF-Writer-Client, in der UI erstell- und widerrufbar. Der Client wird
  entsprechend angepasst (Token in die Config, `VERIFY_SSL` wieder auf `True` als Default).
- Optional später: Passkeys (WebAuthn) oder ein Header-Login hinter einem Reverse-Proxy (Authelia/Authentik).

---

## 6. YAML-Import

- CLI: `filmlog import-v1 /data/import/db.yaml /data/import/optionen.yaml [--dry-run]`
- Zusätzlich in der UI (Admin → Import): beide Dateien hochladen, Vorschau anzeigen, bestätigen.
- Ablauf:
  1. `optionen.yaml` → Kameras, Objektive, Filmstocks, Belichtungszeiten, Blenden (normalisiert und dedupliziert,
     ISO/Typ/Format heuristisch aus dem Namen).
  2. `db.yaml` → Rolls mit **identischer Filmnummer**, `next_film_number` wird übernommen. Freitext-Werte werden auf
     Entitäten gemappt, unbekannte automatisch angelegt.
  3. Frames in Listenreihenfolge (`position`), alle Felder inkl. Altfeld `brennweite`, `blitz`, `aufgenommen_am`.
  4. Status-Mapping: `status/entwickelt/archiviert` → neues Statusmodell inkl. Datum.
- **Idempotent** (erneuter Import erzeugt keine Duplikate) und in **einer Transaktion**, am Ende gibt es einen
  Bericht (Anzahl, Warnungen wie „Belichtungszeit ‚1/125s‘ normalisiert“, „Filmtyp fehlt bei #12“).
- Tests mit einer anonymisierten Kopie deiner echten `db.yaml` als Fixture.

---

## 7. API (v2, Auszug)

```
POST   /auth/login | /auth/logout      GET /auth/me
GET    /api/v2/dashboard               ← ersetzt die 3 Start-Requests: offene Filme, letzte Aufnahme, Zähler
GET    /api/v2/rolls?status=&sort=     POST /api/v2/rolls      GET|PATCH|DELETE /api/v2/rolls/{id}
POST   /api/v2/rolls/{id}/transition   {to: abgeschlossen|entwickelt|archiviert|offen}
GET    /api/v2/rolls/{id}/frames       POST (mit position/count)   PATCH|DELETE /api/v2/frames/{id}
GET    /api/v2/frames/recent?cursor=   ← Cursor-Pagination statt limit+1
GET    /api/v2/suggestions?roll_id=    ← Vorbelegung (Objektiv, Zeit, Blende, Motiv-Vorschläge)
CRUD   /api/v2/cameras | lenses | film-stocks | shutter-speeds | apertures
GET    /api/v2/stats?range=30|365|all
GET    /api/v2/rolls/{id}/export.csv   GET /api/v2/export.json   GET /api/v2/backup.sqlite
POST   /api/v2/import/v1
GET    /api/films, /api/films/{n}, POST /api/films/{n}/archivieren   ← schmale v1-Kompatibilität für den alten Client
```

---

## 8. Projektstruktur

```
filmlog-v2/
├── backend/
│   ├── filmlog/
│   │   ├── main.py            FastAPI-App, Static-Serving, Middleware
│   │   ├── config.py          Settings aus ENV
│   │   ├── db.py              Engine, Session, SQLite-Pragmas (WAL, foreign_keys)
│   │   ├── models.py          SQLAlchemy-Modelle
│   │   ├── schemas.py         Pydantic
│   │   ├── auth.py            Passwort, Sessions, Tokens, Dependencies
│   │   ├── units.py           Parser/Normalisierer für Belichtungszeit, Blende, Brennweite, ISO
│   │   ├── suggestions.py     Vorbelegung und Plausibilität
│   │   ├── routers/           auth, rolls, frames, catalog, stats, export, import_v1
│   │   ├── importer/v1_yaml.py
│   │   └── cli.py             create-user, import-v1, backup
│   ├── migrations/            Alembic
│   ├── tests/                 pytest (units, importer, API)
│   └── pyproject.toml
├── frontend/                  Vite + TS, übernommenes CSS und Fonts, PWA
├── client/                    EXIF-Writer, auf Token und API v2 umgestellt
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 9. Umsetzung in Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0** | Repo-Gerüst, Dockerfile, Compose, CI (Lint und Tests) | `docker compose up` liefert eine Hello-World-Seite |
| **1** | Modelle, Migrationen, `units.py` mit umfangreichen Tests | Sortierung und Normalisierung stehen |
| **2** | **YAML-Importer** + CLI, Test mit echten Daten | Deine Daten sind in SQLite |
| **3** | Auth (Login, Sessions, Admin per ENV, Tokens) | Alles hinter Login |
| **4** | API v2 (Rolls, Frames, Katalog, Dashboard, Stats, Export) | Funktionsgleich mit v1 |
| **5** | Frontend-Port (gleiches Design, ein Request pro Ansicht) | Nutzbar am Handy |
| **6** | „Intelligenz“: Vorbelegung, Objektiv↔Kamera, Auto-Kapazität, Hinweise, Suche | Mehrwert gegenüber v1 |
| **7** | PWA + Offline-Queue, erweiterte Stats + Karte, Volltextsuche | Komfort |
| **8** | EXIF-Client anpassen, README, Migrationsanleitung v1 → v2 | Release v2.0 |

Phasen 0–5 ergeben ein funktionsgleiches, schnelles v2 im Docker-Container mit Login. Phasen 6–8 sind Ausbau.

### Einsatz von Subagenten / Modellen
- **Starkes Modell (Opus):** Datenmodell, Auth, Importer, Architektur-Reviews.
- **Günstigeres, schnelles Modell (z. B. Sonnet/Haiku):** parallel und klar abgegrenzt: Test-Fixtures für `units.py`,
  CSS/HTML-Port des Frontends, CRUD-Router für Katalog-Entitäten, README/Doku, EXIF-Client-Anpassung.
- Jede Teilaufgabe mit klarer Schnittstelle (Pydantic-Schemas zuerst festlegen), danach Review durch das starke Modell.

---

## 10. Entscheidungen (festgelegt)

| Thema | Entscheidung | Konsequenz |
|---|---|---|
| Benutzer | **Single-User** | Keine `user_id` an Daten; ein Account (aus ENV/CLI), dazu API-Tokens für den EXIF-Client |
| Frontend | **Vanilla TypeScript + Vite** | v1-Design/CSS bleibt erhalten, Code wird in Module pro Ansicht aufgeteilt |
| TLS | **Hinter Reverse-Proxy** | Container spricht HTTP auf `:8001`, `--proxy-headers`/`FORWARDED_ALLOW_IPS`, Secure-Cookie per ENV |
| Extras in v2.0 | **PWA + Offline-Queue, erweiterte Stats + Karte, Volltextsuche** | Reverse-Geocoding entfällt vorerst; für die Karte Leaflet + OSM-Tiles (lädt nur in der Stats-Ansicht) |
| Plattform | **amd64 + arm64** | Multi-Arch-Build per `docker buildx` / GitHub Action nach GHCR |

Die Phasen 0–8 bleiben, Phase 7 umfasst PWA/Offline, Stats-Karte und FTS5-Suche (ohne Reverse-Geocoding).

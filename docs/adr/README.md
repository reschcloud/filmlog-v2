# Architekturentscheidungen (ADRs)

Hier liegen die grundlegenden, langlebigen Entscheidungen für Filmlog v2. Sie sind bewusst kurz:
Kontext, Entscheidung, Konsequenzen, verworfene Alternativen. Der Code und `AGENTS.md` sind die
Umsetzung; bei Widersprüchen gilt die neuere ADR.

## Regeln

- Neue grundlegende Entscheidungen (Architektur, Datenmodell, Auth, Offline, API-Vertrag, Field-UI)
  werden als nummerierte ADR ergänzt und hier verlinkt.
- Bestehende ADRs werden nicht inhaltlich umgeschrieben. Eine geänderte Entscheidung bekommt eine neue
  Nummer und im Kopf den Hinweis `Ersetzt: ADR-XXXX`.
- Status: `Accepted` (gilt), `Superseded` (durch neuere ADR ersetzt), `Deprecated` (nicht mehr gültig).
- Sprache ist Deutsch; Dateinamen bleiben ASCII.

## Index

| ADR | Entscheidung | Status |
|---|---|---|
| [0001](0001-offener-film-oeffnet-aufnahme.md) | Ein Tap auf einen offenen Film öffnet direkt die Aufnahme; Details sind eine Sekundäraktion. | Accepted |
| [0002](0002-systemarchitektur.md) | FastAPI + SQLAlchemy 2 + SQLite/WAL und Vanilla TypeScript + Vite in einem Container. | Accepted |
| [0003](0003-single-container-sqlite.md) | Eine Instanz, eine SQLite-Datei im Volume, Backup als Datei/`VACUUM INTO`. | Accepted |
| [0004](0004-auth-single-user.md) | Single-User-Auth: Argon2, Session-Cookie, Bearer-Tokens, CSRF-Header. | Accepted |
| [0005](0005-api-und-sprache.md) | Deutscher Vertrag nach außen, englische JSON-Felder, `docs/API.md` + `types.ts` als Quelle. | Accepted |
| [0006](0006-messwerte-normalisierung.md) | Belichtungszeit/Blende als Label plus numerischer Wert, serverseitig normalisiert. | Accepted |
| [0007](0007-datenintegritaet.md) | Filmnummern nie wiederverwenden, Migrationen nur vorwärts, Positionen in `services.py` pflegen. | Accepted |
| [0008](0008-volltextsuche-fts5.md) | Volltextsuche über SQLite FTS5, Index und Trigger in Migration 0001. | Accepted |
| [0009](0009-offline-und-datenverlust.md) | Offline-Aufnahmen über IndexedDB-Queue mit `client_id`; Entwürfe und Fehler-Queue verhindern Verlust. | Accepted |
| [0010](0010-pwa-cache-und-update.md) | Gehashte Assets immutable, `index.html`/Service Worker ohne Cache, API immer NetworkOnly. | Accepted |
| [0011](0011-deployment-und-rechte.md) | Port 8001 hinter externem TLS-Proxy; Container startet root, App läuft als PUID:PGID. | Accepted |
| [0012](0012-v1-import.md) | v1-YAML-Import idempotent, in einer Transaktion, mit Probelauf und Bericht. | Accepted |
| [0013](0013-statusmodell.md) | Linearer Filmstatus mit Datumsfeldern; Rückschritte löschen spätere Daten; Archiv ist lesbar. | Accepted |
| [0014](0014-hash-routing.md) | Hash-Routing (`#film/42/5`) ohne Server-Routen; Deep-Links und Zurück-Button bleiben einfach. | Accepted |
| [0015](0015-feld-ui-und-navigation.md) | Field-first-UI: untere Navigation, Aufnahme-Modus, 44-px-Ziele, Details einklappen, Minimalismus. | Accepted |
| [0016](0016-suche-paginierung.md) | Suche mit Offsets/Limits und `*_has_more`; Frontend lädt explizit nach. | Accepted |
| [0017](0017-exif-client.md) | ExifTool-Client ist eigenständig, nutzt `/api/v2` mit Bearer-Token und wird als ZIP verteilt. | Accepted |
| [0018](0018-tests-und-qualitaet.md) | Tests gegen temporäre SQLite, Backend `pytest`/`ruff`, Frontend `tsc`/`vite`, CI für beides. | Accepted |
| [0019](0019-normalisierter-katalog.md) | Kameras, Objektive, Filmstocks, Zeiten und Blenden sind normalisierte Katalog-Entitäten; Archiv statt Löschen. | Accepted |
| [0020](0020-frontend-daten-cache.md) | Nur Katalog/Dashboard/Vorschläge werden gecacht; Listen, Details, Suche und Stats bleiben live. | Accepted |
| [0021](0021-navigation-ohne-aufnahme-eintrag.md) | Untere Navigation ohne generischen „Aufnahme“-Eintrag; Aufnahme startet filmbezogen. | Accepted |
| [0022](0022-field-typografie-und-zurueck.md) | Mindestgrößen für Feldtexte und ein deutlich sichtbarer Zurück-Button. | Accepted |

## Vorlage

```md
# ADR-XXXX: Titel

- **Status:** Accepted
- **Datum:** YYYY-MM-DD

## Kontext

Warum standen wir vor einer Entscheidung?

## Entscheidung

Was gilt jetzt, konkret und überprüfbar?

## Konsequenzen

Was wird dadurch leichter, was teurer oder ausgeschlossen?

## Alternativen

Was wurde bewusst verworfen und warum?
```
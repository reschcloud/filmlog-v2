# ADR-0002: Systemarchitektur und Stack

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

v1 las und schrieb bei jedem Request die komplette `db.yaml` und war dadurch bei vielen Aufnahmen langsam.
Filmlog v2 soll auf einem Handy im Feld, auf einem Raspberry Pi und im Heimnetz laufen. Es gibt genau
einen Benutzer und keine Notwendigkeit für einen eigenen Datenbank-Server.

## Entscheidung

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, uvicorn.
- **Datenbank:** SQLite im WAL-Modus als Datei im Volume. Kein PostgreSQL/MySQL-Container.
- **Frontend:** Vanilla TypeScript mit Vite, kein SPA-Framework. Eine Datei pro Ansicht unter
  `frontend/src/views/`, zentrale Gestaltung in `frontend/src/style.css`.
- **Auslieferung:** Das Frontend wird im Docker-Build gebaut und vom FastAPI-Backend als statische
  Dateien ausgeliefert; API und App laufen unter derselben Origin.
- **Betrieb:** Ein Container, ein Prozess (uvicorn), ein Daten-Volume. Multi-Arch-Images für amd64/arm64.
- **PWA:** Manifest und Service Worker über `vite-plugin-pwa`; Offline-Queue für Aufnahmen im Frontend.

## Konsequenzen

- Kein DB-Server, keine Netzwerk-DB, keine zweite Instanz: Backup ist eine Datei, Betrieb bleibt klein.
- SQLite begrenzt parallele Schreiber; das ist für Single-User und einen Prozess ausreichend.
- Das Frontend braucht einen Build-Schritt; TypeScript wird über `tsc --noEmit` geprüft.
- Ohne Framework gibt es wenig Magie, aber auch keine Framework-Upgrades; gemeinsame Logik liegt in
  `frontend/src/lib/`.
- API und Frontend müssen bei Änderungen gemeinsam gepflegt werden (`docs/API.md`, `types.ts`).

## Alternativen

- **Flask + YAML wie v1:** verworfen wegen des linearen Lese-/Schreibaufwands pro Request.
- **PostgreSQL:** verworfen; zusätzlicher Dienst, Backups und Betrieb für einen Single-User zu teuer.
- **React/Svelte:** verworfen; die UI ist klein, das v1-Design ließ sich mit Vanilla TS und Modulen
  direkt übernehmen.
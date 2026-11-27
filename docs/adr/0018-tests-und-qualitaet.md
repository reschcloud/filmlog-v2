# ADR-0018: Tests, Linting und Qualitätssicherung

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die App soll ohne großen Werkzeug-Stack verlässlich bleiben. Backend und Frontend haben unterschiedliche
Laufzeiten und Prüfmechanismen; die CI baut zusätzlich das Multi-Arch-Image und erstellt Releases.

## Entscheidung

- **Backend:** `pytest` gegen eine temporäre SQLite-Datei; `tests/conftest.py` setzt ENV, leert den
  `get_settings()`-Cache und die globalen Engine-Variablen, startet `TestClient(app)` als
  Kontextmanager (Lifespan mit Migrationen + Admin). Neue Fixtures müssen dieses Muster einhalten.
- **Lint:** `ruff check filmlog tests`, Zeilenlänge 120. Kein separates Formatting-Tool.
- **Frontend:** `npm run build` führt `tsc --noEmit` und `vite build` aus; das ist die Typprüfung.
  Es gibt derzeit keinen JS-Unit-Test-Runner; UI-Verhalten wird über Build, Typen und manuelle
  Gerätetests geprüft.
- **Migrations:** Werden beim App-Start automatisch ausgeführt; Tests brauchen keine separaten
  Migrationsschritte. Schemaänderungen werden mit Alembic autogeneriert und geprüft.
- **CI:** GitHub Actions testet Backend und Frontend, baut bei Push auf `main`/`v*` ein Multi-Arch-Image
  und erstellt bei `v*`-Tags automatisch ein Release. Versionen stehen in
  `backend/filmlog/__init__.py`, `backend/pyproject.toml`, `frontend/package.json` und
  `frontend/package-lock.json`.
- **Sprache:** Testnamen und Fehlermeldungen dürfen deutsch sein; Code-Identifier bleiben englisch.

## Konsequenzen

- Backend-Änderungen werden durch echte API-Tests abgesichert; Frontend-Änderungen mindestens durch
  Typen und Build.
- Ohne Frontend-Unit-Tests bleiben reine UI-Routen und DOM-Zustände manuell zu prüfen; das ist eine
  bewusste Lücke, kein Versehen.
- Ein Release erfordert alle vier Versionsstellen; CI und Image hängen am Tag.
- Die Test-Isolation über ENV/Engine ist Pflicht; sonst leaken Zustand und Datenbank zwischen Tests.

## Alternativen

- **Playwright-E2E im Repo:** derzeit nicht gepflegt; würde für Feld-Workflows sinnvoll sein, ist aber
  zusätzlicher Wartungsaufwand.
- **ESLint/Prettier:** verworfen; TypeScript-Strict und `vite` reichen für die kleine Codebasis.
- **Postgres-Testcontainer:** verworfen; die App nutzt SQLite, Tests sollen dieselbe Engine nutzen.
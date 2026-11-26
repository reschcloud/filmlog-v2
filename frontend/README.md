# Filmlog v2 – Frontend

Vite + Vanilla TypeScript (strict), PWA mit Offline-Queue. UI-Sprache Deutsch.
API-Vertrag: `../docs/API.md`.

## Entwickeln

Node ist lokal nicht nötig, alles läuft über Docker:

```sh
# Abhängigkeiten installieren + bauen (Ausgabe: dist/)
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:26-alpine \
  sh -c "npm install && npm run build"

# Dev-Server (Port 5173, Proxy für /api, /auth, /healthz, /client -> localhost:8000)
docker run --rm -it --network host -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:26-alpine \
  sh -c "npm install && npm run dev -- --host"
```

Mit lokalem Node: `npm install`, `npm run dev`, `npm run build`.

## Aufbau

- `src/main.ts` – Hash-Router (`#start`, `#film/42/5`, …), Header-Badges, Sync-Trigger
- `src/api.ts` – fetch-Wrapper (Cookie, `X-Filmlog: 1`, 401 → Login, `{error}`)
- `src/types.ts` – Typen nach API.md
- `src/views/*.ts` – eine Datei pro Ansicht
- `src/lib/*` – escapeHtml, Datum, Offline-Queue (IndexedDB), Cache (localStorage), DOM-Helfer
- `public/` – Icons (SVG + PNG)

## Auslieferung

`dist/` statisch ausliefern. `index.html`, `sw.js` und `manifest.webmanifest` mit
`Cache-Control: no-cache`, `assets/*` mit `immutable`. Alle unbekannten Pfade außer
`/api`, `/auth`, `/client`, `/healthz` auf `index.html` zurückfallen lassen.

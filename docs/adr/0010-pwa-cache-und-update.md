# ADR-0010: PWA-Caching und Update-Verhalten

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die App wird als PWA auf dem Homescreen installiert und muss im Feld schnell starten, darf aber nach
einem Deployment keine veralteten API- oder HTML-Stände ausliefern. API-Antworten dürfen nicht in den
Service-Worker-Cache geraten.

## Entscheidung

- **Build:** `vite-plugin-pwa` mit `registerType: "autoUpdate"`, `clientsClaim: true`, `skipWaiting: true`;
  gehashte JS/CSS/Fonts/Bilder werden precached, `cleanupOutdatedCaches` ist aktiv.
- **Navigation:** Fallback auf `index.html`; `/api/`, `/auth/`, `/client/`, `/healthz` sind ausgenommen
  und laufen `NetworkOnly`.
- **Backend-Cache-Header:**
  - `/assets/*` (gehasht): `public, max-age=31536000, immutable`
  - `sw.js`, `registerSW.js`, `manifest.webmanifest`, `workbox-*`: `no-cache`
  - `index.html`: `no-cache`
  - sonstige statische Dateien: `public, max-age=3600`
- **Proxy:** Diese Regeln gehören nicht in den Reverse-Proxy und dürfen dort nicht überschrieben werden.
- **HTTPS:** Service Worker und GPS funktionieren nur über HTTPS (oder localhost).
- **Update:** Ein neuer Service Worker kann die App nach dem Aktivieren neu laden; ungespeicherte
  Formulare sind durch Entwürfe geschützt (ADR-0009).

## Konsequenzen

- Die App startet nach dem ersten Laden aus dem Cache, auch ohne Netz.
- API-Daten werden nie vom Service Worker gecacht; Offline-Daten kommen aus der Queue bzw. dem lokalen
  Zustand.
- Ein Update kann einen Reload auslösen; das ist bewusst, damit keine alten Assets weiterlaufen.
- Cache-Header sind Teil des API-/Static-Vertrags und werden in `main.py` gepflegt.

## Alternativen

- **`prompt`-Update:** verworfen; im Feld will man keine Update-Dialoge.
- **API-Antworten cachen:** verworfen; veraltete Filme/Aufnahmen wären schlimmer als ein Netzfehler.
- **Cache-Regeln im Proxy:** verworfen; die App soll unabhängig vom Proxy korrekt ausliefern.
# ADR-0014: Hash-Routing im Frontend

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Die App wird als statisches Frontend vom Backend ausgeliefert und als PWA installiert. Es gibt keinen
eigenen Frontend-Server mit Rewrite-Regeln; Deep-Links sollen trotzdem funktionieren.

## Entscheidung

- Routen liegen im **URL-Hash**: `#start`, `#neue-aufnahme`, `#neue-aufnahme/{nummer}`, `#filme`,
  `#film/{nummer}`, `#film/{nummer}/{position}` (öffnet die Bearbeitung), `#zuletzt`, `#suche`, `#stats`,
  `#optionen`, `#mehr`, `#einstellungen`.
- Es gibt keinen Server-Router für diese Pfade. Das Backend liefert für unbekannte Pfade `index.html`
  (SPA-Fallback), solange sie nicht mit `/api/`, `/auth/`, `/client/` oder `/healthz` beginnen.
- `frontend/src/lib/nav.ts` kapselt `currentRoute`, `navigate` und `setRerender`; `main.ts` rendert die
  passende View und scrollt bei jedem Routenwechsel nach oben.
- Der Zurück-Button im Header nutzt die Browser-History; auf der Startseite ist er ausgeblendet.
- Ein Hash-Wechsel auf dieselbe Route rendert die View neu (z. B. erneut laden).

## Konsequenzen

- Deep-Links funktionieren ohne Proxy-Rewrites und ohne Server-Konfiguration.
- Die URL enthält `#`, ist also nicht „pretty“, aber stabil und teilbar.
- Kein Server-Side-Rendering; jede Ansicht lädt ihre Daten über die API.
- Neue Views brauchen einen Eintrag in `routes` und eine Route im Hash-Vokabular.

## Alternativen

- **History-API mit Server-Rewrite:** verworfen; mehr Proxy-Konfiguration, kein Mehrwert für die PWA.
- **Ein einziger Screen ohne Routen:** verworfen; Deep-Links und Zurück-Navigation wären verloren.
- **Dateibasiertes Routing:** verworfen; Hash-Routing ist für die statische Auslieferung am einfachsten.
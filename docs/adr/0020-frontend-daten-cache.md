# ADR-0020: Frontend-Cache nur für lesende Stammdaten

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Im Feld soll die App auch bei wackligem Netz schnell starten. Gleichzeitig dürfen veraltete Filme,
Aufnahmen oder Statistiken nicht als aktuell erscheinen. Ein pauschaler API-Cache wäre gefährlich.

## Entscheidung

- `frontend/src/lib/cache.ts` cached nur **lesende Stammdaten** in `localStorage`:
  Katalog, Dashboard und Frame-Vorschläge.
- `fetchCached` liefert `{ data, stale }`: Bei Netzwerkfehler wird der letzte Stand verwendet und die
  Ansicht zeigt einen sichtbaren Offline-Hinweis. Bei Erfolg wird der Cache aktualisiert.
- **Nicht gecacht** werden: Filmlisten, Filmdetails, Suche, Stats, Rohdaten-Exports. Sie kommen live aus
  der API; für Aufnahmen gilt die Offline-Queue (ADR-0009).
- Der Cache wird beim Import und beim Logout geleert (`cacheClear`); Stats haben bewusst keinen
  Zehn-Minuten-Cache mehr.
- Ein Request mit vorhandenem Cache bekommt ein kürzeres Timeout (8 s), damit der Offline-Fallback
  schneller greift; ohne Cache gilt das Standard-Timeout (20 s).

## Konsequenzen

- Die App startet mit bekannten Stammdaten und zeigt ehrlich „offline – letzter Stand“.
- Verwaltungsdaten (Filme, Status, Suche, Stats) sind offline nicht lesbar; das ist eine bekannte Grenze
  und ein möglicher späterer Ausbau.
- Der Cache liegt im Browser und kann veralten; `stale` und Löschzeitpunkt machen das sichtbar.
- Neue gecachte Endpunkte müssen bewusst gewählt werden; nicht einfach `fetchCached` überall einsetzen.

## Alternativen

- **Service-Worker-Cache für API:** verworfen; schwer zu invalidieren und zeigt veraltete Daten.
- **Alles cachen:** verworfen; Status und Aufnahmen würden nach Änderungen falsch aussehen.
- **Gar kein Cache:** verworfen; die App wäre bei kurzen Netzaussetzern sofort leer.
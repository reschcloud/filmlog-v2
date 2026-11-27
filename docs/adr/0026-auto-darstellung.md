# ADR-0026: Auto-Darstellung folgt der Systemeinstellung

- **Status:** Accepted
- **Datum:** 2026-11-27
- **Ersetzt teilweise:** ADR-0025

## Kontext

Nach dem Light Mode gab es nur die expliziten Optionen Dunkel und Hell. Nutzer wollen aber oft, dass die
App tagsüber hell und abends dunkel ist, ohne die Einstellung manuell zu wechseln.

## Entscheidung

- Die Darstellung hat drei Optionen: **Auto, Dunkel, Hell**. Die Wahl steht in Einstellungen →
  Darstellung.
- **Auto ist der Standard**, wenn noch keine Wahl gespeichert ist. Es folgt
  `prefers-color-scheme` und reagiert **live** auf Systemwechsel.
- Gespeichert wird die Präferenz (`auto|dark|light`) unter `filmlog.theme`. Das aufgelöste Theme steht
  als `data-theme` am `<html>` (für CSS und `color-scheme`), die Präferenz zusätzlich als
  `data-theme-pref`.
- Explizites Dunkel/Hell überschreibt das System und bleibt gespeichert; ein Wechsel zurück auf Auto
  aktiviert die Systemkopplung wieder.
- `meta[name="theme-color"]` wird auf das aufgelöste Theme gesetzt.

## Konsequenzen

- Bestehende gespeicherte Dunkel-/Hell-Wahlen bleiben unverändert; neue Nutzer folgen dem System.
- Der Theme-Wechsel kann durch das System ausgelöst werden; Komponenten müssen beide Paletten tragen.
- Es bleibt eine lokale Geräteeinstellung, keine Kontoeinstellung.
- Tests prüfen Auto mit heller und dunkler Systempräferenz, den Live-Wechsel und die Persistenz.

## Alternativen

- **Nur System, ohne Auswahl:** verworfen; Nutzer wollen bewusst Dunkel oder Hell erzwingen können.
- **Auto nur beim ersten Start:** verworfen; dann wäre „Auto“ keine echte Option.
- **Serverseitige Einstellung:** verworfen; die Darstellung gehört zum Gerät.
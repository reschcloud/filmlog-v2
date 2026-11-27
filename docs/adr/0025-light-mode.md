# ADR-0025: Light Mode als gespeicherte Darstellung

- **Status:** Accepted
- **Datum:** 2026-11-27
- **Betrifft:** ADR-0015, ADR-0023

## Kontext

Das Rams-×-Tesla-Design ist dunkel. Im Feld kann bei hellem Umgebungslicht eine helle Oberfläche besser
lesbar sein; gleichzeitig soll die bestehende dunkle Identität der Standard bleiben. Die Wahl muss ohne
Konto und ohne Reload funktionieren.

## Entscheidung

- Zwei Themes: **Dunkel (Standard)** und **Hell**; Umschalter in Einstellungen → Darstellung.
- Das Theme steht als `data-theme="dark|light"` am `<html>`; die Wahl wird in `localStorage`
  (`filmlog.theme`) gespeichert. Ohne gespeicherte Wahl bleibt es dunkel.
- Der Wechsel wirkt sofort über CSS-Variablen und einen Light-Override-Block; kein Neuladen, kein
  separater Build, keine Route.
- `applyTheme` aktualisiert zusätzlich `meta[name="theme-color"]` und `color-scheme` (native
  Formulare/Scrollbars).
- Die Light-Palette nutzt warme Cream-Flächen, weiße Karten, dunklen Text und denselben Braun-Orange-
  Akzent; offene Filme bleiben auch im Light Mode orange.
- Die Wahl gilt pro Gerät/Browser; es gibt keine serverseitige Einstellung.

## Konsequenzen

- Jede neue Komponente muss in beiden Themes geprüft werden.
- Der Dark Mode bleibt der erste Eindruck; Light ist eine bewusste Opt-in-Wahl.
- Der PWA-Splash/Manifest bleibt dunkel; nur Browser-Chrome und App-Oberfläche wechseln.
- Tests prüfen Theme-Wechsel, Persistenz, `color-scheme` und die wichtigsten Screens in beiden Modi.

## Alternativen

- **Nur Systempräferenz:** verworfen; der Nutzer will die Wahl im Feld selbst treffen.
- **Zweites Stylesheet/Build:** verworfen; dupliziert Regeln und erhöht die Wartung.
- **CSS-Invert-Filter:** verworfen; Farben, Bilder und Kontraste werden unkontrollierbar.
# ADR-0009: Offline-Aufnahmen und Schutz vor Datenverlust

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Im Feld ist das Netz oft weg. Aufnahmen dürfen nicht verloren gehen, wenn die App in den Hintergrund
geht, das Netz abbricht oder der Server einen Eintrag ablehnt. Gleichzeitig sollen keine doppelten
Aufnahmen entstehen.

## Entscheidung

- **Offline-Queue:** Neue Aufnahmen werden bei fehlendem Netz in IndexedDB (`filmlog/queue`) gespeichert.
  Jede Aufnahme trägt eine `client_id` (UUID); `POST /api/v2/rolls/{n}/frames` ist dadurch idempotent.
- **Senden:** Die Queue wird sequenziell gesendet, möglichst unter `navigator.locks` (ein Flush pro Tab),
  mit Timeout pro Eintrag. Ein 409 gilt als Duplikat und wird entfernt.
- **Fehler:** 4xx-Antworten (außer 401/408/429) werden **nicht gelöscht**, sondern in einen sichtbaren
  `failed`-Store verschoben. Unter „Mehr“ können sie erneut gesendet oder bewusst verworfen werden.
  Netzwerk-/5xx-Fehler bleiben in der Queue.
- **Anzeige:** Das Queue-Badge zählt Aufnahmen (inkl. `count`), nicht Queue-Einträge. Ein roter Zähler an
  „Mehr“ zeigt nicht gesendete Aufnahmen. Im Filmdetail erscheinen ausstehende Aufnahmen als
  „Wird gesendet“ mit Verwerfen.
- **Entwürfe:** Aufnahme- und Bearbeitungsformulare speichern ungespeicherte Eingaben bis zu 12 Stunden in
  `localStorage` und stellen sie beim nächsten Öffnen wieder her.
- **Timeouts:** API-Requests haben standardmäßig 20 Sekunden; Importe dürfen länger dauern.
- **Grenze:** Offline werden nur **Aufnahmen** gepuffert. Katalog, Suche, Filmstatus und Anlegen neuer
  Filme brauchen weiterhin Netz (bewusste Grenze, siehe „Alternativen“).

## Konsequenzen

- Der Kernprozess „Aufnahme eintragen“ funktioniert ohne Netz und ohne Datenverlust.
- Durch `client_id` sind Retries sicher; die Queue kann nach einem Abbruch erneut senden.
- Abgelehnte Einträge bleiben sichtbar und benötigen eine Entscheidung; sie verschwinden nicht still.
- Entwürfe können nach einem Abbruch veraltet wirken; sie laufen nach 12 Stunden aus.
- Offline-Lesen von Filmen/Status ist noch nicht abgedeckt und bleibt ein späterer Ausbau.

## Alternativen

- **Nur Online speichern:** verworfen; im Feld unbrauchbar.
- **Queue ohne Idempotenz:** verworfen; Retries erzeugen Duplikate.
- **4xx verwerfen:** verworfen; stiller Datenverlust ist der schlimmste Fehler einer Feld-App.
- **Alles offline (Katalog, Status, Filme anlegen):** für später vorgesehen, aber deutlich größer
  (provisorische Nummern, Reconciliation, Konfliktbehandlung).
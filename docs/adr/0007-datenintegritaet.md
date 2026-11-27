# ADR-0007: Filmnummern, Migrationen und Frame-Positionen

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Filmnummern sind im analogen Workflow sichtbare Identitäten („#42“) und dürfen nicht plötzlich für einen
anderen Film auftauchen. SQLite kann Constraints nicht verzögert prüfen, und Aufnahmen werden mitten in
einem Film eingefügt oder gelöscht.

## Entscheidung

- **Filmnummern** kommen aus `meta.next_roll_number`, zusätzlich abgesichert durch `max(rolls.number)+1`.
  Eine Nummer wird **nie wiederverwendet**, auch nicht nach dem Löschen eines Films.
- **Migrationen** laufen beim App-Start automatisch (Alembic). Sie sind **nur vorwärts** gedacht; ein
  Rollback auf eine ältere App-Version erfordert das Backup von vor dem Update.
- **Frame-Positionen** sind explizit, aber ohne `UNIQUE`-Constraint. Einfügen und Löschen rücken die
  folgenden Positionen in `backend/filmlog/services.py` in derselben Transaktion nach.
- Einfügen in der Mitte übernimmt den Zeitstempel des Vorgängers/Nachfolgers, damit die neue Aufnahme
  nicht fälschlich als „gerade aufgenommen“ unter „Zuletzt“ erscheint.
- **Archivierte Filme** sind nur lesbar; Frame- und Filmänderungen werden serverseitig abgelehnt.
- `rolls.frame_count` und `rolls.last_frame_at` sind denormalisiert und werden nach jeder Frame-Änderung
  über `services.refresh_roll_stats` gepflegt.
- Der FTS5-Index samt Triggern lebt in der Migration `0001_initial.py`, nicht in `models.py`.

## Konsequenzen

- Filmnummern bleiben stabil und sind als Referenz brauchbar.
- Nach jedem Insert/Delete muss `refresh_roll_stats` laufen; sonst driften Listen und Dashboard.
- Positionen sind nur über die Service-Schicht sicher; direkte DB-Manipulation kann Lücken/Duplikate
  erzeugen.
- Ein Downgrade ist kein unterstützter Weg; vor Updates wird ein Backup empfohlen.

## Alternativen

- **Nummern aus `max(number)+1` allein:** verworfen; nach dem Löschen des höchsten Films würde die
  Nummer wiederverwendet.
- **`UNIQUE(roll_id, position)` mit verzögerter Prüfung:** von SQLite nicht unterstützt.
- **Positionslücken akzeptieren:** verworfen; die Anzeige und „Nr. n“ wären verwirrend.
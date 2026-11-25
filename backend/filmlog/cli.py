"""Kommandozeile: `filmlog <befehl>` (im Container: `docker compose exec filmlog filmlog <befehl>`)."""

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

from sqlalchemy import select


def _password(args) -> str:
    if args.password_env:
        pw = os.environ.get(args.password_env, "")
    elif not sys.stdin.isatty():
        pw = sys.stdin.readline().rstrip("\n")
    else:
        pw = getpass.getpass("Passwort: ")
        if pw != getpass.getpass("Passwort wiederholen: "):
            sys.exit("Passwörter stimmen nicht überein.")
    if len(pw) < 8:
        sys.exit("Passwort muss mindestens 8 Zeichen haben.")
    return pw


def cmd_migrate(_args) -> None:
    from .migrate import upgrade

    upgrade()
    print("Datenbank ist auf dem neuesten Stand.")


def cmd_set_user(args) -> None:
    from .auth import hash_password
    from .db import session_factory
    from .migrate import upgrade
    from .models import SessionToken, User

    upgrade()
    with session_factory()() as db:
        users = list(db.scalars(select(User)))
        pw_hash = hash_password(_password(args))
        if users:
            user = users[0]
            user.username = args.username
            user.password_hash = pw_hash
            db.query(SessionToken).delete()
            action = "aktualisiert (alle Sitzungen beendet)"
        else:
            db.add(User(username=args.username, password_hash=pw_hash))
            action = "angelegt"
        db.commit()
    print(f"Benutzer „{args.username}“ {action}.")


def cmd_import_v1(args) -> None:
    from .db import session_factory
    from .importer import ImportError_, import_v1, load_yaml
    from .migrate import upgrade

    upgrade()
    try:
        db_data = load_yaml(Path(args.db).read_bytes(), "db.yaml")
        opt = load_yaml(Path(args.optionen).read_bytes(), "optionen.yaml") if args.optionen else {}
        with session_factory()() as db:
            report = import_v1(db, db_data, opt, dry_run=args.dry_run)
    except (OSError, ImportError_) as e:
        sys.exit(f"Import fehlgeschlagen: {e}")
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    if args.dry_run:
        print("\nProbelauf – es wurde nichts gespeichert. Ohne --dry-run erneut ausführen, um zu importieren.")


def cmd_backup(args) -> None:
    from .db import get_engine

    target = Path(args.target).resolve()
    if target.exists():
        sys.exit(f"{target} existiert bereits.")
    with get_engine().connect() as conn:
        conn.exec_driver_sql("VACUUM INTO ?", (str(target),))
    print(f"Backup geschrieben: {target}")


def _drop_root() -> None:
    """`docker compose exec` laeuft als root: Rechte abgeben, damit DB-Dateien nicht root gehoeren."""
    if hasattr(os, "geteuid") and os.geteuid() == 0 and os.environ.get("PUID"):
        os.setgroups([])
        os.setgid(int(os.environ.get("PGID", os.environ["PUID"])))
        os.setuid(int(os.environ["PUID"]))


def main(argv: list[str] | None = None) -> None:
    _drop_root()
    p = argparse.ArgumentParser(prog="filmlog", description="Filmlog v2 – Verwaltung")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("migrate", help="Datenbank-Migrationen ausführen").set_defaults(func=cmd_migrate)

    u = sub.add_parser("set-user", help="Benutzer anlegen bzw. Name/Passwort setzen (Single-User)")
    u.add_argument("username")
    u.add_argument("--password-env", help="Passwort aus dieser Umgebungsvariable lesen")
    u.set_defaults(func=cmd_set_user)

    i = sub.add_parser("import-v1", help="Daten aus Filmlog v1 (YAML) importieren")
    i.add_argument("db", help="Pfad zu db.yaml")
    i.add_argument("optionen", nargs="?", help="Pfad zu optionen.yaml")
    i.add_argument("--dry-run", action="store_true", help="nur prüfen, nichts speichern")
    i.set_defaults(func=cmd_import_v1)

    b = sub.add_parser("backup", help="Konsistente Kopie der Datenbank schreiben")
    b.add_argument("target")
    b.set_defaults(func=cmd_backup)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()

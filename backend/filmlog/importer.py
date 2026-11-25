"""Import der v1-Daten (data/db.yaml + data/optionen.yaml)."""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime

import yaml
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import services, units
from .models import Aperture, Camera, FilmStock, Frame, Lens, Roll, ShutterSpeed, now

V1_TYPES = {"sw": "sw", "farbe": "farbe", "anderes": "anderes"}


@dataclass
class ImportReport:
    dry_run: bool
    rolls: int = 0
    frames: int = 0
    cameras: int = 0
    lenses: int = 0
    film_stocks: int = 0
    shutter_speeds: int = 0
    apertures: int = 0
    skipped_rolls: int = 0
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return dict(self.__dict__)


class ImportError_(ValueError):
    pass


def load_yaml(text: str | bytes | None, label: str) -> dict:
    if not text:
        return {}
    try:
        data = yaml.load(text, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))
    except yaml.YAMLError as e:
        raise ImportError_(f"{label} ist kein gültiges YAML: {e}") from e
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ImportError_(f"{label} hat ein unerwartetes Format.")
    return data


def _s(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    text = str(v).strip()
    return text or None


def _time(v) -> str | None:
    # YAML 1.1 liest ungequotetes 10:20 als Sexagesimalzahl (620)
    if isinstance(v, int) and not isinstance(v, bool):
        return f"{v // 60:02d}:{v % 60:02d}"
    text = _s(v)
    if text and len(text) >= 5 and text[2] == ":":
        return text[:5]
    return text


def _dt(v) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=None, microsecond=0)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    try:
        return datetime.fromisoformat(str(v).strip()).replace(tzinfo=None, microsecond=0)
    except ValueError:
        return None


def _float(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def _int(v) -> int | None:
    try:
        return int(str(v).strip()[:4]) if v not in (None, "") else None
    except ValueError:
        return None


class _Catalog:
    """Findet oder legt Stammdaten an (Name case-insensitiv) und zaehlt Neuanlagen."""

    def __init__(self, db: Session, report: ImportReport):
        self.db, self.report = db, report
        self.cameras = {c.name.casefold(): c for c in db.scalars(select(Camera))}
        self.lenses = {lens.name.casefold(): lens for lens in db.scalars(select(Lens))}
        self.stocks = {s.name.casefold(): s for s in db.scalars(select(FilmStock))}
        self.shutters = {s.label for s in db.scalars(select(ShutterSpeed))}
        self.apertures = {a.label for a in db.scalars(select(Aperture))}

    def camera(self, name: str) -> Camera:
        key = name.casefold()
        if key not in self.cameras:
            cam = Camera(name=name)
            self.db.add(cam)
            self.cameras[key] = cam
            self.report.cameras += 1
        return self.cameras[key]

    def lens(self, name: str) -> Lens:
        key = name.casefold()
        if key not in self.lenses:
            focal, max_ap = units.guess_lens(name)
            lens = Lens(name=name, focal_length_mm=focal, max_aperture=max_ap)
            self.db.add(lens)
            self.lenses[key] = lens
            self.report.lenses += 1
        return self.lenses[key]

    def stock(self, name: str) -> FilmStock:
        key = name.casefold()
        if key not in self.stocks:
            stock = FilmStock(
                name=name, manufacturer=units.guess_manufacturer(name), iso=units.guess_iso(name),
                type=units.guess_film_type(name), format=units.guess_film_format(name),
            )
            self.db.add(stock)
            self.stocks[key] = stock
            self.report.film_stocks += 1
        return self.stocks[key]

    def shutter(self, raw: str) -> None:
        try:
            label, seconds = units.parse_shutter(raw)
        except units.UnitError:
            self.report.warnings.append(f"Belichtungszeit „{raw}“ nicht erkannt – übersprungen.")
            return
        if label not in self.shutters:
            self.db.add(ShutterSpeed(label=label, seconds=seconds))
            self.shutters.add(label)
            self.report.shutter_speeds += 1

    def aperture(self, raw: str) -> None:
        try:
            label, f = units.parse_aperture(raw)
        except units.UnitError:
            self.report.warnings.append(f"Blende „{raw}“ nicht erkannt – übersprungen.")
            return
        if label not in self.apertures:
            self.db.add(Aperture(label=label, f_number=f))
            self.apertures.add(label)
            self.report.apertures += 1


def import_v1(db: Session, db_data: dict, options: dict | None, dry_run: bool = False) -> ImportReport:
    report = ImportReport(dry_run=dry_run)
    cat = _Catalog(db, report)
    options = options or {}

    for name in options.get("filme") or []:
        if _s(name):
            cat.stock(_s(name))
    for name in options.get("kameras") or []:
        if _s(name):
            cat.camera(_s(name))
    for name in options.get("objektive") or []:
        if _s(name):
            cat.lens(_s(name))
    for raw in options.get("belichtungszeiten") or []:
        if _s(raw):
            cat.shutter(_s(raw))
    for raw in options.get("blenden") or []:
        if _s(raw):
            cat.aperture(_s(raw))
    db.flush()

    films = db_data.get("films") or {}
    if not isinstance(films, dict):
        raise ImportError_("db.yaml: 'films' hat ein unerwartetes Format.")
    existing_numbers = set(db.scalars(select(Roll.number)))
    stock_types: dict[str, Counter] = defaultdict(Counter)
    camera_lenses: dict[int, set] = defaultdict(set)
    camera_formats: dict[int, set] = defaultdict(set)
    normalized_notes: set[str] = set()

    def sorted_items():
        def key(kv):
            try:
                return int(kv[0])
            except (TypeError, ValueError):
                return 10**9
        return sorted(films.items(), key=key)

    for raw_number, film in sorted_items():
        try:
            number = int(raw_number)
        except (TypeError, ValueError):
            report.warnings.append(f"Film mit ungültiger Nummer „{raw_number}“ übersprungen.")
            continue
        if not isinstance(film, dict):
            report.warnings.append(f"Film #{number} hat ein unerwartetes Format – übersprungen.")
            continue
        if number in existing_numbers:
            report.skipped_rolls += 1
            continue

        stock_name = _s(film.get("name")) or "Unbekannter Film"
        camera_name = _s(film.get("kamera")) or "Unbekannte Kamera"
        stock = cat.stock(stock_name)
        camera = cat.camera(camera_name)
        db.flush()

        v1_type = V1_TYPES.get(_s(film.get("filmtyp")) or "")
        if v1_type:
            stock_types[stock.name][v1_type] += 1
        if stock.format:
            camera_formats[camera.id].add(stock.format)

        status = "offen" if film.get("status") == "offen" else "abgeschlossen"
        created = _dt(film.get("angelegt_am")) or now()
        completed = _dt(film.get("abgeschlossen_am"))
        developed = _dt(film.get("entwickelt_am"))
        if status != "offen" and film.get("entwickelt"):
            status = "entwickelt"
            developed = developed or completed or created
        if status != "offen" and film.get("archiviert"):
            status = "archiviert"
        if status != "offen" and completed is None:
            completed = created

        roll = Roll(
            number=number, film_stock_id=stock.id, camera_id=camera.id,
            expiry_year=_int(film.get("ablaufdatum")), capacity=_int(film.get("kapazitaet")),
            status=status, created_at=created,
            completed_at=completed if status != "offen" else None,
            developed_at=developed if status in ("entwickelt", "archiviert") else None,
            archived_at=(developed or completed) if status == "archiviert" else None,
        )
        db.add(roll)
        db.flush()
        report.rolls += 1

        for pos, a in enumerate(film.get("aufnahmen") or [], start=1):
            if not isinstance(a, dict):
                report.warnings.append(f"Film #{number}, Aufnahme {pos}: unerwartetes Format – übersprungen.")
                continue
            f = Frame(roll_id=roll.id, position=pos)
            f.date = _s(a.get("datum"))
            f.time = _time(a.get("uhrzeit"))
            f.location_text = _s(a.get("ort_text"))
            f.lat, f.lon = _float(a.get("ort_lat")), _float(a.get("ort_lon"))
            f.flash = bool(a.get("blitz"))
            f.motif = _s(a.get("motiv"))
            f.focal_length = _s(a.get("brennweite"))

            lens_name = _s(a.get("objektiv"))
            if lens_name:
                lens = cat.lens(lens_name)
                db.flush()
                f.lens_id, f.lens_name = lens.id, lens.name
                camera_lenses[camera.id].add(lens.id)

            raw_shutter = _s(a.get("belichtungszeit"))
            f.shutter, f.shutter_seconds = units.try_parse_shutter(raw_shutter)
            if raw_shutter and f.shutter_seconds is None and f.shutter not in ("B", "T"):
                report.warnings.append(f"Film #{number}, Aufnahme {pos}: Belichtungszeit „{raw_shutter}“ "
                                       "nicht erkannt – als Text übernommen.")
            elif raw_shutter and raw_shutter != f.shutter and raw_shutter not in normalized_notes:
                normalized_notes.add(raw_shutter)
                report.warnings.append(f"Belichtungszeit „{raw_shutter}“ → „{f.shutter}“ normalisiert.")

            raw_ap = _s(a.get("blende"))
            f.aperture, f.f_number = units.try_parse_aperture(raw_ap)
            if raw_ap and f.f_number is None:
                report.warnings.append(f"Film #{number}, Aufnahme {pos}: Blende „{raw_ap}“ nicht erkannt – "
                                       "als Text übernommen.")
            elif raw_ap and raw_ap != f.aperture and raw_ap not in normalized_notes:
                normalized_notes.add(raw_ap)
                report.warnings.append(f"Blende „{raw_ap}“ → „{f.aperture}“ normalisiert.")

            recorded = _dt(a.get("aufgenommen_am"))
            if recorded is None and f.date:
                recorded = _dt(f"{f.date}T{f.time or '00:00'}")
            f.recorded_at = recorded or created
            f.updated_at = f.recorded_at
            db.add(f)
            report.frames += 1

        services.refresh_roll_stats(db, roll)

    # Filmtyp je Filmstock: haeufigster Typ aus den Daten schlaegt die Namens-Heuristik
    for stock in cat.stocks.values():
        counts = stock_types.get(stock.name)
        if counts:
            stock.type = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        elif stock.type is None:
            report.warnings.append(f"Filmtyp für „{stock.name}“ unbekannt – bitte in den Optionen ergänzen.")

    # Passende Objektive je Kamera aus der Historie, Format ableiten wenn eindeutig Kleinbild
    for cam in cat.cameras.values():
        lens_ids = camera_lenses.get(cam.id)
        if lens_ids:
            have = {lens.id for lens in cam.lenses}
            cam.lenses = cam.lenses + [db.get(Lens, i) for i in lens_ids if i not in have]
        if cam.format is None and camera_formats.get(cam.id) == {"35mm"}:
            cam.format = "35mm"

    next_number = _int(db_data.get("next_film_number"))
    highest = db.scalar(select(func.max(Roll.number))) or 0
    services.set_next_roll_number(db, max(next_number or 1, highest + 1))

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report

"""Fachlogik: Serialisierung, Nummernvergabe, Aufnahmen einfuegen/loeschen, Statuswechsel."""

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from . import units
from .models import (
    ROLL_STATUS,
    Aperture,
    Camera,
    FilmStock,
    Frame,
    Lens,
    Meta,
    Roll,
    ShutterSpeed,
    now,
)

STATUS_DATE_FIELD = {
    "abgeschlossen": "completed_at",
    "entwickelt": "developed_at",
    "gescannt": "scanned_at",
    "archiviert": "archived_at",
}
TYPE_LABELS = {"sw": "S/W", "farbe": "Farbe", "dia": "Dia", "anderes": "Anderes"}


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") if dt else None


# ---------- Serialisierung ----------

def camera_dict(c: Camera, usage: dict | None = None) -> dict:
    u = (usage or {}).get(c.id, {})
    return {
        "id": c.id, "name": c.name, "format": c.format, "default_capacity": c.default_capacity,
        "notes": c.notes, "archived": c.archived, "lens_ids": sorted(lens.id for lens in c.lenses),
        "usage_count": u.get("count", 0), "last_used_at": iso(u.get("last")),
    }


def lens_dict(lens: Lens, usage: dict | None = None) -> dict:
    u = (usage or {}).get(lens.id, {})
    return {
        "id": lens.id, "name": lens.name, "focal_length_mm": lens.focal_length_mm,
        "max_aperture": lens.max_aperture, "archived": lens.archived,
        "usage_count": u.get("count", 0), "last_used_at": iso(u.get("last")),
    }


def film_stock_dict(s: FilmStock, usage: dict | None = None) -> dict:
    u = (usage or {}).get(s.id, {})
    return {
        "id": s.id, "name": s.name, "manufacturer": s.manufacturer, "iso": s.iso, "type": s.type,
        "format": s.format, "default_capacity": s.default_capacity, "archived": s.archived,
        "usage_count": u.get("count", 0), "last_used_at": iso(u.get("last")),
    }


def shutter_dict(s: ShutterSpeed) -> dict:
    return {"id": s.id, "label": s.label, "seconds": s.seconds}


def aperture_dict(a: Aperture) -> dict:
    return {"id": a.id, "label": a.label, "f_number": a.f_number}


def roll_dict(r: Roll) -> dict:
    expired = 0
    if r.expiry_year:
        expired = max(0, date.today().year - r.expiry_year)
    return {
        "number": r.number,
        "film_stock": {"id": r.film_stock.id, "name": r.film_stock.name, "type": r.film_stock.type,
                       "iso": r.film_stock.iso},
        "camera": {"id": r.camera.id, "name": r.camera.name},
        "expiry_year": r.expiry_year, "capacity": r.capacity,
        "iso": r.iso_override or r.film_stock.iso, "iso_override": r.iso_override, "notes": r.notes,
        "status": r.status,
        "created_at": iso(r.created_at), "completed_at": iso(r.completed_at),
        "developed_at": iso(r.developed_at), "scanned_at": iso(r.scanned_at), "archived_at": iso(r.archived_at),
        "frame_count": r.frame_count, "last_frame_at": iso(r.last_frame_at),
        "is_full": bool(r.capacity and r.frame_count >= r.capacity),
        "expired_years": expired,
    }


def frame_dict(f: Frame, roll: Roll | None = None, with_roll: bool = False) -> dict:
    roll = roll or f.roll
    d = {
        "id": f.id, "roll_number": roll.number, "position": f.position, "date": f.date, "time": f.time,
        "location_text": f.location_text, "lat": f.lat, "lon": f.lon,
        "lens_id": f.lens_id, "lens_name": f.lens_name,
        "shutter": f.shutter, "shutter_seconds": f.shutter_seconds,
        "aperture": f.aperture, "f_number": f.f_number, "focal_length": f.focal_length,
        "flash": f.flash, "motif": f.motif, "recorded_at": iso(f.recorded_at), "updated_at": iso(f.updated_at),
    }
    if with_roll:
        d["roll"] = {
            "number": roll.number, "camera_name": roll.camera.name, "film_stock_name": roll.film_stock.name,
            "type": roll.film_stock.type, "status": roll.status,
        }
    return d


# ---------- Nutzung (fuer Sortierung "zuletzt genutzt") ----------

def camera_usage(db: Session) -> dict[int, dict]:
    rows = db.execute(
        select(Roll.camera_id, func.sum(Roll.frame_count), func.max(func.coalesce(Roll.last_frame_at, Roll.created_at)))
        .group_by(Roll.camera_id)
    ).all()
    return {cid: {"count": int(n or 0), "last": _dt(last)} for cid, n, last in rows}


def film_stock_usage(db: Session) -> dict[int, dict]:
    rows = db.execute(
        select(Roll.film_stock_id, func.count(Roll.id), func.max(Roll.created_at)).group_by(Roll.film_stock_id)
    ).all()
    return {sid: {"count": int(n), "last": _dt(last)} for sid, n, last in rows}


def lens_usage(db: Session) -> dict[int, dict]:
    rows = db.execute(
        select(Frame.lens_id, func.count(Frame.id), func.max(Frame.recorded_at))
        .where(Frame.lens_id.is_not(None)).group_by(Frame.lens_id)
    ).all()
    return {lid: {"count": int(n), "last": _dt(last)} for lid, n, last in rows}


def _dt(v) -> datetime | None:
    if v is None or isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except ValueError:
        return None


def usage_sorted(items: list, usage: dict) -> list:
    """Archivierte ans Ende; sonst zuletzt genutzt zuerst, ungenutzte alphabetisch dahinter."""
    def key(x):
        last = usage.get(x.id, {}).get("last")
        return (x.archived, last is None, -(last.timestamp()) if last else 0, x.name.casefold())
    return sorted(items, key=key)


def catalog(db: Session) -> dict:
    cu, lu, su = camera_usage(db), lens_usage(db), film_stock_usage(db)
    cameras = usage_sorted(list(db.scalars(select(Camera))), cu)
    lenses = usage_sorted(list(db.scalars(select(Lens))), lu)
    stocks = usage_sorted(list(db.scalars(select(FilmStock))), su)
    shutters = sorted(db.scalars(select(ShutterSpeed)), key=lambda s: units.shutter_sort_key(s.seconds, s.label))
    apertures = sorted(db.scalars(select(Aperture)), key=lambda a: a.f_number)
    return {
        "cameras": [camera_dict(c, cu) for c in cameras],
        "lenses": [lens_dict(lens, lu) for lens in lenses],
        "film_stocks": [film_stock_dict(s, su) for s in stocks],
        "shutter_speeds": [shutter_dict(s) for s in shutters],
        "apertures": [aperture_dict(a) for a in apertures],
    }


# ---------- Filme ----------

def get_roll(db: Session, number: int) -> Roll:
    roll = db.scalar(select(Roll).where(Roll.number == number))
    if roll is None:
        raise HTTPException(404, "Film nicht gefunden.")
    return roll


def next_roll_number(db: Session) -> int:
    meta = db.get(Meta, "next_roll_number")
    highest = db.scalar(select(func.max(Roll.number))) or 0
    number = max(int(meta.value) if meta else 1, highest + 1)
    set_next_roll_number(db, number + 1)
    return number


def set_next_roll_number(db: Session, value: int) -> None:
    meta = db.get(Meta, "next_roll_number")
    if meta is None:
        db.add(Meta(key="next_roll_number", value=str(value)))
    else:
        meta.value = str(max(int(meta.value), value))


def refresh_roll_stats(db: Session, roll: Roll) -> None:
    db.flush()
    count, last = db.execute(
        select(func.count(Frame.id), func.max(Frame.recorded_at)).where(Frame.roll_id == roll.id)
    ).one()
    roll.frame_count = int(count)
    roll.last_frame_at = _dt(last)


def set_status(roll: Roll, status: str) -> None:
    target = ROLL_STATUS.index(status)
    for st, field in STATUS_DATE_FIELD.items():
        idx = ROLL_STATUS.index(st)
        if idx > target:
            setattr(roll, field, None)
        elif idx == target and getattr(roll, field) is None:
            setattr(roll, field, now())
    roll.status = status


# ---------- Aufnahmen ----------

def apply_frame_values(db: Session, frame: Frame, values: dict) -> None:
    """Uebernimmt validierte Felder; normalisiert Belichtung/Blende und uebernimmt den Objektivnamen."""
    for key in ("date", "time", "location_text", "lat", "lon", "motif"):
        if key in values:
            setattr(frame, key, values[key])
    if "flash" in values:
        frame.flash = bool(values["flash"])
    if "lens_id" in values:
        lens_id = values["lens_id"]
        if lens_id is None:
            frame.lens_id, frame.lens_name = None, None
        else:
            lens = db.get(Lens, lens_id)
            if lens is None:
                raise HTTPException(422, "Objektiv nicht gefunden.")
            frame.lens_id, frame.lens_name = lens.id, lens.name
    if "shutter" in values:
        if values["shutter"] is None:
            frame.shutter, frame.shutter_seconds = None, None
        else:
            try:
                frame.shutter, frame.shutter_seconds = units.parse_shutter(values["shutter"])
            except units.UnitError as e:
                raise HTTPException(422, str(e)) from e
    if "aperture" in values:
        if values["aperture"] is None:
            frame.aperture, frame.f_number = None, None
        else:
            try:
                frame.aperture, frame.f_number = units.parse_aperture(values["aperture"])
            except units.UnitError as e:
                raise HTTPException(422, str(e)) from e


def insert_frames(db: Session, roll: Roll, position: int | None, count: int, values: dict,
                  client_id: str | None, recorded_at: datetime | None) -> list[Frame]:
    if roll.status == "archiviert":
        raise HTTPException(400, "Archivierte Filme können nicht bearbeitet werden.")
    if position is None and roll.status != "offen":
        raise HTTPException(400, "Dieser Film ist bereits abgeschlossen.")

    total = db.scalar(select(func.count(Frame.id)).where(Frame.roll_id == roll.id)) or 0
    if position is None:
        position = total + 1
    if position > total + 1:
        raise HTTPException(400, "Ungültige Position.")

    if position <= total:
        db.execute(
            update(Frame).where(Frame.roll_id == roll.id, Frame.position >= position)
            .values(position=Frame.position + count)
        )

    if recorded_at is None:
        if position <= total:
            # Eingeschobene Aufnahme: Zeitstempel vom Vorgaenger/Nachfolger, damit sie nicht als
            # "gerade aufgenommen" unter "Zuletzt" erscheint (wie in v1).
            neighbour = db.scalar(
                select(Frame.recorded_at).where(Frame.roll_id == roll.id, Frame.position.in_([position - 1,
                                                                                            position + count]))
                .order_by(Frame.position)
            )
            recorded_at = neighbour or roll.completed_at or roll.created_at
        else:
            recorded_at = now()
    else:
        recorded_at = recorded_at.replace(tzinfo=None, microsecond=0)

    created = []
    for i in range(count):
        f = Frame(roll_id=roll.id, position=position + i, recorded_at=recorded_at, client_id=client_id)
        apply_frame_values(db, f, values)
        db.add(f)
        created.append(f)
    refresh_roll_stats(db, roll)
    return created


def delete_frame(db: Session, frame: Frame) -> None:
    roll = frame.roll
    if roll.status == "archiviert":
        raise HTTPException(400, "Archivierte Filme können nicht bearbeitet werden.")
    pos = frame.position
    db.delete(frame)
    db.flush()
    db.execute(update(Frame).where(Frame.roll_id == roll.id, Frame.position > pos)
               .values(position=Frame.position - 1))
    refresh_roll_stats(db, roll)

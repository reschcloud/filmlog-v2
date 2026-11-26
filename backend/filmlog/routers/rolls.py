import base64
import csv
import io
import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select, text, tuple_
from sqlalchemy.orm import Session, selectinload

from .. import services
from ..auth import require_user
from ..db import get_db
from ..models import ROLL_STATUS, Camera, FilmStock, Frame, Roll, now
from ..schemas import FrameCreateIn, FrameIn, RollIn, StatusIn

router = APIRouter(prefix="/api/v2", dependencies=[Depends(require_user)])

FULL_AFTER_DAYS = 60
DEVELOP_AFTER_DAYS = 14
MAX_DEVELOP_HINTS = 3


# ---------- Dashboard ----------

@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    open_rolls = list(db.scalars(select(Roll).where(Roll.status == "offen")))
    open_rolls.sort(key=lambda r: r.last_frame_at or r.created_at, reverse=True)

    last = db.scalar(select(Frame).order_by(Frame.recorded_at.desc(), Frame.id.desc()).limit(1))

    to_develop = {"total": 0, "sw": 0, "farbe": 0, "dia": 0, "anderes": 0}
    waiting = list(db.scalars(select(Roll).where(Roll.status == "abgeschlossen")))
    for r in waiting:
        to_develop["total"] += 1
        to_develop[r.film_stock.type if r.film_stock.type in to_develop else "anderes"] += 1

    hints = []
    today = now()
    for r in open_rolls:
        if r.capacity and r.frame_count >= r.capacity:
            hints.append({"kind": "voll", "roll_number": r.number,
                          "text": f"Film #{r.number} ({r.camera.name}) ist voll – abschließen?"})
        else:
            days = (today - r.created_at).days
            if days >= FULL_AFTER_DAYS:
                hints.append({"kind": "lange_in_kamera", "roll_number": r.number,
                              "text": f"Film #{r.number} ist seit {days} Tagen in der {r.camera.name}."})
    overdue = [(r, (today - (r.completed_at or r.created_at)).days)
               for r in sorted(waiting, key=lambda r: r.completed_at or r.created_at)]
    overdue = [(r, days) for r, days in overdue if days >= DEVELOP_AFTER_DAYS]
    if len(overdue) > MAX_DEVELOP_HINTS:
        oldest, days = overdue[0]
        hints.append({"kind": "entwickeln", "roll_number": oldest.number,
                      "text": f"{len(overdue)} Filme warten auf Entwicklung, der älteste (#{oldest.number}) "
                              f"seit {days} Tagen."})
    else:
        for r, days in overdue:
            hints.append({"kind": "entwickeln", "roll_number": r.number,
                          "text": f"Film #{r.number} ({r.film_stock.name}) wartet seit {days} Tagen auf Entwicklung."})

    return {
        "open_rolls": [services.roll_dict(r) for r in open_rolls],
        "last_frame": services.frame_dict(last, with_roll=True) if last else None,
        "to_develop": to_develop,
        "hints": hints,
    }


# ---------- Filme ----------

@router.get("/rolls")
def list_rolls(status: str | None = None, sort: str = "number", db: Session = Depends(get_db)):
    q = select(Roll)
    if status:
        wanted = [s for s in status.split(",") if s in ROLL_STATUS]
        q = q.where(Roll.status.in_(wanted))
    rolls = list(db.scalars(q))
    if sort == "recent":
        rolls.sort(key=lambda r: r.last_frame_at or r.created_at, reverse=True)
    else:
        rolls.sort(key=lambda r: r.number, reverse=True)
    return [services.roll_dict(r) for r in rolls]


def _check_refs(db: Session, data: dict):
    if "film_stock_id" in data and db.get(FilmStock, data["film_stock_id"]) is None:
        raise HTTPException(422, "Film (Filmstock) nicht gefunden.")
    if "camera_id" in data and db.get(Camera, data["camera_id"]) is None:
        raise HTTPException(422, "Kamera nicht gefunden.")


@router.post("/rolls", status_code=201)
def create_roll(data: RollIn, db: Session = Depends(get_db)):
    if not data.film_stock_id or not data.camera_id:
        raise HTTPException(422, "Film und Kamera sind erforderlich.")
    if not data.capacity:
        raise HTTPException(422, "Anzahl Aufnahmen ist erforderlich.")
    values = data.model_dump(exclude_unset=True)
    _check_refs(db, values)
    roll = Roll(number=services.next_roll_number(db), status="offen", created_at=now(), **values)
    db.add(roll)
    db.commit()
    db.refresh(roll)
    return services.roll_dict(roll)


@router.get("/rolls/{number}")
def get_roll(number: int, db: Session = Depends(get_db)):
    roll = services.get_roll(db, number)
    d = services.roll_dict(roll)
    d["frames"] = [services.frame_dict(f, roll) for f in roll.frames]
    return d


@router.patch("/rolls/{number}")
def update_roll(number: int, data: RollIn, db: Session = Depends(get_db)):
    roll = services.get_roll(db, number)
    values = data.model_dump(exclude_unset=True)
    for key in ("film_stock_id", "camera_id"):
        if key in values and values[key] is None:
            del values[key]
    _check_refs(db, values)
    for key, value in values.items():
        setattr(roll, key, value)
    db.commit()
    db.refresh(roll)
    return services.roll_dict(roll)


@router.delete("/rolls/{number}")
def delete_roll(number: int, db: Session = Depends(get_db)):
    roll = services.get_roll(db, number)
    if roll.status == "offen":
        raise HTTPException(400, "Offene Filme können nicht gelöscht werden – bitte zuerst abschließen.")
    db.delete(roll)
    db.commit()
    return {"ok": True}


@router.post("/rolls/{number}/status")
def change_status(number: int, data: StatusIn, db: Session = Depends(get_db)):
    roll = services.get_roll(db, number)
    services.set_status(roll, data.status)
    db.commit()
    return services.roll_dict(roll)


# ---------- Aufnahmen ----------

@router.post("/rolls/{number}/frames", status_code=201)
def create_frames(number: int, data: FrameCreateIn, response: Response, db: Session = Depends(get_db)):
    roll = services.get_roll(db, number)
    if data.client_id:
        existing = list(db.scalars(select(Frame).where(Frame.client_id == data.client_id).order_by(Frame.position)))
        if existing:
            response.status_code = 200
            return [services.frame_dict(f) for f in existing]
    values = data.model_dump(exclude_unset=True, exclude={"position", "count", "client_id", "recorded_at"})
    frames = services.insert_frames(db, roll, data.position, data.count, values, data.client_id, data.recorded_at)
    db.commit()
    return [services.frame_dict(f, roll) for f in frames]


def _get_frame(db: Session, frame_id: int) -> Frame:
    frame = db.get(Frame, frame_id)
    if frame is None:
        raise HTTPException(404, "Aufnahme nicht gefunden.")
    return frame


@router.patch("/frames/{frame_id}")
def update_frame(frame_id: int, data: FrameIn, db: Session = Depends(get_db)):
    frame = _get_frame(db, frame_id)
    if frame.roll.status == "archiviert":
        raise HTTPException(400, "Archivierte Filme können nicht bearbeitet werden.")
    values = data.model_dump(exclude_unset=True, exclude={"lat", "lon"})
    services.apply_frame_values(db, frame, values)
    db.commit()
    return services.frame_dict(frame)


@router.delete("/frames/{frame_id}")
def delete_frame(frame_id: int, db: Session = Depends(get_db)):
    services.delete_frame(db, _get_frame(db, frame_id))
    db.commit()
    return {"ok": True}


def _encode_cursor(f: Frame) -> str:
    return base64.urlsafe_b64encode(json.dumps([f.recorded_at.isoformat(), f.id]).encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        ts, fid = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        return datetime.fromisoformat(ts), int(fid)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, "Ungültiger Cursor.") from e


@router.get("/frames/recent")
def recent_frames(roll: int | None = None, limit: int = Query(25, ge=1, le=200), cursor: str | None = None,
                  db: Session = Depends(get_db)):
    q = select(Frame).options(selectinload(Frame.roll)).order_by(Frame.recorded_at.desc(), Frame.id.desc())
    if roll is not None:
        q = q.where(Frame.roll_id == services.get_roll(db, roll).id)
    if cursor:
        ts, fid = _decode_cursor(cursor)
        q = q.where(tuple_(Frame.recorded_at, Frame.id) < tuple_(ts, fid))
    rows = list(db.scalars(q.limit(limit + 1)))
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": [services.frame_dict(f, with_roll=True) for f in rows],
        "next_cursor": _encode_cursor(rows[-1]) if more and rows else None,
    }


# ---------- CSV-Export (Excel, deutsche Einstellung) ----------

CSV_COLUMNS = (
    "Film-Nr", "Film", "Kamera", "Nr", "Datum", "Uhrzeit", "Ort", "Breitengrad", "Längengrad", "Objektiv",
    "Belichtungszeit", "Blende", "Blitz", "Motiv", "Filmtyp", "ISO", "Ablaufjahr", "Angelegt", "Abgeschlossen",
)


def _csv_text(value) -> str:
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        text = "'" + text
    return text


def _csv_number(value) -> str:
    if value is None:
        return ""
    text = repr(float(value))
    if "e" in text.lower():
        text = f"{float(value):.12f}".rstrip("0").rstrip(".")
    if text.endswith(".0"):
        text = text[:-2]
    return text.replace(".", ",")


def _slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[-\s]+", "-", text) or "film"


@router.get("/rolls/{number}/export.csv")
def export_csv(number: int, db: Session = Depends(get_db)):
    roll = services.get_roll(db, number)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(CSV_COLUMNS)
    typ = services.TYPE_LABELS.get(roll.film_stock.type, "")
    iso = roll.iso_override or roll.film_stock.iso
    for f in roll.frames:
        w.writerow([
            roll.number, _csv_text(roll.film_stock.name), _csv_text(roll.camera.name),
            f.position, f.date or "", f.time or "", _csv_text(f.location_text),
            _csv_number(f.lat), _csv_number(f.lon), _csv_text(f.lens_name), _csv_text(f.shutter),
            _csv_text(f.aperture), "ja" if f.flash else "", _csv_text(f.motif),
            typ, iso or "", roll.expiry_year or "",
            services.iso(roll.created_at)[:10] if roll.created_at else "",
            services.iso(roll.completed_at)[:10] if roll.completed_at else "",
        ])
    filename = f"film_{str(roll.number).zfill(3)}_{_slugify(roll.film_stock.name)}.csv"
    return Response(buf.getvalue().encode("utf-8-sig"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------- Suche ----------

def _fts_query(q: str) -> str | None:
    tokens = re.findall(r"\w+", q, re.UNICODE)
    if not tokens:
        return None
    return " ".join(f'"{t}"*' for t in tokens)


@router.get("/search")
def search(q: str = Query("", max_length=200),
           frame_offset: int = Query(0, ge=0), roll_offset: int = Query(0, ge=0),
           frame_limit: int = Query(50, ge=1, le=100), roll_limit: int = Query(30, ge=1, le=100),
           db: Session = Depends(get_db)):
    q = q.strip()
    if not q:
        return {"frames": [], "rolls": [], "frames_has_more": False, "rolls_has_more": False}

    frames: list[Frame] = []
    frames_has_more = False
    fts = _fts_query(q)
    if fts:
        rows = db.execute(
            text("SELECT rowid FROM frames_fts WHERE frames_fts MATCH :q "
                 "ORDER BY rank LIMIT :limit OFFSET :offset"),
            {"q": fts, "limit": frame_limit + 1, "offset": frame_offset},
        ).all()
        frames_has_more = len(rows) > frame_limit
        ids = [row[0] for row in rows[:frame_limit]]
        if ids:
            by_id = {f.id: f for f in db.scalars(select(Frame).where(Frame.id.in_(ids)))}
            frames = [by_id[i] for i in ids if i in by_id]

    like = f"%{q}%"
    number_match = [Roll.number == int(q.lstrip("#"))] if q.lstrip("#").isdigit() else []
    roll_q = (
        select(Roll).join(Camera, Roll.camera_id == Camera.id).join(FilmStock, Roll.film_stock_id == FilmStock.id)
        .where(or_(Camera.name.ilike(like), FilmStock.name.ilike(like), Roll.notes.ilike(like), *number_match))
        .order_by(Roll.number.desc()).offset(roll_offset).limit(roll_limit + 1)
    )
    rolled = list(db.scalars(roll_q).unique())
    rolls_has_more = len(rolled) > roll_limit
    rolls = rolled[:roll_limit]
    return {"frames": [services.frame_dict(f, with_roll=True) for f in frames],
            "rolls": [services.roll_dict(r) for r in rolls],
            "frames_has_more": frames_has_more, "rolls_has_more": rolls_has_more}


# ---------- Vorschlaege ----------

@router.get("/suggestions/frame")
def suggest_frame(roll: int, db: Session = Depends(get_db)):
    r = services.get_roll(db, roll)
    last = db.scalar(select(Frame).where(Frame.roll_id == r.id).order_by(Frame.position.desc()).limit(1))

    # Objektive, die an dieser Kamera genutzt wurden (zuletzt genutzt zuerst)
    used = db.execute(
        select(Frame.lens_id, func.max(Frame.recorded_at).label("last"))
        .join(Roll, Frame.roll_id == Roll.id)
        .where(Roll.camera_id == r.camera_id, Frame.lens_id.is_not(None))
        .group_by(Frame.lens_id).order_by(func.max(Frame.recorded_at).desc())
    ).all()
    lens_ids = [lid for lid, _ in used]
    explicit = [lens.id for lens in r.camera.lenses if not lens.archived]
    if explicit:
        lens_ids = [i for i in lens_ids if i in explicit] + [i for i in explicit if i not in lens_ids]

    if last:
        return {"lens_id": last.lens_id, "shutter": last.shutter, "aperture": last.aperture, "motif": last.motif,
                "lens_ids": lens_ids}
    return {"lens_id": lens_ids[0] if lens_ids else None, "shutter": None, "aperture": None, "motif": None,
            "lens_ids": lens_ids}


@router.get("/suggestions/roll")
def suggest_roll(camera_id: int | None = None, film_stock_id: int | None = None, db: Session = Depends(get_db)):
    from .. import units

    cam = db.get(Camera, camera_id) if camera_id else None
    stock = db.get(FilmStock, film_stock_id) if film_stock_id else None

    capacity = None
    if cam and stock:
        capacity = db.scalar(select(Roll.capacity).where(Roll.camera_id == cam.id, Roll.film_stock_id == stock.id,
                                                         Roll.capacity.is_not(None))
                             .order_by(Roll.created_at.desc()).limit(1))
    if capacity is None and cam:
        capacity = cam.default_capacity
    if capacity is None and cam and cam.format in units.CAPACITY_BY_CAMERA_FORMAT and cam.format != "instant":
        capacity = units.CAPACITY_BY_CAMERA_FORMAT[cam.format]
    if capacity is None and stock:
        capacity = stock.default_capacity or units.CAPACITY_BY_FILM_FORMAT.get(stock.format or "")
    if capacity is None and cam:
        capacity = db.scalar(select(Roll.capacity).where(Roll.camera_id == cam.id, Roll.capacity.is_not(None))
                             .order_by(Roll.created_at.desc()).limit(1))

    this_year = now().year
    expiry = None
    if stock:
        expiry = db.scalar(select(Roll.expiry_year).where(Roll.film_stock_id == stock.id,
                                                         Roll.expiry_year.is_not(None))
                           .order_by(Roll.created_at.desc()).limit(1))
    if expiry is None:
        expiry = this_year + 1
    return {"capacity": capacity, "expiry_year": expiry, "type": stock.type if stock else None,
            "iso": stock.iso if stock else None}


@router.get("/suggestions/motifs")
def suggest_motifs(q: str = Query("", max_length=200), db: Session = Depends(get_db)):
    q = q.strip()
    query = select(Frame.motif, func.count().label("n"), func.max(Frame.recorded_at).label("last")) \
        .where(Frame.motif.is_not(None), Frame.motif != "")
    if q:
        query = query.where(Frame.motif.ilike(f"%{q}%"))
    rows = db.execute(query.group_by(Frame.motif).order_by(func.count().desc(), func.max(Frame.recorded_at).desc())
                      .limit(10)).all()
    return [m for m, _, _ in rows]


_COORD_RE = re.compile(r"^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$")


@router.get("/suggestions/places")
def suggest_places(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                   db: Session = Depends(get_db)):
    import math

    dlat = 0.01
    dlon = 0.01 / max(0.1, math.cos(math.radians(lat)))
    rows = db.execute(
        select(Frame.location_text, Frame.lat, Frame.lon)
        .where(Frame.lat.between(lat - dlat, lat + dlat), Frame.lon.between(lon - dlon, lon + dlon),
               Frame.location_text.is_not(None))
        .distinct()
    ).all()
    best: dict[str, float] = {}
    for place, flat, flon in rows:
        if not place or _COORD_RE.match(place):
            continue
        dist = _haversine(lat, lon, flat, flon)
        if dist <= 1000 and dist < best.get(place, math.inf):
            best[place] = dist
    return [{"location_text": t, "distance_m": round(d)} for t, d in sorted(best.items(), key=lambda kv: kv[1])[:5]]


def _haversine(lat1, lon1, lat2, lon2) -> float:
    import math
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


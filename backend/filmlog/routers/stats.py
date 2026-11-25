from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import services, units
from ..auth import require_user
from ..db import get_db
from ..models import Camera, FilmStock, Frame, Roll

router = APIRouter(prefix="/api/v2", dependencies=[Depends(require_user)])

RANGES = {"30": 30, "365": 365, "alle": None}


def _ranked(rows) -> list[dict]:
    items = [{"name": name or "Unbekannt", "count": int(n)} for name, n in rows]
    return sorted(items, key=lambda x: (-x["count"], x["name"].casefold()))


@router.get("/stats")
def stats(range: str = "30", db: Session = Depends(get_db)):  # noqa: A002
    if range not in RANGES:
        raise HTTPException(422, "Zeitraum muss 30, 365 oder alle sein.")
    days = RANGES[range]
    since = (date.today() - timedelta(days=days - 1)).isoformat() if days else None

    frame_day = func.coalesce(Frame.date, func.substr(Frame.recorded_at, 1, 10))
    roll_day = func.substr(Roll.created_at, 1, 10)

    def frames_q(*cols):
        q = select(*cols).select_from(Frame).join(Roll, Frame.roll_id == Roll.id)
        if since:
            q = q.where(frame_day >= since)
        return q

    def rolls_q(*cols):
        q = select(*cols).select_from(Roll)
        if since:
            q = q.where(roll_day >= since)
        return q

    frames_total = db.scalar(frames_q(func.count(Frame.id))) or 0
    rolls_total = db.scalar(rolls_q(func.count(Roll.id))) or 0

    by_type_rows = db.execute(
        frames_q(FilmStock.type, func.count(Frame.id)).join(FilmStock, Roll.film_stock_id == FilmStock.id)
        .group_by(FilmStock.type)
    ).all()
    by_type = sorted(
        ({"name": services.TYPE_LABELS.get(t, "Ohne Angabe"), "key": t, "count": int(n)} for t, n in by_type_rows),
        key=lambda x: (-x["count"], x["name"]),
    )

    by_camera = _ranked(db.execute(
        frames_q(Camera.name, func.count(Frame.id)).join(Camera, Roll.camera_id == Camera.id).group_by(Camera.name)
    ).all())

    stock_rows = db.execute(
        frames_q(FilmStock.name, FilmStock.type, func.count(Frame.id))
        .join(FilmStock, Roll.film_stock_id == FilmStock.id).group_by(FilmStock.name, FilmStock.type)
    ).all()
    by_film_stock = sorted(({"name": n, "type": t, "count": int(c)} for n, t, c in stock_rows),
                           key=lambda x: (-x["count"], x["name"].casefold()))

    roll_stock_rows = db.execute(
        rolls_q(FilmStock.name, FilmStock.type, func.count(Roll.id))
        .join(FilmStock, Roll.film_stock_id == FilmStock.id).group_by(FilmStock.name, FilmStock.type)
    ).all()
    rolls_by_film_stock = sorted(({"name": n, "type": t, "count": int(c)} for n, t, c in roll_stock_rows),
                                 key=lambda x: (-x["count"], x["name"].casefold()))

    by_lens = _ranked(db.execute(
        frames_q(Frame.lens_name, func.count(Frame.id)).where(Frame.lens_name.is_not(None)).group_by(Frame.lens_name)
    ).all())

    shutter_rows = db.execute(
        frames_q(Frame.shutter, func.max(Frame.shutter_seconds), func.count(Frame.id))
        .where(Frame.shutter.is_not(None)).group_by(Frame.shutter)
    ).all()
    by_shutter = [{"name": s, "count": int(c)}
                  for s, sec, c in sorted(shutter_rows, key=lambda r: units.shutter_sort_key(r[1], r[0]))]

    ap_rows = db.execute(
        frames_q(Frame.aperture, func.max(Frame.f_number), func.count(Frame.id))
        .where(Frame.aperture.is_not(None)).group_by(Frame.aperture)
    ).all()
    by_aperture = [{"name": a, "count": int(c)}
                   for a, f, c in sorted(ap_rows, key=lambda r: (r[1] is None, r[1] or 0, r[0]))]

    month_frames = dict(db.execute(
        frames_q(func.substr(frame_day, 1, 7), func.count(Frame.id)).group_by(func.substr(frame_day, 1, 7))
    ).all())
    month_rolls = dict(db.execute(
        rolls_q(func.substr(roll_day, 1, 7), func.count(Roll.id)).group_by(func.substr(roll_day, 1, 7))
    ).all())
    months = sorted(m for m in set(month_frames) | set(month_rolls) if m)
    by_month = [{"month": m, "frames": int(month_frames.get(m, 0)), "rolls": int(month_rolls.get(m, 0))}
                for m in months]

    loc_rows = db.execute(
        frames_q(Frame.lat, Frame.lon, Frame.motif, Roll.number, Frame.position, Frame.date)
        .where(Frame.lat.is_not(None), Frame.lon.is_not(None))
        .order_by(Frame.recorded_at.desc()).limit(5000)
    ).all()
    locations = [{"lat": la, "lon": lo, "motif": m, "roll_number": n, "position": p, "date": d}
                 for la, lo, m, n, p, d in loc_rows]

    return {
        "range": range, "frames_total": frames_total, "rolls_total": rolls_total,
        "by_type": by_type, "by_camera": by_camera, "by_film_stock": by_film_stock,
        "rolls_by_film_stock": rolls_by_film_stock, "by_lens": by_lens,
        "by_shutter": by_shutter, "by_aperture": by_aperture, "by_month": by_month, "locations": locations,
    }

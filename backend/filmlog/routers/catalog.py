from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import services, units
from ..auth import require_user
from ..db import get_db
from ..models import Aperture, Camera, FilmStock, Frame, Lens, Roll, ShutterSpeed
from ..schemas import CameraIn, FilmStockIn, LabelIn, LensIn, PresetIn

router = APIRouter(prefix="/api/v2", dependencies=[Depends(require_user)])


@router.get("/catalog")
def get_catalog(db: Session = Depends(get_db)):
    return services.catalog(db)


def _get(db: Session, model, obj_id: int, label: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, f"{label} nicht gefunden.")
    return obj


def _check_unique(db: Session, model, name: str, exclude_id: int | None, label: str):
    q = select(model).where(func.lower(model.name) == name.lower())
    existing = db.scalar(q)
    if existing is not None and existing.id != exclude_id:
        raise HTTPException(409, f"{label} „{name}“ gibt es bereits.")


def _delete_or_archive(db: Session, obj, in_use: bool):
    if in_use:
        obj.archived = True
        db.commit()
        return {"deleted": False, "archived": True}
    db.delete(obj)
    db.commit()
    return {"deleted": True}


# ---------- Kameras ----------

def _set_lenses(db: Session, cam: Camera, lens_ids: list[int]):
    lenses = list(db.scalars(select(Lens).where(Lens.id.in_(lens_ids)))) if lens_ids else []
    if len(lenses) != len(set(lens_ids)):
        raise HTTPException(422, "Unbekanntes Objektiv in lens_ids.")
    cam.lenses = lenses


@router.post("/cameras", status_code=201)
def create_camera(data: CameraIn, db: Session = Depends(get_db)):
    if not data.name:
        raise HTTPException(422, "Name ist erforderlich.")
    _check_unique(db, Camera, data.name, None, "Kamera")
    cam = Camera(name=data.name, format=data.format, default_capacity=data.default_capacity, notes=data.notes,
                 archived=bool(data.archived))
    if data.lens_ids:
        _set_lenses(db, cam, data.lens_ids)
    db.add(cam)
    db.commit()
    return services.camera_dict(cam, services.camera_usage(db))


@router.patch("/cameras/{obj_id}")
def update_camera(obj_id: int, data: CameraIn, db: Session = Depends(get_db)):
    cam = _get(db, Camera, obj_id, "Kamera")
    values = data.model_dump(exclude_unset=True)
    if "name" in values:
        if not values["name"]:
            raise HTTPException(422, "Name darf nicht leer sein.")
        _check_unique(db, Camera, values["name"], cam.id, "Kamera")
    for key in ("name", "format", "default_capacity", "notes"):
        if key in values:
            setattr(cam, key, values[key])
    if values.get("archived") is not None:
        cam.archived = values["archived"]
    if "lens_ids" in values:
        _set_lenses(db, cam, values["lens_ids"] or [])
    db.commit()
    return services.camera_dict(cam, services.camera_usage(db))


@router.delete("/cameras/{obj_id}")
def delete_camera(obj_id: int, db: Session = Depends(get_db)):
    cam = _get(db, Camera, obj_id, "Kamera")
    in_use = db.scalar(select(func.count(Roll.id)).where(Roll.camera_id == cam.id)) > 0
    return _delete_or_archive(db, cam, in_use)


# ---------- Objektive ----------

@router.post("/lenses", status_code=201)
def create_lens(data: LensIn, db: Session = Depends(get_db)):
    if not data.name:
        raise HTTPException(422, "Name ist erforderlich.")
    _check_unique(db, Lens, data.name, None, "Objektiv")
    focal, max_ap = units.guess_lens(data.name)
    lens = Lens(name=data.name, focal_length_mm=data.focal_length_mm or focal,
                max_aperture=data.max_aperture or max_ap, archived=bool(data.archived))
    db.add(lens)
    db.commit()
    return services.lens_dict(lens, services.lens_usage(db))


@router.patch("/lenses/{obj_id}")
def update_lens(obj_id: int, data: LensIn, db: Session = Depends(get_db)):
    lens = _get(db, Lens, obj_id, "Objektiv")
    values = data.model_dump(exclude_unset=True)
    if "name" in values:
        if not values["name"]:
            raise HTTPException(422, "Name darf nicht leer sein.")
        _check_unique(db, Lens, values["name"], lens.id, "Objektiv")
    for key in ("name", "focal_length_mm", "max_aperture"):
        if key in values:
            setattr(lens, key, values[key])
    if values.get("archived") is not None:
        lens.archived = values["archived"]
    db.commit()
    return services.lens_dict(lens, services.lens_usage(db))


@router.delete("/lenses/{obj_id}")
def delete_lens(obj_id: int, db: Session = Depends(get_db)):
    lens = _get(db, Lens, obj_id, "Objektiv")
    in_use = db.scalar(select(func.count(Frame.id)).where(Frame.lens_id == lens.id)) > 0
    return _delete_or_archive(db, lens, in_use)


# ---------- Filmstocks ----------

@router.post("/film-stocks", status_code=201)
def create_film_stock(data: FilmStockIn, db: Session = Depends(get_db)):
    if not data.name:
        raise HTTPException(422, "Name ist erforderlich.")
    _check_unique(db, FilmStock, data.name, None, "Film")
    stock = FilmStock(
        name=data.name,
        manufacturer=data.manufacturer or units.guess_manufacturer(data.name),
        iso=data.iso or units.guess_iso(data.name),
        type=data.type or units.guess_film_type(data.name),
        format=data.format or units.guess_film_format(data.name),
        default_capacity=data.default_capacity,
        archived=bool(data.archived),
    )
    db.add(stock)
    db.commit()
    return services.film_stock_dict(stock, services.film_stock_usage(db))


@router.patch("/film-stocks/{obj_id}")
def update_film_stock(obj_id: int, data: FilmStockIn, db: Session = Depends(get_db)):
    stock = _get(db, FilmStock, obj_id, "Film")
    values = data.model_dump(exclude_unset=True)
    if "name" in values:
        if not values["name"]:
            raise HTTPException(422, "Name darf nicht leer sein.")
        _check_unique(db, FilmStock, values["name"], stock.id, "Film")
    for key in ("name", "manufacturer", "iso", "type", "format", "default_capacity"):
        if key in values:
            setattr(stock, key, values[key])
    if values.get("archived") is not None:
        stock.archived = values["archived"]
    db.commit()
    return services.film_stock_dict(stock, services.film_stock_usage(db))


@router.delete("/film-stocks/{obj_id}")
def delete_film_stock(obj_id: int, db: Session = Depends(get_db)):
    stock = _get(db, FilmStock, obj_id, "Film")
    in_use = db.scalar(select(func.count(Roll.id)).where(Roll.film_stock_id == stock.id)) > 0
    return _delete_or_archive(db, stock, in_use)


# ---------- Belichtungszeiten / Blenden ----------
# Werte, die in Aufnahmen stehen, sind dort als Text gespeichert; Loeschen aus der Liste ist daher immer moeglich.

def _parse_or_422(fn, label: str):
    try:
        return fn(label)
    except units.UnitError as e:
        raise HTTPException(422, str(e)) from e


def _sorted_shutters(db: Session) -> list[dict]:
    rows = sorted(db.scalars(select(ShutterSpeed)), key=lambda s: units.shutter_sort_key(s.seconds, s.label))
    return [services.shutter_dict(s) for s in rows]


def _sorted_apertures(db: Session) -> list[dict]:
    return [services.aperture_dict(a) for a in sorted(db.scalars(select(Aperture)), key=lambda a: a.f_number)]


def add_shutter(db: Session, label: str) -> ShutterSpeed:
    norm, seconds = _parse_or_422(units.parse_shutter, label)
    existing = db.scalar(select(ShutterSpeed).where(ShutterSpeed.label == norm))
    if existing:
        return existing
    row = ShutterSpeed(label=norm, seconds=seconds)
    db.add(row)
    db.flush()
    return row


def add_aperture(db: Session, label: str) -> Aperture:
    norm, f = _parse_or_422(units.parse_aperture, label)
    existing = db.scalar(select(Aperture).where(Aperture.label == norm))
    if existing:
        return existing
    row = Aperture(label=norm, f_number=f)
    db.add(row)
    db.flush()
    return row


@router.post("/shutter-speeds", status_code=201)
def create_shutter(data: LabelIn, db: Session = Depends(get_db)):
    norm, _ = _parse_or_422(units.parse_shutter, data.label)
    if db.scalar(select(ShutterSpeed).where(ShutterSpeed.label == norm)):
        raise HTTPException(409, f"Belichtungszeit {norm} gibt es bereits.")
    row = add_shutter(db, data.label)
    db.commit()
    return services.shutter_dict(row)


@router.patch("/shutter-speeds/{obj_id}")
def update_shutter(obj_id: int, data: LabelIn, db: Session = Depends(get_db)):
    row = _get(db, ShutterSpeed, obj_id, "Belichtungszeit")
    norm, seconds = _parse_or_422(units.parse_shutter, data.label)
    dup = db.scalar(select(ShutterSpeed).where(ShutterSpeed.label == norm))
    if dup and dup.id != row.id:
        raise HTTPException(409, f"Belichtungszeit {norm} gibt es bereits.")
    row.label, row.seconds = norm, seconds
    db.commit()
    return services.shutter_dict(row)


@router.delete("/shutter-speeds/{obj_id}")
def delete_shutter(obj_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, ShutterSpeed, obj_id, "Belichtungszeit"))
    db.commit()
    return {"deleted": True}


@router.post("/shutter-speeds/presets")
def shutter_presets(data: PresetIn, db: Session = Depends(get_db)):
    for label in units.SHUTTER_PRESETS[data.preset]:
        add_shutter(db, label)
    db.commit()
    return _sorted_shutters(db)


@router.post("/apertures", status_code=201)
def create_aperture(data: LabelIn, db: Session = Depends(get_db)):
    norm, _ = _parse_or_422(units.parse_aperture, data.label)
    if db.scalar(select(Aperture).where(Aperture.label == norm)):
        raise HTTPException(409, f"Blende {norm} gibt es bereits.")
    row = add_aperture(db, data.label)
    db.commit()
    return services.aperture_dict(row)


@router.patch("/apertures/{obj_id}")
def update_aperture(obj_id: int, data: LabelIn, db: Session = Depends(get_db)):
    row = _get(db, Aperture, obj_id, "Blende")
    norm, f = _parse_or_422(units.parse_aperture, data.label)
    dup = db.scalar(select(Aperture).where(Aperture.label == norm))
    if dup and dup.id != row.id:
        raise HTTPException(409, f"Blende {norm} gibt es bereits.")
    row.label, row.f_number = norm, f
    db.commit()
    return services.aperture_dict(row)


@router.delete("/apertures/{obj_id}")
def delete_aperture(obj_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Aperture, obj_id, "Blende"))
    db.commit()
    return {"deleted": True}


@router.post("/apertures/presets")
def aperture_presets(data: PresetIn, db: Session = Depends(get_db)):
    for label in units.APERTURE_PRESETS[data.preset]:
        add_aperture(db, label)
    db.commit()
    return _sorted_apertures(db)

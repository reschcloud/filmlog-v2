from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import CAMERA_FORMATS, FILM_FORMATS, FILM_TYPES, ROLL_STATUS


def _strip(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")


class LoginIn(_In):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=500)
    remember: bool = True


class PasswordIn(_In):
    current: str
    new: str = Field(min_length=8, max_length=500)


class TokenIn(_In):
    name: str = Field(min_length=1, max_length=100)


# ---------- Katalog ----------

class CameraIn(_In):
    name: str | None = Field(default=None, max_length=200)
    format: str | None = None
    default_capacity: int | None = Field(default=None, ge=1, le=999)
    notes: str | None = None
    archived: bool | None = None
    lens_ids: list[int] | None = None

    _s = field_validator("name", "format", "notes", mode="before")(_strip)

    @field_validator("format")
    @classmethod
    def _fmt(cls, v):
        if v is not None and v not in CAMERA_FORMATS:
            raise ValueError(f"Unbekanntes Kameraformat (erlaubt: {', '.join(CAMERA_FORMATS)})")
        return v


class LensIn(_In):
    name: str | None = Field(default=None, max_length=200)
    focal_length_mm: float | None = Field(default=None, gt=0, le=5000)
    max_aperture: float | None = Field(default=None, gt=0, le=256)
    archived: bool | None = None

    _s = field_validator("name", mode="before")(_strip)


class FilmStockIn(_In):
    name: str | None = Field(default=None, max_length=200)
    manufacturer: str | None = Field(default=None, max_length=100)
    iso: int | None = Field(default=None, ge=1, le=100000)
    type: str | None = None
    format: str | None = None
    default_capacity: int | None = Field(default=None, ge=1, le=999)
    archived: bool | None = None

    _s = field_validator("name", "manufacturer", "type", "format", mode="before")(_strip)

    @field_validator("type")
    @classmethod
    def _type(cls, v):
        if v is not None and v not in FILM_TYPES:
            raise ValueError(f"Unbekannter Filmtyp (erlaubt: {', '.join(FILM_TYPES)})")
        return v

    @field_validator("format")
    @classmethod
    def _fmt(cls, v):
        if v is not None and v not in FILM_FORMATS:
            raise ValueError(f"Unbekanntes Filmformat (erlaubt: {', '.join(FILM_FORMATS)})")
        return v


class LabelIn(_In):
    label: str = Field(min_length=1, max_length=20)


class PresetIn(_In):
    preset: str = Field(pattern="^(voll|halb|drittel)$")


# ---------- Filme / Aufnahmen ----------

class RollIn(_In):
    film_stock_id: int | None = None
    camera_id: int | None = None
    capacity: int | None = Field(default=None, ge=1, le=999)
    expiry_year: int | None = Field(default=None, ge=1900, le=2900)
    iso_override: int | None = Field(default=None, ge=1, le=100000)
    notes: str | None = None

    _s = field_validator("notes", mode="before")(_strip)

    @field_validator("expiry_year", "iso_override", "capacity", mode="before")
    @classmethod
    def _empty_int(cls, v):
        return None if v == "" else v


class StatusIn(_In):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ROLL_STATUS:
            raise ValueError(f"Unbekannter Status (erlaubt: {', '.join(ROLL_STATUS)})")
        return v


class FrameIn(_In):
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}(:\d{2})?$")
    location_text: str | None = Field(default=None, max_length=300)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    lens_id: int | None = None
    shutter: str | None = Field(default=None, max_length=20)
    aperture: str | None = Field(default=None, max_length=20)
    flash: bool | None = None
    motif: str | None = Field(default=None, max_length=5000)

    _s = field_validator("date", "time", "location_text", "shutter", "aperture", "motif", mode="before")(_strip)

    @field_validator("lens_id", "lat", "lon", mode="before")
    @classmethod
    def _empty(cls, v):
        return None if v == "" else v


class FrameCreateIn(FrameIn):
    position: int | None = Field(default=None, ge=1)
    count: int = Field(default=1, ge=1, le=50)
    client_id: str | None = Field(default=None, max_length=64)
    recorded_at: datetime | None = None

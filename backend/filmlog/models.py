from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now().replace(microsecond=0)


ROLL_STATUS = ("offen", "abgeschlossen", "entwickelt", "gescannt", "archiviert")
FILM_TYPES = ("sw", "farbe", "dia", "anderes")
CAMERA_FORMATS = ("35mm", "halbformat", "6x4.5", "6x6", "6x7", "6x9", "4x5", "instant", "anderes")
FILM_FORMATS = ("35mm", "120", "4x5", "instant", "anderes")


class Meta(Base):
    __tablename__ = "meta"
    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SessionToken(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    user_agent: Mapped[str | None] = mapped_column(String(255))


class ApiToken(Base):
    __tablename__ = "api_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)


camera_lenses = Table(
    "camera_lenses",
    Base.metadata,
    Column("camera_id", ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True),
    Column("lens_id", ForeignKey("lenses.id", ondelete="CASCADE"), primary_key=True),
)


class Lens(Base):
    __tablename__ = "lenses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    focal_length_mm: Mapped[float | None] = mapped_column(Float)
    max_aperture: Mapped[float | None] = mapped_column(Float)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Camera(Base):
    __tablename__ = "cameras"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    format: Mapped[str | None] = mapped_column(String(20))
    default_capacity: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    lenses: Mapped[list[Lens]] = relationship(secondary=camera_lenses, lazy="selectin")


class FilmStock(Base):
    __tablename__ = "film_stocks"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    iso: Mapped[int | None] = mapped_column(Integer)
    type: Mapped[str | None] = mapped_column(String(20))
    format: Mapped[str | None] = mapped_column(String(20))
    default_capacity: Mapped[int | None] = mapped_column(Integer)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class ShutterSpeed(Base):
    __tablename__ = "shutter_speeds"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(20), unique=True)
    seconds: Mapped[float | None] = mapped_column(Float)


class Aperture(Base):
    __tablename__ = "apertures"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(20), unique=True)
    f_number: Mapped[float] = mapped_column(Float)


class Roll(Base):
    __tablename__ = "rolls"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    film_stock_id: Mapped[int] = mapped_column(ForeignKey("film_stocks.id"))
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"))
    expiry_year: Mapped[int | None] = mapped_column(Integer)
    capacity: Mapped[int | None] = mapped_column(Integer)
    iso_override: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="offen", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    developed_at: Mapped[datetime | None] = mapped_column(DateTime)
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Denormalisiert fuer schnelle Listen/Dashboard, wird bei jeder Frame-Aenderung gepflegt.
    frame_count: Mapped[int] = mapped_column(Integer, default=0)
    last_frame_at: Mapped[datetime | None] = mapped_column(DateTime)

    film_stock: Mapped[FilmStock] = relationship(lazy="joined")
    camera: Mapped[Camera] = relationship(lazy="joined")
    frames: Mapped[list["Frame"]] = relationship(
        back_populates="roll", order_by="Frame.position", cascade="all, delete-orphan"
    )


class Frame(Base):
    __tablename__ = "frames"
    __table_args__ = (
        # Bewusst nicht UNIQUE: SQLite kann Unique-Constraints nicht verzoegert pruefen, das Nachruecken
        # beim Einfuegen/Loeschen wuerde sonst mitten im UPDATE kollidieren. Konsistenz sichert services.py.
        Index("ix_frames_roll_position", "roll_id", "position"),
        Index("ix_frames_recorded_at", "recorded_at"),
        Index("ix_frames_client_id", "client_id"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    roll_id: Mapped[int] = mapped_column(ForeignKey("rolls.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    date: Mapped[str | None] = mapped_column(String(10), index=True)
    time: Mapped[str | None] = mapped_column(String(8))
    location_text: Mapped[str | None] = mapped_column(String(300))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    lens_id: Mapped[int | None] = mapped_column(ForeignKey("lenses.id", ondelete="SET NULL"))
    lens_name: Mapped[str | None] = mapped_column(String(200))
    shutter: Mapped[str | None] = mapped_column(String(20))
    shutter_seconds: Mapped[float | None] = mapped_column(Float)
    aperture: Mapped[str | None] = mapped_column(String(20))
    f_number: Mapped[float | None] = mapped_column(Float)
    focal_length: Mapped[str | None] = mapped_column(String(20))
    flash: Mapped[bool] = mapped_column(Boolean, default=False)
    motif: Mapped[str | None] = mapped_column(Text)
    client_id: Mapped[str | None] = mapped_column(String(64))
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    roll: Mapped[Roll] = relationship(back_populates="frames")


# Volltextsuche (SQLite FTS5) als External-Content-Tabelle, per Trigger synchron gehalten.
FTS_DDL = [
    """CREATE VIRTUAL TABLE IF NOT EXISTS frames_fts USING fts5(
        motif, location_text, lens_name,
        content='frames', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    )""",
    """CREATE TRIGGER IF NOT EXISTS frames_fts_ai AFTER INSERT ON frames BEGIN
        INSERT INTO frames_fts(rowid, motif, location_text, lens_name)
        VALUES (new.id, new.motif, new.location_text, new.lens_name);
    END""",
    """CREATE TRIGGER IF NOT EXISTS frames_fts_ad AFTER DELETE ON frames BEGIN
        INSERT INTO frames_fts(frames_fts, rowid, motif, location_text, lens_name)
        VALUES ('delete', old.id, old.motif, old.location_text, old.lens_name);
    END""",
    """CREATE TRIGGER IF NOT EXISTS frames_fts_au AFTER UPDATE OF motif, location_text, lens_name ON frames BEGIN
        INSERT INTO frames_fts(frames_fts, rowid, motif, location_text, lens_name)
        VALUES ('delete', old.id, old.motif, old.location_text, old.lens_name);
        INSERT INTO frames_fts(rowid, motif, location_text, lens_name)
        VALUES (new.id, new.motif, new.location_text, new.lens_name);
    END""",
]
FTS_DROP = [
    "DROP TRIGGER IF EXISTS frames_fts_au",
    "DROP TRIGGER IF EXISTS frames_fts_ad",
    "DROP TRIGGER IF EXISTS frames_fts_ai",
    "DROP TABLE IF EXISTS frames_fts",
]

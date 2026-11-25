from pathlib import Path

from alembic import command
from alembic.config import Config

from .config import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", get_settings().db_url)
    return cfg


def upgrade(revision: str = "head") -> None:
    get_settings().data_dir.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(), revision)

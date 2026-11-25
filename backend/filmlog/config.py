from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FILMLOG_", env_file=".env", extra="ignore")

    data_dir: Path = Path("/data")
    database_url: str | None = None
    static_dir: Path | None = None
    client_dir: Path | None = None

    admin_user: str | None = None
    admin_password: str | None = None

    # Cookies nur ueber HTTPS senden. Hinter einem TLS-Reverse-Proxy True lassen,
    # fuer reines HTTP im LAN auf False setzen.
    secure_cookies: bool = True
    session_days: int = 90
    session_hours_short: int = 12

    login_max_attempts: int = 5
    login_window_seconds: int = 300

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self.data_dir / 'filmlog.db'}"

    @property
    def static_path(self) -> Path:
        if self.static_dir:
            return self.static_dir
        return Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

    @property
    def client_path(self) -> Path:
        if self.client_dir:
            return self.client_dir
        return Path(__file__).resolve().parent.parent.parent / "client"


@lru_cache
def get_settings() -> Settings:
    return Settings()

import pytest
from fastapi.testclient import TestClient

from filmlog import db as dbmod
from filmlog.config import get_settings

USER, PASSWORD = "admin", "geheim1234"


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("FILMLOG_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FILMLOG_ADMIN_USER", USER)
    monkeypatch.setenv("FILMLOG_ADMIN_PASSWORD", PASSWORD)
    monkeypatch.setenv("FILMLOG_SECURE_COOKIES", "false")
    monkeypatch.setenv("FILMLOG_STATIC_DIR", str(tmp_path / "dist"))
    get_settings.cache_clear()
    dbmod._engine = None
    from filmlog.auth import rate_limiter
    rate_limiter._attempts.clear()

    from filmlog.main import create_app
    yield create_app()
    if dbmod._engine is not None:
        dbmod._engine.dispose()
    dbmod._engine = None
    get_settings.cache_clear()


@pytest.fixture
def anon(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client(anon):
    r = anon.post("/auth/login", json={"username": USER, "password": PASSWORD})
    assert r.status_code == 200, r.text
    anon.headers["X-Filmlog"] = "1"
    return anon


@pytest.fixture
def db_session(client):
    with dbmod.session_factory()() as s:
        yield s


@pytest.fixture
def basics(client):
    """Kamera, Objektiv, Film und Standardwerte anlegen."""
    lens = client.post("/api/v2/lenses", json={"name": "Helios 44-2 58mm f/2"}).json()
    cam = client.post("/api/v2/cameras", json={"name": "Zenit TTL", "format": "35mm",
                                              "lens_ids": [lens["id"]]}).json()
    stock = client.post("/api/v2/film-stocks", json={"name": "Kodak Tri-X 400 35mm"}).json()
    return {"lens": lens, "camera": cam, "stock": stock}

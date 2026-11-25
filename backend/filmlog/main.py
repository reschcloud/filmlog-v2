import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware

from . import __version__
from .config import get_settings
from .db import session_factory
from .routers import auth as auth_router
from .routers import catalog, rolls, stats, system

log = logging.getLogger("filmlog")

NO_SPA_PREFIXES = ("/api/", "/auth/", "/client/", "/healthz")


def _startup(run_migrations: bool) -> None:
    if run_migrations:
        from .migrate import upgrade

        upgrade()
    from .auth import ensure_admin

    with session_factory()() as db:
        ensure_admin(db)


def create_app(run_migrations: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        _startup(run_migrations)
        yield

    app = FastAPI(title="Filmlog", version=__version__, lifespan=lifespan, docs_url="/api/docs",
                  redoc_url=None, openapi_url="/api/openapi.json")
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException):
        return JSONResponse({"error": exc.detail if isinstance(exc.detail, str) else "Fehler"},
                            status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        parts = []
        for err in exc.errors():
            loc = ".".join(str(x) for x in err.get("loc", []) if x not in ("body", "query", "path"))
            msg = str(err.get("msg", "ungültig")).removeprefix("Value error, ")
            parts.append(f"{loc}: {msg}" if loc else msg)
        return JSONResponse({"error": "Ungültige Eingabe – " + "; ".join(parts)}, status_code=422)

    app.include_router(system.router)
    app.include_router(auth_router.router)
    app.include_router(catalog.router)
    app.include_router(rolls.router)
    app.include_router(stats.router)
    app.include_router(system.api)

    _mount_frontend(app, get_settings().static_path)
    return app


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    """Liefert das gebaute Frontend aus: gehashte Assets dauerhaft cachen, index.html/Service Worker nie."""
    dist = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str, request: Request):
        if ("/" + path).startswith(NO_SPA_PREFIXES):
            return JSONResponse({"error": "Nicht gefunden."}, status_code=404)
        target = (dist / path).resolve() if path else dist / "index.html"
        if dist not in target.parents and target != dist / "index.html":
            return JSONResponse({"error": "Nicht gefunden."}, status_code=404)
        if path and target.is_file():
            if path.startswith("assets/"):
                cache = "public, max-age=31536000, immutable"
            elif path in ("sw.js", "registerSW.js", "manifest.webmanifest") or path.startswith("workbox-"):
                cache = "no-cache"
            else:
                cache = "public, max-age=3600"
            return FileResponse(target, headers={"Cache-Control": cache})
        index = dist / "index.html"
        if not index.is_file():
            return JSONResponse({"error": "Frontend nicht gebaut."}, status_code=503)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()

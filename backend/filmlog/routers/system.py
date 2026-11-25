import io
import os
import tempfile
import zipfile
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from .. import importer, services
from ..auth import require_user
from ..config import get_settings
from ..db import get_db, get_engine
from ..models import Roll

router = APIRouter()
api = APIRouter(prefix="/api/v2", dependencies=[Depends(require_user)])

MAX_IMPORT_BYTES = 50 * 1024 * 1024


@router.get("/healthz")
def healthz(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"ok": True}


@api.get("/export.json")
def export_json(db: Session = Depends(get_db)):
    import json

    data = services.catalog(db)
    rolls = []
    for r in db.scalars(select(Roll).order_by(Roll.number)):
        d = services.roll_dict(r)
        d["frames"] = [services.frame_dict(f, r) for f in r.frames]
        rolls.append(d)
    data["rolls"] = rolls
    data["exported_at"] = services.iso(services.now())
    body = json.dumps(data, ensure_ascii=False, indent=2)
    return Response(body.encode(), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="filmlog-{date.today()}.json"'})


@api.get("/backup.sqlite")
def backup():
    engine = get_engine()
    if engine.dialect.name != "sqlite":
        raise HTTPException(400, "Backup nur für SQLite verfügbar.")
    fd, path = tempfile.mkstemp(suffix=".sqlite", dir=get_settings().data_dir if get_settings().data_dir.exists()
                                else None)
    os.close(fd)
    os.unlink(path)
    with engine.connect() as conn:
        conn.exec_driver_sql("VACUUM INTO ?", (path,))
    return FileResponse(path, media_type="application/vnd.sqlite3", filename=f"filmlog-{date.today()}.sqlite",
                        background=BackgroundTask(os.unlink, path))


async def _read(upload: UploadFile | None, label: str) -> bytes | None:
    if upload is None:
        return None
    data = await upload.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, f"{label} ist zu groß.")
    return data


@api.post("/import/v1")
async def import_v1(db_file: UploadFile = File(alias="db"), optionen: UploadFile | None = File(default=None),
                    dry_run: str = Form("true"), db: Session = Depends(get_db)):
    try:
        db_data = importer.load_yaml(await _read(db_file, "db.yaml"), "db.yaml")
        opt_data = importer.load_yaml(await _read(optionen, "optionen.yaml"), "optionen.yaml")
        report = importer.import_v1(db, db_data, opt_data, dry_run=dry_run.lower() in ("1", "true", "yes", "ja"))
    except importer.ImportError_ as e:
        db.rollback()
        raise HTTPException(422, str(e)) from e
    return report.as_dict()


@router.get("/client/download", dependencies=[Depends(require_user)])
def client_download():
    client_dir = get_settings().client_path
    if not client_dir.is_dir():
        raise HTTPException(404, "Client-Ordner nicht gefunden.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(client_dir.iterdir()):
            if p.is_file() and not p.name.endswith(".config.json"):
                zf.write(p, arcname=p.name)
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="filmlog-exif-writer.zip"'})

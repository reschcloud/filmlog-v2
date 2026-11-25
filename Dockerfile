# syntax=docker/dockerfile:1

# ---------- Frontend bauen (läuft immer auf der Build-Plattform, Ergebnis ist plattformunabhängig) ----------
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Python-Abhängigkeiten ----------
FROM python:3.12-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
COPY backend/pyproject.toml /src/backend/
COPY backend/filmlog /src/backend/filmlog
RUN /venv/bin/pip install /src/backend

# ---------- Laufzeit ----------
FROM python:3.12-slim
LABEL org.opencontainers.image.title="Filmlog" \
      org.opencontainers.image.description="Analoges Aufnahmeprotokoll" \
      org.opencontainers.image.source="https://github.com/reschcloud/filmlog" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/venv/bin:$PATH" \
    FILMLOG_DATA_DIR=/data \
    FILMLOG_STATIC_DIR=/app/static \
    FILMLOG_CLIENT_DIR=/app/client \
    FORWARDED_ALLOW_IPS="127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16" \
    TZ=Europe/Berlin

RUN useradd --system --uid 1000 --user-group --home-dir /app filmlog \
    && mkdir -p /data && chown filmlog:filmlog /data

COPY --from=build /venv /venv
COPY client /app/client
COPY --from=frontend /app/dist /app/static
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Der Container startet als root, damit der Entrypoint die Rechte von /data korrigieren kann;
# die App selbst laeuft danach als PUID:PGID (Standard 1000:1000).
ENV PUID=1000 PGID=1000
WORKDIR /app
VOLUME ["/data"]
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/healthz', timeout=4)"

# Eine Instanz (SQLite); Migrationen laufen beim Start automatisch.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "filmlog.main:app", "--host", "0.0.0.0", "--port", "8001", "--proxy-headers", "--no-server-header"]

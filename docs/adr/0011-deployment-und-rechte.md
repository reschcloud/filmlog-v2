# ADR-0011: Deployment, Ports und Dateirechte

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Filmlog läuft auf einem privaten Server oder Raspberry Pi hinter einem TLS-Reverse-Proxy. Das
Datenverzeichnis wird vom Host gemountet und muss für den Containerbenutzer beschreibbar sein.

## Entscheidung

- **Port:** Der Container lauscht auf **8001** (uvicorn, Healthcheck, `EXPOSE`); Compose veröffentlicht
  nur `127.0.0.1:8001`. Der lokale Vite-Dev-Server läuft auf **8000** und proxyt API/Auth auf 8000.
  Dieser Unterschied ist Absicht.
- **TLS/Proxy:** TLS, Hostnamen und Auth-Proxy (Caddy/Traefik/nginx/Authelia) liegen **außerhalb** des
  Repos. Die App erwartet `X-Forwarded-*` nur von `FORWARDED_ALLOW_IPS`.
- **Rechte:** Der Container startet als root, `docker-entrypoint.sh` korrigiert Besitzer von `/data` auf
  `PUID:PGID` (Standard 1000:1000), prüft Schreibbarkeit und gibt die Rechte per `setpriv` ab. Deshalb
  gibt es **kein** `USER` im Dockerfile; die App selbst läuft nie als root.
- **Daten:** `/data` ist ein Volume; dort liegen DB, Backups und Import-Uploads. Keine Dateien als root
  im Datenverzeichnis anlegen.
- **Healthcheck:** `GET /healthz`; Compose wartet auf `healthy`.
- **Images:** Multi-Arch (amd64/arm64) über GitHub Actions nach GHCR, Tags `2`, `2.x.y` (Semver) und
  `sha-…`; es gibt bewusst keinen `latest`-Tag.
- **Updates:** `pull_policy: missing` erlaubt Start ohne Netz, überspringt aber `pull`, wenn der Tag `:2`
  lokal existiert. Updates daher mit `docker compose pull --policy always` oder `up -d --pull always`;
  `--build` für lokale Änderungen.

## Konsequenzen

- Der Container ist nicht für den direkten öffentlichen Betrieb gedacht; TLS und Hosting kommen vom Proxy.
- Falsche `PUID`/`PGID` führen zu Schreibfehlern; der Entrypoint bricht mit einer klaren Meldung ab.
- Nur eine Instanz (SQLite); kein Scale-out.
- `docker compose up` kann ohne Netz starten, aber ein Update braucht bewusst `--policy always`.

## Alternativen

- **App als Non-Root im Image:** verworfen, weil dann ein als root angelegtes `./data` nicht korrigiert
  werden könnte.
- **TLS im Container:** verworfen; Zertifikatsverwaltung gehört zum Proxy.
- **Port 8000 im Container:** verworfen; 8000 ist der Dev-Server, 8001 der Produktionsport.
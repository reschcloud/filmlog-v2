#!/usr/bin/env bash
# Filmlog v2 – Installation und Update in einem Skript.
#
#   ./setup.sh install [--build] [--dry-run]
#   ./setup.sh update  [--build] [--no-git] [--dry-run]
#   ./setup.sh status
#
# Voraussetzungen: Docker; mit Compose-Plugin oder als reines Docker.
# Die Daten liegen in ./data und bleiben bei Updates erhalten.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

IMAGE="ghcr.io/reschcloud/filmlog:2"
CONTAINER="filmlog"
SERVICE="filmlog"
PORT="8001"
DATA_DIR="$ROOT/data"
ENV_FILE="$ROOT/.env"
ENV_EXAMPLE="$ROOT/.env.example"
COMPOSE_FILE="$ROOT/docker-compose.yml"

COMMAND=""
BUILD=0
DO_GIT=1
DRY_RUN=0
COMPOSE=()
COMPOSE_MODE="docker"
BACKUP_PATH=""

# ---------- Ausgabe ----------

step()  { printf '\n==> %s\n' "$*"; }
msg()   { printf '%s\n' "$*"; }
warn()  { printf 'Warnung: %s\n' "$*" >&2; }
die()   { printf 'Fehler: %s\n' "$*" >&2; exit 1; }

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  +'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

usage() {
  cat <<'EOF'
Filmlog v2 – Setup

Aufruf:
  ./setup.sh install [--build] [--dry-run]
  ./setup.sh update  [--build] [--no-git] [--dry-run]
  ./setup.sh status

  install   .env anlegen, Image ziehen, Container starten
  update    Sicherheitskopie, git pull, neues Image, Neustart
  status    Container, Health und Version anzeigen

Optionen:
  --build   lokal bauen statt das fertige Image zu ziehen
  --no-git  beim Update kein git pull (z. B. bei lokalen Änderungen)
  --dry-run nur anzeigen, nichts ausführen oder schreiben

Daten: ./data (SQLite). Ein Update erstellt vorher eine Sicherheitskopie.
EOF
}

# ---------- Argumente ----------

while [ $# -gt 0 ]; do
  case "$1" in
    install|update|status) COMMAND="$1" ;;
    --build) BUILD=1 ;;
    --no-git) DO_GIT=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unbekannte Option: $1 (siehe ./setup.sh --help)" ;;
  esac
  shift
done

if [ -z "$COMMAND" ]; then
  usage
  exit 1
fi

# ---------- Docker / Compose ----------

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker ist nicht installiert."
  if [ "$DRY_RUN" != 1 ]; then
    docker info >/dev/null 2>&1 || die "Docker-Daemon nicht erreichbar (sudo oder docker-Gruppe?)."
  fi

  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
    COMPOSE_MODE="compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
    COMPOSE_MODE="compose"
  else
    COMPOSE=()
    COMPOSE_MODE="docker"
    warn "Kein Compose-Plugin gefunden – nutze docker direkt."
  fi
}

container_running() {
  local running
  running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | tr -d '\n' || true)"
  [ "$running" = "true" ]
}

container_exists() {
  [ -n "$(docker inspect -f '{{.Id}}' "$CONTAINER" 2>/dev/null | tr -d '\n' || true)" ]
}

# ---------- .env ----------

replace_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

prompt_admin() {
  local current admin pw pw2
  current="$(grep '^FILMLOG_ADMIN_USER=' "$ENV_FILE" | cut -d= -f2- || true)"
  current="${current:-admin}"
  read -r -p "Admin-Benutzername [$current]: " admin
  admin="${admin:-$current}"
  [[ "$admin" =~ ^[A-Za-z0-9._-]+$ ]] || die "Benutzername: nur Buchstaben, Ziffern, Punkt, Unterstrich oder Minus."
  while :; do
    read -r -s -p "Admin-Passwort (mind. 8 Zeichen, nur Buchstaben/Ziffern/._-): " pw
    printf '\n'
    if [ "${#pw}" -ge 8 ] && [[ "$pw" =~ ^[A-Za-z0-9._-]+$ ]]; then break; fi
    warn "Bitte mindestens 8 Zeichen aus Buchstaben, Ziffern, Punkt, Unterstrich oder Minus."
  done
  read -r -s -p "Passwort wiederholen: " pw2
  printf '\n'
  [ "$pw" = "$pw2" ] || die "Die Passwörter stimmen nicht überein."
  replace_env "FILMLOG_ADMIN_USER" "$admin"
  replace_env "FILMLOG_ADMIN_PASSWORD" "$pw"
  msg "Zugangsdaten in .env gespeichert."
}

ensure_env() {
  if [ -f "$ENV_FILE" ]; then
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    if grep -q '^FILMLOG_ADMIN_PASSWORD=bitte-aendern$' "$ENV_FILE"; then
      warn "FILMLOG_ADMIN_PASSWORD steht in .env noch auf dem Beispielwert."
      # Nur bei einer frischen Installation fragen: Bei vorhandener DB ist der Benutzer
      # bereits angelegt, die .env wird dann nicht mehr ausgewertet.
      if [ "$COMMAND" = "install" ] && [ -t 0 ] && [ "$DRY_RUN" != 1 ] && [ ! -f "$DATA_DIR/filmlog.db" ]; then
        prompt_admin
      fi
    fi
    return 0
  fi

  step ".env anlegen"
  if [ "$DRY_RUN" = 1 ]; then
    run cp "$ENV_EXAMPLE" "$ENV_FILE"
    return 0
  fi

  [ -f "$ENV_EXAMPLE" ] || die "$ENV_EXAMPLE fehlt."
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  # Daten sollen dem aufrufenden Benutzer gehören (auch bei sudo).
  local uid gid
  uid="${SUDO_UID:-$(id -u)}"
  gid="${SUDO_GID:-$(id -g)}"
  if [ "$uid" = "0" ]; then uid=1000; gid=1000; fi
  sed -i "s/^PUID=.*/PUID=$uid/; s/^PGID=.*/PGID=$gid/" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  if [ ! -t 0 ]; then
    warn "Kein Terminal: FILMLOG_ADMIN_PASSWORD in .env steht noch auf dem Beispielwert."
    return 0
  fi
  prompt_admin
}

# ---------- Image / Container ----------

pull_image() {
  if [ "$BUILD" = 1 ]; then
    msg "Lokaler Build – kein Image-Pull."
    return 0
  fi
  step "Image ziehen"
  if [ "$COMPOSE_MODE" = "compose" ]; then
    if ! run "${COMPOSE[@]}" pull --policy always; then
      warn "--policy always nicht unterstützt – versuche normales pull."
      run "${COMPOSE[@]}" pull
    fi
  else
    run docker pull "$IMAGE"
  fi
}

start_container() {
  step "Container starten"
  if [ "$COMPOSE_MODE" = "compose" ]; then
    if [ "$BUILD" = 1 ]; then
      run "${COMPOSE[@]}" up -d --build
    else
      run "${COMPOSE[@]}" up -d
    fi
    return 0
  fi

  if [ "$BUILD" = 1 ]; then
    run docker build -t "$IMAGE" "$ROOT"
  fi
  if container_exists; then
    run docker rm -f "$CONTAINER"
  fi
  run docker run -d --name "$CONTAINER" --restart unless-stopped \
    --env-file "$ENV_FILE" \
    -p "127.0.0.1:${PORT}:8001" \
    -v "${DATA_DIR}:/data" \
    "$IMAGE"
}

wait_healthy() {
  [ "$DRY_RUN" = 1 ] && return 0
  step "Auf Start warten"
  local i status
  for ((i = 0; i < 45; i++)); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null | tr -d '\n' || true)"
    [ -n "$status" ] || status="missing"
    case "$status" in
      healthy)
        msg "Container ist healthy."
        return 0
        ;;
      running)
        msg "Container läuft (ohne Healthcheck)."
        return 0
        ;;
      unhealthy|exited|dead)
        docker logs --tail 40 "$CONTAINER" >&2 || true
        die "Container ist $status."
        ;;
    esac
    sleep 2
  done
  docker logs --tail 40 "$CONTAINER" >&2 || true
  die "Container wurde nicht rechtzeitig healthy."
}

show_version() {
  [ "$DRY_RUN" = 1 ] && return 0
  local v
  if [ "$COMPOSE_MODE" = "compose" ]; then
    v="$("${COMPOSE[@]}" exec -T "$SERVICE" python -c 'import filmlog; print(filmlog.__version__)' 2>/dev/null || true)"
  else
    v="$(docker exec "$CONTAINER" python -c 'import filmlog; print(filmlog.__version__)' 2>/dev/null || true)"
  fi
  if [ -n "$v" ]; then
    msg "Version: $v"
  else
    warn "Version konnte nicht gelesen werden."
  fi
}

# ---------- Sicherheitskopie ----------

backup_data() {
  step "Sicherheitskopie"
  local ts dir
  ts="$(date +%Y%m%d-%H%M%S)"

  if [ "$DRY_RUN" = 1 ]; then
    msg "  + Sicherheitskopie nach data/backup-$ts…"
    return 0
  fi

  if container_running; then
    if [ "$COMPOSE_MODE" = "compose" ]; then
      "${COMPOSE[@]}" exec -T "$SERVICE" filmlog backup "/data/backup-$ts.sqlite"
    else
      docker exec "$CONTAINER" filmlog backup "/data/backup-$ts.sqlite"
    fi
    BACKUP_PATH="data/backup-$ts.sqlite"
  elif [ -f "$DATA_DIR/filmlog.db" ]; then
    dir="$DATA_DIR/backup-$ts"
    mkdir -p "$dir"
    cp -a "$DATA_DIR"/filmlog.db* "$dir"/ 2>/dev/null || true
    BACKUP_PATH="data/backup-$ts/"
  else
    msg "Keine Datenbank vorhanden – keine Kopie nötig."
    return 0
  fi
  msg "Sicherheitskopie: $BACKUP_PATH"
}

# ---------- Update des Checkouts ----------

update_checkout() {
  if [ "$DO_GIT" != 1 ]; then
    msg "git pull übersprungen (--no-git)."
    return 0
  fi
  if [ ! -d "$ROOT/.git" ]; then
    msg "Kein Git-Checkout – git pull übersprungen."
    return 0
  fi
  if ! command -v git >/dev/null 2>&1; then
    warn "git ist nicht installiert – Checkout bleibt unverändert."
    return 0
  fi
  if [ -n "$(git status --porcelain)" ]; then
    warn "Lokale Änderungen im Checkout – git pull übersprungen."
    return 0
  fi

  step "Repository aktualisieren"
  if ! run git pull --ff-only; then
    warn "git pull fehlgeschlagen – fahre mit dem lokalen Stand fort."
  fi
}

# ---------- Befehle ----------

cmd_install() {
  need_docker
  [ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE fehlt – bitte im Filmlog-Verzeichnis ausführen."
  ensure_env
  if [ -f "$DATA_DIR/filmlog.db" ]; then
    msg "Bestehende Installation erkannt – für Updates mit Sicherheitskopie: ./setup.sh update"
  fi
  if [ ! -d "$DATA_DIR" ]; then
    run mkdir -p "$DATA_DIR"
  fi
  pull_image
  start_container
  wait_healthy
  show_version

  msg ""
  msg "Filmlog läuft auf http://127.0.0.1:${PORT}"
  msg "Daten: $DATA_DIR"
  msg "Für GPS und PWA hinter einem HTTPS-Reverse-Proxy betreiben."
  msg "Nur im LAN ohne HTTPS: FILMLOG_SECURE_COOKIES=false in .env setzen."
}

cmd_update() {
  need_docker
  [ -f "$ENV_FILE" ] || die "Keine .env gefunden – bitte zuerst ./setup.sh install."
  [ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE fehlt – bitte im Filmlog-Verzeichnis ausführen."
  chmod 600 "$ENV_FILE" 2>/dev/null || true

  backup_data
  update_checkout
  pull_image
  start_container
  wait_healthy
  show_version

  msg ""
  msg "Update abgeschlossen. Filmlog läuft auf http://127.0.0.1:${PORT}"
  [ -n "$BACKUP_PATH" ] && msg "Sicherheitskopie: $BACKUP_PATH"
}

cmd_status() {
  need_docker
  local state health version
  state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null | tr -d '\n' || true)"
  [ -n "$state" ] || state="nicht vorhanden"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$CONTAINER" 2>/dev/null | tr -d '\n' || true)"
  [ -n "$health" ] || health="-"
  msg "Container: $CONTAINER"
  msg "Status:    $state (Health: $health)"
  msg "Daten:     $DATA_DIR"
  if [ "$state" = "running" ]; then
    version=""
    if [ "$COMPOSE_MODE" = "compose" ]; then
      version="$("${COMPOSE[@]}" exec -T "$SERVICE" python -c 'import filmlog; print(filmlog.__version__)' 2>/dev/null || true)"
    else
      version="$(docker exec "$CONTAINER" python -c 'import filmlog; print(filmlog.__version__)' 2>/dev/null || true)"
    fi
    [ -n "$version" ] && msg "Version:   $version"
    msg "URL:       http://127.0.0.1:${PORT}"
  fi
}

case "$COMMAND" in
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
esac
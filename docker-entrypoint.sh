#!/bin/sh
# Startet als root, korrigiert die Rechte von /data (z. B. wenn Docker ./data als root angelegt hat)
# und fuehrt die App dann als unprivilegierter Benutzer PUID:PGID aus.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${FILMLOG_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA_DIR"
    find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$0" "$@"
fi

if ! ( : > "$DATA_DIR/.write-test" ) 2>/dev/null; then
    echo "FEHLER: $DATA_DIR ist für Benutzer $(id -u):$(id -g) nicht beschreibbar." >&2
    echo "Auf dem Host z. B.: sudo chown -R $(id -u):$(id -g) ./data  (oder PUID/PGID passend setzen)" >&2
    exit 1
fi
rm -f "$DATA_DIR/.write-test"

exec "$@"

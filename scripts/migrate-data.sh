#!/usr/bin/env bash
#
# Migrate an existing Mangva data/ directory into the Docker container's volume.
#
# Mangva stores everything (accounts, read progress, library/activity,
# announcements, and the persisted JWT secret) as plain JSON files in data/.
# This script copies those files into the volume used by docker-compose so your
# old manual install carries over to the container.
#
# Usage:
#   ./scripts/migrate-data.sh [SOURCE_DATA_DIR]
#
#   SOURCE_DATA_DIR  Path to your old data/ folder. Defaults to ./data
#                    (run on a machine that can reach both the files and Docker;
#                    scp the folder over first if they live on different hosts).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SRC="${1:-./data}"
SERVICE="mangva"
DEST="/app/data"

# Files Mangva persists (see server/db.mjs + server/auth.mjs).
# .jwt-secret is last and optional — see the note at the end.
FILES=(users.json activity.json progress.json announcement.json removals.json manga-meta.json .jwt-secret)

# --- pick the compose command (v2 plugin or legacy v1) ---
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERROR: 'docker compose' not found. Install Docker Desktop or the compose plugin." >&2
  exit 1
fi

# --- validate the source directory ---
if [ ! -d "$SRC" ]; then
  echo "ERROR: source data directory not found: $SRC" >&2
  echo "       Pass the path to your old data/ folder, e.g.:" >&2
  echo "       ./scripts/migrate-data.sh /path/to/old/data" >&2
  exit 1
fi

found=()
for f in "${FILES[@]}"; do
  [ -f "$SRC/$f" ] && found+=("$f")
done

if [ ${#found[@]} -eq 0 ]; then
  echo "ERROR: no Mangva data files found in '$SRC'." >&2
  echo "       Expected one or more of: ${FILES[*]}" >&2
  exit 1
fi

echo "Source:      $(cd "$SRC" && pwd)"
echo "Destination: volume mounted at $DEST in service '$SERVICE'"
echo "Migrating:   ${found[*]}"
echo

# --- ensure the container + volume exist (builds the image if needed) ---
echo "→ Ensuring the container exists…"
$DC up -d

# --- stop the app so nothing writes mid-copy ---
echo "→ Pausing the app during copy…"
$DC stop "$SERVICE" >/dev/null

# --- copy each file into the volume via the container ---
for f in "${found[@]}"; do
  echo "  • $f"
  $DC cp "$SRC/$f" "$SERVICE:$DEST/$f"
done

# --- restart ---
echo "→ Restarting the app…"
$DC start "$SERVICE" >/dev/null

echo
echo "✅ Done. Accounts, read progress, and library are now in the container."

if [ ! -f "$SRC/.jwt-secret" ]; then
  cat <<'EOF'

Note on sign-in sessions:
  No .jwt-secret was migrated, so existing login sessions won't carry over —
  everyone (including you) signs in again once. All accounts and data are intact.

  To keep everyone signed in instead, set the SAME secret your old server used
  as JWT_SECRET in docker-compose.yml, then re-run. (If your old setup never set
  JWT_SECRET, sessions can't be preserved — just sign in again.)
EOF
fi

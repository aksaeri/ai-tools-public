#!/usr/bin/env bash
# Deploy the voice-widget relay to Cloudflare.
#
#   ./deploy.sh                 dry run (default): build the bundle, change nothing
#   ./deploy.sh --dry-run       same
#   ./deploy.sh --yes           copy ../package/voice-widget.js into public/v1/, then deploy
#   ./deploy.sh secrets         dry run: say which secrets would be pushed
#   ./deploy.sh secrets --yes   push GROQ_API_KEY and ADMIN_TOKEN from ../.env
#
# Secret values are read from ../.env and piped on stdin; they are never echoed
# or put on a command line. Wrangler uses your own Cloudflare login.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRANGLER=(npx --yes wrangler@4)
ENV_FILE="$HERE/../.env"
PKG_SRC="$HERE/../package/voice-widget.js"
PKG_DST="$HERE/public/v1/voice-widget.js"

die() { echo "deploy.sh: $*" >&2; exit 1; }

mode="deploy"
really=0
for arg in "$@"; do
  case "$arg" in
    secrets) mode="secrets" ;;
    --yes) really=1 ;;
    --dry-run) really=0 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

cd "$HERE"

# --- secrets --------------------------------------------------------------
# Map: wrangler secret name -> line in ../.env
SECRETS=("GROQ_API_KEY:GROQ_API_KEY_PROD" "ADMIN_TOKEN:VW_ADMIN_TOKEN")

env_value() {
  # Print the value of KEY from ../.env (first match, surrounding quotes removed, no newline).
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" | tr -d '\r\n'
}

if [ "$mode" = "secrets" ]; then
  [ -f "$ENV_FILE" ] || die "no .env at $ENV_FILE"
  for pair in "${SECRETS[@]}"; do
    line="${pair#*:}"
    grep -Eq "^${line}=.+" "$ENV_FILE" || die "missing line in .env: ${line}=<value> (see .env.example)"
  done
  for pair in "${SECRETS[@]}"; do
    name="${pair%%:*}"; line="${pair#*:}"
    if [ "$really" -eq 1 ]; then
      echo "Setting Worker secret $name from .env line $line"
      env_value "$line" | "${WRANGLER[@]}" secret put "$name"
    else
      echo "[dry run] would set Worker secret $name from .env line $line"
    fi
  done
  [ "$really" -eq 1 ] || echo "[dry run] nothing changed. Re-run with --yes to push."
  exit 0
fi

# --- deploy ---------------------------------------------------------------
if [ "$really" -eq 1 ]; then
  [ -f "$PKG_SRC" ] || die "package not built: $PKG_SRC is missing"
  mkdir -p "$(dirname "$PKG_DST")"
  cp "$PKG_SRC" "$PKG_DST"
  echo "Copied package -> public/v1/voice-widget.js ($(wc -c < "$PKG_DST") bytes)"
  "${WRANGLER[@]}" deploy
else
  if [ -f "$PKG_SRC" ]; then
    echo "[dry run] would copy ../package/voice-widget.js -> public/v1/voice-widget.js ($(wc -c < "$PKG_SRC") bytes)"
  else
    echo "[dry run] WARNING: ../package/voice-widget.js is missing; a real deploy would stop here"
  fi
  out="$(mktemp -d /tmp/voice-widget-dry.XXXXXX)"
  "${WRANGLER[@]}" deploy --dry-run --outdir "$out"
  echo "[dry run] bundle written to $out; nothing deployed. Re-run with --yes to deploy."
fi

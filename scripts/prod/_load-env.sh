#!/usr/bin/env bash
# Shared env-file loader. Source this file; do not execute directly.
#
# Usage:
#   # shellcheck source=_load-env.sh
#   . "$SCRIPT_DIR/_load-env.sh"
#   load_env_file "$ENV_FILE"

load_env_file() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"                             # strip inline comments
    line="${line#"${line%%[![:space:]]*}"}"         # trim leading whitespace
    line="${line%"${line##*[![:space:]]}"}"         # trim trailing whitespace
    [ -z "$line" ] && continue
    case "$line" in
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        export "$key=$value"
        ;;
      *) echo "[WARN] ignoring non-KEY=VALUE line in $env_file" >&2 ;;
    esac
  done < "$env_file"
}

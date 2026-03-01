#!/usr/bin/env bash
# Shared env-file loader. Source this file; do not execute directly.
#
# Usage:
#   # shellcheck source=_load-env.sh
#   . "$SCRIPT_DIR/_load-env.sh"
#   load_env_file "$ENV_FILE"

load_env_file() {
  local env_file="$1"
  local line key value
  # Intentionally return 0 when file is absent — callers that require the file
  # must check existence before calling this function.
  [ -f "$env_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"         # trim leading whitespace
    line="${line%"${line##*[![:space:]]}"}"         # trim trailing whitespace
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac         # skip full-line comments
    case "$line" in
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        # Validate key is a valid shell identifier
        case "$key" in
          "" | *[!A-Za-z0-9_]* | [0-9]*)
            echo "[WARN] invalid key '$key' in $env_file" >&2
            continue
            ;;
        esac
        eval "export ${key}=\"\${value}\""
        ;;
      *) echo "[WARN] ignoring non-KEY=VALUE line in $env_file" >&2 ;;
    esac
  done < "$env_file"
}

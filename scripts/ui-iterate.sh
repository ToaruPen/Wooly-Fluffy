#!/usr/bin/env bash

set -euo pipefail

eprint() { printf '%s\n' "$*" >&2; }

usage() {
  cat <<'EOF'
Usage: scripts/ui-iterate.sh <issue-number> [round-id] [options]

Capture UI screenshots for iterative redesign and run web checks.

Positional arguments:
  issue-number                Issue number (e.g. 99 or issue-99)
  round-id                    Optional round id (e.g. round-01 or 1)

Options:
  --route <path>              Target route (default: /kiosk)
  --base-url <url>            Base URL (default: $WF_BASE_URL or http://127.0.0.1:5173)
  --out-root <dir>            Output root (default: var/screenshot)
  --desktop-size <WxH>        Desktop viewport (default: 1280x720)
  --mobile-size <WxH>         Mobile viewport (default: 390x844)
  --skip-checks               Skip typecheck/lint/test
  --with-e2e                  Also run `npm run -w web e2e`
  --skip-capture              Skip screenshot capture
  --note <text>               Save note in round metadata
  --dry-run                   Print plan only
  -h, --help                  Show help

Examples:
  ./scripts/ui-iterate.sh 99
  ./scripts/ui-iterate.sh 99 round-02 --route /staff
  ./scripts/ui-iterate.sh 99 3 --route /kiosk --with-e2e

Outputs:
  <out-root>/issue-<n>/round-<xx>/
    - <route>-desktop.png
    - <route>-mobile.png
    - checks/*.log
    - meta.txt

EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    eprint "Missing command: $cmd"
    exit 1
  fi
}

normalize_issue_number() {
  local raw="$1"
  if [[ "$raw" =~ ^issue-([0-9]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$raw"
    return 0
  fi
  return 1
}

normalize_round_id() {
  local raw="$1"
  if [[ -z "$raw" ]]; then
    return 1
  fi
  if [[ "$raw" =~ ^round-([0-9]+)$ ]]; then
    printf 'round-%02d\n' "$((10#${BASH_REMATCH[1]}))"
    return 0
  fi
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf 'round-%02d\n' "$((10#$raw))"
    return 0
  fi
  return 1
}

validate_size() {
  local raw="$1"
  if [[ ! "$raw" =~ ^[0-9]+x[0-9]+$ ]]; then
    return 1
  fi
  local w="${raw%x*}"
  local h="${raw#*x}"
  if [[ "$w" -lt 200 || "$h" -lt 200 ]]; then
    return 1
  fi
  return 0
}

next_round_id() {
  local issue_dir="$1"
  local max_n=0
  if [[ -d "$issue_dir" ]]; then
    while IFS= read -r path; do
      local base
      base="$(basename "$path")"
      if [[ "$base" =~ ^round-([0-9]+)$ ]]; then
        local n=$((10#${BASH_REMATCH[1]}))
        if [[ "$n" -gt "$max_n" ]]; then
          max_n="$n"
        fi
      fi
    done < <(find "$issue_dir" -maxdepth 1 -type d -name 'round-*' 2>/dev/null || true)
  fi
  printf 'round-%02d\n' "$((max_n + 1))"
}

run_check() {
  local name="$1"
  local cmd="$2"
  local log_file="$3"

  set +e
  bash -lc "$cmd" >"$log_file" 2>&1
  local ec=$?
  set -e

  if [[ "$ec" -ne 0 ]]; then
    eprint "Check failed: $name (exit=$ec)"
    eprint "See log: $log_file"
    return "$ec"
  fi
  return 0
}

issue_arg=""
round_arg=""

route="/kiosk"
base_url="${WF_BASE_URL:-http://127.0.0.1:5173}"
out_root="var/screenshot"
desktop_size="1280x720"
mobile_size="390x844"
run_checks=1
run_e2e=0
run_capture=1
dry_run=0
note=""

args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --route)
      route="${2:-}"
      shift 2
      ;;
    --base-url)
      base_url="${2:-}"
      shift 2
      ;;
    --out-root)
      out_root="${2:-}"
      shift 2
      ;;
    --desktop-size)
      desktop_size="${2:-}"
      shift 2
      ;;
    --mobile-size)
      mobile_size="${2:-}"
      shift 2
      ;;
    --skip-checks)
      run_checks=0
      shift
      ;;
    --with-e2e)
      run_e2e=1
      shift
      ;;
    --skip-capture)
      run_capture=0
      shift
      ;;
    --note)
      note="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        args+=("$1")
        shift
      done
      ;;
    -*)
      eprint "Unknown option: $1"
      usage
      exit 2
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done

if [[ "${#args[@]}" -lt 1 || "${#args[@]}" -gt 2 ]]; then
  usage
  exit 2
fi

issue_arg="${args[0]}"
round_arg="${args[1]:-}"

issue_number="$(normalize_issue_number "$issue_arg" || true)"
if [[ -z "$issue_number" ]]; then
  eprint "Invalid issue-number: $issue_arg"
  exit 2
fi

if [[ -n "$round_arg" ]]; then
  round_id="$(normalize_round_id "$round_arg" || true)"
  if [[ -z "$round_id" ]]; then
    eprint "Invalid round-id: $round_arg (use round-01 or 1)"
    exit 2
  fi
else
  round_id=""
fi

if [[ -z "$route" ]]; then
  eprint "--route is required"
  exit 2
fi
if [[ "$route" != /* ]]; then
  route="/$route"
fi

if ! validate_size "$desktop_size"; then
  eprint "Invalid --desktop-size: $desktop_size (expected WxH, minimum 200x200)"
  exit 2
fi
if ! validate_size "$mobile_size"; then
  eprint "Invalid --mobile-size: $mobile_size (expected WxH, minimum 200x200)"
  exit 2
fi

require_cmd git
require_cmd node
require_cmd npm

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  eprint "Not in a git repository"
  exit 1
fi

issue_dir="$repo_root/$out_root/issue-$issue_number"
if [[ -z "$round_id" ]]; then
  round_id="$(next_round_id "$issue_dir")"
fi
round_dir="$issue_dir/$round_id"
checks_dir="$round_dir/checks"

route_slug="$(printf '%s' "$route" | sed -E 's#^/##; s#[^A-Za-z0-9]+#-#g; s#(^-|-$)##g')"
if [[ -z "$route_slug" ]]; then
  route_slug="home"
fi

target_url="${base_url%/}${route}"

if [[ "$dry_run" -eq 1 ]]; then
  eprint "Plan:"
  eprint "- repo_root: $repo_root"
  eprint "- issue: $issue_number"
  eprint "- round: $round_id"
  eprint "- route: $route"
  eprint "- target_url: $target_url"
  eprint "- out_dir: $round_dir"
  eprint "- desktop_size: $desktop_size"
  eprint "- mobile_size: $mobile_size"
  eprint "- run_checks: $run_checks"
  eprint "- run_e2e: $run_e2e"
  eprint "- run_capture: $run_capture"
  exit 0
fi

mkdir -p "$checks_dir"

meta_file="$round_dir/meta.txt"
{
  printf 'issue=%s\n' "$issue_number"
  printf 'round=%s\n' "$round_id"
  printf 'route=%s\n' "$route"
  printf 'target_url=%s\n' "$target_url"
  printf 'desktop_size=%s\n' "$desktop_size"
  printf 'mobile_size=%s\n' "$mobile_size"
  printf 'timestamp=%s\n' "$(date +"%Y-%m-%dT%H:%M:%S%z")"
  if [[ -n "$note" ]]; then
    printf 'note=%s\n' "$note"
  fi
} > "$meta_file"

if [[ "$run_checks" -eq 1 ]]; then
  run_check "web-typecheck" "npm run -w web typecheck" "$checks_dir/web-typecheck.log"
  run_check "web-lint" "npm run -w web lint" "$checks_dir/web-lint.log"
  run_check "web-test" "npm run -w web test" "$checks_dir/web-test.log"
  if [[ "$run_e2e" -eq 1 ]]; then
    run_check "web-e2e" "npm run -w web e2e" "$checks_dir/web-e2e.log"
  fi
fi

desktop_file="$round_dir/${route_slug}-desktop.png"
mobile_file="$round_dir/${route_slug}-mobile.png"

if [[ "$run_capture" -eq 1 ]]; then
  require_cmd curl
  if ! curl -fsS "$target_url" >/dev/null; then
    eprint "Target URL is unreachable: $target_url"
    eprint "Start web server first (example: npm run -w web dev -- --host 127.0.0.1 --port 5173)"
    exit 1
  fi

  desktop_w="${desktop_size%x*}"
  desktop_h="${desktop_size#*x}"
  mobile_w="${mobile_size%x*}"
  mobile_h="${mobile_size#*x}"

  node - "$target_url" "$desktop_file" "$mobile_file" "$desktop_w" "$desktop_h" "$mobile_w" "$mobile_h" <<'NODE'
const [url, desktopFile, mobileFile, desktopW, desktopH, mobileW, mobileH] = process.argv.slice(2);

const { chromium } = require("playwright");

const toInt = (value, name) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid ${name}: ${value}`);
  }
  return parsed;
};

const capture = async (page, path) => {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!response || !response.ok()) {
    const status = response ? response.status() : "no-response";
    throw new Error(`failed to load ${url} (${status})`);
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
    // Best-effort only.
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path, fullPage: true });
};

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const desktopPage = await browser.newPage({
      viewport: { width: toInt(desktopW, "desktopW"), height: toInt(desktopH, "desktopH") },
    });
    await capture(desktopPage, desktopFile);
    await desktopPage.close();

    const mobilePage = await browser.newPage({
      viewport: { width: toInt(mobileW, "mobileW"), height: toInt(mobileH, "mobileH") },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await capture(mobilePage, mobileFile);
    await mobilePage.close();
  } finally {
    await browser.close();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
NODE
fi

printf '%s\n' "UI iteration round generated:"
printf '%s\n' "- meta: ${meta_file#$repo_root/}"
if [[ "$run_capture" -eq 1 ]]; then
  printf '%s\n' "- screenshot(desktop): ${desktop_file#$repo_root/}"
  printf '%s\n' "- screenshot(mobile): ${mobile_file#$repo_root/}"
fi
if [[ "$run_checks" -eq 1 ]]; then
  printf '%s\n' "- checks: ${checks_dir#$repo_root/}"
fi

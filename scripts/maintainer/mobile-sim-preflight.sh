#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR=""
UDID="booted"
APP_URL=""
ERASE=0
WAIT_SECONDS=5
STRICT_POPUP_CHECK=1

print_usage() {
  cat <<USAGE
mobile-sim-preflight.sh

Usage:
  scripts/maintainer/mobile-sim-preflight.sh [options]

Options:
  --udid <sim_udid|booted>       Simulator UDID (default: booted)
  --out-dir <path>               Output directory (default: output/mobile-soak-<ts>/preflight)
  --app-url <url>                Optional deep link to open during preflight
  --erase                         Erase simulator before boot
  --wait-seconds <n>             Wait seconds after boot/open-url (default: 5)
  --no-strict-popup-check        Do not exit non-zero when popup is detected
  -h, --help                     Show help

Environment:
  MOBILE_PRECHECK_APP_URL        Optional deep link fallback
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --udid)
      UDID="$2"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --app-url)
      APP_URL="$2"
      shift 2
      ;;
    --erase)
      ERASE=1
      shift
      ;;
    --wait-seconds)
      WAIT_SECONDS="$2"
      shift 2
      ;;
    --no-strict-popup-check)
      STRICT_POPUP_CHECK=0
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "[preflight] unknown arg: $1" >&2
      print_usage
      exit 2
      ;;
  esac
done

APP_URL="${APP_URL:-${MOBILE_PRECHECK_APP_URL:-}}"

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$ROOT_DIR/output/mobile-soak-$(date +%s)/preflight"
elif [[ "$OUT_DIR" != /* ]]; then
  OUT_DIR="$ROOT_DIR/$OUT_DIR"
fi

mkdir -p "$OUT_DIR"

PRE_BOOT_SHOT="$OUT_DIR/launch.png"
POST_BOOT_SHOT="$OUT_DIR/preflight.png"
JSON_OUT="$OUT_DIR/preflight.json"

resolve_udid() {
  local raw="$1"
  if [[ "$raw" != "booted" ]]; then
    echo "$raw"
    return 0
  fi

  local detected
  detected="$(xcrun simctl list devices | awk -F '[()]' '/Booted/{print $2; exit}')"
  if [[ -n "$detected" ]]; then
    echo "$detected"
    return 0
  fi

  detected="$(xcrun simctl list devices available | awk -F '[()]' '/iPhone/{print $2; exit}')"
  if [[ -n "$detected" ]]; then
    echo "$detected"
    return 0
  fi

  echo ""
}

TARGET_UDID="$(resolve_udid "$UDID")"
if [[ -z "$TARGET_UDID" ]]; then
  echo "[preflight] failed to resolve simulator UDID" >&2
  exit 3
fi

echo "[preflight] target_udid=$TARGET_UDID out_dir=$OUT_DIR"

xcrun simctl shutdown all >/dev/null 2>&1 || true
if [[ "$ERASE" -eq 1 ]]; then
  xcrun simctl erase "$TARGET_UDID" >/dev/null 2>&1 || true
fi

xcrun simctl boot "$TARGET_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$TARGET_UDID" -b

# Screenshot at launch/home state
xcrun simctl io "$TARGET_UDID" screenshot "$PRE_BOOT_SHOT" >/dev/null 2>&1 || true

if [[ -n "$APP_URL" ]]; then
  xcrun simctl openurl "$TARGET_UDID" "$APP_URL" >/dev/null 2>&1 || true
fi

sleep "$WAIT_SECONDS"

xcrun simctl io "$TARGET_UDID" screenshot "$POST_BOOT_SHOT" >/dev/null 2>&1 || true

POPUP_BLOCKED=false
POPUP_SIGNALS=()

if command -v tesseract >/dev/null 2>&1 && [[ -f "$POST_BOOT_SHOT" ]]; then
  OCR_TEXT="$(tesseract "$POST_BOOT_SHOT" stdout 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)"
  if grep -q "open in" <<<"$OCR_TEXT"; then
    POPUP_BLOCKED=true
    POPUP_SIGNALS+=("open_in_prompt")
  fi
  if grep -q "no script url provided" <<<"$OCR_TEXT"; then
    POPUP_BLOCKED=true
    POPUP_SIGNALS+=("no_script_url")
  fi
  if grep -q "packager is running" <<<"$OCR_TEXT"; then
    POPUP_BLOCKED=true
    POPUP_SIGNALS+=("metro_not_attached")
  fi
  if grep -q "could not connect to the server" <<<"$OCR_TEXT"; then
    POPUP_BLOCKED=true
    POPUP_SIGNALS+=("runtime_connection_issue")
  fi
  if grep -q "developer menu" <<<"$OCR_TEXT"; then
    POPUP_BLOCKED=true
    POPUP_SIGNALS+=("expo_dev_menu")
  fi
  if grep -q "expo go" <<<"$OCR_TEXT"; then
    POPUP_BLOCKED=true
    POPUP_SIGNALS+=("expo_go_overlay")
  fi
fi

if command -v node >/dev/null 2>&1 && [[ -f "$POST_BOOT_SHOT" ]]; then
  REDBOX_DETECTED="$(node - "$POST_BOOT_SHOT" <<'NODE'
const fs = require("fs");
const shotPath = process.argv[2];
let detected = false;
try {
  const { PNG } = require("pngjs");
  const raw = fs.readFileSync(shotPath);
  const png = PNG.sync.read(raw);
  const width = Number(png.width || 0);
  const height = Number(png.height || 0);
  if (width > 0 && height > 0) {
    const rows = Math.min(220, height);
    let opaque = 0;
    let redLike = 0;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (width * y + x) * 4;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        const a = png.data[idx + 3];
        if (a < 220) continue;
        opaque += 1;
        if (r >= 170 && g <= 95 && b <= 110) redLike += 1;
      }
    }
    if (opaque > 0) {
      const ratio = redLike / opaque;
      detected = ratio >= 0.12;
    }
  }
} catch {
  detected = false;
}
process.stdout.write(detected ? "true" : "false");
NODE
)"
  if [[ "$REDBOX_DETECTED" == "true" ]]; then
    POPUP_BLOCKED=true
    POPUP_SIGNALS+=("react_native_redbox")
  fi
fi

if [[ -z "$APP_URL" ]]; then
  POPUP_SIGNALS+=("app_url_not_provided")
fi

signals_json="[]"
if [[ ${#POPUP_SIGNALS[@]} -gt 0 ]]; then
  joined=""
  for signal in "${POPUP_SIGNALS[@]}"; do
    if [[ -n "$joined" ]]; then
      joined+=" ,"
    fi
    joined+="\"$signal\""
  done
  signals_json="[$joined]"
fi

cat > "$JSON_OUT" <<JSON
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "targetUdid": "$TARGET_UDID",
  "appUrl": "${APP_URL}",
  "erase": $([[ "$ERASE" -eq 1 ]] && echo true || echo false),
  "waitSeconds": $WAIT_SECONDS,
  "popupBlocked": $([[ "$POPUP_BLOCKED" == "true" ]] && echo true || echo false),
  "popupSignals": $signals_json,
  "screenshots": {
    "launch": "$PRE_BOOT_SHOT",
    "preflight": "$POST_BOOT_SHOT"
  }
}
JSON

cat "$JSON_OUT"

if [[ "$POPUP_BLOCKED" == "true" && "$STRICT_POPUP_CHECK" -eq 1 ]]; then
  echo "[preflight] popup detected, blocking run" >&2
  exit 4
fi

exit 0

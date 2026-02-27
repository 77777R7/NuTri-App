#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
INTERVAL_SEC="${1:-30}"

while true; do
  "${ROOT_DIR}/scripts/maintainer/backend-health-check.sh" || true
  sleep "${INTERVAL_SEC}"
done


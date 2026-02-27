#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PID_FILE="${ROOT_DIR}/output/monitoring/backend-health-watch.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "backend-watch is not running (pid file missing)"
  exit 0
fi

pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
if [[ -z "${pid}" ]]; then
  rm -f "${PID_FILE}"
  echo "backend-watch pid file was empty, cleaned."
  exit 0
fi

if kill -0 "${pid}" 2>/dev/null; then
  kill "${pid}" || true
  sleep 1
fi

rm -f "${PID_FILE}"
echo "backend-watch stopped (pid=${pid})"


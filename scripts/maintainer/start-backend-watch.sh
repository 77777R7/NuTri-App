#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MON_DIR="${ROOT_DIR}/output/monitoring"
LOG_FILE="${MON_DIR}/backend-health.log"
PID_FILE="${MON_DIR}/backend-health-watch.pid"
INTERVAL_SEC="${BACKEND_WATCH_INTERVAL_SEC:-30}"

mkdir -p "${MON_DIR}"

if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    echo "backend-watch already running (pid=${existing_pid})"
    exit 0
  fi
fi

nohup "${ROOT_DIR}/scripts/maintainer/backend-watch-loop.sh" "${INTERVAL_SEC}" >>"${LOG_FILE}" 2>&1 &
watch_pid="$!"
echo "${watch_pid}" >"${PID_FILE}"

echo "backend-watch started (pid=${watch_pid})"
echo "log=${LOG_FILE}"
echo "pid_file=${PID_FILE}"

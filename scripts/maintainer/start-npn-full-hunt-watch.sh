#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/maintainer/start-npn-full-hunt-watch.sh <run-dir> [interval-sec]"
  exit 1
fi

RUN_DIR_INPUT="$1"
INTERVAL_SEC="${2:-60}"
RUN_DIR="${RUN_DIR_INPUT}"
if [[ "${RUN_DIR}" != /* ]]; then
  RUN_DIR="${ROOT_DIR}/${RUN_DIR}"
fi

MON_DIR="${RUN_DIR}/monitoring"
PID_FILE="${MON_DIR}/watch.pid"
LOG_FILE="${MON_DIR}/watch.log"

mkdir -p "${MON_DIR}"

if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    echo "npn-watch already running (pid=${existing_pid})"
    echo "log=${LOG_FILE}"
    exit 0
  fi
fi

nohup node "${ROOT_DIR}/scripts/maintainer/npn-full-hunt-watch.mjs" \
  --run-dir "${RUN_DIR}" \
  --interval-sec "${INTERVAL_SEC}" \
  --no-exit-when-stopped \
  >>"${LOG_FILE}" 2>&1 &

watch_pid="$!"
echo "${watch_pid}" >"${PID_FILE}"

echo "npn-watch started (pid=${watch_pid})"
echo "run_dir=${RUN_DIR}"
echo "log=${LOG_FILE}"
echo "pid_file=${PID_FILE}"

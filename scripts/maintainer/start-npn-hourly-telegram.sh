#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/maintainer/start-npn-hourly-telegram.sh <run-dir> [interval-sec] [runtime-signal-dir]"
  exit 1
fi

RUN_DIR_INPUT="$1"
INTERVAL_SEC="${2:-3600}"
RUNTIME_SIGNAL_DIR_INPUT="${3:-}"
if [[ "${INTERVAL_SEC}" -lt 60 ]]; then
  echo "interval-sec must be >= 60"
  exit 1
fi

RUN_DIR="${RUN_DIR_INPUT}"
if [[ "${RUN_DIR}" != /* ]]; then
  RUN_DIR="${ROOT_DIR}/${RUN_DIR}"
fi

RUNTIME_SIGNAL_ARG=""
if [[ -n "${RUNTIME_SIGNAL_DIR_INPUT}" ]]; then
  RUNTIME_SIGNAL_DIR="${RUNTIME_SIGNAL_DIR_INPUT}"
  if [[ "${RUNTIME_SIGNAL_DIR}" != /* ]]; then
    RUNTIME_SIGNAL_DIR="${ROOT_DIR}/${RUNTIME_SIGNAL_DIR}"
  fi
  RUNTIME_SIGNAL_ARG=" --runtime-signal-dir \"${RUNTIME_SIGNAL_DIR}\""
fi

MON_DIR="${RUN_DIR}/monitoring"
PID_FILE="${MON_DIR}/hourly_telegram.pid"
LOG_FILE="${MON_DIR}/hourly_telegram.log"

mkdir -p "${MON_DIR}"

if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    echo "npn-hourly-telegram already running (pid=${existing_pid})"
    echo "run_dir=${RUN_DIR}"
    echo "log=${LOG_FILE}"
    exit 0
  fi
fi

nohup bash -lc "while true; do if ! node \"${ROOT_DIR}/scripts/maintainer/npn-hourly-telegram.mjs\" --run-dir \"${RUN_DIR}\"${RUNTIME_SIGNAL_ARG}; then echo \"[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] npn-hourly-telegram iteration failed\"; fi; sleep ${INTERVAL_SEC}; done" \
  >>"${LOG_FILE}" 2>&1 &

telegram_pid="$!"
echo "${telegram_pid}" >"${PID_FILE}"

echo "npn-hourly-telegram started (pid=${telegram_pid})"
echo "run_dir=${RUN_DIR}"
echo "interval_sec=${INTERVAL_SEC}"
echo "log=${LOG_FILE}"
echo "pid_file=${PID_FILE}"

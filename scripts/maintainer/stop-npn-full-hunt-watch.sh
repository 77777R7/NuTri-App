#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/maintainer/stop-npn-full-hunt-watch.sh <run-dir>"
  exit 1
fi

RUN_DIR_INPUT="$1"
RUN_DIR="${RUN_DIR_INPUT}"
if [[ "${RUN_DIR}" != /* ]]; then
  RUN_DIR="${ROOT_DIR}/${RUN_DIR}"
fi

PID_FILE="${RUN_DIR}/monitoring/watch.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "npn-watch is not running (pid file missing)"
  exit 0
fi

pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
if [[ -z "${pid}" ]]; then
  rm -f "${PID_FILE}"
  echo "npn-watch pid file empty, cleaned."
  exit 0
fi

if kill -0 "${pid}" 2>/dev/null; then
  kill "${pid}" || true
  sleep 1
fi

rm -f "${PID_FILE}"
echo "npn-watch stopped (pid=${pid})"


#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3001}"
URL="${2:-http://127.0.0.1:${PORT}/health}"
TIMEOUT_SEC="${BACKEND_HEALTH_TIMEOUT_SEC:-4}"
CONNECT_TIMEOUT_SEC="${BACKEND_HEALTH_CONNECT_TIMEOUT_SEC:-1}"
RETRY_COUNT="${BACKEND_HEALTH_RETRY_COUNT:-0}"
RETRY_DELAY_SEC="${BACKEND_HEALTH_RETRY_DELAY_SEC:-0}"
METHOD="$(printf "%s" "${BACKEND_HEALTH_METHOD:-GET}" | tr '[:lower:]' '[:upper:]')"

if [[ "${METHOD}" != "GET" && "${METHOD}" != "HEAD" ]]; then
  METHOD="GET"
fi

pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
http_code="000"
err_msg=""
tmp_err="$(mktemp)"

curl_args=(
  -sS
  -m "${TIMEOUT_SEC}"
  --connect-timeout "${CONNECT_TIMEOUT_SEC}"
  -X "${METHOD}"
  -o /dev/null
  -w "%{http_code}"
)

if [[ "${RETRY_COUNT}" -gt 0 ]]; then
  curl_args+=(--retry "${RETRY_COUNT}" --retry-delay "${RETRY_DELAY_SEC}" --retry-connrefused)
fi

curl_args+=("${URL}")

if curl "${curl_args[@]}" >"${tmp_err}.code" 2>"${tmp_err}"; then
  http_code="$(cat "${tmp_err}.code")"
else
  http_code="000"
  err_msg="$(tr '\n' ' ' <"${tmp_err}" | sed 's/"/\\"/g')"
fi

rm -f "${tmp_err}" "${tmp_err}.code"

status="healthy"
if [[ -z "${pid}" || "${http_code}" != "200" ]]; then
  status="unhealthy"
fi

ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
printf '{"ts":"%s","status":"%s","port":%s,"pid":"%s","http":"%s","url":"%s","error":"%s"}\n' \
  "${ts}" "${status}" "${PORT}" "${pid}" "${http_code}" "${URL}" "${err_msg}"

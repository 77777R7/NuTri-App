#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: scripts/maintainer/run_top100_lane1_batch.sh <out-dir> <batch-id> [extra-args...]"
  exit 1
fi

OUT_DIR="$1"
BATCH_ID="$2"
shift 2

cd "$(dirname "$0")/../.."

node scripts/maintainer/run_top100_lane1_orchestrator.mjs \
  --mode batch \
  --out-dir "$OUT_DIR" \
  --batch-id "$BATCH_ID" \
  "$@"


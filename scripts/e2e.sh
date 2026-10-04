#!/bin/bash
# Backend end-to-end check: upload a clip, wait for separation (+ recovery),
# then check the result, a stem download and its spectrogram.
#
# usage: scripts/e2e.sh <clip.wav> <separation_model> [recovery_model]
#   BASE=http://localhost:8000 (default) points at the backend.
#   KEEP=1 keeps the test job (by default it's deleted on exit, pass or fail,
#   so repeated runs don't fill the jobs list).
# Exits non-zero if the job fails, times out, or a download is missing.
set -u
CLIP=${1:?usage: e2e.sh <clip.wav> <model> [recovery_model]}
MODEL=${2:?separation model, e.g. htdemucs}
RECOVERY=${3:-}
BASE=${BASE:-http://localhost:8000}
start=$(date +%s)

json() { python -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

if [ -n "$RECOVERY" ]; then
  TID=$(curl -s -F "file=@$CLIP" -F "model=$MODEL" -F "recover=true" -F "recovery_model=$RECOVERY" "$BASE/upload" | json "d['task_id']")
else
  TID=$(curl -s -F "file=@$CLIP" -F "model=$MODEL" "$BASE/upload" | json "d['task_id']")
fi
[ -n "$TID" ] || { echo "FAIL: upload rejected"; exit 1; }
cleanup() {
  [ "${KEEP:-0}" = 1 ] && return
  curl -s -o /dev/null -X POST "$BASE/tasks/$TID/cancel"
  for _ in 1 2 3 4 5; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/tasks/$TID")" != 409 ] && return
    sleep 2
  done
}
trap cleanup EXIT
echo "[$MODEL${RECOVERY:++$RECOVERY}] task $TID"

last=""
while true; do
  S=$(curl -s "$BASE/status/$TID")
  [ "$S" != "$last" ] && echo "  $(( $(date +%s) - start ))s $S"
  last="$S"
  echo "$S" | grep -q -E '"status": ?"completed"' && break
  echo "$S" | grep -q -E '"status": ?"failed"' && { echo "FAIL: job failed"; exit 1; }
  [ $(( $(date +%s) - start )) -gt 1800 ] && { echo "FAIL: timeout"; exit 1; }
  sleep 3
done

RESULT=$(curl -s "$BASE/result/$TID")
TRACK=$(echo "$RESULT" | json "d['tracks'][0]")
echo "  tracks: $(echo "$RESULT" | json "', '.join(d['tracks'])")"
variants="original"
[ -n "$RECOVERY" ] && variants="original recovered"
for v in $variants; do
  dl=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/download/$TID/$TRACK?variant=$v")
  sp=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/spectrogram/$TID/$TRACK?variant=$v")
  echo "  $TRACK/$v: download $dl, spectrogram $sp"
  [ "$dl" = 200 ] && [ "$sp" = 200 ] || { echo "FAIL: $TRACK/$v"; exit 1; }
done
echo "PASS in $(( $(date +%s) - start ))s"

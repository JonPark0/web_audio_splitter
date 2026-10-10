#!/bin/sh
# Build-time only: `retry <attempts> <command...>` re-runs a flaky download
# with a growing pause (15 s, 30 s, ...). The checkpoint prefetches in the
# Dockerfile use it so a stalled link to Hugging Face's CDN doesn't fail the
# whole build: each try resumes the .incomplete file huggingface_hub left in
# its cache, so no bytes already received are fetched again.
attempts=$1
shift
i=1
until "$@"; do
    if [ "$i" -ge "$attempts" ]; then
        echo "retry: still failing after $i attempts: $*" >&2
        exit 1
    fi
    echo "retry: attempt $i of $attempts failed; trying again in $((i * 15)) s" >&2
    sleep $((i * 15))
    i=$((i + 1))
done

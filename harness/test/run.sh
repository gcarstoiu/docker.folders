#!/bin/bash
#
# Run the UI tests against the harness.
#
#   ./harness/test/run.sh [name-filter]
#
# Starts a headless Chrome with CDP exposed (in Docker, so nothing is
# installed on the host), waits for the harness, then drives it with
# puppeteer-core. The harness itself must already be running:
#
#   ./harness/serve.sh &
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${HARNESS_PORT:-8089}"
CDP_PORT="${CDP_PORT:-9222}"
NAME=simple-folders-chrome

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

curl -sf -o /dev/null "http://localhost:$PORT/" || {
  echo "error: harness is not answering on $PORT - start ./harness/serve.sh first" >&2
  exit 1
}

cleanup
docker run -d --rm --name "$NAME" --network host -e HOME=/tmp \
  --entrypoint chromium-browser zenika/alpine-chrome \
  --headless --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --user-data-dir=/tmp/cdp --hide-scrollbars \
  --remote-debugging-address=0.0.0.0 --remote-debugging-port="$CDP_PORT" \
  about:blank >/dev/null

# Wait for CDP rather than sleeping a fixed amount.
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$CDP_PORT/json/version" && break
  sleep 0.25
done

HARNESS_URL="http://localhost:$PORT" CDP_URL="http://localhost:$CDP_PORT" \
  node "$HERE/ui.mjs" "${1:-}"

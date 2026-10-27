#!/bin/bash
#
# Run the local Unraid harness.
#
#   ./harness/serve.sh [port]
#
# Environment:
#   HARNESS_LATENCY          seconds per simulated docker action (default 0.6; 0 = instant)
#   HARNESS_FAIL             "name:action" list to force failures, e.g. "sonarr:stop,radarr:*"
#   HARNESS_UNRAID_VERSION   version the mock reports (default 7.3.4)
#
# Then open http://localhost:<port>/
#
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$HARNESS")"
PORT="${1:-8089}"

# Unraid 7.2-7.4 ship PHP 8.3, so match that rather than whatever is newest.
PHP_IMAGE="${PHP_IMAGE:-php:8.3-cli-alpine}"

mkdir -p "$HARNESS/state"
chmod +x "$HARNESS/mock/plugins/dynamix.docker.manager/scripts/update_container" 2>/dev/null || true

echo "docker.folders harness"
echo "  url       http://localhost:$PORT/"
echo "  latency   ${HARNESS_LATENCY:-0.6}s per action"
echo "  failures  ${HARNESS_FAIL:-none}"
echo "  unraid    ${HARNESS_UNRAID_VERSION:-7.3.4}"
echo "  state     $HARNESS/state  (reset at /_reset)"

# -d auto_prepend_file reproduces Unraid's global CSRF gate, which is installed
# the same way (php.ini auto_prepend_file) on a real server.
# The built-in server is single-threaded; PHP_CLI_SERVER_WORKERS lets the
# long-poll nchan mock block without stalling every other request.
php_args=(
  -d auto_prepend_file=/app/harness/prepend.php
  -d max_execution_time=60
  -S "0.0.0.0:$PORT"
  -t /app/harness/mock
  /app/harness/router.php
)

if command -v php >/dev/null 2>&1; then
  echo "  php       $(php -r 'echo PHP_VERSION;') (local)"
  echo
  # Rewrite the container paths back to host paths for a local run.
  php_args=( "${php_args[@]//\/app/$REPO}" )
  php_args=( "${php_args[@]/0.0.0.0:$PORT/localhost:$PORT}" )
  PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-6}" exec php "${php_args[@]}"
fi

command -v docker >/dev/null 2>&1 || {
  echo "error: neither php nor docker found on PATH" >&2
  echo "       install php-cli, or docker to run $PHP_IMAGE" >&2
  exit 1
}

echo "  php       $PHP_IMAGE (docker - no php on this host)"
echo
# -it only when there is a terminal; CI and background runs have neither.
tty_flags=()
[ -t 0 ] && [ -t 1 ] && tty_flags=(-it)

exec docker run --rm "${tty_flags[@]}" \
  --name docker-folders-harness \
  -p "$PORT:$PORT" \
  -v "$REPO:/app" \
  -w /app \
  -e PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-6}" \
  -e HARNESS_LATENCY="${HARNESS_LATENCY:-}" \
  -e HARNESS_FAIL="${HARNESS_FAIL:-}" \
  -e HARNESS_UNRAID_VERSION="${HARNESS_UNRAID_VERSION:-}" \
  -u "$(id -u):$(id -g)" \
  "$PHP_IMAGE" php "${php_args[@]}"

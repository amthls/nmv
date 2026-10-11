#!/bin/sh
# Starts as root only to make the writable directories usable by the unprivileged `node` user,
# then runs the real command as `node`. Checks "can node write here?" rather than ownership:
# Docker Desktop bind mounts report root ownership but are world-writable, and a recursive chown
# on every start would be slow on a big uploads folder.
set -e
if [ "$(id -u)" = "0" ]; then
  for dir in /app/uploads /app/exports /app/.cache; do
    [ -d "$dir" ] || continue
    if ! setpriv --reuid=node --regid=node --init-groups test -w "$dir"; then
      echo "[entrypoint] giving node write access to $dir"
      chown -R node:node "$dir" || echo "[entrypoint] warning: could not chown $dir"
    fi
  done
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"

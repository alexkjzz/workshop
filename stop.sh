#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$ROOT/.runtime"

for service in simulator frontend backend mosquitto; do
  pid_file="$RUNTIME/$service.pid"
  if [[ ! -f "$pid_file" ]]; then
    printf '%s : aucun processus gere par run.sh.\n' "$service"
    continue
  fi

  IFS= read -r pid < "$pid_file"
  if [[ ! "$pid" =~ ^[0-9]+$ || "$pid" -le 1 ]]; then
    printf '%s : fichier PID invalide, aucun processus arrete.\n' "$service" >&2
    exit 1
  fi
  recorded_start="$(sed -n '2p' "$pid_file")"
  current_start="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"

  if [[ -z "$current_start" || "$current_start" != "$recorded_start" ]]; then
    printf '%s : processus deja termine ou PID reutilise, laisse intact.\n' "$service"
    rm -f "$pid_file"
    continue
  fi

  kill -TERM -- "-$pid" 2>/dev/null || true
  for ((attempt = 0; attempt < 50; attempt++)); do
    if ! kill -0 -- "-$pid" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  if kill -0 -- "-$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
  printf '%s : arrete.\n' "$service"
done
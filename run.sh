#!/usr/bin/env bash
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$ROOT/.runtime"
BACKEND="$ROOT/iot-backend"
FRONTEND="$ROOT/iot-frontend"
STARTED=()

for executable in node lsof; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Commande requise introuvable : %s\n' "$executable" >&2
    exit 1
  fi
done

if [[ ! -x "$BACKEND/node_modules/.bin/tsx" || ! -x "$FRONTEND/node_modules/.bin/vite" ]]; then
  printf 'Installe les dependances avec bash install.sh (voir README.md).\n' >&2
  exit 1
fi

mkdir -p "$RUNTIME"

cleanup() {
  local exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    for service in "${STARTED[@]}"; do
      local pid
      IFS= read -r pid < "$RUNTIME/$service.pid"
      kill -TERM -- "-$pid" 2>/dev/null || true
      rm -f "$RUNTIME/$service.pid"
    done
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

start_service() {
  local service="$1" port="$2" directory="$3"
  shift 3
  if [[ "$port" -ne 0 ]] && port_in_use "$port"; then
    printf '%s : service deja actif sur le port %s, laisse intact.\n' "$service" "$port"
    return
  fi

  if [[ -f "$RUNTIME/$service.pid" ]]; then
    local previous_pid recorded_start current_start
    IFS= read -r previous_pid < "$RUNTIME/$service.pid"
    recorded_start="$(sed -n '2p' "$RUNTIME/$service.pid")"
    current_start="$(ps -p "$previous_pid" -o lstart= 2>/dev/null || true)"
    if [[ -n "$current_start" && "$current_start" == "$recorded_start" ]]; then
      if [[ "$port" -eq 0 ]] && grep -q '^Simulateur MQTT pret\.' "$RUNTIME/$service.log"; then
        printf '%s : deja actif.\n' "$service"
        return
      fi
      printf '%s est deja lance mais ne repond pas. Lance bash stop.sh puis reessaie.\n' "$service" >&2
      return 1
    fi
  fi

  (cd "$directory" && exec "$@") > "$RUNTIME/$service.log" 2>&1 &
  local pid=$!
  printf '%s\n%s\n' "$pid" "$(ps -p "$pid" -o lstart= 2>/dev/null || true)" > "$RUNTIME/$service.pid"
  STARTED+=("$service")

  local attempt
  for ((attempt = 0; attempt < 50; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '%s : echec du demarrage. Journal : %s/%s.log\n' "$service" "$RUNTIME" "$service" >&2
      return 1
    fi
    if [[ "$port" -eq 0 ]]; then
      if grep -q '^Simulateur MQTT pret\.' "$RUNTIME/$service.log"; then
        printf '%s : connecte au broker de test.\n' "$service"
        return
      fi
    elif port_in_use "$port"; then
      printf '%s : demarre sur le port %s.\n' "$service" "$port"
      return
    fi
    sleep 0.2
  done
  printf '%s : delai de demarrage depasse. Journal : %s/%s.log\n' "$service" "$RUNTIME" "$service" >&2
  return 1
}

if ! port_in_use 1883; then
  MOSQUITTO="$(command -v mosquitto || true)"
  if [[ -z "$MOSQUITTO" ]]; then
    for candidate in /opt/homebrew/sbin/mosquitto /usr/local/sbin/mosquitto; do
      if [[ -x "$candidate" ]]; then
        MOSQUITTO="$candidate"
        break
      fi
    done
  fi
  if [[ -z "$MOSQUITTO" ]]; then
    printf 'Mosquitto introuvable. Sur macOS : brew install mosquitto\n' >&2
    exit 1
  fi
  start_service mosquitto 1883 "$ROOT" "$MOSQUITTO" -p 1883 -v
else
  printf 'mosquitto : service deja actif sur le port 1883, laisse intact.\n'
fi

# Secret de session Better Auth, genere une fois et conserve hors de Git.
if [[ ! -s "$RUNTIME/auth-secret" ]]; then
  (umask 077 && node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' > "$RUNTIME/auth-secret")
fi
BETTER_AUTH_SECRET="$(cat "$RUNTIME/auth-secret")"

start_service backend 3001 "$BACKEND" env PORT=3001 MQTT_URL=mqtt://127.0.0.1:1883 \
  BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" BETTER_AUTH_URL=http://127.0.0.1:5173 \
  MQTT_TELEMETRY_TOPIC=esp8266/donnees MQTT_COMMAND_TOPIC=esp8266/led \
  "$BACKEND/node_modules/.bin/tsx" watch src/index.ts
start_service frontend 5173 "$FRONTEND" "$FRONTEND/node_modules/.bin/vite" \
  --host 127.0.0.1 --port 5173 --strictPort

start_service simulator 0 "$BACKEND" "$BACKEND/node_modules/.bin/tsx" src/simulator.ts

printf '\nMode TEST LOCAL : capteurs et LED simules, aucune carte IoT requise.\nDashboard : http://127.0.0.1:5173\nAPI : http://127.0.0.1:3001/api/status\nJournaux : %s\nCommandes LED simulees : %s/simulator.log\nCompte du dashboard : npm --prefix iot-backend run user:create -- <email> "<nom>"\nArret : bash stop.sh\n' "$RUNTIME" "$RUNTIME"
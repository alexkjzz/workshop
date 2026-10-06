#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for executable in node npm lsof; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Commande requise introuvable : %s. Voir les prerequis du README.md.\n' "$executable" >&2
    exit 1
  fi
done

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
  printf 'Node.js 22.12 ou plus recent est requis.\n' >&2
  exit 1
fi

mosquitto_available() {
  command -v mosquitto >/dev/null 2>&1 ||
    [[ -x /opt/homebrew/sbin/mosquitto ]] ||
    [[ -x /usr/local/sbin/mosquitto ]]
}

if ! mosquitto_available || ! command -v mosquitto_pub >/dev/null 2>&1 || ! command -v mosquitto_sub >/dev/null 2>&1; then
  if [[ "$(uname -s)" != Darwin ]] || ! command -v brew >/dev/null 2>&1; then
    printf 'Installer Mosquitto et ses clients avec le gestionnaire de paquets du systeme, puis relancer ce script. Sur macOS, Homebrew est requis.\n' >&2
    exit 1
  fi
  brew install mosquitto
fi

if ! mosquitto_available || ! command -v mosquitto_pub >/dev/null 2>&1 || ! command -v mosquitto_sub >/dev/null 2>&1; then
  printf 'Mosquitto ou ses clients restent introuvables. Verifier le PATH de Homebrew.\n' >&2
  exit 1
fi

npm --prefix "$ROOT/iot-backend" ci
npm --prefix "$ROOT/iot-frontend" ci

printf '\nInstallation terminee. Demarrage : bash run.sh\nArret : bash stop.sh\n'
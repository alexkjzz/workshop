#!/usr/bin/env bash
# Genere une CA de table, le certificat du broker Mosquitto et un certificat
# client (mTLS optionnel) pour l'ESP8266. Cles EC P-256 : poignee de main TLS
# bien plus rapide que RSA sur ESP8266.
#
# Usage : bash scripts/gen-certs.sh [IP_DU_SERVEUR] [ID_DU_BOITIER]
set -euo pipefail

SERVER_IP="${1:-192.168.10.1}"
DEVICE_ID="${2:-sentinel-x-01}"
DAYS=825
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"

mkdir -p "$OUT"
cd "$OUT"
umask 077

if [[ ! -f ca.key ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key
  openssl req -x509 -new -key ca.key -sha256 -days 3650 -out ca.crt \
    -subj "/O=AetherCorp/CN=SENTINEL-X Table CA"
fi

openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -out server.csr -subj "/O=AetherCorp/CN=$SERVER_IP"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days "$DAYS" -sha256 \
  -extfile <(printf 'subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\n' "$SERVER_IP")

openssl ecparam -name prime256v1 -genkey -noout -out client.key
openssl req -new -key client.key -out client.csr -subj "/O=AetherCorp/CN=$DEVICE_ID"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days "$DAYS" -sha256 \
  -extfile <(printf 'extendedKeyUsage=clientAuth\n')

rm -f server.csr client.csr
chmod 644 ca.crt server.crt client.crt

printf '\nCertificats generes dans %s\n' "$OUT"
printf '  Broker : ca.crt, server.crt, server.key (SAN IP:%s)\n' "$SERVER_IP"
printf '  ESP8266 : copier ca.crt dans MQTT_CA_CERT (include/secrets.h)\n'
printf '  mTLS optionnel : client.crt / client.key (CN=%s)\n' "$DEVICE_ID"
printf 'Ne jamais committer ca.key ni les cles privees.\n'

#!/bin/sh
# Sentinel-X first-run initialisation, executed at every `docker compose up`.
# Idempotent: existing keys and secrets are kept; certificates are renewed
# 30 days before expiry or when the public host names change.
set -eu
umask 077

PKI=/run/sentinel/pki          # certificates (public) and per-service private keys
SECRETS=/run/sentinel/secrets  # generated secrets, one owner per file
EXPORT=/export                 # host folder: public CA certificate only

# Fixed service accounts of the images (see docker-compose.yml).
UID_BACKEND=1000
UID_NGINX=101
UID_MOSQUITTO=1883
UID_AI=10001
UID_BRIDGE=10002

log() { echo "[init] $*"; }

mkdir -p "$PKI" "$SECRETS"
chmod 0755 "$PKI"
chmod 0711 "$SECRETS"

# --- Local certificate authority ---------------------------------------------
if [ ! -s "$PKI/ca.key" ] || [ ! -s "$PKI/ca.crt" ]; then
  log "Creation de l'autorite de certification locale Sentinel-X"
  openssl ecparam -name prime256v1 -genkey -noout -out "$PKI/ca.key"
  openssl req -x509 -new -key "$PKI/ca.key" -sha256 -days 3650 \
    -subj "/O=AetherCorp/CN=Sentinel-X Local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$PKI/ca.crt"
fi
chmod 0400 "$PKI/ca.key"
chmod 0644 "$PKI/ca.crt"

# "a,192.168.10.1" -> "DNS:a,IP:192.168.10.1"
san_list() {
  echo "$1" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | sort -u | while read -r host; do
    case "$host" in
      *[!0-9.]*) case "$host" in *:*) echo "IP:$host" ;; *) echo "DNS:$host" ;; esac ;;
      *) echo "IP:$host" ;;
    esac
  done | paste -sd, -
}

# issue NAME OWNER_UID HOSTS
issue() {
  name=$1 owner=$2 sans=$(san_list "$3")
  crt="$PKI/$name.crt" key="$PKI/$name.key" stamp="$PKI/$name.san"
  if [ -s "$crt" ] && [ -s "$key" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$sans" ] \
    && openssl x509 -in "$crt" -noout -checkend 2592000 >/dev/null \
    && openssl verify -CAfile "$PKI/ca.crt" "$crt" >/dev/null 2>&1; then
    chown "$owner:$owner" "$key"
    return
  fi
  log "Certificat $name : $sans"
  openssl ecparam -name prime256v1 -genkey -noout -out "$key"
  openssl req -new -key "$key" -subj "/O=AetherCorp/CN=$name" -out "$PKI/$name.csr"
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\nbasicConstraints=critical,CA:FALSE\n' \
    "$sans" > "$PKI/$name.ext"
  openssl x509 -req -in "$PKI/$name.csr" -CA "$PKI/ca.crt" -CAkey "$PKI/ca.key" -CAcreateserial \
    -days 397 -sha256 -extfile "$PKI/$name.ext" -out "$crt" 2>/dev/null
  rm -f "$PKI/$name.csr" "$PKI/$name.ext"
  echo "$sans" > "$stamp"
  chown "$owner:$owner" "$key"
  chmod 0400 "$key"
  chmod 0644 "$crt" "$stamp"
}

PUBLIC_HOSTS=${PUBLIC_HOSTS:-localhost}
issue nginx "$UID_NGINX" "localhost,127.0.0.1,$PUBLIC_HOSTS"
issue backend "$UID_BACKEND" "backend,localhost"
issue mosquitto "$UID_MOSQUITTO" "mosquitto,localhost,127.0.0.1"
issue ai "$UID_AI" "ai,localhost"
chmod 0644 "$PKI/ca.srl" 2>/dev/null || true

# --- Secrets -------------------------------------------------------------------
# secret NAME OWNER_UID GROUP_GID MODE BYTES
secret() {
  file="$SECRETS/$1"
  if [ ! -s "$file" ]; then
    openssl rand -hex "$5" > "$file"
    log "Secret $1 genere"
  fi
  chown "$2:$3" "$file"
  chmod "$4" "$file"
}
secret auth-secret "$UID_BACKEND" "$UID_BACKEND" 0400 32
secret ai-token "$UID_BACKEND" "$UID_AI" 0440 32       # backend (owner) and AI (group)
secret mqtt-backend-password "$UID_BACKEND" "$UID_BACKEND" 0400 24
secret mqtt-bridge-password "$UID_BRIDGE" "$UID_BRIDGE" 0400 24
first_run=false
[ -s "$SECRETS/initial-admin-password" ] || first_run=true
secret initial-admin-password "$UID_BACKEND" "$UID_BACKEND" 0400 12

# Mosquitto password file (hashed), rebuilt from the secrets above.
tmp="$SECRETS/.mosquitto-passwd.tmp"
rm -f "$tmp"
mosquitto_passwd -c -b "$tmp" backend "$(cat "$SECRETS/mqtt-backend-password")" >/dev/null
mosquitto_passwd -b "$tmp" bridge "$(cat "$SECRETS/mqtt-bridge-password")" >/dev/null
chown "$UID_MOSQUITTO:$UID_MOSQUITTO" "$tmp"
chmod 0400 "$tmp"
mv -f "$tmp" "$SECRETS/mosquitto-passwd"

# ACL copied from the versioned template: Mosquitto requires a private file.
install -o "$UID_MOSQUITTO" -g "$UID_MOSQUITTO" -m 0400 /templates/mosquitto-acl "$SECRETS/mosquitto-acl"

# --- Public CA certificate for the browsers and the host -----------------------
if [ -d "$EXPORT" ]; then
  cp "$PKI/ca.crt" "$EXPORT/sentinel-x-ca.crt"
  chmod 0644 "$EXPORT/sentinel-x-ca.crt"
fi

log "PKI et secrets prets."
if [ "$first_run" = true ]; then
  log "Premier demarrage : compte administrateur ${INITIAL_ADMIN_EMAIL:-admin@sentinel-x.local}"
  log "Mot de passe : docker compose exec backend cat /run/sentinel/secrets/initial-admin-password"
fi

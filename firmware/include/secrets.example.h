#pragma once

// Copier ce fichier en include/secrets.h (ignore par Git) puis le completer.
// Ne jamais committer secrets.h.

#define WIFI_SSID "SENTINEL-X-G1"
#define WIFI_PASSWORD "change-me"

// IP du PC Serveur Local. Elle doit figurer dans le SAN du certificat serveur
// (voir scripts/gen-certs.sh), sinon la verification TLS echoue.
#define MQTT_HOST "192.168.10.1"
#define MQTT_PORT 8883
#define MQTT_USERNAME "sentinel-x-01"
#define MQTT_PASSWORD "change-me"

// Le reseau de table n'a pas Internet : le PC Serveur Local doit servir l'heure
// (chrony/ntpd). Sans NTP, l'heure de compilation est utilisee pour verifier
// la validite du certificat.
#define NTP_SERVER "192.168.10.1"

// Certificat de l'autorite (certs/ca.crt), PAS le certificat serveur.
static const char MQTT_CA_CERT[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
REMPLACER_PAR_LE_CONTENU_DE_certs/ca.crt
-----END CERTIFICATE-----
)PEM";

// Optionnel : authentification mutuelle (mTLS). Decommenter et completer avec
// certs/client.crt et certs/client.key, et activer require_certificate dans Mosquitto.
// #define MQTT_USE_CLIENT_CERT
// static const char MQTT_CLIENT_CERT[] PROGMEM = R"PEM(
// -----BEGIN CERTIFICATE-----
// -----END CERTIFICATE-----
// )PEM";
// static const char MQTT_CLIENT_KEY[] PROGMEM = R"PEM(
// -----BEGIN EC PRIVATE KEY-----
// -----END EC PRIVATE KEY-----
// )PEM";

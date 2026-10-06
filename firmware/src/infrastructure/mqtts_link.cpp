#include "infrastructure/mqtts_link.h"

#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "config.h"
#include "infrastructure/system_clock.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copier include/secrets.example.h en include/secrets.h et le completer."
#endif

namespace {

// PubSubClient n'accepte qu'un callback C : l'etat de la liaison est unique.
BearSSL::WiFiClientSecure tlsClient;
BearSSL::X509List caCert(MQTT_CA_CERT);
#ifdef MQTT_USE_CLIENT_CERT
BearSSL::X509List clientCert(MQTT_CLIENT_CERT);
BearSSL::PrivateKey clientKey(MQTT_CLIENT_KEY);
#endif
PubSubClient mqtt(tlsClient);

MqttsLink::CommandHandler commandHandler = nullptr;
bool wifiWasConnected = false;
bool tlsPrepared = false;
unsigned long lastAttemptAt = 0;
unsigned long retryDelay = MQTT_RETRY_MIN_MS;
bool attemptedOnce = false;

const char *optional(const char *value) {
  return value[0] == '\0' ? nullptr : value;
}

// Heure de compilation (__DATE__ "Oct  6 2026", __TIME__ "11:33:00"), utilisee
// comme borne de validite du certificat quand aucun serveur NTP ne repond.
time_t buildEpoch() {
  static const char months[] = "JanFebMarAprMayJunJulAugSepOctNovDec";
  char monthName[4] = {0};
  struct tm build = {};
  sscanf(__DATE__, "%3s %d %d", monthName, &build.tm_mday, &build.tm_year);
  sscanf(__TIME__, "%d:%d:%d", &build.tm_hour, &build.tm_min, &build.tm_sec);
  build.tm_mon = (strstr(months, monthName) - months) / 3;
  build.tm_year -= 1900;
  return mktime(&build);
}

void prepareTls() {
  // Le reseau de table n'a pas Internet : le PC Serveur Local sert l'heure.
  configTime(0, 0, NTP_SERVER);
  const unsigned long startedAt = millis();
  while (!SystemClock::synchronized() && millis() - startedAt < NTP_SYNC_TIMEOUT_MS) {
    delay(100);
  }
  if (SystemClock::synchronized()) {
    Serial.printf("[NTP] heure synchronisee (%lld)\n", static_cast<long long>(time(nullptr)));
  } else {
    Serial.println(F("[NTP] pas de reponse, heure de compilation utilisee pour TLS"));
  }

  // Reduit la RAM consommee par TLS si le broker accepte des fragments de 1 Ko.
  if (tlsClient.probeMaxFragmentLength(MQTT_HOST, MQTT_PORT, 1024)) {
    tlsClient.setBufferSizes(1024, 1024);
    Serial.println(F("[TLS] fragments de 1 Ko negocies"));
  }
  tlsPrepared = true;
}

void onMessage(char *topic, byte *payload, unsigned int length) {
  Serial.printf("[MQTT] %s <- %.*s\n", topic, static_cast<int>(length), reinterpret_cast<char *>(payload));
  if (commandHandler) {
    commandHandler(reinterpret_cast<const char *>(payload), length);
  }
}

void connectMqtt() {
  // Verifie la periode de validite du certificat avec l'heure NTP, ou a defaut
  // l'heure de compilation.
  tlsClient.setX509Time(SystemClock::synchronized() ? time(nullptr) : buildEpoch());

  Serial.printf("[MQTT] connexion a mqtts://%s:%d ...\n", MQTT_HOST, MQTT_PORT);
  const bool connected = mqtt.connect(DEVICE_ID, optional(MQTT_USERNAME), optional(MQTT_PASSWORD),
                                      MQTT_STATUS_TOPIC, 1, true, "offline");
  if (!connected) {
    char error[96];
    const int code = tlsClient.getLastSSLError(error, sizeof(error));
    if (code != 0) {
      Serial.printf("[TLS] erreur %d : %s\n", code, error);
    }
    Serial.printf("[MQTT] echec (etat %d), nouvel essai dans %lu s\n", mqtt.state(),
                  retryDelay / 1000);
    retryDelay = min(retryDelay * 2, MQTT_RETRY_MAX_MS);
    return;
  }

  retryDelay = MQTT_RETRY_MIN_MS;
  mqtt.publish(MQTT_STATUS_TOPIC, "online", true);
  if (!mqtt.subscribe(MQTT_COMMAND_TOPIC, 1)) {
    Serial.println(F("[MQTT] abonnement aux commandes impossible"));
  }
  Serial.println(F("[MQTT] connecte en TLS"));
}

}  // namespace

void MqttsLink::begin(CommandHandler onCommand) {
  commandHandler = onCommand;

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.hostname(DEVICE_ID);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] connexion a %s ...\n", WIFI_SSID);

  tlsClient.setTrustAnchors(&caCert);
#ifdef MQTT_USE_CLIENT_CERT
  tlsClient.setClientECCert(&clientCert, &clientKey, BR_KEYTYPE_KEYX | BR_KEYTYPE_SIGN, BR_KEYTYPE_EC);
#endif

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(MQTT_BUFFER_SIZE);
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setSocketTimeout(5);
}

void MqttsLink::loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiWasConnected) {
      Serial.println(F("[WiFi] connexion perdue"));
      wifiWasConnected = false;
    }
    return;
  }
  if (!wifiWasConnected) {
    wifiWasConnected = true;
    Serial.printf("[WiFi] connecte, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(),
                  WiFi.RSSI());
  }
  if (!tlsPrepared) {
    prepareTls();
  }

  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }
  const unsigned long now = millis();
  if (!attemptedOnce || now - lastAttemptAt >= retryDelay) {
    attemptedOnce = true;
    lastAttemptAt = now;
    connectMqtt();
  }
}

LinkState MqttsLink::state() const {
  if (WiFi.status() != WL_CONNECTED) return LinkState::WifiConnecting;
  if (!mqtt.connected()) return LinkState::BrokerConnecting;
  return LinkState::Online;
}

bool MqttsLink::publish(const Sample &sample) {
  if (!mqtt.connected()) return false;

  // Champs attendus par iot-backend (infrastructure/messaging/messages.ts).
  // Temperature et humidite sont omises si le DHT22 a echoue : une valeur NaN
  // ferait rejeter tout le message.
  const Readings &readings = sample.readings;
  JsonDocument doc;
  doc["device"] = DEVICE_ID;
  if (sample.timestamp != 0) {
    doc["ts"] = sample.timestamp;
  }
  if (readings.climateValid) {
    doc["temperature"] = serialized(String(readings.temperature, 1));
    doc["humidity"] = serialized(String(readings.humidity, 1));
  }
  doc["gas"] = readings.gas;
  doc["presence"] = readings.presence;
  doc["rssi"] = WiFi.RSSI();

  char payload[MQTT_BUFFER_SIZE];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  const bool sent = mqtt.publish(MQTT_TELEMETRY_TOPIC, reinterpret_cast<const uint8_t *>(payload),
                                 length, false);
  if (sent) {
    Serial.printf("[MQTT] %s -> %s\n", MQTT_TELEMETRY_TOPIC, payload);
  }
  return sent;
}

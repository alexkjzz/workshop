#include "infrastructure/mqtts_link.h"

#if SENTINEL_NETWORK_ENABLED

#include <ESP8266WiFi.h>
#include <string.h>
#include <time.h>

#include "infrastructure/system_clock.h"
#include "infrastructure/telemetry_payload.h"

namespace {

const char *optional(const char *value) {
  return value && value[0] ? value : nullptr;
}

}  // namespace

void MqttsLink::begin(CommandHandler onCommand) {
  commandHandler_ = onCommand;

  // Vérification de la configuration réseau/TLS.
  if (!WIFI_SSID[0] ||
      !MQTT_HOST[0] ||
      MQTT_PORT == 0 ||
      !NTP_SERVER[0] ||
      !caCert_.append(MQTT_CA_CERT) ||
      caCert_.getCount() == 0 ||
      !mqtt_.setBufferSize(MQTT_BUFFER_SIZE)) {

    Serial.println(
        F("[CONFIG] Wi-Fi/MQTT/NTP, CA PEM ou allocation MQTT invalides")
    );

    return;
  }

  // TLS serveur
  tlsClient_.setTrustAnchors(&caCert_);
  tlsClient_.setSession(&session_);
  tlsClient_.setSSLVersion(BR_TLS12, BR_TLS12);

#ifdef MQTT_USE_CLIENT_CERT

  if (!clientCert_.append(MQTT_CLIENT_CERT) ||
      clientCert_.getCount() == 0 ||
      !clientKey_.parse(MQTT_CLIENT_KEY)) {

    Serial.println(
        F("[CONFIG] certificat ou cle mTLS invalides")
    );

    return;
  }

  if (clientKey_.isRSA()) {
    tlsClient_.setClientRSACert(
        &clientCert_,
        &clientKey_
    );
  } else if (clientKey_.isEC()) {
    tlsClient_.setClientECCert(
        &clientCert_,
        &clientKey_,
        BR_KEYTYPE_KEYX | BR_KEYTYPE_SIGN,
        BR_KEYTYPE_EC
    );
  } else {
    Serial.println(
        F("[CONFIG] type de cle mTLS non supporte")
    );

    return;
  }

#endif

  mqtt_.setServer(
      MQTT_HOST,
      MQTT_PORT
  );

  mqtt_.setCallback(
      [this](char *topic, uint8_t *payload, unsigned int length) {
        onMessage(topic, payload, length);
      }
  );

  mqtt_.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt_.setSocketTimeout(MQTT_SOCKET_TIMEOUT_S);

  // Wi-Fi
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.hostname(DEVICE_ID);
  WiFi.setAutoReconnect(true);

  WiFi.begin(
      WIFI_SSID,
      WIFI_PASSWORD
  );

  configured_ = true;
  state_ = LinkState::WifiConnecting;

  Serial.printf(
      "[WiFi] connexion a %s ...\n",
      WIFI_SSID
  );
}

bool MqttsLink::clockReady() {
  if (!ntpStarted_) {
    ntpStarted_ = true;
    ntpStartedAt_ = millis();

    configTime(
        0,
        0,
        NTP_SERVER
    );

    Serial.printf(
        "[NTP] synchronisation avec %s\n",
        NTP_SERVER
    );
  }

  if (SystemClock::synchronized()) {
    if (!clockLogged_) {
      Serial.println(
          F("[NTP] heure disponible, verification TLS autorisee")
      );
    }

    clockLogged_ = true;
    return true;
  }

  state_ = LinkState::ClockSynchronizing;

  if (!ntpWarned_ &&
      millis() - ntpStartedAt_ >= NTP_SYNC_TIMEOUT_MS) {

    ntpWarned_ = true;

    Serial.println(
        F("[NTP] sans reponse : MQTT attend l'heure, capteurs et alarmes locaux actifs")
    );
  }

  return false;
}

void MqttsLink::onMessage(
    char *topic,
    uint8_t *payload,
    unsigned int length
) {
  if (!topic ||
      strcmp(topic, MQTT_COMMAND_TOPIC) != 0 ||
      !payload ||
      length == 0 ||
      length > 128) {

    return;
  }

  if (commandHandler_) {
    commandHandler_(
        reinterpret_cast<const char *>(payload),
        length
    );
  }
}

void MqttsLink::connectMqtt() {
  // TLS a besoin d'une heure correcte pour vérifier
  // les dates de validité des certificats X.509.
  tlsClient_.setX509Time(
      time(nullptr)
  );

  Serial.printf(
      "[MQTT] connexion a mqtts://%s:%u ...\n",
      MQTT_HOST,
      static_cast<unsigned int>(MQTT_PORT)
  );

  const bool connected =
      mqtt_.connect(
          DEVICE_ID,
          optional(MQTT_USERNAME),
          optional(MQTT_PASSWORD),
          MQTT_STATUS_TOPIC,
          1,
          true,
          "offline"
      );

  if (connected &&
      mqtt_.subscribe(MQTT_COMMAND_TOPIC, 1) &&
      mqtt_.publish(
          MQTT_STATUS_TOPIC,
          "online",
          true
      )) {

    retry_.reset();
    state_ = LinkState::Online;

    Serial.println(
        F("[MQTT] connecte en TLS, abonnement aux commandes demande")
    );

    return;
  }

  if (connected) {
    Serial.println(
        F("[MQTT] initialisation des topics impossible")
    );
  } else {
    char error[96]{};

    const int code =
        tlsClient_.getLastSSLError(
            error,
            sizeof(error)
        );

    if (code) {
      Serial.printf(
          "[TLS] erreur %d : %s\n",
          code,
          error
      );
    }

    Serial.printf(
        "[MQTT] echec (etat %d)\n",
        mqtt_.state()
    );
  }

  // Fermeture forcée.
  // Le broker utilisera le Last Will "offline".
  tlsClient_.stop(1);

  state_ = LinkState::BrokerConnecting;

  const uint32_t delayMs =
      retry_.failed(millis());

  Serial.printf(
      "[MQTT] nouvel essai dans %lu ms\n",
      static_cast<unsigned long>(delayMs)
  );
}

void MqttsLink::loop(bool allowReconnect) {
  if (!configured_) {
    return;
  }

  // =========================
  // WIFI
  // =========================

  if (WiFi.status() != WL_CONNECTED) {
    state_ = LinkState::WifiConnecting;

    if (wifiWasConnected_) {
      Serial.println(
          F("[WiFi] connexion perdue")
      );

      tlsClient_.stop(1);

      wifiWasConnected_ = false;

      retry_.reset();
    }

    return;
  }

  if (!wifiWasConnected_) {
    wifiWasConnected_ = true;

    Serial.printf(
        "[WiFi] IP %s, RSSI %d dBm\n",
        WiFi.localIP().toString().c_str(),
        WiFi.RSSI()
    );
  }

  // =========================
  // NTP
  // =========================

  if (!clockReady()) {
    return;
  }

  // =========================
  // MQTT
  // =========================

  if (mqtt_.connected()) {
    if (mqtt_.loop()) {
      state_ = LinkState::Online;
      return;
    }
  }

  if (state_ == LinkState::Online) {
    Serial.println(
        F("[MQTT] connexion perdue")
    );

    retry_.failed(millis());
  }

  state_ = LinkState::BrokerConnecting;

  // IMPORTANT :
  // main.cpp passe false ici lorsqu'une alarme locale est active.
  // Une reconnexion TLS/MQTT ne doit donc pas ralentir une alarme.
  if (allowReconnect &&
      retry_.due(millis())) {

    connectMqtt();
  }
}

bool MqttsLink::publish(const Sample &sample) {
  if (state_ != LinkState::Online ||
      !mqtt_.connected()) {

    return false;
  }

  char payload[MQTT_BUFFER_SIZE]{};

  // Taille supplémentaire utilisée par MQTT :
  // header + longueur du topic + topic.
  const size_t overhead =
      MQTT_MAX_HEADER_SIZE +
      2 +
      strlen(MQTT_TELEMETRY_TOPIC);

  if (overhead >= sizeof(payload)) {
    return false;
  }

  const size_t length =
      buildTelemetryPayload(
          sample,
          DEVICE_ID,
          WiFi.RSSI(),
          payload,
          sizeof(payload) - overhead
      );

  if (!length) {
    Serial.println(
        F("[MQTT] mesure invalide ou JSON trop volumineux, publication refusee")
    );

    return false;
  }

  const bool sent =
      mqtt_.publish(
          MQTT_TELEMETRY_TOPIC,
          reinterpret_cast<const uint8_t *>(payload),
          length,
          false
      );

  if (sent) {
    Serial.printf(
        "[MQTT] %s -> %s\n",
        MQTT_TELEMETRY_TOPIC,
        payload
    );
  }

  return sent;
}

#endif
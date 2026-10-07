#pragma once

#include "config.h"

#if SENTINEL_NETWORK_ENABLED

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copier include/secrets.example.h en include/secrets.h et le completer."
#endif

#include <PubSubClient.h>
#include <WiFiClientSecure.h>

#include "application/ports.h"
#include "domain/retry_backoff.h"

class MqttsLink : public TelemetryLink {
 public:
  using CommandHandler =
      void (*)(
          const char *payload,
          size_t length
      );

  void begin(
      CommandHandler onCommand
  );

  void loop(
      bool allowReconnect = true
  );

  LinkState state() const override {
    return state_;
  }

  bool publish(
      const Sample &sample
  ) override;

 private:
  bool clockReady();

  void connectMqtt();

  void onMessage(
      char *topic,
      uint8_t *payload,
      unsigned int length
  );

  BearSSL::X509List caCert_;

#ifdef MQTT_USE_CLIENT_CERT
  BearSSL::X509List clientCert_;
  BearSSL::PrivateKey clientKey_;
#endif

  BearSSL::Session session_;

  BearSSL::WiFiClientSecure
      tlsClient_;

  PubSubClient mqtt_{
      tlsClient_
  };

  RetryBackoff retry_{
      MQTT_RETRY_MIN_MS,
      MQTT_RETRY_MAX_MS
  };

  CommandHandler commandHandler_
      = nullptr;

  LinkState state_
      = LinkState::ConfigurationError;

  bool configured_ = false;

  bool wifiWasConnected_ = false;

  bool ntpStarted_ = false;

  bool ntpWarned_ = false;

  bool clockLogged_ = false;

  uint32_t ntpStartedAt_ = 0;
};

#endif
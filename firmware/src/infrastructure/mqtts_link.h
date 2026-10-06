#pragma once

#include <stddef.h>

#include "application/ports.h"

// Wi-Fi + MQTT sur TLS (certificat du broker verifie par la CA de table).
class MqttsLink : public TelemetryLink {
 public:
  using CommandHandler = void (*)(const char *payload, size_t length);

  void begin(CommandHandler onCommand);
  // Maintient Wi-Fi et MQTTS (reconnexion non bloquante avec backoff).
  void loop();

  LinkState state() const override;
  bool publish(const Sample &sample) override;
};

#pragma once

#include <Arduino.h>

#include "application/ports.h"

class LocalLink : public TelemetryLink {
 public:
  using CommandHandler =
      void (*)(const char *, size_t);

  void begin(CommandHandler) {
    Serial.println(
        F(
            "[RESEAU] mode local : "
            "OLED/serie actifs, MQTT desactive"
        )
    );
  }

  void loop(bool = true) {}

  LinkState state() const override {
    return LinkState::Disabled;
  }

  bool publish(
      const Sample &
  ) override {
    return false;
  }
};
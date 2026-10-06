#pragma once

#include <Arduino.h>

#include "application/ports.h"

class SerialLogger : public Logger {
 public:
  void info(const char *message) override { Serial.println(message); }
};

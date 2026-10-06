#pragma once

#include "application/ports.h"

// DHT22 (temperature/humidite), MQ-2 (gaz, entree analogique) et PIR HC-SR501.
class BoardSensors : public Sensors {
 public:
  void begin();
  void sample(Readings &readings) override;
  bool readPresence() override;
};

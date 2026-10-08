#pragma once

#include <DHT.h>

#include "application/ports.h"
#include "config.h"

class BoardSensors : public Sensors {
 public:
  void begin();
  void sampleClimate(Readings &readings) override;
  int readGas() override;
  bool readPresence() override;

 private:
  DHT dht_{PIN_DHT, DHT_TYPE};
};

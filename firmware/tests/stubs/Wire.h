#pragma once
#include <Arduino.h>

class TwoWire {
 public:
  uint8_t ack = 0, address = 0;
  unsigned probes = 0;
  void begin(uint8_t, uint8_t) {}
  void setClock(uint32_t) {}
  void beginTransmission(uint8_t value) { address = value; }
  uint8_t endTransmission() { ++probes; return ack; }
};
inline TwoWire Wire;

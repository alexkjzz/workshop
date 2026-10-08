#pragma once

#include <Arduino.h>
#include "application/ports.h"

class Sentinel {
 public:
  Sentinel(Sensors &sensors, Actuators &actuators, DisplayPort &display)
      : sensors_(sensors), actuators_(actuators), display_(display) {}

  void begin(uint32_t nowMs);
  void tick(uint32_t nowMs);

  const Readings &readings() const { return readings_; }
  const DeviceStatus &status() const { return status_; }

 private:
  void updatePIR();
  void updateGas();
  void updateDHT();
  void updateOutputs();
  void printSerialStatus();

  Sensors &sensors_;
  Actuators &actuators_;
  DisplayPort &display_;

  Readings readings_;
  DeviceStatus status_;

  uint32_t startTime_ = 0;
  uint32_t lastDHTRead_ = 0;
  uint32_t lastGasRead_ = 0;
  uint32_t lastDisplay_ = 0;
  uint32_t lastSerial_ = 0;
};

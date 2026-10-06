#pragma once

#include "application/ports.h"

// LED verte (liaison), LED rouge (alerte) et buzzer piezo.
class GpioActuators : public Actuators {
 public:
  void begin();
  void apply(const ActuatorOutputs &outputs) override;

 private:
  void setBuzzer(bool on);
  bool buzzerOn_ = false;
};

#pragma once

#include "application/ports.h"

class GpioActuators : public Actuators {
 public:
  void begin();
  void apply(const ActuatorOutputs &outputs) override;
};

#include "domain/gas_failsafe.h"

GasFailsafe::GasFailsafe(int threshold, int hysteresis, uint32_t warmupMs)
    : threshold_(threshold), hysteresis_(hysteresis), warmupMs_(warmupMs) {}

bool GasFailsafe::update(int gas, uint32_t nowMs) {
  // Le prechauffage n'a lieu qu'une fois (insensible au debordement de millis()).
  if (!warmedUp_ && nowMs >= warmupMs_) warmedUp_ = true;
  if (threshold_ <= 0 || !warmedUp_) {
    active_ = false;
  } else if (gas >= threshold_) {
    active_ = true;
  } else if (gas < threshold_ - hysteresis_) {
    active_ = false;
  }
  return active_;
}

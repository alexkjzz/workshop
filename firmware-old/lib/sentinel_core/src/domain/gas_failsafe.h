#pragma once

#include <stdint.h>

class GasFailsafe {
 public:
  GasFailsafe(
      int threshold,
      int hysteresis,
      uint32_t warmupMs
  );

  void begin(uint32_t nowMs);

  // Etat memorise apres le prechauffage, y compris apres debordement de millis().
  bool ready() const { return warmedUp_; }

  // L'implementation unique est dans gas_failsafe.cpp.
  bool update(int gas, uint32_t nowMs);

  bool active() const { return active_; }

 private:
  int threshold_;
  int hysteresis_;

  uint32_t warmupMs_;
  uint32_t startedAt_ = 0;

  bool warmedUp_ = false;
  bool active_ = false;
};

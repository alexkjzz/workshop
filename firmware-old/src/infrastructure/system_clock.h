#pragma once

#include <time.h>

#include "application/ports.h"

class SystemClock : public Clock {
 public:
  static constexpr time_t kMinValidEpoch = 1735689600;  // 2025-01-01
  uint32_t epochSeconds() const override;
  uint32_t now() const { return epochSeconds(); }

  static bool synchronized();
};

#pragma once

#include <time.h>

#include "application/ports.h"

// Heure systeme, synchronisee par NTP (demarre par la liaison MQTTS).
class SystemClock : public Clock {
 public:
  // Toute date anterieure est consideree comme une horloge non synchronisee.
  static constexpr time_t kMinValidEpoch = 1735689600;  // 2025-01-01

  static bool synchronized() { return time(nullptr) >= kMinValidEpoch; }

  uint32_t epochSeconds() const override {
    return synchronized() ? static_cast<uint32_t>(time(nullptr)) : 0;
  }
};

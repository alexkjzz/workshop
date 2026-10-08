#include "infrastructure/system_clock.h"

#include <time.h>

uint32_t SystemClock::epochSeconds() const {
  const time_t current = time(nullptr);
  // L'uptime n'est pas une date epoch : ne jamais envoyer une fausse date de 1970.
  return current >= kMinValidEpoch && static_cast<uint64_t>(current) <= UINT32_MAX
      ? static_cast<uint32_t>(current) : 0;
}

bool SystemClock::synchronized() {
  const time_t current = time(nullptr);
  return current >= kMinValidEpoch && static_cast<uint64_t>(current) <= UINT32_MAX;
}

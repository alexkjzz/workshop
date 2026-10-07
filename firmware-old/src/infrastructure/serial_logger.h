#pragma once

#include "application/ports.h"

class SerialLogger : public Logger {
 public:
  void info(const char *message) override;
  void status(
      const Readings &readings,
      const DeviceStatus &status,
      LinkState link,
      size_t buffered,
      uint32_t dropped
  );
};

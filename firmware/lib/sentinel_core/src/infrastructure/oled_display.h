#pragma once

#include <Adafruit_SSD1306.h>
#include "application/ports.h"
#include "sentinel_config.h"

class OledDisplay : public DisplayPort {
 public:
  void begin();
  void render(const Readings &readings, const DeviceStatus &status) override;
  bool connected() const { return connected_; }

 private:
  Adafruit_SSD1306 display_{OLED_WIDTH, OLED_HEIGHT, &Wire, -1};
  bool connected_ = false;
};

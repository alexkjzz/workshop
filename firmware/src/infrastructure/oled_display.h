#pragma once

#include "application/ports.h"

// Ecran OLED SSD1306 0.96" (I2C) : IP, liaison, mesures et bandeau d'alerte.
class OledDisplay : public StatusDisplay {
 public:
  void begin();
  void render(const Readings &readings, LinkState link, bool alarm) override;

 private:
  bool available_ = false;
};

#pragma once
#include <Arduino.h>
#include <Wire.h>

constexpr uint8_t SSD1306_SWITCHCAPVCC = 2, SSD1306_WHITE = 1;
class Adafruit_SSD1306 : public FakePrint {
 public:
  inline static bool allocationOk = true;
  inline static unsigned begins = 0;
  inline static std::string lastFrame;
  Adafruit_SSD1306(uint8_t, uint8_t, TwoWire *, int8_t) {}
  bool begin(uint8_t, uint8_t, bool, bool) { ++begins; return allocationOk; }
  void clearDisplay() { text.clear(); }
  void display() { lastFrame = text; }
  void setRotation(uint8_t) {}
  void setTextColor(uint16_t) {}
  void setTextSize(uint8_t) {}
  void setCursor(int16_t, int16_t) {}
  void drawRect(int16_t, int16_t, int16_t, int16_t, uint16_t) {}
  void fillRect(int16_t, int16_t, int16_t, int16_t, uint16_t) {}
  void drawLine(int16_t, int16_t, int16_t, int16_t, uint16_t) {}
};

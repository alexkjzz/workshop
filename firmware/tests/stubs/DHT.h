#pragma once
#include <Arduino.h>
#include <cmath>

constexpr uint8_t DHT11 = 11, DHT12 = 12, DHT21 = 21, DHT22 = 22;

class DHT {
 public:
  inline static float temperature = NAN;
  inline static float humidity = NAN;
  inline static unsigned temperatureReads = 0, humidityReads = 0, begins = 0;
  inline static uint8_t configuredPin = 0, configuredType = 0;
  DHT(uint8_t pin, uint8_t type) { configuredPin = pin; configuredType = type; }
  void begin() { ++begins; }
  float readTemperature() { ++temperatureReads; return temperature; }
  float readHumidity() { ++humidityReads; return humidity; }
};

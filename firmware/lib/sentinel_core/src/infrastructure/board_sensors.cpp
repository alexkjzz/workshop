#include "infrastructure/board_sensors.h"

#include <Arduino.h>
#include <math.h>

static_assert(DHT_TYPE == DHT11 || DHT_TYPE == DHT12 || DHT_TYPE == DHT21 ||
              DHT_TYPE == DHT22, "Unsupported configured DHT sensor type");

void BoardSensors::begin() {
  climateSampled_ = false;
  climateWasValid_ = false;
  pinMode(PIN_PIR, INPUT);
  dht_.begin();
  Serial.printf("[DHT] Configured type=DHT%u pin=GPIO%u interval=%lu ms; verify sensor and wiring\n",
                static_cast<unsigned>(DHT_TYPE), static_cast<unsigned>(PIN_DHT),
                static_cast<unsigned long>(DHT_INTERVAL_MS));
}

void BoardSensors::sampleClimate(Readings &readings) {
  const float t = dht_.readTemperature();
  const float h = dht_.readHumidity();

  readings.climateValid =
      isfinite(t) && isfinite(h) &&
      h >= 0.0f && h <= 100.0f &&
      t >= -40.0f && t <= 80.0f;

  if (readings.climateValid) {
    readings.temperature = t;
    readings.humidity = h;
    if (climateSampled_ && !climateWasValid_) Serial.println(F("[DHT] Reading recovered"));
  } else {
    // Never leave a previous measurement available behind an invalid reading.
    readings.temperature = NAN;
    readings.humidity = NAN;
    if (!climateSampled_ || climateWasValid_) {
      Serial.println(F("[DHT] Invalid reading: check configured type, power and data wiring"));
    }
  }
  climateSampled_ = true;
  climateWasValid_ = readings.climateValid;
}

int BoardSensors::readGas() {
  // Identique a l'ancien main.cpp : moyenne de 8 lectures.
  unsigned long sum = 0;
  for (int i = 0; i < 8; ++i) {
    sum += analogRead(PIN_GAS);
    delayMicroseconds(300);
  }
  return static_cast<int>(sum / 8);
}

bool BoardSensors::readPresence() {
  return digitalRead(PIN_PIR) == HIGH;
}

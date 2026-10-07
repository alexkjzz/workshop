#include "infrastructure/board_sensors.h"

#include <Arduino.h>
#include <math.h>

void BoardSensors::begin() {
  pinMode(PIN_PIR, INPUT);
  dht_.begin();
}

void BoardSensors::sampleClimate(Readings &readings) {
  const float t = dht_.readTemperature();
  const float h = dht_.readHumidity();

  readings.climateValid =
      !isnan(t) && !isnan(h) &&
      h >= 0.0f && h <= 100.0f &&
      t >= -40.0f && t <= 80.0f;

  if (readings.climateValid) {
    readings.temperature = t;
    readings.humidity = h;
  }
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

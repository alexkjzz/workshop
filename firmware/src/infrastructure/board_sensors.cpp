#include "infrastructure/board_sensors.h"

#include <Arduino.h>
#include <DHT.h>

#include "config.h"

namespace {

DHT dht(PIN_DHT, DHT22);

int readGas() {
  // Moyenne pour lisser le bruit de l'ADC ; peu d'echantillons car des
  // analogRead trop rapproches perturbent le Wi-Fi.
  long total = 0;
  for (uint8_t i = 0; i < GAS_SAMPLES; i++) {
    total += analogRead(PIN_GAS);
    delay(2);
  }
  return static_cast<int>(total / GAS_SAMPLES);
}

}  // namespace

void BoardSensors::begin() {
  dht.begin();
  pinMode(PIN_PIR, INPUT);
}

void BoardSensors::sample(Readings &readings) {
  const float temperature = dht.readTemperature();
  const float humidity = dht.readHumidity();
  readings.climateValid = !isnan(temperature) && !isnan(humidity);
  if (readings.climateValid) {
    readings.temperature = temperature;
    readings.humidity = humidity;
  } else {
    Serial.println(F("[DHT22] lecture impossible"));
  }
  readings.gas = readGas();
}

bool BoardSensors::readPresence() {
  return digitalRead(PIN_PIR) == HIGH;
}

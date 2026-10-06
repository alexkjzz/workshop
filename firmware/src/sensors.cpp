#include "sensors.h"

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

namespace sensors {

void begin() {
  dht.begin();
  pinMode(PIN_PIR, INPUT);
}

void sample(Readings &readings) {
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

bool pollPresence(Readings &readings) {
  const bool presence = digitalRead(PIN_PIR) == HIGH;
  if (presence == readings.presence) {
    return false;
  }
  readings.presence = presence;
  return true;
}

}  // namespace sensors

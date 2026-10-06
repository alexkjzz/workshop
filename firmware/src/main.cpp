// SENTINEL-X - Edge Node ESP8266
// Capteurs DHT22 / MQ-2 / PIR -> JSON sur MQTTS, commandes distantes -> LEDs et buzzer.

#include <Arduino.h>

#include "actuators.h"
#include "config.h"
#include "display.h"
#include "readings.h"
#include "sensors.h"
#include "uplink.h"

namespace {

Readings readings;
unsigned long lastSampleAt = 0;
unsigned long lastPublishAt = 0;
unsigned long lastDisplayAt = 0;
bool gasAlarm = false;

void onCommand(const char *command) {
  if (!actuators::handleCommand(command)) {
    Serial.printf("[CMD] commande inconnue : %s\n", command);
  }
}

// Fail-safe local avec hysteresis, ignore pendant le prechauffage du MQ-2.
bool evaluateGasFailsafe(unsigned long now) {
  if (GAS_FAILSAFE_THRESHOLD <= 0 || now < GAS_WARMUP_MS) {
    return false;
  }
  if (readings.gas >= GAS_FAILSAFE_THRESHOLD) {
    gasAlarm = true;
  } else if (readings.gas < GAS_FAILSAFE_THRESHOLD - GAS_FAILSAFE_HYSTERESIS) {
    gasAlarm = false;
  }
  return gasAlarm;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.printf("SENTINEL-X %s - demarrage\n", DEVICE_ID);

  actuators::begin();
  display::begin();
  sensors::begin();
  uplink::begin(onCommand);

  // Force un premier echantillon des le premier tour de loop().
  lastSampleAt = millis() - SAMPLE_INTERVAL_MS;
}

void loop() {
  uplink::loop();
  const unsigned long now = millis();

  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    sensors::sample(readings);
    actuators::setFailsafeAlarm(evaluateGasFailsafe(now));
  }

  // Un changement du PIR est publie immediatement pour une alerte reactive.
  const bool presenceChanged = sensors::pollPresence(readings);
  if (presenceChanged || now - lastPublishAt >= PUBLISH_INTERVAL_MS) {
    if (uplink::publishTelemetry(readings)) {
      lastPublishAt = now;
    }
  }

  actuators::loop(now, uplink::online());

  if (now - lastDisplayAt >= DISPLAY_INTERVAL_MS) {
    lastDisplayAt = now;
    display::render(readings, uplink::stateLabel(), actuators::alarmActive());
  }
}

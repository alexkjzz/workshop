// SENTINEL-X V2 - ESP8266 NodeMCU
// Composition root : assemble le coeur (lib/sentinel_core) et les adaptateurs Arduino.
// PlatformIO compile ce fichier firmware/src/main.cpp, pas firmware/main.cpp.

#include <Arduino.h>

#include "application/sentinel.h"
#include "config.h"
#include "domain/gas_failsafe.h"
#include "infrastructure/board_sensors.h"
#include "infrastructure/gpio_actuators.h"
#if SENTINEL_NETWORK_ENABLED
#include "infrastructure/mqtts_link.h"
#else
#include "infrastructure/local_link.h"
#endif
#include "infrastructure/oled_display.h"
#include "infrastructure/serial_logger.h"
#include "infrastructure/system_clock.h"

namespace {

BoardSensors sensors;
GpioActuators actuators;
#if SENTINEL_NETWORK_ENABLED
MqttsLink link;
#else
LocalLink link;
#endif
OledDisplay display;
SystemClock systemClock;
SerialLogger logger;
GasFailsafe failsafe(GAS_FAILSAFE_THRESHOLD, GAS_FAILSAFE_HYSTERESIS, GAS_WARMUP_MS);

const SentinelSettings settings{SAMPLE_INTERVAL_MS, PUBLISH_INTERVAL_MS, DISPLAY_INTERVAL_MS,
                                REPLAY_BATCH, GAS_INTERVAL_MS, PIR_WARMUP_MS};
Sentinel sentinel(sensors, actuators, link, display, systemClock, logger, failsafe, settings);
uint32_t lastSerialAt = 0;

void onCommand(const char *payload, size_t length) {
  sentinel.handleCommand(payload, length);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.printf("SENTINEL-X %s - demarrage\n", DEVICE_ID);

  actuators.begin();
  sensors.begin();
  sentinel.begin(millis());
  display.begin();
  link.begin(onCommand);
  Serial.printf("[BOOT] MQ-2 ADC brut (pas des ppm), PIR %lu ms, gaz %lu ms de chauffe\n",
                PIR_WARMUP_MS, GAS_WARMUP_MS);
  lastSerialAt = millis() - SERIAL_INTERVAL_MS;
}

void loop() {
  sensors.loop(millis());
  sentinel.tick(millis());  // les alarmes locales passent avant le reseau
  // Une alarme distante doit pouvoir se reconnecter pour recevoir ALARM_OFF.
  const bool localAlarm = sentinel.status().gasAlert || sentinel.readings().presence;
  link.loop(!localAlarm);
  // Appliquer les commandes recues et relire le PIR apres un travail reseau lent.
  sensors.loop(millis());
  sentinel.tick(millis());
  const uint32_t now = millis();
  if (now - lastSerialAt >= SERIAL_INTERVAL_MS) {
    lastSerialAt = now;
    logger.status(sentinel.readings(), sentinel.status(), link.state(),
                  sentinel.bufferedSamples(), sentinel.droppedSamples());
  }
  yield();
}

// SENTINEL-X - Edge Node ESP8266
// Composition root : assemble le coeur (lib/sentinel_core) et les adaptateurs Arduino.

#include <Arduino.h>

#include "application/sentinel.h"
#include "config.h"
#include "domain/gas_failsafe.h"
#include "infrastructure/board_sensors.h"
#include "infrastructure/gpio_actuators.h"
#include "infrastructure/mqtts_link.h"
#include "infrastructure/oled_display.h"
#include "infrastructure/serial_logger.h"
#include "infrastructure/system_clock.h"

namespace {

BoardSensors sensors;
GpioActuators actuators;
MqttsLink link;
OledDisplay display;
SystemClock systemClock;
SerialLogger logger;
GasFailsafe failsafe(GAS_FAILSAFE_THRESHOLD, GAS_FAILSAFE_HYSTERESIS, GAS_WARMUP_MS);

const SentinelSettings settings{SAMPLE_INTERVAL_MS, PUBLISH_INTERVAL_MS, DISPLAY_INTERVAL_MS, REPLAY_BATCH};
Sentinel sentinel(sensors, actuators, link, display, systemClock, logger, failsafe, settings);

void onCommand(const char *payload, size_t length) {
  sentinel.handleCommand(payload, length);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.printf("SENTINEL-X %s - demarrage\n", DEVICE_ID);

  actuators.begin();
  display.begin();
  sensors.begin();
  link.begin(onCommand);
  sentinel.begin(millis());
}

void loop() {
  link.loop();
  sentinel.tick(millis());
}

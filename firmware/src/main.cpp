#include <Arduino.h>

#include "application/sentinel.h"
#include "infrastructure/board_sensors.h"
#include "infrastructure/gpio_actuators.h"
#include "infrastructure/oled_display.h"

namespace {
BoardSensors sensors;
GpioActuators actuators;
OledDisplay display;
Sentinel sentinel(sensors, actuators, display);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println(F("DEMARRAGE SENTINEL-X V2"));

  actuators.begin();
  sensors.begin();
  display.begin();
  sentinel.begin(millis());
}

void loop() {
  sentinel.tick(millis());
  yield();
}

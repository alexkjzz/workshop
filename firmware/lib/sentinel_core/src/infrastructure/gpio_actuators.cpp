#include "infrastructure/gpio_actuators.h"

#include <Arduino.h>
#include "sentinel_config.h"

void GpioActuators::begin() {
  // GPIO15 / D8 doit rester LOW au demarrage.
  digitalWrite(PIN_LED_WARNING, ORANGE_LED_OFF);
  pinMode(PIN_LED_WARNING, OUTPUT);

  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_LED_ALERT, OUTPUT);

  digitalWrite(PIN_BUZZER, BUZZER_OFF);
  digitalWrite(PIN_LED_STATUS, GREEN_LED_OFF);
  digitalWrite(PIN_LED_ALERT, RED_LED_OFF);
}

void GpioActuators::apply(const ActuatorOutputs &outputs) {
  digitalWrite(PIN_LED_ALERT, outputs.red ? RED_LED_ON : RED_LED_OFF);
  digitalWrite(PIN_LED_WARNING, outputs.orange ? ORANGE_LED_ON : ORANGE_LED_OFF);
  digitalWrite(PIN_LED_STATUS, outputs.green ? GREEN_LED_ON : GREEN_LED_OFF);
  digitalWrite(PIN_BUZZER, outputs.buzzer ? BUZZER_ON : BUZZER_OFF);
}

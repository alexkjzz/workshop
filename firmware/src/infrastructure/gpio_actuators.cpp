#include "infrastructure/gpio_actuators.h"

#include <Arduino.h>

#include "config.h"

void GpioActuators::begin() {
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_LED_ALERT, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_STATUS, LOW);
  digitalWrite(PIN_LED_ALERT, LOW);
}

void GpioActuators::apply(const ActuatorOutputs &outputs) {
  digitalWrite(PIN_LED_STATUS, outputs.statusLed ? HIGH : LOW);
  digitalWrite(PIN_LED_ALERT, outputs.alertLed ? HIGH : LOW);
  setBuzzer(outputs.buzzer);
}

void GpioActuators::setBuzzer(bool on) {
  if (on == buzzerOn_) {
    return;
  }
  buzzerOn_ = on;
  if (BUZZER_PASSIVE) {
    if (on) {
      tone(PIN_BUZZER, BUZZER_FREQUENCY_HZ);
    } else {
      noTone(PIN_BUZZER);
    }
  } else {
    digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
  }
}

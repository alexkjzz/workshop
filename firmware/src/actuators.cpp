#include "actuators.h"

#include <Arduino.h>

#include "config.h"

namespace {

bool remoteLed = false;
bool remoteBuzzer = false;
bool failsafeAlarm = false;
bool buzzerOn = false;

void setBuzzer(bool on) {
  if (on == buzzerOn) {
    return;
  }
  buzzerOn = on;
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

}  // namespace

namespace actuators {

void begin() {
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_LED_ALERT, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_STATUS, LOW);
  digitalWrite(PIN_LED_ALERT, LOW);
}

bool handleCommand(const char *command) {
  // "ON"/"OFF" : contrat actuel du backend (POST /api/action), LED d'alerte.
  if (strcmp(command, "ON") == 0) {
    remoteLed = true;
  } else if (strcmp(command, "OFF") == 0) {
    remoteLed = false;
  } else if (strcmp(command, "BUZZER_ON") == 0) {
    remoteBuzzer = true;
  } else if (strcmp(command, "BUZZER_OFF") == 0) {
    remoteBuzzer = false;
  } else if (strcmp(command, "ALARM_ON") == 0) {
    remoteLed = remoteBuzzer = true;
  } else if (strcmp(command, "ALARM_OFF") == 0) {
    remoteLed = remoteBuzzer = false;
  } else {
    return false;
  }
  return true;
}

void setFailsafeAlarm(bool active) {
  if (active != failsafeAlarm) {
    Serial.printf("[ALARME] fail-safe gaz %s\n", active ? "DECLENCHE" : "leve");
  }
  failsafeAlarm = active;
}

void loop(unsigned long now, bool online) {
  const bool blinkPhase = (now / 250) % 2 == 0;
  const bool beepPhase = (now / 400) % 2 == 0;

  // Verte fixe : liaison MQTTS etablie ; clignotante : connexion en cours.
  digitalWrite(PIN_LED_STATUS, (online || blinkPhase) ? HIGH : LOW);
  // Rouge fixe sur commande distante, clignotante sur fail-safe local.
  digitalWrite(PIN_LED_ALERT, (remoteLed || (failsafeAlarm && blinkPhase)) ? HIGH : LOW);
  setBuzzer((remoteBuzzer || failsafeAlarm) && beepPhase);
}

bool alarmActive() {
  return remoteLed || remoteBuzzer || failsafeAlarm;
}

}  // namespace actuators

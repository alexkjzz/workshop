#include "application/sentinel.h"

#include <Arduino.h>
#include "sentinel_config.h"

void Sentinel::begin(uint32_t nowMs) {
  startTime_ = nowMs;
  lastDHTRead_ = nowMs - DHT_INTERVAL_MS;
  lastGasRead_ = nowMs - GAS_INTERVAL_MS;
  lastDisplay_ = nowMs - DISPLAY_INTERVAL_MS;
  lastSerial_ = nowMs - SERIAL_INTERVAL_MS;

  Serial.println(F("Systeme initialise"));
}

void Sentinel::tick(uint32_t nowMs) {
  const uint32_t elapsed = nowMs - startTime_;

  status_.pirReady = elapsed >= PIR_WARMUP_MS;
  status_.gasReady = elapsed >= GAS_WARMUP_MS;
  status_.systemReady = status_.pirReady && status_.gasReady;

  updatePIR();

  if (nowMs - lastGasRead_ >= GAS_INTERVAL_MS) {
    lastGasRead_ = nowMs;
    updateGas();
  }

  if (nowMs - lastDHTRead_ >= DHT_INTERVAL_MS) {
    lastDHTRead_ = nowMs;
    updateDHT();
  }

  updateOutputs();

  if (nowMs - lastDisplay_ >= DISPLAY_INTERVAL_MS) {
    lastDisplay_ = nowMs;
    display_.render(readings_, status_);
  }

  if (nowMs - lastSerial_ >= SERIAL_INTERVAL_MS) {
    lastSerial_ = nowMs;
    printSerialStatus();
  }
}

void Sentinel::updatePIR() {
  const bool previousMotion = status_.motionDetected;

  if (!status_.pirReady) {
    status_.motionDetected = false;
    readings_.presence = false;
    return;
  }

  status_.motionDetected = sensors_.readPresence();
  readings_.presence = status_.motionDetected;

  if (status_.motionDetected && !previousMotion) {
    Serial.println();
    Serial.println(F(">>> MOUVEMENT DETECTE <<<"));
  }

  if (!status_.motionDetected && previousMotion) {
    Serial.println();
    Serial.println(F("PIR : retour NORMAL"));
  }
}

void Sentinel::updateGas() {
  readings_.gas = sensors_.readGas();

  if (!status_.gasReady) {
    status_.gasAlert = false;
    return;
  }

  if (!status_.gasAlert && readings_.gas >= GAS_THRESHOLD_ON) {
    status_.gasAlert = true;
    Serial.println();
    Serial.println(F("!!! ALERTE GAZ !!!"));
  } else if (status_.gasAlert && readings_.gas <= GAS_THRESHOLD_OFF) {
    status_.gasAlert = false;
    Serial.println();
    Serial.println(F("Gaz revenu a la normale"));
  }
}

void Sentinel::updateDHT() {
  sensors_.sampleClimate(readings_);
}

void Sentinel::updateOutputs() {
  // Priorite identique au code original : rouge, puis orange, puis verte.
  status_.alarmActive = status_.gasAlert || status_.motionDetected;
  status_.warningActive = !status_.alarmActive && (!status_.systemReady || !readings_.climateValid);
  const bool systemOK = status_.systemReady && readings_.climateValid && !status_.alarmActive;

  ActuatorOutputs outputs;
  outputs.red = status_.alarmActive;
  outputs.orange = status_.warningActive;
  outputs.green = systemOK;
  outputs.buzzer = status_.alarmActive;
  actuators_.apply(outputs);
}

void Sentinel::printSerialStatus() {
  Serial.println();
  Serial.println(F("========= SENTINEL-X ========="));

  Serial.print(F("Temperature : "));
  if (readings_.climateValid) {
    Serial.print(readings_.temperature, 1);
    Serial.println(F(" C"));
  } else {
    Serial.println(F("ERREUR"));
  }

  Serial.print(F("Humidite    : "));
  if (readings_.climateValid) {
    Serial.print(readings_.humidity, 1);
    Serial.println(F(" %"));
  } else {
    Serial.println(F("ERREUR"));
  }

  Serial.print(F("Gaz MQ-2    : "));
  Serial.println(readings_.gas);

  Serial.print(F("Etat gaz    : "));
  if (!status_.gasReady) Serial.println(F("CHAUFFE"));
  else if (status_.gasAlert) Serial.println(F("DANGER"));
  else Serial.println(F("NORMAL"));

  Serial.print(F("Etat PIR    : "));
  if (!status_.pirReady) Serial.println(F("CALIBRATION"));
  else if (status_.motionDetected) Serial.println(F("MOUVEMENT"));
  else Serial.println(F("NORMAL"));

  Serial.print(F("ALARME      : "));
  Serial.println(status_.alarmActive ? F("ACTIVE") : F("OFF"));
  Serial.print(F("LED ROUGE   : "));
  Serial.println(status_.alarmActive ? F("ON") : F("OFF"));
  Serial.print(F("LED ORANGE  : "));
  Serial.println(status_.warningActive ? F("ON") : F("OFF"));
  Serial.print(F("LED VERTE   : "));
  Serial.println(status_.systemReady && readings_.climateValid && !status_.alarmActive ? F("ON") : F("OFF"));
  Serial.println(F("=============================="));
}

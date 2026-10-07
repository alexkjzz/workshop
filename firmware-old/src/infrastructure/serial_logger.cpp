#include "infrastructure/serial_logger.h"

#include <Arduino.h>

namespace {

const char *stateLabel(
    LinkState state
) {
  switch (state) {
    case LinkState::Disabled:
      return "LOCAL";

    case LinkState::ConfigurationError:
      return "CFG_ERR";

    case LinkState::WifiConnecting:
      return "WIFI_WAIT";

    case LinkState::ClockSynchronizing:
      return "NTP_WAIT";

    case LinkState::BrokerConnecting:
      return "MQTT_WAIT";

    case LinkState::Online:
      return "MQTT_OK";
  }

  return "?";
}

}

void SerialLogger::info(const char *message) {
  if (message) Serial.println(message);
}

void SerialLogger::status(
    const Readings &r,
    const DeviceStatus &s,
    LinkState link,
    size_t buffered,
    uint32_t dropped
) {
  char climate[30];
  if (r.climateValid) {
    snprintf(climate, sizeof(climate), "T=%.1fC H=%.1f%%", r.temperature, r.humidity);
  } else {
    snprintf(climate, sizeof(climate), "DHT=ERR");
  }
  char line[128];
  const int length = snprintf(line, sizeof(line),
      "[STATE] %s GAS=%d/%s PIR=%s ALARM=%s NET=%s Q=%u LOST=%lu\n", climate, r.gas,
      !s.gasReady ? "WARM" : !r.gasValid ? "ERR" : s.gasAlert ? "ALERT" : "OK",
      !s.pirReady ? "WARM" : r.presence ? "MOVE" : "OK",
      s.alarmActive ? "ON" : "OFF", stateLabel(link), static_cast<unsigned int>(buffered),
      static_cast<unsigned long>(dropped));
  if (length > 0 && static_cast<size_t>(length) < sizeof(line)
      && Serial.availableForWrite() >= length) {
    Serial.write(reinterpret_cast<const uint8_t *>(line), static_cast<size_t>(length));
  }
}

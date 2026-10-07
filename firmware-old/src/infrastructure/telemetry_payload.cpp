#include "infrastructure/telemetry_payload.h"

#include <ArduinoJson.h>
#include <math.h>

size_t buildTelemetryPayload(const Sample &sample, const char *deviceId, int rssi,
                             char *output, size_t capacity) {
  if (!output || capacity == 0) return 0;
  output[0] = '\0';
  if (!deviceId || !sample.readings.anyValid()) return 0;
  const Readings &r = sample.readings;
  JsonDocument doc;
  doc["device"] = deviceId;
  // Express attend ts en secondes ; timestamp est reserve aux dates ISO texte.
  if (sample.timestamp) doc["ts"] = sample.timestamp;
  bool hasMeasurement = false;
  if (r.climateValid && isfinite(r.temperature) && isfinite(r.humidity)
      && r.temperature >= -40 && r.temperature <= 80 && r.humidity >= 0 && r.humidity <= 100) {
    doc["temperature"] = roundf(r.temperature * 10) / 10;
    doc["humidity"] = roundf(r.humidity * 10) / 10;
    hasMeasurement = true;
  }
  if (r.gasValid && r.gas >= 0 && r.gas <= 1023) {
    doc["gas"] = r.gas;
    hasMeasurement = true;
  }
  if (r.presenceValid) {
    doc["presence"] = r.presence;
    hasMeasurement = true;
  }
  if (!hasMeasurement || doc.overflowed()) return 0;
  doc["rssi"] = rssi;
  const size_t required = measureJson(doc);
  if (doc.overflowed() || required >= capacity) return 0;
  const size_t written = serializeJson(doc, output, capacity);
  if (written != required) {
    output[0] = '\0';
    return 0;
  }
  return written;
}

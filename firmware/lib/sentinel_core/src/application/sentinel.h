#pragma once

#include <stddef.h>
#include <stdint.h>

#include "application/ports.h"
#include "domain/alarm_state.h"
#include "domain/gas_failsafe.h"
#include "domain/readings.h"
#include "domain/sample_buffer.h"

struct SentinelSettings {
  uint32_t sampleIntervalMs;   // le DHT22 ne supporte pas mieux que 0.5 Hz
  uint32_t publishIntervalMs;  // + publication immediate sur changement du PIR
  uint32_t displayIntervalMs;
  uint8_t replayBatch;  // mesures rejouees par tick apres une coupure
};

// Mesures conservees pendant une coupure puis rejouees : 150 x 2 s = 5 min.
constexpr size_t kOfflineBufferSize = 150;

// Cas d'usage du boitier : mesurer, publier (ou mettre en tampon), alerter.
class Sentinel {
 public:
  Sentinel(Sensors &sensors, Actuators &actuators, TelemetryLink &link, StatusDisplay &display,
           const Clock &clock, Logger &logger, GasFailsafe &failsafe, const SentinelSettings &settings);

  void begin(uint32_t nowMs);
  void tick(uint32_t nowMs);
  // Renvoie false si la commande est inconnue.
  bool handleCommand(const char *payload, size_t length);

  const Readings &readings() const { return readings_; }
  size_t bufferedSamples() const { return buffer_.size(); }

 private:
  void publish();
  void replayBuffer();

  Sensors &sensors_;
  Actuators &actuators_;
  TelemetryLink &link_;
  StatusDisplay &display_;
  const Clock &clock_;
  Logger &logger_;
  GasFailsafe &failsafe_;
  const SentinelSettings settings_;

  Readings readings_;
  AlarmState alarm_;
  SampleBuffer<kOfflineBufferSize> buffer_;
  uint32_t lastSampleAt_ = 0;
  uint32_t lastPublishAt_ = 0;
  uint32_t lastDisplayAt_ = 0;
};

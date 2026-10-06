#include "application/sentinel.h"

#include "domain/command.h"

Sentinel::Sentinel(Sensors &sensors, Actuators &actuators, TelemetryLink &link, StatusDisplay &display,
                   const Clock &clock, Logger &logger, GasFailsafe &failsafe,
                   const SentinelSettings &settings)
    : sensors_(sensors),
      actuators_(actuators),
      link_(link),
      display_(display),
      clock_(clock),
      logger_(logger),
      failsafe_(failsafe),
      settings_(settings) {}

void Sentinel::begin(uint32_t nowMs) {
  // Force un premier echantillon et un premier affichage au premier tick.
  lastSampleAt_ = nowMs - settings_.sampleIntervalMs;
  lastDisplayAt_ = nowMs - settings_.displayIntervalMs;
  lastPublishAt_ = nowMs;
}

void Sentinel::tick(uint32_t nowMs) {
  if (nowMs - lastSampleAt_ >= settings_.sampleIntervalMs) {
    lastSampleAt_ = nowMs;
    sensors_.sample(readings_);
    const bool wasActive = failsafe_.active();
    alarm_.setFailsafe(failsafe_.update(readings_.gas, nowMs));
    if (failsafe_.active() != wasActive) {
      logger_.info(failsafe_.active() ? "[ALARME] fail-safe gaz declenche" : "[ALARME] fail-safe gaz leve");
    }
  }

  // Un changement du PIR est publie immediatement pour une alerte reactive.
  const bool presence = sensors_.readPresence();
  const bool presenceChanged = presence != readings_.presence;
  readings_.presence = presence;
  if (presenceChanged || nowMs - lastPublishAt_ >= settings_.publishIntervalMs) {
    lastPublishAt_ = nowMs;
    publish();
  }

  if (link_.state() == LinkState::Online) replayBuffer();

  actuators_.apply(alarm_.outputs(nowMs, link_.state() == LinkState::Online));

  if (nowMs - lastDisplayAt_ >= settings_.displayIntervalMs) {
    lastDisplayAt_ = nowMs;
    display_.render(readings_, link_.state(), alarm_.active());
  }
}

bool Sentinel::handleCommand(const char *payload, size_t length) {
  if (alarm_.apply(parseCommand(payload, length))) return true;
  logger_.info("[CMD] commande inconnue");
  return false;
}

void Sentinel::publish() {
  Sample sample;
  sample.timestamp = clock_.epochSeconds();
  sample.readings = readings_;
  if (link_.state() == LinkState::Online && link_.publish(sample)) return;
  // Sans horloge, une mesure rejouee plus tard serait datee a sa reception : inutile.
  if (sample.timestamp != 0) buffer_.push(sample);
}

// Rejoue progressivement les mesures prises hors ligne, de la plus ancienne a la plus recente.
void Sentinel::replayBuffer() {
  for (uint8_t i = 0; i < settings_.replayBatch && !buffer_.empty(); i++) {
    if (!link_.publish(buffer_.front())) return;
    buffer_.pop();
    if (buffer_.empty()) logger_.info("[MQTT] tampon hors ligne vide");
  }
}

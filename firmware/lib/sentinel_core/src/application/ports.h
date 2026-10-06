#pragma once

#include <stdint.h>

#include "domain/alarm_state.h"
#include "domain/readings.h"

// Interfaces que l'infrastructure (Arduino) implemente pour le coeur.

class Sensors {
 public:
  virtual ~Sensors() = default;
  // Lit temperature, humidite (DHT22) et gaz (MQ-2). Au plus toutes les 2 s.
  virtual void sample(Readings &readings) = 0;
  virtual bool readPresence() = 0;
};

class Actuators {
 public:
  virtual ~Actuators() = default;
  virtual void apply(const ActuatorOutputs &outputs) = 0;
};

enum class LinkState { WifiConnecting, BrokerConnecting, Online };

class TelemetryLink {
 public:
  virtual ~TelemetryLink() = default;
  virtual LinkState state() const = 0;
  virtual bool publish(const Sample &sample) = 0;
};

class StatusDisplay {
 public:
  virtual ~StatusDisplay() = default;
  virtual void render(const Readings &readings, LinkState link, bool alarm) = 0;
};

class Clock {
 public:
  virtual ~Clock() = default;
  // Epoch en secondes, 0 tant que l'heure n'est pas synchronisee.
  virtual uint32_t epochSeconds() const = 0;
};

class Logger {
 public:
  virtual ~Logger() = default;
  virtual void info(const char *message) = 0;
};

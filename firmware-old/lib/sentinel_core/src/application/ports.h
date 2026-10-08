#pragma once

struct Readings {
  float temperature = NAN;
  float humidity = NAN;
  int gas = 0;
  bool presence = false;
  bool climateValid = false;
};

struct DeviceStatus {
  bool pirReady = false;
  bool gasReady = false;
  bool systemReady = false;
  bool gasAlert = false;
  bool motionDetected = false;
  bool alarmActive = false;
  bool warningActive = false;
};

struct ActuatorOutputs {
  bool green = false;
  bool red = false;
  bool orange = false;
  bool buzzer = false;
};

class Sensors {
 public:
  virtual ~Sensors() = default;
  virtual void sampleClimate(Readings &readings) = 0;
  virtual int readGas() = 0;
  virtual bool readPresence() = 0;
};

class Actuators {
 public:
  virtual ~Actuators() = default;
  virtual void apply(const ActuatorOutputs &outputs) = 0;
};

class DisplayPort {
 public:
  virtual ~DisplayPort() = default;
  virtual void render(const Readings &readings, const DeviceStatus &status) = 0;
};

#include <cmath>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

// Including both names must compile without duplicate configuration definitions.
#include "config.h"
#include "sentinel_config.h"
#include "application/sentinel.h"
#include "infrastructure/board_sensors.h"
#include "infrastructure/gpio_actuators.h"
#include "infrastructure/oled_display.h"

#define CHECK(condition) do { if (!(condition)) throw std::runtime_error( \
  std::string(__FILE__) + ":" + std::to_string(__LINE__) + " " + #condition); } while (false)

struct TestSensors : Sensors {
  int gas = 0;
  bool motion = false, climateValid = true;
  unsigned climateReads = 0;
  void sampleClimate(Readings &readings) override {
    ++climateReads;
    readings.climateValid = climateValid;
    readings.temperature = climateValid ? 23.5f : NAN;
    readings.humidity = climateValid ? 50.0f : NAN;
  }
  int readGas() override { return gas; }
  bool readPresence() override { return motion; }
};
struct TestActuators : Actuators {
  ActuatorOutputs last;
  void apply(const ActuatorOutputs &outputs) override { last = outputs; }
};
struct TestDisplay : DisplayPort {
  void render(const Readings &, const DeviceStatus &) override {}
};
struct Fixture {
  TestSensors sensors;
  TestActuators actuators;
  TestDisplay display;
  Sentinel sentinel{sensors, actuators, display};
  explicit Fixture(uint32_t start = 0) { sentinel.begin(start); }
};

void first_climate_read_waits_and_cadence_is_preserved() {
  Fixture f(1000);
  f.sentinel.tick(1000);
  f.sentinel.tick(2999);
  CHECK(f.sensors.climateReads == 0);
  CHECK(!f.sentinel.readings().climateValid);
  f.sentinel.tick(3000);
  CHECK(f.sensors.climateReads == 1);
  f.sentinel.tick(4999);
  CHECK(f.sensors.climateReads == 1);
  f.sentinel.tick(5000);
  CHECK(f.sensors.climateReads == 2);
}

void warmup_suppresses_alarms_then_enables_each_sensor() {
  Fixture f;
  f.sensors.motion = true;
  f.sensors.gas = 1023;
  f.sentinel.tick(PIR_WARMUP_MS - 1);
  CHECK(!f.sentinel.status().alarmActive);
  CHECK(f.actuators.last.orange && !f.actuators.last.green);
  f.sentinel.tick(PIR_WARMUP_MS);
  CHECK(f.sentinel.status().pirReady && !f.sentinel.status().gasReady);
  CHECK(f.sentinel.status().motionDetected && f.actuators.last.buzzer);
  f.sensors.motion = false;
  f.sentinel.tick(GAS_WARMUP_MS - 1);
  CHECK(!f.sentinel.status().gasAlert);
  f.sentinel.tick(GAS_WARMUP_MS + GAS_INTERVAL_MS);
  CHECK(f.sentinel.status().gasReady && f.sentinel.status().gasAlert);
  CHECK(f.actuators.last.red && !f.actuators.last.orange);
}

void gas_hysteresis_uses_inclusive_boundaries() {
  Fixture f;
  f.sensors.gas = GAS_THRESHOLD_ON - 1;
  f.sentinel.tick(GAS_WARMUP_MS);
  CHECK(!f.sentinel.status().gasAlert);
  f.sensors.gas = GAS_THRESHOLD_ON;
  f.sentinel.tick(GAS_WARMUP_MS + GAS_INTERVAL_MS);
  CHECK(f.sentinel.status().gasAlert);
  f.sensors.gas = GAS_THRESHOLD_OFF + 1;
  f.sentinel.tick(GAS_WARMUP_MS + 2 * GAS_INTERVAL_MS);
  CHECK(f.sentinel.status().gasAlert);
  f.sensors.gas = GAS_THRESHOLD_OFF;
  f.sentinel.tick(GAS_WARMUP_MS + 3 * GAS_INTERVAL_MS);
  CHECK(!f.sentinel.status().gasAlert);
}

void warmup_and_alarm_survive_clock_rollover() {
  const uint32_t start = UINT32_MAX - 1000;
  Fixture f(start);
  f.sensors.gas = GAS_THRESHOLD_ON;
  f.sentinel.tick(start + GAS_WARMUP_MS);
  CHECK(f.sentinel.status().gasReady && f.sentinel.status().pirReady);
  CHECK(f.sentinel.status().gasAlert);
  // The same tick value is reached a complete millis cycle after begin().
  f.sentinel.tick(start);
  CHECK(f.sentinel.status().gasReady && f.sentinel.status().pirReady);
  CHECK(f.sentinel.status().gasAlert && f.actuators.last.buzzer);
}

void begin_resets_alarm_climate_and_warmup() {
  Fixture f;
  f.sensors.gas = GAS_THRESHOLD_ON;
  f.sentinel.tick(GAS_WARMUP_MS);
  CHECK(f.sentinel.status().alarmActive && f.sentinel.readings().climateValid);
  f.sentinel.begin(100000);
  CHECK(!f.sentinel.status().alarmActive && !f.sentinel.status().gasReady);
  CHECK(!f.sentinel.readings().climateValid && std::isnan(f.sentinel.readings().temperature));
  CHECK(!f.actuators.last.buzzer && f.actuators.last.orange && !f.actuators.last.red);
  const unsigned before = f.sensors.climateReads;
  f.sentinel.tick(101999);
  CHECK(f.sensors.climateReads == before && !f.sentinel.status().gasAlert);
  f.sentinel.tick(102000);
  CHECK(f.sensors.climateReads == before + 1);
}

void invalid_climate_warns_without_disabling_motion_alarm() {
  Fixture f;
  f.sensors.climateValid = false;
  f.sentinel.tick(GAS_WARMUP_MS);
  CHECK(f.actuators.last.orange && !f.actuators.last.green);
  f.sensors.motion = true;
  f.sentinel.tick(GAS_WARMUP_MS + 1);
  CHECK(f.actuators.last.red && f.actuators.last.buzzer && !f.actuators.last.orange);
}

void dht_adapter_preserves_observations_and_rejects_invalid_measurements() {
  BoardSensors sensors;
  sensors.begin();
  CHECK(DHT::configuredType == DHT_TYPE && DHT::configuredPin == PIN_DHT);
  CHECK(Serial.text.find("[DHT] Configured type=DHT") != std::string::npos);
  Readings readings;
  DHT::temperature = 76.8f;
  DHT::humidity = 6.9f;
  sensors.sampleClimate(readings);
  CHECK(readings.climateValid && readings.temperature == 76.8f && readings.humidity == 6.9f);
  const std::vector<std::pair<float, float>> bad = {
    {NAN, 50}, {23, NAN}, {INFINITY, 50}, {23, INFINITY}, {-40.1f, 50},
    {80.1f, 50}, {23, -0.1f}, {23, 100.1f},
  };
  for (const auto &value : bad) {
    DHT::temperature = value.first;
    DHT::humidity = value.second;
    sensors.sampleClimate(readings);
    CHECK(!readings.climateValid);
    CHECK(std::isnan(readings.temperature) && std::isnan(readings.humidity));
  }
  DHT::temperature = -40;
  DHT::humidity = 0;
  sensors.sampleClimate(readings);
  CHECK(readings.climateValid);
  CHECK(Serial.text.find("[DHT] Reading recovered") != std::string::npos);
  DHT::temperature = 80;
  DHT::humidity = 100;
  sensors.sampleClimate(readings);
  CHECK(readings.climateValid);
}

void serial_contract_reports_invalid_climate_and_real_warmup() {
  Serial.text.clear();
  Fixture f;
  f.sentinel.tick(0);
  CHECK(Serial.text.find("========= SENTINEL-X =========") != std::string::npos);
  CHECK(Serial.text.find("Temperature : ERREUR") != std::string::npos);
  CHECK(Serial.text.find("Humidite    : ERREUR") != std::string::npos);
  CHECK(Serial.text.find("Etat gaz    : CHAUFFE") != std::string::npos);
  CHECK(Serial.text.find("Etat PIR    : CALIBRATION") != std::string::npos);
  CHECK(Serial.text.find("LED ORANGE  : ON") != std::string::npos);
}

void gpio_outputs_preserve_polarity_and_begin_is_quiet() {
  GpioActuators gpio;
  gpio.apply({false, true, false, true});
  CHECK(fake::levels[PIN_LED_ALERT] == RED_LED_ON);
  CHECK(fake::levels[PIN_BUZZER] == BUZZER_ON);
  fake::gpioCalls.clear();
  gpio.begin();
  CHECK(fake::levels[PIN_BUZZER] == BUZZER_OFF);
  CHECK(fake::levels[PIN_LED_ALERT] == RED_LED_OFF);
  CHECK(fake::levels[PIN_LED_WARNING] == ORANGE_LED_OFF);
  CHECK(fake::gpioCalls.front() == std::make_pair('w', static_cast<int>(PIN_LED_WARNING)));
  gpio.apply({true, false, false, false});
  CHECK(fake::levels[PIN_LED_STATUS] == GREEN_LED_ON);
}

void oled_requires_ack_and_does_not_claim_ok_for_invalid_climate() {
  Wire.ack = 2;
  const unsigned before = Adafruit_SSD1306::begins;
  OledDisplay missing;
  missing.begin();
  CHECK(!missing.connected() && Adafruit_SSD1306::begins == before);
  Wire.ack = 0;
  Adafruit_SSD1306::allocationOk = false;
  missing.begin();
  CHECK(!missing.connected());
  Adafruit_SSD1306::allocationOk = true;
  OledDisplay present;
  present.begin();
  CHECK(present.connected() && Wire.address == OLED_ADDRESS);
  Readings readings;
  DeviceStatus status;
  status.systemReady = status.pirReady = status.gasReady = true;
  present.render(readings, status);
  CHECK(Adafruit_SSD1306::lastFrame.find("ERR") != std::string::npos);
  CHECK(Adafruit_SSD1306::lastFrame.find("DHT SENSOR ERROR") != std::string::npos);
  CHECK(Adafruit_SSD1306::lastFrame.find("SAFE") == std::string::npos);
  Wire.ack = 2;
  present.render(readings, status);
  CHECK(!present.connected());
  Wire.ack = 0;
  fake::now = 4999;
  present.render(readings, status);
  CHECK(!present.connected());
  fake::now = 5000;
  present.render(readings, status);
  CHECK(present.connected());
}

int main() {
  const std::vector<std::pair<const char *, std::function<void()>>> tests = {
    {"DHT initial delay and cadence", first_climate_read_waits_and_cadence_is_preserved},
    {"PIR and gas warmup", warmup_suppresses_alarms_then_enables_each_sensor},
    {"Gas hysteresis boundaries", gas_hysteresis_uses_inclusive_boundaries},
    {"Clock rollover", warmup_and_alarm_survive_clock_rollover},
    {"Repeated begin resets state", begin_resets_alarm_climate_and_warmup},
    {"Climate fault and motion priority", invalid_climate_warns_without_disabling_motion_alarm},
    {"Real DHT adapter validation", dht_adapter_preserves_observations_and_rejects_invalid_measurements},
    {"USB serial contract", serial_contract_reports_invalid_climate_and_real_warmup},
    {"GPIO polarity and startup", gpio_outputs_preserve_polarity_and_begin_is_quiet},
    {"OLED acknowledgement and status", oled_requires_ack_and_does_not_claim_ok_for_invalid_climate},
  };
  unsigned failed = 0;
  for (const auto &test : tests) {
    try { test.second(); std::cout << "PASS " << test.first << '\n'; }
    catch (const std::exception &error) { ++failed; std::cerr << "FAIL " << error.what() << '\n'; }
  }
  std::cout << tests.size() - failed << '/' << tests.size() << " tests passed\n";
  return failed ? 1 : 0;
}

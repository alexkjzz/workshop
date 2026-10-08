// Tests du coeur du firmware (domaine + application), executes nativement.
#include <string.h>
#include <math.h>
#include <unity.h>
#include <ArduinoJson.h>

#include "application/sentinel.h"
#include "domain/alarm_state.h"
#include "domain/command.h"
#include "domain/gas_failsafe.h"
#include "domain/sample_buffer.h"
#include "domain/rolling_average.h"
#include "domain/retry_backoff.h"
#include "infrastructure/telemetry_payload.h"

namespace {

Command parse(const char *text) { return parseCommand(text, strlen(text)); }

// --- Faux ports -------------------------------------------------------------

struct FakeSensors : Sensors {
  Readings next;
  bool presence = false;
  int climateSamples = 0;
  int gasSamples = 0;
  void sample(Readings &readings) override {
    ++climateSamples;
    readings.temperature = next.temperature;
    readings.humidity = next.humidity;
    readings.climateValid = next.climateValid;
  }
  int readGas() override { ++gasSamples; return next.gas; }
  bool readPresence() override { return presence; }
};

struct FakeActuators : Actuators {
  ActuatorOutputs last{};
  void apply(const ActuatorOutputs &outputs) override { last = outputs; }
};

struct FakeLink : TelemetryLink {
  LinkState current = LinkState::Online;
  uint32_t published[400];
  Readings readings[400];
  size_t count = 0;
  bool accepting = true;
  LinkState state() const override { return current; }
  bool publish(const Sample &sample) override {
    if (current != LinkState::Online || !accepting) return false;
    readings[count] = sample.readings;
    published[count++] = sample.timestamp;
    return true;
  }
};

struct FakeDisplay : StatusDisplay {
  int renders = 0;
  DeviceStatus last;
  void render(const Readings &, LinkState, const DeviceStatus &status) override {
    ++renders;
    last = status;
  }
};

struct FakeClock : Clock {
  uint32_t epoch = 0;
  uint32_t epochSeconds() const override { return epoch; }
};

struct SilentLogger : Logger {
  void info(const char *) override {}
};

constexpr SentinelSettings kSettings{2000, 2000, 300, 5, 250, 0};

struct Fixture {
  FakeSensors sensors;
  FakeActuators actuators;
  FakeLink link;
  FakeDisplay display;
  FakeClock clock;
  SilentLogger logger;
  GasFailsafe failsafe{600, 50, 60000};
  Sentinel sentinel{sensors, actuators, link, display, clock, logger, failsafe, kSettings};

  Fixture() { sensors.next.climateValid = true; }
};

}  // namespace

void setUp() {}
void tearDown() {}

// --- Domaine ----------------------------------------------------------------

void test_commands_are_trimmed_and_case_insensitive() {
  TEST_ASSERT_TRUE(parse("ON") == Command::AlertLedOn);
  TEST_ASSERT_TRUE(parse("  off\n") == Command::AlertLedOff);
  TEST_ASSERT_TRUE(parse("alarm_on") == Command::AlarmOn);
  TEST_ASSERT_TRUE(parse("BLINK") == Command::Unknown);
  TEST_ASSERT_TRUE(parse("") == Command::Unknown);
  TEST_ASSERT_TRUE(parse("AN_EXTREMELY_LONG_COMMAND_NAME_THAT_OVERFLOWS") == Command::Unknown);
}

void test_gas_failsafe_waits_for_warmup_and_uses_hysteresis() {
  GasFailsafe failsafe(600, 50, 60000);
  TEST_ASSERT_FALSE(failsafe.update(900, 1000));    // prechauffage
  TEST_ASSERT_FALSE(failsafe.ready());
  TEST_ASSERT_TRUE(failsafe.update(600, 60000));    // seuil atteint
  TEST_ASSERT_TRUE(failsafe.ready());
  TEST_ASSERT_TRUE(failsafe.update(551, 61000));    // dans l'hysteresis
  TEST_ASSERT_FALSE(failsafe.update(550, 62000));   // seuil OFF inclus
  GasFailsafe disabled(0, 50, 0);
  TEST_ASSERT_FALSE(disabled.update(1023, 1000));
}

void test_alarm_outputs() {
  AlarmState alarm;
  ActuatorOutputs outputs = alarm.outputs(250, false, true);
  TEST_ASSERT_FALSE(outputs.statusLed);
  TEST_ASSERT_TRUE(outputs.warningLed);
  TEST_ASSERT_TRUE(alarm.outputs(250, true, true).statusLed);

  TEST_ASSERT_TRUE(alarm.apply(Command::AlertLedOn));
  TEST_ASSERT_TRUE(alarm.outputs(250, true, true).alertLed);
  TEST_ASSERT_FALSE(alarm.outputs(0, true, true).buzzer);

  alarm.apply(Command::AlarmOn);
  TEST_ASSERT_TRUE(alarm.outputs(0, true, true).buzzer);
  TEST_ASSERT_FALSE(alarm.outputs(400, true, true).buzzer);  // commande distante intermittente
  TEST_ASSERT_FALSE(alarm.apply(Command::Unknown));
}

void test_sample_buffer_overwrites_the_oldest() {
  SampleBuffer<3> buffer;
  for (uint32_t ts = 1; ts <= 4; ts++) {
    Sample sample;
    sample.timestamp = ts;
    buffer.push(sample);
  }
  TEST_ASSERT_EQUAL(3, buffer.size());
  TEST_ASSERT_EQUAL_UINT32(2, buffer.front().timestamp);
}

// --- Application ------------------------------------------------------------

void test_publishes_periodically_and_on_presence_change() {
  Fixture f;
  f.clock.epoch = 1791280000;
  f.sentinel.begin(0);
  f.sentinel.tick(0);
  TEST_ASSERT_EQUAL(0, f.link.count);
  f.sentinel.tick(2000);
  TEST_ASSERT_EQUAL(1, f.link.count);
  f.sensors.presence = true;
  f.sentinel.tick(2100);  // immediat, sans attendre l'intervalle
  TEST_ASSERT_EQUAL(2, f.link.count);
  TEST_ASSERT_TRUE(f.sentinel.readings().presence);
}

void test_buffers_offline_samples_and_replays_them_in_order() {
  Fixture f;
  f.sentinel.begin(0);
  f.link.current = LinkState::BrokerConnecting;
  for (uint32_t i = 1; i <= 7; i++) {
    f.clock.epoch = 1791280000 + i;
    f.sentinel.tick(i * 2000);
  }
  TEST_ASSERT_EQUAL(7, f.sentinel.bufferedSamples());

  f.link.current = LinkState::Online;
  f.sentinel.tick(14500);  // rejoue un lot de 5
  TEST_ASSERT_EQUAL(5, f.link.count);
  TEST_ASSERT_EQUAL_UINT32(1791280001, f.link.published[0]);
  f.sentinel.tick(14600);
  TEST_ASSERT_EQUAL(0, f.sentinel.bufferedSamples());
  TEST_ASSERT_EQUAL_UINT32(1791280007, f.link.published[6]);
}

void test_does_not_buffer_without_clock() {
  Fixture f;
  f.sentinel.begin(0);
  f.link.current = LinkState::WifiConnecting;
  f.sentinel.tick(2000);
  TEST_ASSERT_EQUAL(0, f.sentinel.bufferedSamples());
}

void test_gas_failsafe_drives_the_actuators() {
  Fixture f;
  f.sentinel.begin(60000);
  f.sensors.next.gas = 900;
  f.sentinel.tick(60000);
  TEST_ASSERT_FALSE(f.actuators.last.alertLed);
  f.sentinel.tick(120000);  // 60 s apres begin, independamment de l'heure du boot
  TEST_ASSERT_TRUE(f.actuators.last.alertLed);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
}

void test_gas_warmup_is_relative_to_begin_and_survives_millis_wrap() {
  GasFailsafe failsafe(600, 50, 60000);
  const uint32_t start = UINT32_MAX - 10000;
  failsafe.begin(start);
  TEST_ASSERT_FALSE(failsafe.update(900, start + 59999));
  TEST_ASSERT_TRUE(failsafe.update(900, start + 60000));
  TEST_ASSERT_TRUE(failsafe.ready());
  TEST_ASSERT_FALSE(failsafe.update(550, start + 61000));
  TEST_ASSERT_TRUE(failsafe.ready());
}

void test_local_alarm_has_priority_over_warning_and_remote_off() {
  AlarmState alarm;
  alarm.setMotion(true);
  alarm.apply(Command::AlarmOff);
  const ActuatorOutputs outputs = alarm.outputs(400, false, false);
  TEST_ASSERT_TRUE(outputs.alertLed);
  TEST_ASSERT_TRUE(outputs.buzzer);  // continu, meme dans la phase OFF du bip distant
  TEST_ASSERT_FALSE(outputs.warningLed);
  TEST_ASSERT_FALSE(outputs.statusLed);

  alarm.setMotion(false);
  alarm.setFailsafe(true);
  alarm.apply(Command::BuzzerOff);
  TEST_ASSERT_TRUE(alarm.outputs(400, true, true).buzzer);
}

void test_climate_error_uses_orange_without_fabricating_an_alarm() {
  AlarmState alarm;
  const ActuatorOutputs outputs = alarm.outputs(0, true, false);
  TEST_ASSERT_TRUE(outputs.warningLed);
  TEST_ASSERT_FALSE(outputs.statusLed);
  TEST_ASSERT_FALSE(outputs.alertLed);
  TEST_ASSERT_FALSE(outputs.buzzer);
}

void test_gas_and_climate_have_independent_sampling_intervals() {
  Fixture f;
  f.sentinel.begin(100);
  f.sentinel.tick(100);
  f.sentinel.tick(349);
  TEST_ASSERT_EQUAL(1, f.sensors.gasSamples);
  f.sentinel.tick(350);
  TEST_ASSERT_EQUAL(2, f.sensors.gasSamples);
  TEST_ASSERT_EQUAL(1, f.sensors.climateSamples);
  f.sentinel.tick(2100);
  TEST_ASSERT_EQUAL(2, f.sensors.climateSamples);
}

void test_pir_is_ignored_during_warmup_then_alarms_immediately() {
  Fixture f;
  const SentinelSettings settings{2000, 2000, 300, 5, 250, 45000};
  Sentinel sentinel(f.sensors, f.actuators, f.link, f.display, f.clock, f.logger, f.failsafe, settings);
  f.sensors.presence = true;
  sentinel.begin(1000);
  sentinel.tick(45999);
  TEST_ASSERT_FALSE(sentinel.readings().presence);
  TEST_ASSERT_FALSE(f.actuators.last.buzzer);
  TEST_ASSERT_TRUE(f.actuators.last.warningLed);
  const size_t before = f.link.count;
  sentinel.tick(46000);
  TEST_ASSERT_TRUE(sentinel.status().pirReady);
  TEST_ASSERT_TRUE(sentinel.readings().presence);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
  TEST_ASSERT_TRUE(f.actuators.last.alertLed);
  TEST_ASSERT_EQUAL(before + 1, f.link.count);
  TEST_ASSERT_FALSE(f.actuators.last.warningLed);
}

void test_pir_readiness_survives_millis_wrap() {
  Fixture f;
  const SentinelSettings settings{2000, 2000, 300, 5, 250, 45000};
  Sentinel sentinel(f.sensors, f.actuators, f.link, f.display, f.clock, f.logger, f.failsafe, settings);
  const uint32_t start = UINT32_MAX - 10000;
  sentinel.begin(start);
  sentinel.tick(start + 45000);
  TEST_ASSERT_TRUE(sentinel.status().pirReady);
  f.sensors.presence = true;
  sentinel.tick(start + 45001);
  TEST_ASSERT_TRUE(sentinel.readings().presence);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
}

void test_ready_healthy_system_uses_green_even_without_network() {
  Fixture f;
  f.link.current = LinkState::Disabled;
  f.sentinel.begin(0);
  f.sentinel.tick(60000);
  TEST_ASSERT_TRUE(f.actuators.last.statusLed);
  TEST_ASSERT_FALSE(f.actuators.last.warningLed);
  TEST_ASSERT_FALSE(f.actuators.last.alertLed);
  TEST_ASSERT_FALSE(f.actuators.last.buzzer);
  TEST_ASSERT_TRUE(f.display.last.systemReady());
}

void test_local_mode_does_not_build_an_offline_telemetry_queue() {
  Fixture f;
  f.link.current = LinkState::Disabled;
  f.clock.epoch = 1791280000;
  f.sentinel.begin(0);
  f.sentinel.tick(2000);
  TEST_ASSERT_EQUAL(0, f.sentinel.bufferedSamples());
  TEST_ASSERT_EQUAL(0, f.link.count);
}

void test_gas_alarm_reacts_between_dht_reads_and_recovers_at_off_threshold() {
  Fixture f;
  f.link.current = LinkState::Disabled;
  f.sentinel.begin(0);
  f.sentinel.tick(60000);
  const int climateSamples = f.sensors.climateSamples;
  f.sensors.next.gas = 600;
  f.sentinel.tick(60250);
  TEST_ASSERT_TRUE(f.sentinel.status().gasAlert);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
  TEST_ASSERT_EQUAL(climateSamples, f.sensors.climateSamples);
  f.sensors.next.gas = 551;
  f.sentinel.tick(60500);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
  f.sensors.next.gas = 550;
  f.sentinel.tick(60750);
  TEST_ASSERT_FALSE(f.sentinel.status().gasAlert);
  TEST_ASSERT_FALSE(f.actuators.last.buzzer);
  TEST_ASSERT_TRUE(f.actuators.last.statusLed);
}

void test_sensor_error_and_recovery_update_leds() {
  Fixture f;
  f.link.current = LinkState::Disabled;
  f.sentinel.begin(0);
  f.sentinel.tick(60000);
  f.sensors.next.climateValid = false;
  f.sentinel.tick(62000);
  TEST_ASSERT_TRUE(f.actuators.last.warningLed);
  TEST_ASSERT_FALSE(f.actuators.last.statusLed);
  f.sensors.next.climateValid = true;
  f.sentinel.tick(64000);
  TEST_ASSERT_FALSE(f.actuators.last.warningLed);
  TEST_ASSERT_TRUE(f.actuators.last.statusLed);
}

void test_commands_reach_the_alarm() {
  Fixture f;
  f.sentinel.begin(0);
  const char command[] = "on";
  TEST_ASSERT_TRUE(f.sentinel.handleCommand(command, strlen(command)));
  f.sentinel.tick(250);
  TEST_ASSERT_TRUE(f.actuators.last.alertLed);
  TEST_ASSERT_FALSE(f.sentinel.handleCommand("nope", 4));
}

void test_command_rejects_null_and_embedded_nul() {
  TEST_ASSERT_TRUE(parseCommand(nullptr, 2) == Command::Unknown);
  const char binary[] = {'O', 'N', '\0', 'X'};
  TEST_ASSERT_TRUE(parseCommand(binary, sizeof(binary)) == Command::Unknown);
  TEST_ASSERT_TRUE(parseCommand("ON", 2) == Command::AlertLedOn);
}

void test_adc_average_handles_startup_replacement_and_reset() {
  RollingAverage<3> average;
  TEST_ASSERT_EQUAL_INT(0, average.value());
  average.add(100);
  TEST_ASSERT_EQUAL_INT(100, average.value());
  average.add(200);
  average.add(300);
  TEST_ASSERT_EQUAL_INT(200, average.value());
  average.add(400);
  TEST_ASSERT_EQUAL_INT(300, average.value());
  average.clear();
  average.add(1023);
  TEST_ASSERT_EQUAL_INT(1023, average.value());
}

void test_retry_delays_are_exact_capped_and_wrap_safe() {
  RetryBackoff retry(2000, 30000);
  const uint32_t start = UINT32_MAX - 1000;
  TEST_ASSERT_TRUE(retry.due(start));
  TEST_ASSERT_EQUAL_UINT32(2000, retry.failed(start));
  TEST_ASSERT_FALSE(retry.due(start + 1999));
  TEST_ASSERT_TRUE(retry.due(start + 2000));
  TEST_ASSERT_EQUAL_UINT32(4000, retry.failed(5000));
  TEST_ASSERT_FALSE(retry.due(8999));
  TEST_ASSERT_TRUE(retry.due(9000));
  TEST_ASSERT_EQUAL_UINT32(8000, retry.failed(10000));
  TEST_ASSERT_EQUAL_UINT32(16000, retry.failed(20000));
  TEST_ASSERT_EQUAL_UINT32(30000, retry.failed(40000));
  TEST_ASSERT_EQUAL_UINT32(30000, retry.failed(80000));
  retry.reset();
  TEST_ASSERT_TRUE(retry.due(80000));
  TEST_ASSERT_EQUAL_UINT32(2000, retry.failed(80001));
}

void test_readiness_is_carried_by_published_measurements() {
  Fixture f;
  const SentinelSettings settings{2000, 2000, 300, 5, 250, 45000};
  Sentinel sentinel(f.sensors, f.actuators, f.link, f.display, f.clock, f.logger, f.failsafe, settings);
  sentinel.begin(0);
  sentinel.tick(2000);
  TEST_ASSERT_TRUE(f.link.readings[0].climateValid);
  TEST_ASSERT_FALSE(f.link.readings[0].gasValid);
  TEST_ASSERT_FALSE(f.link.readings[0].presenceValid);
  sentinel.tick(45000);
  TEST_ASSERT_TRUE(f.link.readings[1].presenceValid);
  TEST_ASSERT_FALSE(f.link.readings[1].gasValid);
  sentinel.tick(60000);
  TEST_ASSERT_TRUE(f.link.readings[2].gasValid);
}

void test_no_telemetry_when_all_measurements_are_unavailable() {
  Fixture f;
  f.sensors.next.climateValid = false;
  const SentinelSettings settings{2000, 2000, 300, 5, 250, 45000};
  Sentinel sentinel(f.sensors, f.actuators, f.link, f.display, f.clock, f.logger, f.failsafe, settings);
  sentinel.begin(0);
  sentinel.tick(2000);
  TEST_ASSERT_EQUAL(0, f.link.count);
  TEST_ASSERT_EQUAL(0, sentinel.bufferedSamples());
}

void test_reconnect_replays_old_samples_before_a_new_periodic_sample() {
  Fixture f;
  f.link.current = LinkState::BrokerConnecting;
  f.sentinel.begin(0);
  for (uint32_t i = 1; i <= 3; ++i) {
    f.clock.epoch = 1791280000 + i;
    f.sentinel.tick(i * 2000);
  }
  f.link.current = LinkState::Online;
  f.clock.epoch = 1791280004;
  f.sentinel.tick(8000);  // publication periodique ET reprise dans le meme tour
  TEST_ASSERT_EQUAL(4, f.link.count);
  for (size_t i = 0; i < 4; ++i) {
    TEST_ASSERT_EQUAL_UINT32(1791280001 + i, f.link.published[i]);
  }
  TEST_ASSERT_EQUAL(0, f.sentinel.bufferedSamples());
}

void test_failed_replay_keeps_samples_until_the_transport_accepts_them() {
  Fixture f;
  f.sentinel.begin(0);
  f.clock.epoch = 1791280001;
  f.link.accepting = false;
  f.sentinel.tick(2000);
  f.sentinel.tick(2100);
  TEST_ASSERT_EQUAL(1, f.sentinel.bufferedSamples());
  TEST_ASSERT_EQUAL(0, f.link.count);
  f.link.accepting = true;
  f.sentinel.tick(2200);
  TEST_ASSERT_EQUAL(0, f.sentinel.bufferedSamples());
  TEST_ASSERT_EQUAL(1, f.link.count);
}

void test_offline_overflow_is_bounded_and_reports_dropped_samples() {
  Fixture f;
  f.link.current = LinkState::WifiConnecting;
  f.sentinel.begin(0);
  for (uint32_t i = 1; i <= kOfflineBufferSize + 3; ++i) {
    f.clock.epoch = 1791280000 + i;
    f.sentinel.tick(i * 2000);
  }
  TEST_ASSERT_EQUAL(kOfflineBufferSize, f.sentinel.bufferedSamples());
  TEST_ASSERT_EQUAL_UINT32(3, f.sentinel.droppedSamples());
  f.link.current = LinkState::Online;
  f.sentinel.tick((kOfflineBufferSize + 3) * 2000 + 1);
  TEST_ASSERT_EQUAL_UINT32(1791280004, f.link.published[0]);
}

void test_invalid_adc_does_not_clear_an_active_gas_alarm() {
  Fixture f;
  f.sentinel.begin(0);
  f.sensors.next.gas = 900;
  f.sentinel.tick(60000);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
  f.sensors.next.gas = -1;
  f.sentinel.tick(60250);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
  TEST_ASSERT_FALSE(f.sentinel.readings().gasValid);
  f.sensors.next.gas = 550;
  f.sentinel.tick(60500);
  TEST_ASSERT_FALSE(f.actuators.last.buzzer);
}

void test_begin_resets_remote_commands_measurements_and_queue() {
  Fixture f;
  f.link.current = LinkState::WifiConnecting;
  f.clock.epoch = 1791280000;
  f.sentinel.begin(0);
  f.sentinel.handleCommand("ALARM_ON", 8);
  f.sentinel.tick(2000);
  TEST_ASSERT_EQUAL(1, f.sentinel.bufferedSamples());
  f.sentinel.begin(3000);
  TEST_ASSERT_EQUAL(0, f.sentinel.bufferedSamples());
  TEST_ASSERT_FALSE(f.sentinel.readings().anyValid());
  f.sentinel.tick(3000);
  TEST_ASSERT_FALSE(f.actuators.last.buzzer);
  TEST_ASSERT_FALSE(f.actuators.last.alertLed);
}

void test_payload_contains_backend_numeric_types_and_boolean_presence() {
  Sample sample;
  sample.timestamp = 1791280000;
  sample.readings = Readings{22.56f, 48.24f, true, 120, true, true, true};
  char payload[256];
  TEST_ASSERT_TRUE(buildTelemetryPayload(sample, "esp\"01", -60, payload, sizeof(payload)) > 0);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, payload));
  TEST_ASSERT_TRUE(doc["temperature"].is<float>());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 22.6f, doc["temperature"].as<float>());
  TEST_ASSERT_TRUE(doc["gas"].is<int>());
  TEST_ASSERT_EQUAL_INT(120, doc["gas"].as<int>());
  TEST_ASSERT_TRUE(doc["presence"].is<bool>());
  TEST_ASSERT_TRUE(doc["presence"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("esp\"01", doc["device"].as<const char *>());
  TEST_ASSERT_EQUAL_UINT32(sample.timestamp, doc["ts"].as<uint32_t>());
}

void test_payload_omits_warming_sensors_and_unsynchronized_timestamp() {
  Sample sample;
  sample.readings = Readings{21, 50, true, 900, true, false, false};
  char payload[256];
  TEST_ASSERT_TRUE(buildTelemetryPayload(sample, "esp", -60, payload, sizeof(payload)) > 0);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, payload));
  TEST_ASSERT_TRUE(doc["gas"].isNull());
  TEST_ASSERT_TRUE(doc["presence"].isNull());
  TEST_ASSERT_TRUE(doc["ts"].isNull());
  TEST_ASSERT_FALSE(doc["temperature"].isNull());
}

void test_payload_rejects_empty_and_truncated_json() {
  Sample sample;
  char payload[256] = "old";
  TEST_ASSERT_EQUAL(0, buildTelemetryPayload(sample, "esp", -60, payload, sizeof(payload)));
  TEST_ASSERT_EQUAL_STRING("", payload);
  sample.readings.presenceValid = true;
  TEST_ASSERT_TRUE(buildTelemetryPayload(sample, "esp", -60, payload, sizeof(payload)) > 0);
  const size_t length = strlen(payload);
  TEST_ASSERT_EQUAL(0, buildTelemetryPayload(sample, "esp", -60, payload, length));
  TEST_ASSERT_EQUAL_STRING("", payload);
  TEST_ASSERT_TRUE(buildTelemetryPayload(sample, "esp", -60, payload, length + 1) > 0);
  TEST_ASSERT_EQUAL(0, buildTelemetryPayload(sample, "esp", -60, nullptr, 10));
}

void test_payload_omits_invalid_climate_and_adc_but_preserves_valid_presence() {
  Sample sample;
  sample.readings = Readings{NAN, 50, true, 1024, false, true, true};
  char payload[256];
  TEST_ASSERT_TRUE(buildTelemetryPayload(sample, "esp", -60, payload, sizeof(payload)) > 0);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, payload));
  TEST_ASSERT_TRUE(doc["temperature"].isNull());
  TEST_ASSERT_TRUE(doc["humidity"].isNull());
  TEST_ASSERT_TRUE(doc["gas"].isNull());
  TEST_ASSERT_TRUE(doc["presence"].is<bool>());
  TEST_ASSERT_FALSE(doc["presence"].as<bool>());
  sample.readings.presenceValid = false;
  TEST_ASSERT_EQUAL(0, buildTelemetryPayload(sample, "esp", -60, payload, sizeof(payload)));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_commands_are_trimmed_and_case_insensitive);
  RUN_TEST(test_gas_failsafe_waits_for_warmup_and_uses_hysteresis);
  RUN_TEST(test_alarm_outputs);
  RUN_TEST(test_sample_buffer_overwrites_the_oldest);
  RUN_TEST(test_publishes_periodically_and_on_presence_change);
  RUN_TEST(test_buffers_offline_samples_and_replays_them_in_order);
  RUN_TEST(test_does_not_buffer_without_clock);
  RUN_TEST(test_gas_failsafe_drives_the_actuators);
  RUN_TEST(test_commands_reach_the_alarm);
  RUN_TEST(test_gas_warmup_is_relative_to_begin_and_survives_millis_wrap);
  RUN_TEST(test_local_alarm_has_priority_over_warning_and_remote_off);
  RUN_TEST(test_climate_error_uses_orange_without_fabricating_an_alarm);
  RUN_TEST(test_gas_and_climate_have_independent_sampling_intervals);
  RUN_TEST(test_pir_is_ignored_during_warmup_then_alarms_immediately);
  RUN_TEST(test_pir_readiness_survives_millis_wrap);
  RUN_TEST(test_ready_healthy_system_uses_green_even_without_network);
  RUN_TEST(test_local_mode_does_not_build_an_offline_telemetry_queue);
  RUN_TEST(test_gas_alarm_reacts_between_dht_reads_and_recovers_at_off_threshold);
  RUN_TEST(test_sensor_error_and_recovery_update_leds);
  RUN_TEST(test_command_rejects_null_and_embedded_nul);
  RUN_TEST(test_adc_average_handles_startup_replacement_and_reset);
  RUN_TEST(test_retry_delays_are_exact_capped_and_wrap_safe);
  RUN_TEST(test_readiness_is_carried_by_published_measurements);
  RUN_TEST(test_no_telemetry_when_all_measurements_are_unavailable);
  RUN_TEST(test_reconnect_replays_old_samples_before_a_new_periodic_sample);
  RUN_TEST(test_failed_replay_keeps_samples_until_the_transport_accepts_them);
  RUN_TEST(test_offline_overflow_is_bounded_and_reports_dropped_samples);
  RUN_TEST(test_invalid_adc_does_not_clear_an_active_gas_alarm);
  RUN_TEST(test_begin_resets_remote_commands_measurements_and_queue);
  RUN_TEST(test_payload_contains_backend_numeric_types_and_boolean_presence);
  RUN_TEST(test_payload_omits_warming_sensors_and_unsynchronized_timestamp);
  RUN_TEST(test_payload_rejects_empty_and_truncated_json);
  RUN_TEST(test_payload_omits_invalid_climate_and_adc_but_preserves_valid_presence);
  return UNITY_END();
}

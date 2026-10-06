// Tests du coeur du firmware (domaine + application), executes nativement.
#include <string.h>
#include <unity.h>

#include "application/sentinel.h"
#include "domain/alarm_state.h"
#include "domain/command.h"
#include "domain/gas_failsafe.h"
#include "domain/sample_buffer.h"

namespace {

Command parse(const char *text) { return parseCommand(text, strlen(text)); }

// --- Faux ports -------------------------------------------------------------

struct FakeSensors : Sensors {
  Readings next;
  bool presence = false;
  void sample(Readings &readings) override {
    const bool keep = readings.presence;
    readings = next;
    readings.presence = keep;
  }
  bool readPresence() override { return presence; }
};

struct FakeActuators : Actuators {
  ActuatorOutputs last{};
  void apply(const ActuatorOutputs &outputs) override { last = outputs; }
};

struct FakeLink : TelemetryLink {
  LinkState current = LinkState::Online;
  uint32_t published[400];
  size_t count = 0;
  LinkState state() const override { return current; }
  bool publish(const Sample &sample) override {
    if (current != LinkState::Online) return false;
    published[count++] = sample.timestamp;
    return true;
  }
};

struct FakeDisplay : StatusDisplay {
  int renders = 0;
  void render(const Readings &, LinkState, bool) override { renders++; }
};

struct FakeClock : Clock {
  uint32_t epoch = 0;
  uint32_t epochSeconds() const override { return epoch; }
};

struct SilentLogger : Logger {
  void info(const char *) override {}
};

constexpr SentinelSettings kSettings{2000, 2000, 500, 5};

struct Fixture {
  FakeSensors sensors;
  FakeActuators actuators;
  FakeLink link;
  FakeDisplay display;
  FakeClock clock;
  SilentLogger logger;
  GasFailsafe failsafe{700, 50, 60000};
  Sentinel sentinel{sensors, actuators, link, display, clock, logger, failsafe, kSettings};
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
  GasFailsafe failsafe(700, 50, 60000);
  TEST_ASSERT_FALSE(failsafe.update(900, 1000));    // prechauffage
  TEST_ASSERT_TRUE(failsafe.update(700, 60000));    // seuil atteint
  TEST_ASSERT_TRUE(failsafe.update(660, 61000));    // dans l'hysteresis
  TEST_ASSERT_FALSE(failsafe.update(649, 62000));   // sous seuil - hysteresis
  GasFailsafe disabled(0, 50, 0);
  TEST_ASSERT_FALSE(disabled.update(1023, 1000));
}

void test_alarm_outputs() {
  AlarmState alarm;
  ActuatorOutputs outputs = alarm.outputs(250, false);  // phase eteinte du clignotement
  TEST_ASSERT_FALSE(outputs.statusLed);
  TEST_ASSERT_TRUE(alarm.outputs(250, true).statusLed);  // fixe en ligne

  TEST_ASSERT_TRUE(alarm.apply(Command::AlertLedOn));
  TEST_ASSERT_TRUE(alarm.outputs(250, true).alertLed);
  TEST_ASSERT_FALSE(alarm.outputs(0, true).buzzer);

  alarm.apply(Command::AlarmOn);
  TEST_ASSERT_TRUE(alarm.outputs(0, true).buzzer);
  TEST_ASSERT_FALSE(alarm.outputs(400, true).buzzer);  // intermittent
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
  f.sentinel.tick(60000);  // tick en phase "allumee" du clignotement et du bip
  TEST_ASSERT_TRUE(f.actuators.last.alertLed);
  TEST_ASSERT_TRUE(f.actuators.last.buzzer);
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
  return UNITY_END();
}

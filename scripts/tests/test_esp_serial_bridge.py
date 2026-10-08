"""Parser and forwarding tests; no serial device, broker or optional package."""
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from esp_serial_bridge import (  # noqa: E402
    BLOCK_END, BLOCK_START, LatestSampleBuffer, MqttForwarder, StatusBlockParser,
    StatusStreamParser, cli_arguments, select_serial_port, serial_port_hint, usb_candidates,
)


def block(**changes):
    fields = {
        "Temperature": "24.4 C", "Humidite": "61.1 %", "Gaz MQ-2": "40",
        "Etat gaz": "NORMAL", "Etat PIR": "NORMAL", "ALARME": "OFF",
        "LED ROUGE": "OFF", "LED ORANGE": "OFF", "LED VERTE": "ON",
    }
    fields.update(changes)
    return [BLOCK_START, *(f"{key:12}: {value}" for key, value in fields.items()), BLOCK_END]


def parse(lines, parser=None):
    parser = parser or StatusBlockParser()
    results = []
    for index, line in enumerate(lines):
        value = parser.feed_line(line, now=index * .01)
        if value is not None:
            results.append(value)
    return results


class ParserTests(unittest.TestCase):
    def test_complete_normal_block_preserves_values_and_device_flags(self):
        self.assertEqual(parse(block()), [{
            "temperature": 24.4, "humidity": 61.1, "gas": 40, "presence": False,
            "climateValid": True, "gasReady": True, "pirReady": True, "gasAlert": False,
            "alarmActive": False, "ledRed": False, "ledOrange": False, "ledGreen": True,
        }])

    def test_real_motion_block_and_gas_alarm_are_distinct(self):
        motion = parse(block(**{"Etat PIR": "MOUVEMENT", "ALARME": "ACTIVE",
                                "LED ROUGE": "ON", "LED VERTE": "OFF"}))[0]
        self.assertTrue(motion["presence"])
        self.assertTrue(motion["alarmActive"])
        self.assertFalse(motion["gasAlert"])
        gas = parse(block(**{"Gaz MQ-2": "630", "Etat gaz": "DANGER", "ALARME": "ACTIVE",
                             "LED ROUGE": "ON", "LED VERTE": "OFF"}))[0]
        self.assertEqual(gas["gas"], 630)
        self.assertTrue(gas["gasAlert"])
        self.assertFalse(gas["presence"])

    def test_warmup_omits_unreliable_gas_and_presence(self):
        value = parse(block(**{"Etat gaz": "CHAUFFE", "Etat PIR": "CALIBRATION",
                               "LED ORANGE": "ON", "LED VERTE": "OFF"}))[0]
        self.assertNotIn("gas", value)
        self.assertNotIn("presence", value)
        self.assertFalse(value["gasReady"])
        self.assertFalse(value["pirReady"])
        self.assertEqual(value["temperature"], 24.4)

    def test_climate_failure_omits_both_dht_fields(self):
        for changes in ({"Temperature": "ERREUR", "Humidite": "ERREUR"},
                        {"Temperature": "ERREUR"}, {"Humidite": "ERREUR"}):
            with self.subTest(changes=changes):
                value = parse(block(**changes))[0]
                self.assertFalse(value["climateValid"])
                self.assertNotIn("temperature", value)
                self.assertNotIn("humidity", value)
                self.assertEqual(value["gas"], 40)

    def test_all_sensors_unavailable_still_provides_real_flags(self):
        value = parse(block(**{"Temperature": "ERREUR", "Humidite": "ERREUR",
                               "Etat gaz": "CHAUFFE", "Etat PIR": "CALIBRATION",
                               "LED ORANGE": "ON", "LED VERTE": "OFF"}))[0]
        self.assertEqual(len(value), 8)
        self.assertTrue(value["ledOrange"])

    def test_boundary_values_and_negative_temperature(self):
        for temperature, humidity, gas in (("-40.0 C", "0.0 %", "0"), ("80.0 C", "100.0 %", "1023")):
            self.assertEqual(len(parse(block(**{"Temperature": temperature, "Humidite": humidity,
                                                "Gaz MQ-2": gas}))), 1)

    def test_invalid_numbers_units_and_states_reject_entire_block(self):
        for key, values in {
            "Temperature": ("NaN C", "inf C", "81.0 C", "-40.1 C", "24.4", "24.4 F"),
            "Humidite": ("101 %", "-1 %", "nan %"),
            "Gaz MQ-2": ("1024", "-1", "12.5", "invalid"),
            "Etat gaz": ("ERREUR", "CHAUFFE junk"),
            "Etat PIR": ("ACTIVE",), "ALARME": ("ON",), "LED VERTE": ("1",),
        }.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    self.assertEqual(parse(block(**{key: value})), [])

    def test_incomplete_block_and_duplicate_fields_are_rejected(self):
        original = block()
        self.assertEqual(parse(original[:-2] + [BLOCK_END]), [])
        self.assertEqual(parse(original[:3] + [original[1]] + original[3:]), [])

    def test_startup_and_motion_noise_outside_blocks_are_ignored(self):
        self.assertEqual(parse(["", "DEMARRAGE SENTINEL-X V2", ">>> MOUVEMENT DETECTE <<<"]
                               + block() + ["PIR : retour NORMAL"]), parse(block()))

    def test_bad_block_resynchronizes_without_reusing_old_fields(self):
        malformed = block()[:4] + ["unexpected noise"] + block()[4:]
        self.assertEqual(parse(malformed + block(**{"Temperature": "19.0 C"}))[0]["temperature"], 19)
        self.assertEqual(parse(block()[:5] + block(**{"Gaz MQ-2": "100"}))[0]["gas"], 100)

    def test_timeout_drops_unfinished_snapshot(self):
        parser = StatusBlockParser(timeout=1)
        for line in block()[:-1]:
            parser.feed_line(line, now=0)
        self.assertIsNone(parser.feed_line(BLOCK_END, now=1.01))
        self.assertEqual(len(parse(block(), parser)), 1)

    def test_crlf_and_whitespace_are_supported_but_oversized_lines_are_dropped(self):
        self.assertEqual(parse([f" {line}\r\n" for line in block()]), parse(block()))
        self.assertEqual(parse(block()[:3] + ["x" * 257] + block()[3:]), [])


class BufferTests(unittest.TestCase):
    def test_only_latest_sample_survives_and_timestamp_is_preserved(self):
        buffer = LatestSampleBuffer()
        buffer.put({"ts": 100, "gas": 30}, 1)
        buffer.put({"ts": 101, "gas": 40}, 2)
        self.assertEqual(buffer.peek(3).payload, {"ts": 101, "gas": 40})
        self.assertIsNone(buffer.peek(4.01))

    def test_future_monotonic_sample_and_clear_are_safe(self):
        buffer = LatestSampleBuffer()
        buffer.put({"ts": 100}, 5)
        self.assertIsNone(buffer.peek(4))
        buffer.put({"ts": 100}, 5)
        buffer.clear()
        self.assertIsNone(buffer.peek(5))


class StreamParserTests(unittest.TestCase):
    def test_byte_fragments_and_serial_timeouts_preserve_a_complete_snapshot(self):
        parser = StatusStreamParser()
        wire = ("\r\n".join(block()) + "\r\n").encode()
        results = []
        for index, byte in enumerate(wire):
            results.extend(parser.feed(bytes([byte]), now=index * .001))
            self.assertEqual(parser.feed(b"", now=index * .001), [])
        self.assertEqual(results, parse(block()))

    def test_multiple_blocks_in_one_chunk_preserve_each_snapshot(self):
        lines = block() + block(**{"Temperature": "76.8 C", "Humidite": "6.9 %"})
        results = StatusStreamParser().feed(("\n".join(lines) + "\n").encode(), now=0)
        self.assertEqual(results, parse(lines))
        self.assertEqual(results[1]["temperature"], 76.8)
        self.assertEqual(results[1]["humidity"], 6.9)

    def test_partial_line_timeout_drops_frame_and_resynchronizes(self):
        parser = StatusStreamParser(timeout=1)
        prefix = (BLOCK_START + "\nTemperature : 2").encode()
        self.assertEqual(parser.feed(prefix, now=0), [])
        self.assertEqual(parser.feed(b"", now=1.01), [])
        suffix = ("4.4 C\n" + "\n".join(block()[2:]) + "\n").encode()
        self.assertEqual(parser.feed(suffix, now=1.02), [])
        self.assertEqual(parser.feed(("\n".join(block()) + "\n").encode(), now=1.03), parse(block()))

    def test_oversized_line_and_boot_bytes_do_not_contaminate_next_frame(self):
        parser = StatusStreamParser()
        prefix = (BLOCK_START + "\n").encode()
        self.assertEqual(parser.feed(prefix + b"x" * 10000, now=0), [])
        suffix = ("\n" + "\n".join(block()[1:]) + "\n").encode()
        self.assertEqual(parser.feed(suffix, now=.1), [])
        wire = b"\xff\xfe\x00\n" + ("\n".join(block()) + "\n").encode()
        self.assertEqual(parser.feed(wire, now=.2), parse(block()))

    def test_reconnect_reset_never_combines_two_sessions(self):
        parser = StatusStreamParser()
        self.assertEqual(parser.feed(("\n".join(block()[:5]) + "\n").encode(), now=0), [])
        parser.reset()
        self.assertEqual(parser.feed(("\n".join(block()[5:]) + "\n").encode(), now=.1), [])
        self.assertEqual(parser.feed(("\n".join(block()) + "\n").encode(), now=.2), parse(block()))


class FakeInfo:
    def __init__(self, rc=0):
        self.rc = rc
        self.published = False

    def is_published(self):
        return self.published


class FakeClient:
    def __init__(self):
        self.connected = False
        self.calls = []
        self.info = FakeInfo()

    def is_connected(self):
        return self.connected

    def publish(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.info


class ForwarderTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.buffer = LatestSampleBuffer()
        self.forwarder = MqttForwarder(self.client, "esp8266/donnees", self.buffer)

    def test_offline_does_not_publish_and_expired_measurement_is_not_replayed(self):
        self.buffer.put({"ts": 100, "gas": 40}, 1)
        self.forwarder.poll(1)
        self.assertEqual(self.client.calls, [])
        self.client.connected = True
        self.forwarder.poll(3.01)
        self.assertEqual(self.client.calls, [])

    def test_mqtt_qos_zero_not_retained_original_timestamp_and_bounded_inflight(self):
        self.client.connected = True
        self.buffer.put({"ts": 100, "gas": 40}, 1)
        self.assertIsNone(self.forwarder.poll(1))
        args, options = self.client.calls[0]
        self.assertEqual(args[0], "esp8266/donnees")
        self.assertEqual(json.loads(args[1]), {"ts": 100, "gas": 40})
        self.assertEqual(options, {"qos": 0, "retain": False})
        for index in range(10):
            self.buffer.put({"ts": 101 + index}, 1)
            self.forwarder.poll(1.1)
        self.assertEqual(len(self.client.calls), 1)
        self.client.info.published = True
        self.assertEqual(self.forwarder.poll(1.2), {"ts": 100, "gas": 40})
        self.assertEqual(self.forwarder.sent_count, 1)
        self.forwarder.poll(1.3)
        self.assertEqual(json.loads(self.client.calls[-1][0][1]), {"ts": 110})

    def test_lost_qos_zero_message_is_not_reissued_on_reconnection(self):
        self.client.connected = True
        self.buffer.put({"ts": 100, "gas": 40}, 1)
        self.forwarder.poll(1)
        self.client.connected = False
        self.forwarder.poll(1.1)
        self.client.connected = True
        self.forwarder.poll(1.2)
        self.assertEqual(len(self.client.calls), 1)
        self.assertEqual(self.forwarder.sent_count, 0)

    def test_publish_rejection_keeps_only_fresh_latest_sample(self):
        self.client.connected = True
        self.client.info.rc = 4
        self.buffer.put({"ts": 100}, 1)
        self.forwarder.poll(1)
        self.assertIsNotNone(self.buffer.peek(1))
        self.forwarder.poll(4)
        self.assertEqual(len(self.client.calls), 1)


def port(device, description, vid=None):
    return SimpleNamespace(device=device, description=description, vid=vid, manufacturer="", hwid="")


class PortAndCliTests(unittest.TestCase):
    def test_autodetection_selects_ch340_and_excludes_bluetooth(self):
        ports = [port("COM4", "Bluetooth"), port("COM5", "Bluetooth UART", 1),
                 port("COM7", "USB-SERIAL CH340", 0x1a86)]
        self.assertEqual(select_serial_port(ports), "COM7")
        self.assertEqual(len(usb_candidates(ports)), 1)

    def test_ambiguous_or_missing_port_requires_explicit_selection(self):
        for ports in ([], [port("COM7", "CH340"), port("COM8", "CP2102")]):
            with self.assertRaises(ValueError):
                select_serial_port(ports)
        self.assertEqual(select_serial_port([], "COM12"), "COM12")

    def test_cli_defaults_and_bounded_diagnostic(self):
        args = cli_arguments(["--port", "COM7", "--max-messages", "3"])
        self.assertEqual((args.baud, args.mqtt_host, args.mqtt_port, args.mqtt_topic),
                         (115200, "127.0.0.1", 1883, "esp8266/donnees"))
        self.assertEqual(args.max_messages, 3)

    def test_diagnostic_explains_pinned_port_after_windows_renumbering(self):
        ports = [port("COM6", "USB-SERIAL CH340", 0x1a86), port("COM4", "Bluetooth")]
        hint = serial_port_hint(ports, "COM7")
        self.assertIn("COM6", hint)
        self.assertIn("COM7 absent", hint)
        self.assertIn("Sans --port", hint)
        # An explicitly selected device is never silently replaced by another.
        self.assertEqual(select_serial_port(ports, "COM7"), "COM7")
        self.assertNotIn("absent", serial_port_hint(ports, "com6"))


if __name__ == "__main__":
    unittest.main()

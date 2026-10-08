"""Read Sentinel-X's USB status blocks and forward fresh telemetry to MQTT.

The ESP remains the owner of its alarms and LEDs. This process never sends a
serial command and does not replay an offline measurement history.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import re
import time
from dataclasses import dataclass
from typing import Any

LOGGER = logging.getLogger("esp-bridge")
BLOCK_START = "========= SENTINEL-X ========="
BLOCK_END = "=============================="
FIELDS = {
    "Temperature", "Humidite", "Gaz MQ-2", "Etat gaz", "Etat PIR",
    "ALARME", "LED ROUGE", "LED ORANGE", "LED VERTE",
}
MAX_LINE_BYTES = 256


def _measurement(value: str, unit: str, minimum: float, maximum: float) -> float | None:
    if value == "ERREUR":
        return None
    matched = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s+" + re.escape(unit), value)
    if not matched:
        raise ValueError("Invalid measurement or unit")
    number = float(matched.group(1))
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError("Measurement out of range")
    return number


def _state(value: str, allowed: tuple[str, ...]) -> str:
    if value not in allowed:
        raise ValueError("Invalid device state")
    return value


def telemetry_from_fields(fields: dict[str, str]) -> dict[str, Any]:
    """Validate one complete snapshot; unavailable sensors are omitted."""
    if set(fields) != FIELDS:
        raise ValueError("Incomplete status block")
    temperature = _measurement(fields["Temperature"], "C", -40, 80)
    humidity = _measurement(fields["Humidite"], "%", 0, 100)
    if not re.fullmatch(r"\d{1,4}", fields["Gaz MQ-2"]):
        raise ValueError("Invalid MQ-2 reading")
    gas = int(fields["Gaz MQ-2"])
    if not 0 <= gas <= 1023:
        raise ValueError("MQ-2 must be an ESP8266 raw ADC value")
    gas_state = _state(fields["Etat gaz"], ("CHAUFFE", "DANGER", "NORMAL"))
    pir_state = _state(fields["Etat PIR"], ("CALIBRATION", "MOUVEMENT", "NORMAL"))
    climate_valid = temperature is not None and humidity is not None
    result: dict[str, Any] = {
        "climateValid": climate_valid,
        "gasReady": gas_state != "CHAUFFE",
        "pirReady": pir_state != "CALIBRATION",
        "gasAlert": gas_state == "DANGER",
        "alarmActive": _state(fields["ALARME"], ("ACTIVE", "OFF")) == "ACTIVE",
        "ledRed": _state(fields["LED ROUGE"], ("ON", "OFF")) == "ON",
        "ledOrange": _state(fields["LED ORANGE"], ("ON", "OFF")) == "ON",
        "ledGreen": _state(fields["LED VERTE"], ("ON", "OFF")) == "ON",
    }
    if climate_valid:
        result.update(temperature=temperature, humidity=humidity)
    if result["gasReady"]:
        result["gas"] = gas
    if result["pirReady"]:
        result["presence"] = pir_state == "MOUVEMENT"
    return result


class StatusBlockParser:
    """Bounded parser that resynchronizes on the next full block header."""

    def __init__(self, timeout: float = 3.0):
        self.timeout = timeout
        self.reset()

    def reset(self) -> None:
        self._started: float | None = None
        self._fields: dict[str, str] = {}

    def feed_line(self, line: str, now: float | None = None) -> dict[str, Any] | None:
        now = time.monotonic() if now is None else now
        if len(line) > MAX_LINE_BYTES:
            self.reset()
            return None
        line = line.strip()
        if line == BLOCK_START:
            self._started = now
            self._fields = {}
            return None
        if self._started is None:
            return None
        if now - self._started > self.timeout:
            self.reset()
            return None
        if line == BLOCK_END:
            fields = self._fields
            self.reset()
            try:
                return telemetry_from_fields(fields)
            except ValueError:
                return None
        matched = re.fullmatch(r"([^:]+?)\s*:\s*(.+)", line)
        if not matched:
            self.reset()
            return None
        key, value = matched.group(1).strip(), matched.group(2).strip()
        if key not in FIELDS or key in self._fields:
            self.reset()
            return None
        self._fields[key] = value
        return None


class StatusStreamParser:
    """Keep partial USB lines across read timeouts, with bounded memory/time."""

    def __init__(self, timeout: float = 3.0):
        self.timeout = timeout
        self._parser = StatusBlockParser(timeout)
        self.reset()

    def reset(self) -> None:
        self._parser.reset()
        self._line = bytearray()
        self._partial_since: float | None = None
        self._discarding = False

    def feed(self, data: bytes, now: float | None = None) -> list[dict[str, Any]]:
        now = time.monotonic() if now is None else now
        if self._partial_since is not None and now - self._partial_since > self.timeout:
            self._line.clear()
            self._partial_since = None
            self._discarding = True
            self._parser.reset()
        results = []
        for byte in data:
            if byte == 10:
                if not self._discarding:
                    try:
                        line = self._line.decode("utf-8", errors="strict")
                    except UnicodeDecodeError:
                        self._parser.reset()
                    else:
                        value = self._parser.feed_line(line, now)
                        if value is not None:
                            results.append(value)
                self._line.clear()
                self._partial_since = None
                self._discarding = False
            elif not self._discarding:
                if self._partial_since is None:
                    self._partial_since = now
                if len(self._line) >= MAX_LINE_BYTES:
                    self._line.clear()
                    self._partial_since = None
                    self._discarding = True
                    self._parser.reset()
                else:
                    self._line.append(byte)
        return results


@dataclass(frozen=True)
class PendingSample:
    payload: dict[str, Any]
    received_at: float


class LatestSampleBuffer:
    """Exactly one recent sample, with its original reception timestamp."""

    def __init__(self, max_age: float = 2.0):
        self.max_age = max_age
        self._latest: PendingSample | None = None

    def put(self, payload: dict[str, Any], received_at: float) -> None:
        self._latest = PendingSample(dict(payload), received_at)

    def clear(self) -> None:
        self._latest = None

    def peek(self, now: float) -> PendingSample | None:
        if self._latest and not 0 <= now - self._latest.received_at <= self.max_age:
            self.clear()
        return self._latest


class MqttForwarder:
    """At most one QoS 0 packet in flight; no retained/offline MQTT history."""

    def __init__(self, client: Any, topic: str, samples: LatestSampleBuffer):
        self.client = client
        self.topic = topic
        self.samples = samples
        self._pending: tuple[Any, PendingSample] | None = None
        self.sent_count = 0

    def poll(self, now: float) -> dict[str, Any] | None:
        if self._pending:
            info, sample = self._pending
            try:
                published = info.is_published()
            except (RuntimeError, ValueError):
                self._pending = None
                return None
            if not published:
                if not self.client.is_connected():
                    # A dropped QoS 0 message is not retried as a new observation.
                    self._pending = None
                return None
            self._pending = None
            self.sent_count += 1
            return sample.payload
        sample = self.samples.peek(now)
        if sample is None or not self.client.is_connected():
            return None
        info = self.client.publish(
            self.topic, json.dumps(sample.payload, separators=(",", ":"), allow_nan=False),
            qos=0, retain=False,
        )
        if info.rc == 0:
            self.samples.clear()
            self._pending = (info, sample)
        return None


def usb_candidates(ports: Any) -> list[Any]:
    candidates = []
    for port in ports:
        description = f"{port.description or ''} {port.manufacturer or ''} {port.hwid or ''}".lower()
        if "bluetooth" in description:
            continue
        if port.vid is not None or any(marker in description for marker in (
            "ch340", "ch341", "cp210", "usb serial", "usb-serial", "ftdi", "usb uart",
        )):
            candidates.append(port)
    return candidates


def select_serial_port(ports: Any, explicit_port: str | None = None) -> str:
    if explicit_port:
        return explicit_port
    candidates = usb_candidates(ports)
    if len(candidates) != 1:
        raise ValueError(
            f"{len(candidates)} ports USB plausibles : utilisez --list-ports puis --port COMx."
        )
    return candidates[0].device


def serial_port_hint(ports: Any, explicit_port: str | None = None) -> str:
    ports = list(ports)
    available = ", ".join(f"{port.device} ({port.description})" for port in ports) or "aucun"
    hint = f"Ports detectes : {available}."
    if explicit_port and not any(port.device.casefold() == explicit_port.casefold() for port in ports):
        hint += f" {explicit_port} absent ; verifiez --list-ports et --port."
        if len(usb_candidates(ports)) == 1:
            hint += " Sans --port, l'unique port USB sera selectionne automatiquement."
    return hint


def _positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("Une valeur positive est requise")
    return number


def cli_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="Port USB, par exemple COM7 ; sinon autodetection unique")
    parser.add_argument("--baud", type=_positive_int, default=115200)
    parser.add_argument("--mqtt-host", default="127.0.0.1")
    parser.add_argument("--mqtt-port", type=_positive_int, default=1883)
    parser.add_argument("--mqtt-topic", default="esp8266/donnees")
    parser.add_argument("--device", default="sentinel-x-01")
    parser.add_argument("--list-ports", action="store_true")
    parser.add_argument("--max-messages", type=_positive_int,
                        help="S'arreter apres N envois MQTT (diagnostic)")
    args = parser.parse_args(argv)
    if args.mqtt_port > 65535:
        parser.error("--mqtt-port doit etre compris entre 1 et 65535")
    if not args.mqtt_topic or any(character in args.mqtt_topic for character in "#+\0"):
        parser.error("--mqtt-topic doit etre un topic de publication sans wildcard")
    if not args.device or len(args.device) > 64 or any(ord(c) < 32 for c in args.device):
        parser.error("--device doit contenir de 1 a 64 caracteres imprimables")
    return args


def main(argv: list[str] | None = None) -> int:
    args = cli_arguments(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [USB-MQTT] %(message)s")
    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        LOGGER.error("Installez les dependances : python -m pip install -r scripts/requirements-esp.txt")
        return 1
    if args.list_ports:
        for port in list_ports.comports():
            kind = "USB" if usb_candidates([port]) else "autre"
            print(f"{port.device}: {port.description} [{kind}]")
        return 0
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        LOGGER.error("Installez les dependances : python -m pip install -r scripts/requirements-esp.txt")
        return 1

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.reconnect_delay_set(min_delay=1, max_delay=15)
    client.max_inflight_messages_set(1)
    client.max_queued_messages_set(1)

    def on_connect(_client, _userdata, _flags, reason_code, _properties):
        if reason_code.is_failure:
            LOGGER.warning("Connexion MQTT refusee : %s", reason_code)
        else:
            LOGGER.info("MQTT connecte sur %s:%s, topic %s", args.mqtt_host, args.mqtt_port, args.mqtt_topic)

    def on_disconnect(_client, _userdata, _flags, reason_code, _properties):
        if reason_code.is_failure:
            LOGGER.warning("MQTT deconnecte ; reconnexion automatique")

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_connect_fail = lambda *_args: LOGGER.warning("MQTT indisponible ; nouvel essai automatique")
    client.connect_async(args.mqtt_host, args.mqtt_port, keepalive=15)
    client.loop_start()
    samples = LatestSampleBuffer()
    forwarder = MqttForwarder(client, args.mqtt_topic, samples)
    parser = StatusStreamParser()
    device = None
    next_attempt = 0.0
    previous_error = None
    last_block_at = 0.0
    last_stale_warning: float | None = None
    LOGGER.info("Lecture USB seule ; aucun ordre envoye au firmware. Ctrl+C pour arreter.")
    try:
        while True:
            now = time.monotonic()
            sent = forwarder.poll(now)
            if sent:
                LOGGER.info("MQTT #%d T=%s H=%s gaz=%s presence=%s alarme=%s",
                            forwarder.sent_count, sent.get("temperature", "indisponible"),
                            sent.get("humidity", "indisponible"), sent.get("gas", "chauffe"),
                            sent.get("presence", "calibration"), sent["alarmActive"])
                if args.max_messages and forwarder.sent_count >= args.max_messages:
                    return 0
            if device is None:
                if now < next_attempt:
                    time.sleep(0.1)
                    continue
                try:
                    ports = list(list_ports.comports())
                    port = select_serial_port(ports, args.port)
                    # Set modem lines before opening; never write sensor commands.
                    device = serial.Serial(port=None, baudrate=args.baud, timeout=0.25)
                    device.dtr = False
                    device.rts = False
                    device.port = port
                    device.open()
                    device.reset_input_buffer()
                    parser.reset()
                    previous_error = None
                    last_block_at = time.monotonic()
                    last_stale_warning = None
                    LOGGER.info("Port %s ouvert a %s bauds", port, args.baud)
                except (serial.SerialException, OSError, ValueError) as error:
                    if device is not None:
                        device.close()
                    device = None
                    text = f"{error}. {serial_port_hint(list_ports.comports(), args.port)}"
                    if text != previous_error:
                        LOGGER.warning("USB indisponible : %s (reessai dans 2 s)", text)
                        previous_error = text
                    next_attempt = time.monotonic() + 2
                    continue
            try:
                chunk = device.read_until(b"\n", size=MAX_LINE_BYTES + 1)
                received_at = time.monotonic()
                for telemetry in parser.feed(chunk, received_at):
                    if last_stale_warning is not None:
                        LOGGER.info("Reception de blocs Sentinel-X retablie sur %s", port)
                    last_block_at = received_at
                    last_stale_warning = None
                    payload = {"source": "live", "device": args.device, "ts": time.time(), **telemetry}
                    samples.put(payload, received_at)
                if received_at - last_block_at >= 10 and (
                    last_stale_warning is None or received_at - last_stale_warning >= 30
                ):
                    LOGGER.warning(
                        "Port %s ouvert mais aucun bloc Sentinel-X valide depuis %.0f s ; "
                        "verifiez le firmware USB, le debit %s et le moniteur serie.",
                        port, received_at - last_block_at, args.baud,
                    )
                    last_stale_warning = received_at
            except (serial.SerialException, OSError) as error:
                LOGGER.warning("Port USB perdu : %s", error)
                device.close()
                device = None
                parser.reset()
                samples.clear()
                next_attempt = time.monotonic() + 2
    except KeyboardInterrupt:
        LOGGER.info("Passerelle arretee")
        return 0
    finally:
        if device is not None:
            device.close()
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    raise SystemExit(main())

"""Explicit demo mode. Publishes MQTT -> real backend -> AI -> authenticated dashboard."""
import argparse
import csv
import math
import os
import random
import time
from datetime import timedelta
from pathlib import Path
from threading import Event
from urllib.parse import urlparse

from .schemas.sensor import SensorSample, utc_now


def normal_samples(count: int = 1200, seed: int = 42) -> list[SensorSample]:
    rng = random.Random(seed)
    start = utc_now() - timedelta(seconds=count * 2)
    return [SensorSample(
        temperature=23.5 + 0.6 * math.sin(index / 25) + rng.gauss(0, 0.1),
        humidity=52 + 4 * math.sin(index / 40) + rng.gauss(0, 0.4),
        gas=140 + 10 * math.sin(index / 32) + rng.gauss(0, 2),
        presence=(index % 120 < 12), timestamp=start + timedelta(seconds=index * 2), source="simulation",
    ) for index in range(count)]


def drift_samples(count: int = 40) -> list[SensorSample]:
    start = utc_now()
    return [SensorSample(temperature=24 + index * 0.12, humidity=52, gas=145 + index * 2.5,
                         presence=False, timestamp=start + timedelta(seconds=index * 2), source="simulation")
            for index in range(count)]


def write_training(path: Path, count: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "temperature", "humidity", "gas", "presence"])
        for sample in normal_samples(count):
            writer.writerow([sample.timestamp.isoformat(), sample.temperature, sample.humidity,
                             sample.gas, int(sample.presence)])
    print(f"[SIMULATION] Wrote {count} synthetic normal samples to {path}; use only for demonstration training")


def publish(args):
    import json
    import paho.mqtt.client as mqtt
    url = urlparse(args.mqtt_url)
    if url.scheme not in ("mqtt", "mqtts"):
        raise ValueError("MQTT_URL must use mqtt:// or mqtts://")
    connected = Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

    def on_connect(_client, _userdata, _flags, reason, _properties):
        if not reason.is_failure:
            connected.set()

    def on_disconnect(_client, _userdata, _flags, _reason, _properties):
        connected.clear()

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.reconnect_delay_set(1, 10)
    if url.username:
        client.username_pw_set(url.username, url.password)
    if url.scheme == "mqtts":
        client.tls_set()
    client.connect_async(url.hostname or "127.0.0.1", url.port or (8883 if url.scheme == "mqtts" else 1883))
    client.loop_start()
    try:
        if not connected.wait(10):
            raise ConnectionError("MQTT broker unavailable; start Mosquitto first")
        print("[SIMULATION] Explicit synthetic telemetry through MQTT and the existing backend")
        samples = normal_samples(args.normal_count) + drift_samples(args.drift_count)
        for sample in samples:
            if not connected.wait(10):
                raise ConnectionError("MQTT reconnection timed out")
            payload = sample.model_dump(mode="json", exclude={"sample_id", "timestamp"})
            payload["ts"] = time.time()
            info = client.publish(args.topic, json.dumps(payload), qos=1)
            info.wait_for_publish(timeout=5)
            if not info.is_published():
                raise ConnectionError("MQTT publication timed out")
            print(f"[SIMULATION] temperature={sample.temperature:.2f} gas={sample.gas:.1f}")
            time.sleep(args.interval)
    finally:
        client.disconnect()
        client.loop_stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate-training", type=Path)
    parser.add_argument("--count", type=int, default=1200)
    from .config import Settings
    Settings()  # Load ai/.env before resolving the MQTT settings.
    parser.add_argument("--mqtt-url", default=os.getenv("MQTT_URL", "mqtt://127.0.0.1:1883"))
    parser.add_argument("--topic", default=os.getenv("MQTT_TELEMETRY_TOPIC", "esp8266/donnees"))
    parser.add_argument("--normal-count", type=int, default=25)
    parser.add_argument("--drift-count", type=int, default=40)
    parser.add_argument("--interval", type=float, default=2)
    args = parser.parse_args()
    if args.interval <= 0 or min(args.count, args.normal_count, args.drift_count) < 0:
        parser.error("Counts must be nonnegative and interval positive")
    try:
        if args.generate_training:
            write_training(args.generate_training, args.count)
        else:
            publish(args)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"[SIMULATION] {error}\n")


if __name__ == "__main__":
    main()

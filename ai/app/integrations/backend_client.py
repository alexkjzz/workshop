"""Read-only export of real backend SQLite readings to the training CSV contract."""
import argparse
import csv
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def export_readings(database: Path, output: Path, include_legacy: bool = False) -> int:
    if database.resolve() == output.resolve() or (output.exists() and database.samefile(output)):
        raise ValueError("CSV output must differ from the source SQLite database")
    # Never create a missing production database or write into its tables.
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(readings)")}
        if "source" not in columns and not include_legacy:
            raise ValueError("Legacy history has no source metadata; confirm its origin with --include-legacy")
        where = ("WHERE source='live' OR source IS NULL" if include_legacy else "WHERE source='live'") if "source" in columns else ""
        rows = connection.execute(
            f"SELECT recorded_at,temperature,humidity,gas,presence,"
            f"{'device_flags' if 'device_flags' in columns else 'NULL'} "
            f"FROM readings {where} ORDER BY recorded_at,id"
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["timestamp", "temperature", "humidity", "gas", "presence"])
            for timestamp, temperature, humidity, gas, presence, encoded_flags in rows:
                flags = json.loads(encoded_flags) if encoded_flags is not None else {}
                if not isinstance(flags, dict) or any(
                    name in flags and not isinstance(flags[name], bool)
                    for name in ("climateValid", "gasReady", "pirReady")
                ):
                    raise ValueError("Invalid device readiness metadata in training history")
                # Match live inference: unready values must not become normal training data.
                values = [temperature, humidity, gas, presence]
                if flags.get("climateValid") is False:
                    values[0] = values[1] = None
                if flags.get("gasReady") is False:
                    values[2] = None
                if flags.get("pirReady") is False:
                    values[3] = None
                writer.writerow([datetime.fromtimestamp(timestamp / 1000, timezone.utc).isoformat(), *values])
                count += 1
        return count
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("../iot-backend/data/telemetry.db"))
    parser.add_argument("--output", type=Path, default=Path("data/sensor_data.csv"))
    parser.add_argument("--include-legacy", action="store_true", help="Only if pre-migration readings are known real and normal")
    args = parser.parse_args()
    try:
        count = export_readings(args.database, args.output, args.include_legacy)
        print(f"Exported {count} non-simulation backend readings to {args.output}; review normality before training")
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f"[AI] Export failed: {error}\n")


if __name__ == "__main__":
    main()

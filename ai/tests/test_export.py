import csv
import json
import sqlite3

import pytest

from app.integrations.backend_client import export_readings


def test_export_excludes_simulation_and_unknown_history(tmp_path):
    database = tmp_path / "telemetry.db"
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE readings (id INTEGER PRIMARY KEY,recorded_at INTEGER,temperature REAL,humidity REAL,gas REAL,presence INTEGER,source TEXT)")
        for index, source in enumerate(["live", "simulation", None], start=1):
            db.execute("INSERT INTO readings VALUES (?,?,?,?,?,?,?)", (index, index * 2000, 23, 52, 140, 0, source))
    output = tmp_path / "real.csv"
    assert export_readings(database, output) == 1
    with output.open(encoding="utf-8") as handle:
        assert len(list(csv.DictReader(handle))) == 1
    assert export_readings(database, output, include_legacy=True) == 2


def test_legacy_history_requires_explicit_origin_confirmation(tmp_path):
    database = tmp_path / "old.db"
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE readings (id INTEGER PRIMARY KEY,recorded_at INTEGER,temperature REAL,humidity REAL,gas REAL,presence INTEGER)")
    with pytest.raises(ValueError, match="origin"):
        export_readings(database, tmp_path / "real.csv")
    assert export_readings(database, tmp_path / "real.csv", include_legacy=True) == 0


def test_export_omits_invalid_or_unready_channels_without_inventing_zero(tmp_path):
    database = tmp_path / "flags.db"
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE readings (id INTEGER PRIMARY KEY,recorded_at INTEGER,temperature REAL,humidity REAL,gas REAL,presence INTEGER,source TEXT,device_flags TEXT)")
        flags = [None, {"climateValid": False}, {"gasReady": False, "pirReady": False},
                 {"climateValid": True, "gasReady": True, "pirReady": True}]
        for index, status in enumerate(flags, start=1):
            db.execute("INSERT INTO readings VALUES (?,?,?,?,?,?,?,?)",
                       (index, index * 1000, 23, 52, 140, 0, "live",
                        json.dumps(status) if status is not None else None))
    output = tmp_path / "real.csv"
    assert export_readings(database, output) == 4
    with output.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [rows[0][key] for key in ("temperature", "humidity", "gas", "presence")] == ["23.0", "52.0", "140.0", "0"]
    assert rows[1]["temperature"] == rows[1]["humidity"] == ""
    assert rows[1]["gas"] == "140.0" and rows[1]["presence"] == "0"
    assert rows[2]["gas"] == rows[2]["presence"] == ""
    assert rows[2]["temperature"] == "23.0"
    assert rows[3]["presence"] == "0"


@pytest.mark.parametrize("metadata", ['[]', '{"gasReady":0}', 'broken JSON'])
def test_export_reports_malformed_readiness_metadata(tmp_path, metadata):
    database = tmp_path / "invalid.db"
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE readings (id INTEGER PRIMARY KEY,recorded_at INTEGER,temperature REAL,humidity REAL,gas REAL,presence INTEGER,source TEXT,device_flags TEXT)")
        db.execute("INSERT INTO readings VALUES (1,1000,23,52,140,0,'live',?)", (metadata,))
    with pytest.raises(ValueError):
        export_readings(database, tmp_path / "real.csv")


def test_export_cannot_overwrite_its_source_database(tmp_path):
    database = tmp_path / "telemetry.db"
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE readings (id INTEGER PRIMARY KEY)")
    original = database.read_bytes()
    with pytest.raises(ValueError, match="differ"):
        export_readings(database, database)
    assert database.read_bytes() == original

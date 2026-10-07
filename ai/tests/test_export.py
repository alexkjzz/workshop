import csv
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

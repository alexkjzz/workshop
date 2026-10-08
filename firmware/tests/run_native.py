"""Compile the actual firmware classes with hardware doubles, then run assertions."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", help="Path to g++, clang++ or zig (no shell arguments)")
    args = parser.parse_args()
    firmware = Path(__file__).resolve().parents[1]
    compiler = args.compiler or shutil.which("g++") or shutil.which("clang++") or shutil.which("zig")
    if not compiler:
        bundled = firmware.parent / ".runtime/firmware-tools/zig-x86_64-windows-0.14.1/zig.exe"
        if bundled.is_file():
            compiler = str(bundled)
    if not compiler:
        parser.error("Install g++/clang++/Zig, or pass --compiler with its executable path")
    command = [compiler]
    if Path(compiler).stem.lower() == "zig":
        command.append("c++")
    source = firmware / "lib/sentinel_core/src"
    units = [source / "application/sentinel.cpp", *sorted((source / "infrastructure").glob("*.cpp")),
             firmware / "tests/test_firmware.cpp"]
    try:
        with tempfile.TemporaryDirectory(prefix="sentinel-firmware-tests-") as directory:
            output = Path(directory)
            env = os.environ.copy()
            # Keep the C++ toolchain cache between runs; only test binaries are temporary.
            if Path(compiler).stem.lower() == "zig":
                cache = firmware / ".pio/native-tests/zig-cache"
                cache.mkdir(parents=True, exist_ok=True)
                env["ZIG_GLOBAL_CACHE_DIR"] = str(cache)
            env["ZIG_LOCAL_CACHE_DIR"] = str(output / "zig-local")
            for name, flags in [("default", []), ("configured", ["-DDHT_TYPE=21", "-DPIN_DHT=0"])]:
                executable = output / (name + (".exe" if os.name == "nt" else ""))
                build = [*command, "-std=c++17", "-Wall", "-Wextra", "-Werror", *flags,
                         "-I" + str(firmware / "tests/stubs"), "-I" + str(firmware / "include"),
                         "-I" + str(source), *(str(unit) for unit in units), "-o", str(executable)]
                print(f"Compiling firmware tests ({name})", flush=True)
                subprocess.run(build, check=True, env=env)
                subprocess.run([str(executable)], check=True, env=env)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Firmware tests failed: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

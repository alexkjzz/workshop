"""Check the Git index and working files before publishing (Python stdlib only)."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MAX_FILE_BYTES = 10 * 1024 * 1024
PRIVATE_DIRECTORIES = {
    '.runtime', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache',
    '.pio', '.vscode', '.idea', 'dist', 'dist-ssr', 'coverage', 'certs',
}
PRIVATE_SUFFIXES = {'.key', '.pem', '.p12', '.pfx', '.db', '.sqlite', '.sqlite3',
                    '.log', '.joblib', '.pickle', '.pkl', '.pt', '.onnx'}
TOKEN_PATTERN = re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{70,}|AKIA[0-9A-Z]{16})')
PRIVATE_KEY_PATTERN = re.compile(
    rb'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{64,}'
)


def git(*arguments: str, input_data: bytes | None = None) -> bytes:
    return subprocess.run(['git', *arguments], cwd=ROOT, input=input_data,
                          check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def private_path(name: str) -> bool:
    path = PurePosixPath(name)
    lower = name.lower()
    if any(part.lower() in PRIVATE_DIRECTORIES for part in path.parts):
        return True
    if (path.name == '.env' or path.name.startswith('.env.')) and path.name != '.env.example':
        return True
    if path.name.lower() == 'secrets.h' or path.suffix.lower() in PRIVATE_SUFFIXES:
        return True
    if re.search(r'\.(?:db|sqlite|sqlite3)-(?:wal|shm|journal)$', lower):
        return True
    if lower.startswith('ai/known_faces/') and lower != 'ai/known_faces/readme.md':
        return True
    if lower.startswith('ai/faces/'):
        return True
    return lower.startswith('ai/data/') and lower.endswith('.csv') and not lower.endswith('.example.csv')


def local_secrets() -> list[bytes]:
    """Compare known local credentials without displaying their values."""
    values = []
    for relative in ('.env', 'iot-backend/.env', 'ai/.env'):
        path = ROOT / relative
        if not path.is_file():
            continue
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if line.lstrip().startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            value = value.strip().strip('\"\'')
            if re.search(r'SECRET|PASSWORD|TOKEN', key, re.I) and len(value) >= 12:
                values.append(value.encode())
    return values


def main() -> int:
    try:
        raw_entries = git('ls-files', '--stage', '-z').split(b'\0')
        entries = []
        issues: set[tuple[str, str]] = set()
        for entry in raw_entries:
            if not entry:
                continue
            metadata, raw_name = entry.split(b'\t', 1)
            mode, sha, stage = metadata.decode().split()
            name = raw_name.decode('utf-8')
            if stage != '0':
                issues.add((name, 'unresolved Git conflict'))
            elif mode == '160000':
                issues.add((name, 'submodule requires a separate publication review'))
            else:
                entries.append((name, sha))
            if private_path(name):
                issues.add((name, 'private or generated file is tracked'))

        if not entries:
            print('FAIL: no tracked files. Run git add . before this check.')
            return 1
        shas = [sha for _, sha in entries]
        metadata = git('cat-file', '--batch-check', input_data=('\n'.join(shas) + '\n').encode()).splitlines()
        readable = []
        for (name, sha), info in zip(entries, metadata, strict=True):
            _object, kind, raw_size = info.split()
            if kind != b'blob':
                issues.add((name, 'unexpected Git object'))
            elif int(raw_size) > MAX_FILE_BYTES:
                issues.add((name, 'file exceeds the project limit of 10 MiB'))
            else:
                readable.append((name, sha))

        objects = git('cat-file', '--batch', input_data=('\n'.join(sha for _, sha in readable) + '\n').encode()) if readable else b''
        offset = 0
        secrets = local_secrets()
        for name, _sha in readable:
            end = objects.index(b'\n', offset)
            size = int(objects[offset:end].split()[2])
            indexed = objects[end + 1:end + 1 + size]
            offset = end + 1 + size + 1
            path = ROOT / name
            contents = [indexed]
            if path.is_file() and not path.is_symlink():
                if path.stat().st_size > MAX_FILE_BYTES:
                    issues.add((name, 'working file exceeds 10 MiB'))
                else:
                    contents.append(path.read_bytes())
            for data in contents:
                if TOKEN_PATTERN.search(data) or PRIVATE_KEY_PATTERN.search(data):
                    issues.add((name, 'credential or private key pattern detected'))
                if any(secret in data for secret in secrets):
                    issues.add((name, 'contains a credential from a local .env'))

        if issues:
            for name, reason in sorted(issues):
                print(f'FAIL {name}: {reason}')
            return 1
        print(f'PASS: {len(entries)} tracked files; no private paths, known local credentials, or oversized artifacts detected.')
        print('Checks cover the Git index and working files, not past commits or every possible secret format.')
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'FAIL: repository check could not finish ({type(error).__name__}).', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

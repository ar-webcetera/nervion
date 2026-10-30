#!/usr/bin/env python3
"""Read-only host/owned-PostgreSQL checks with bounded, sanitized alert attempts."""

import argparse
import contextlib
import dataclasses
import fcntl
import json
import math
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time


GIB = 1024 ** 3
REMINDER_SECONDS = 6 * 3600
DEADLINE_SECONDS = 45
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
CODES = frozenset({
    "DISK_LOW", "DISK_CHECK_FAILED", "MEMORY_LOW", "MEMORY_CHECK_FAILED",
    "POSTGRES_CHECK_FAILED", "WAL_BACKLOG", "WAL_ARCHIVE_FAILURE", "WAL_TOO_LARGE",
    "SMTP_CERT_EXPIRING", "SMTP_CERT_CHECK_FAILED",
})
POSTGRES_SQL = """WITH pending AS (
 SELECT (pg_stat_file('pg_wal/archive_status/' || name, true)).modification AS modified
 FROM pg_ls_dir('pg_wal/archive_status') AS name WHERE name LIKE '%.ready'
) SELECT json_build_object(
 'archiveEnabled', current_setting('archive_mode') IN ('on', 'always'),
 'unresolvedArchiveFailure', COALESCE(last_failed_time > COALESCE(last_archived_time, '-infinity'::timestamptz), false),
 'oldestPendingWalAgeSeconds', (SELECT COALESCE(EXTRACT(epoch FROM now() - min(modified)), 0) FROM pending),
 'walBytes', (SELECT COALESCE(sum(size), 0) FROM pg_ls_waldir())
) FROM pg_stat_archiver;"""
INSPECT_FORMAT = '{{json .Id}}\n{{json (index .Config.Labels "com.docker.compose.project")}}\n{{json (index .Config.Labels "com.docker.compose.service")}}\n{{json .State.Running}}\n{{json .Mounts}}'


class MonitorError(Exception):
    """Fixed public codes only, never subprocess output or private paths."""


class MonitorDeadline(BaseException):
    """A deadline cannot be swallowed by an individual check."""


@dataclasses.dataclass(frozen=True)
class Config:
    project: str
    disk_paths: tuple
    state: pathlib.Path
    smtp_bundle: pathlib.Path | None = None
    smtp_hostname: str | None = None


def absolute_path(raw):
    if not isinstance(raw, str) or not raw.startswith("/") or len(raw) > 4096 or any(ord(c) < 32 for c in raw):
        raise MonitorError("INVALID_CONFIG")
    value = pathlib.Path(raw)
    if str(value) != raw or ".." in value.parts or value == pathlib.Path("/"):
        raise MonitorError("INVALID_CONFIG")
    return value


def directory(path, *, private=False):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.geteuid()) or info.st_mode & (0o077 if private else 0o022) or path.resolve(strict=True) != path:
        raise MonitorError("UNSAFE_DIRECTORY")


def read_file(path, *, limit=16384, private=True):
    if path.resolve(strict=True) != path:
        raise MonitorError("UNSAFE_FILE")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in (0, os.geteuid()) or info.st_mode & (0o077 if private else 0o022):
            raise MonitorError("UNSAFE_FILE")
        data = stream.read(limit + 1)
    if not data or len(data) > limit:
        raise MonitorError("INVALID_FILE_SIZE")
    return data


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise MonitorError("INVALID_JSON")
        value[key] = item
    return value


def load_config(path):
    data = json.loads(read_file(path), object_pairs_hook=unique_object)
    required = {"composeProject", "postgresService", "diskPaths", "stateDirectory"}
    if not isinstance(data, dict) or not required <= data.keys() or data.keys() - required - {"smtpBundleDirectory", "smtpHostname"}:
        raise MonitorError("INVALID_CONFIG")
    if not isinstance(data["composeProject"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", data["composeProject"]) or data["postgresService"] != "postgres":
        raise MonitorError("INVALID_CONFIG")
    if not isinstance(data["diskPaths"], list) or not 1 <= len(data["diskPaths"]) <= 8:
        raise MonitorError("INVALID_CONFIG")
    disks = tuple(absolute_path(value) for value in data["diskPaths"])
    if len(set(disks)) != len(disks):
        raise MonitorError("INVALID_CONFIG")
    state = absolute_path(data["stateDirectory"])
    bundle = data.get("smtpBundleDirectory")
    hostname = data.get("smtpHostname")
    if (bundle is None) != (hostname is None):
        raise MonitorError("INVALID_CONFIG")
    if bundle is not None:
        bundle = absolute_path(bundle)
        if not isinstance(hostname, str) or len(hostname) > 253 or "." not in hostname or re.fullmatch(r"[0-9.]+", hostname) or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in hostname.split(".")):
            raise MonitorError("INVALID_CONFIG")
    return Config(data["composeProject"], disks, state, bundle, hostname)


def command(args, *, data=None, timeout=8, allowed=(0,)):
    try:
        result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=timeout, check=False, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MonitorError("COMMAND_FAILED") from error
    if result.returncode not in allowed or len(result.stdout) > 65536:
        raise MonitorError("COMMAND_FAILED")
    return result.returncode, result.stdout


def postgres_target(config):
    _, output = command(DOCKER + ["ps", "--all", "--no-trunc", "--quiet", "--filter", f"label=com.docker.compose.project={config.project}", "--filter", "label=com.docker.compose.service=postgres"])
    ids = output.decode("ascii").split()
    if len(ids) != 1 or not re.fullmatch(r"[a-f0-9]{64}", ids[0]):
        raise MonitorError("POSTGRES_CHECK_FAILED")
    _, output = command(DOCKER + ["inspect", "--format", INSPECT_FORMAT, ids[0]])
    values = [json.loads(line) for line in output.splitlines()]
    if len(values) != 5 or values[:4] != [ids[0], config.project, "postgres", True] or not isinstance(values[4], list):
        raise MonitorError("POSTGRES_CHECK_FAILED")
    mounts = [value for value in values[4] if value.get("Destination") == "/var/lib/postgresql/data"]
    if len(mounts) != 1 or mounts[0].get("Type") != "volume" or mounts[0].get("Name") != config.project + "_postgres_data" or not mounts[0].get("RW"):
        raise MonitorError("POSTGRES_CHECK_FAILED")
    if any(value.get("Destination", "").startswith("/var/lib/postgresql/data/") for value in values[4]):
        raise MonitorError("POSTGRES_CHECK_FAILED")
    return ids[0], absolute_path(mounts[0]["Source"])


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def wal_failures(container_id):
    _, output = command(DOCKER + ["exec", "--user", "postgres", "--env", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=3000 -c lock_timeout=1000", container_id,
                                 "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--host", "/var/run/postgresql", "--username", "postgres", "--dbname", "postgres", "--command", POSTGRES_SQL])
    data = json.loads(output)
    if not isinstance(data, dict) or set(data) != {"archiveEnabled", "unresolvedArchiveFailure", "oldestPendingWalAgeSeconds", "walBytes"} or type(data["archiveEnabled"]) is not bool or type(data["unresolvedArchiveFailure"]) is not bool or not all(finite_number(data[key]) and data[key] >= 0 for key in ("oldestPendingWalAgeSeconds", "walBytes")):
        raise MonitorError("POSTGRES_CHECK_FAILED")
    result = set()
    if not data["archiveEnabled"] or data["unresolvedArchiveFailure"]:
        result.add("WAL_ARCHIVE_FAILURE")
    if data["oldestPendingWalAgeSeconds"] > 300:
        result.add("WAL_BACKLOG")
    if data["walBytes"] > GIB:
        result.add("WAL_TOO_LARGE")
    return result


def disk_low(path):
    if path.resolve(strict=True) != path or not path.is_dir():
        raise MonitorError("DISK_CHECK_FAILED")
    usage = os.statvfs(path)
    total = usage.f_blocks * usage.f_frsize
    available = usage.f_bavail * usage.f_frsize
    if total <= 0 or available < 0 or available > total:
        raise MonitorError("DISK_CHECK_FAILED")
    return available < 4 * GIB or (total - available) * 10 >= total * 9


def memory_available():
    # This fixed kernel counter contains no process, user or environment data.
    with open("/proc/meminfo", "rb") as source:
        data = source.read(16385)
    matches = re.findall(rb"^MemAvailable:\s+([0-9]+) kB$", data, re.MULTILINE)
    if len(data) > 16384 or len(matches) != 1:
        raise MonitorError("MEMORY_CHECK_FAILED")
    return int(matches[0]) * 1024


def smtp_failures(config):
    if config.smtp_bundle is None:
        return set()
    directory(config.smtp_bundle, private=True)
    current = config.smtp_bundle / "current"
    if not current.is_symlink() or not re.fullmatch(r"releases/[a-f0-9]{64}", os.readlink(current)):
        raise MonitorError("SMTP_CERT_CHECK_FAILED")
    release = config.smtp_bundle / os.readlink(current)
    directory(config.smtp_bundle / "releases", private=True)
    directory(release, private=True)
    cert = read_file(release / "fullchain.pem", private=False, limit=262144)
    # The private key is intentionally never opened. Check the public bundle,
    # not live SMTP endpoints or the unrelated shared Caddy certificate store.
    _, output = command(["openssl", "x509", "-noout", "-checkhost", config.smtp_hostname], data=cert, timeout=5)
    if output.strip() != f"Hostname {config.smtp_hostname} does match certificate".encode("ascii"):
        raise MonitorError("SMTP_CERT_CHECK_FAILED")
    code, _ = command(["openssl", "x509", "-noout", "-checkend", str(14 * 86400)], data=cert, timeout=5, allowed=(0, 1))
    return {"SMTP_CERT_EXPIRING"} if code else set()


def collect(config):
    failures = set()
    disks = set(config.disk_paths)
    try:
        container_id, data_directory = postgres_target(config)
        disks.add(data_directory)
        failures.update(wal_failures(container_id))
    except Exception:
        failures.add("POSTGRES_CHECK_FAILED")
    for path in sorted(disks):
        try:
            if disk_low(path):
                failures.add("DISK_LOW")
        except Exception:
            failures.add("DISK_CHECK_FAILED")
    low_memory = None
    try:
        low_memory = memory_available() < 256 * 1024 ** 2
    except Exception:
        failures.add("MEMORY_CHECK_FAILED")
    try:
        failures.update(smtp_failures(config))
    except Exception:
        failures.add("SMTP_CERT_CHECK_FAILED")
    return failures, low_memory


def empty_state():
    return {"version": 1, "lastSampleAt": 0, "memoryStreak": 0, "active": {}}


def load_state(path):
    if not path.exists() and not path.is_symlink():
        return empty_state()
    data = json.loads(read_file(path), object_pairs_hook=unique_object)
    if not isinstance(data, dict) or set(data) != set(empty_state()) or data["version"] != 1 or not finite_number(data["lastSampleAt"]) or data["lastSampleAt"] < 0 or type(data["memoryStreak"]) is not int or not 0 <= data["memoryStreak"] <= 3 or not isinstance(data["active"], dict) or not set(data["active"]) <= CODES or not all(finite_number(value) and value >= 0 for value in data["active"].values()):
        raise MonitorError("INVALID_STATE")
    return data


def advance_state(previous, failures, low_memory, now):
    if not set(failures) <= CODES or not finite_number(now) or now <= 0:
        raise MonitorError("INVALID_STATE")
    failures = set(failures)
    elapsed = now - previous["lastSampleAt"]
    streak = 0
    sample_at = now
    if low_memory is True:
        if 240 <= elapsed <= 660:
            streak = min(3, previous["memoryStreak"] + 1)
        elif 0 <= elapsed < 240 and previous["memoryStreak"]:
            streak = previous["memoryStreak"]
            sample_at = previous["lastSampleAt"]
        else:
            streak = 1
    if streak >= 3:
        failures.add("MEMORY_LOW")
    active = {}
    due = []
    for code in sorted(failures):
        last = previous["active"].get(code)
        if last is None or now < last or now - last >= REMINDER_SECONDS:
            due.append(code)
            active[code] = now
        else:
            active[code] = last
    return {"version": 1, "lastSampleAt": sample_at, "memoryStreak": streak, "active": active}, due


def save_state(path, state):
    fd, temporary = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(state, output, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def lock_state(path):
    directory(path, private=True)
    fd = os.open(path / ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in (0, os.geteuid()) or info.st_mode & 0o077:
            raise MonitorError("UNSAFE_STATE")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
        else:
            yield True
    finally:
        os.close(fd)


@contextlib.contextmanager
def deadline(seconds=DEADLINE_SECONDS):
    def expire(_signal, _frame):
        raise MonitorDeadline()
    handler = signal.signal(signal.SIGALRM, expire)
    timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *timer)
        signal.signal(signal.SIGALRM, handler)


class QuietParser(argparse.ArgumentParser):
    def error(self, _message):
        raise MonitorError("INVALID_ARGUMENTS")


def main(argv=None):
    try:
        parser = QuietParser(description=__doc__)
        parser.add_argument("--config", required=True, type=pathlib.Path)
        parser.add_argument("--check-config", action="store_true")
        args = parser.parse_args(argv)
        with deadline():
            config = load_config(args.config)
            if args.check_config:
                print('{"status":"configuration-valid"}')
                return 0
            with lock_state(config.state) as locked:
                if not locked:
                    print('{"status":"already-running"}')
                    return 0
                previous = load_state(config.state / "state.json")
                failures, low_memory = collect(config)
                state, due = advance_state(previous, failures, low_memory, time.time())
                # Persist attempts before OnFailure. No claim of email delivery;
                # unavailable receivers are retried by a later six-hour reminder.
                save_state(config.state / "state.json", state)
                print(json.dumps({"status": "alert-due" if due else "suppressed" if state["active"] else "healthy", "codes": sorted(state["active"]), "due": due}, separators=(",", ":")))
                return 1 if due else 0
    except (Exception, MonitorDeadline) as error:
        code = "MONITOR_DEADLINE_EXCEEDED" if isinstance(error, MonitorDeadline) else str(error) if isinstance(error, MonitorError) else "MONITOR_FAILED"
        print(json.dumps({"error": code}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

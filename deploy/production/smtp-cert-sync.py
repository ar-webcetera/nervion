#!/usr/bin/env python3
"""Publish one Caddy-managed certificate to an isolated SMTP bundle."""

import argparse
import contextlib
import dataclasses
import datetime
import fcntl
import hashlib
import hmac
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time


CONTAINER_BUNDLE = "/run/nervion/smtp-tls"
SMTP_HEALTHCHECK = ["CMD", "node", "/opt/nervion/health.mjs", "smtp"]
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
RESTART_SECONDS = 60
HEALTH_SECONDS = 120
OPERATION_SECONDS = 300


class SyncError(Exception):
    """Public error codes must never contain command output or key material."""


@dataclasses.dataclass(frozen=True)
class Config:
    hostname: str
    caddy_root: pathlib.Path
    bundle: pathlib.Path
    project: str
    minimum_validity: int = 14 * 86400


def command(args, *, data=None, timeout=10):
    try:
        result = subprocess.run(
            args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, check=False,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SyncError("COMMAND_FAILED") from error
    if result.returncode:
        raise SyncError("COMMAND_FAILED")
    return result.stdout


def private_owner(info):
    return info.st_uid in (0, os.geteuid()) and not info.st_mode & 0o022


def directory(path, *, private=False):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or not private_owner(info):
        raise SyncError("UNSAFE_DIRECTORY")
    if path.resolve() != path or (private and info.st_mode & 0o077):
        raise SyncError("UNSAFE_DIRECTORY")


def read_file(path, *, secret=False, limit=262144):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not private_owner(info):
                raise SyncError("UNSAFE_FILE")
            if secret and info.st_mode & 0o077:
                raise SyncError("UNSAFE_SECRET_FILE")
            value = stream.read(limit + 1)
            if not value or len(value) > limit:
                raise SyncError("INVALID_FILE_SIZE")
            return value
    except OSError as error:
        raise SyncError("FILE_UNAVAILABLE") from error


def load_config(path):
    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise SyncError("DUPLICATE_CONFIG_KEY")
            value[key] = item
        return value

    try:
        values = json.loads(read_file(path, secret=True, limit=8192), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError) as error:
        raise SyncError("INVALID_CONFIG") from error
    required = {"hostname", "caddyStorageRoot", "bundleDirectory", "composeProject", "composeService"}
    if not isinstance(values, dict) or not required <= values.keys() or values.keys() - required - {"minimumValiditySeconds"}:
        raise SyncError("INVALID_CONFIG")
    host = values["hostname"]
    if not isinstance(host, str) or len(host) > 253 or "." not in host or not all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")
    ) or re.fullmatch(r"[0-9.]+", host):
        raise SyncError("INVALID_HOSTNAME")
    if not isinstance(values["composeProject"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", values["composeProject"]):
        raise SyncError("INVALID_PROJECT")
    if values["composeService"] != "smtp":
        raise SyncError("INVALID_SERVICE")
    paths = []
    for name in ("caddyStorageRoot", "bundleDirectory"):
        raw = values[name]
        if not isinstance(raw, str) or not raw.startswith("/") or os.path.normpath(raw) != raw or len(pathlib.Path(raw).parts) < 3 or any(ord(char) < 32 for char in raw):
            raise SyncError("INVALID_DIRECTORY")
        paths.append(pathlib.Path(raw))
    source, bundle = paths
    if source == bundle or source in bundle.parents or bundle in source.parents:
        raise SyncError("OVERLAPPING_DIRECTORIES")
    minimum = values.get("minimumValiditySeconds", 14 * 86400)
    if type(minimum) is not int or not 86400 <= minimum <= 30 * 86400:
        raise SyncError("INVALID_VALIDITY_THRESHOLD")
    directory(source)
    directory(bundle.parent)
    if bundle.exists() or bundle.is_symlink():
        directory(bundle, private=True)
    return Config(host, source, bundle, values["composeProject"], minimum)


def write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextlib.contextmanager
def locked_bundle(bundle):
    if not bundle.exists():
        bundle.mkdir(mode=0o700)
    directory(bundle, private=True)
    fd = os.open(bundle / ".sync.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not private_owner(info) or info.st_mode & 0o077:
            raise SyncError("UNSAFE_LOCK")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SyncError("SYNC_ALREADY_RUNNING") from error
        yield
    finally:
        os.close(fd)


def validate_material(cert, key, config, run=command, *, now=None):
    san = run(["openssl", "x509", "-in", str(cert), "-noout", "-ext", "subjectAltName"]).decode("ascii")
    if "".join(san.splitlines()[1:]).strip() != f"DNS:{config.hostname}":
        raise SyncError("CERTIFICATE_HOSTNAME_MISMATCH")
    dates = dict(line.split("=", 1) for line in run(["openssl", "x509", "-in", str(cert), "-noout", "-dates"]).decode("ascii").splitlines())
    parse = lambda value: datetime.datetime.strptime(value, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=datetime.timezone.utc).timestamp()
    start, expiry = parse(dates["notBefore"]), parse(dates["notAfter"])
    current_time = time.time() if now is None else now
    if start > current_time or expiry - current_time <= config.minimum_validity:
        raise SyncError("CERTIFICATE_NOT_VALID_LONG_ENOUGH")
    public_pem = run(["openssl", "x509", "-in", str(cert), "-pubkey", "-noout"])
    cert_public = run(["openssl", "pkey", "-pubin", "-outform", "DER"], data=public_pem)
    key_public = run(["openssl", "pkey", "-in", str(key), "-pubout", "-outform", "DER"])
    if not hmac.compare_digest(cert_public, key_public):
        raise SyncError("CERTIFICATE_KEY_MISMATCH")
    run(["openssl", "verify", "-purpose", "sslserver", "-verify_hostname", config.hostname, "-untrusted", str(cert), str(cert)])
    return datetime.datetime.fromtimestamp(expiry, datetime.timezone.utc).isoformat()


def prepare_release(config, run):
    certificates = config.caddy_root / "certificates"
    directory(certificates)
    candidates = []
    with os.scandir(certificates) as entries:
        for index, entry in enumerate(entries):
            if index >= 32:
                raise SyncError("TOO_MANY_ISSUERS")
            if not entry.is_dir(follow_symlinks=False):
                continue
            source = pathlib.Path(entry.path) / config.hostname
            if not source.exists() and not source.is_symlink():
                continue
            directory(pathlib.Path(entry.path))
            directory(source)
            cert = read_file(source / f"{config.hostname}.crt")
            key = read_file(source / f"{config.hostname}.key", secret=True, limit=32768)
            staged = pathlib.Path(tempfile.mkdtemp(prefix=".staging-", dir=config.bundle))
            try:
                write_private(staged / "fullchain.pem", cert)
                write_private(staged / "privkey.pem", key)
                expiry = validate_material(staged / "fullchain.pem", staged / "privkey.pem", config, run)
                candidates.append((expiry, hashlib.sha256(cert).hexdigest(), cert, key))
            except SyncError:
                # A previous ACME issuer may have an expired certificate. Only
                # valid, trusted, exact-host pairs participate in selection.
                pass
            finally:
                shutil.rmtree(staged)
    if not candidates:
        raise SyncError("NO_VALID_SOURCE_CERTIFICATE")
    expiry, fingerprint, cert, key = max(candidates, key=lambda item: item[0])
    releases = config.bundle / "releases"
    if not releases.exists():
        releases.mkdir(mode=0o700)
    directory(releases, private=True)
    release = releases / fingerprint
    if release.exists() or release.is_symlink():
        directory(release, private=True)
        if read_file(release / "fullchain.pem", secret=True) != cert or read_file(release / "privkey.pem", secret=True) != key:
            raise SyncError("EXISTING_RELEASE_MISMATCH")
    else:
        staged = pathlib.Path(tempfile.mkdtemp(prefix=".staging-", dir=config.bundle))
        try:
            write_private(staged / "fullchain.pem", cert)
            write_private(staged / "privkey.pem", key)
            fsync_directory(staged)
            staged.rename(release)
            fsync_directory(releases)
        finally:
            if staged.exists():
                shutil.rmtree(staged)
    return fingerprint, expiry


def current_fingerprint(bundle):
    current = bundle / "current"
    if not current.exists() and not current.is_symlink():
        return None
    if not current.is_symlink():
        raise SyncError("UNSAFE_CURRENT_POINTER")
    target = os.readlink(current)
    if not re.fullmatch(r"releases/[0-9a-f]{64}", target):
        raise SyncError("UNSAFE_CURRENT_POINTER")
    directory(bundle / target, private=True)
    return target.split("/")[1]


def switch_current(bundle, fingerprint):
    fd, name = tempfile.mkstemp(prefix=".current-", dir=bundle)
    os.close(fd)
    temporary = pathlib.Path(name)
    temporary.unlink()
    try:
        temporary.symlink_to(f"releases/{fingerprint}")
        os.replace(temporary, bundle / "current")
        fsync_directory(bundle)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def inspect_target(container_id, config, run):
    values = json.loads(run([*DOCKER, "inspect", container_id]))
    if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], dict):
        raise SyncError("INVALID_SMTP_TARGET")
    target = values[0]
    labels = target.get("Config", {}).get("Labels", {})
    env = dict(value.split("=", 1) for value in target.get("Config", {}).get("Env", []) if "=" in value)
    expected = {
        "TENANCY_ENABLED": "true", "NODE_ENV": "production",
        "SMTP_TLS_CERT_FILE": f"{CONTAINER_BUNDLE}/current/fullchain.pem",
        "SMTP_TLS_KEY_FILE": f"{CONTAINER_BUNDLE}/current/privkey.pem",
        "SMTP_TLS_SERVER_NAME": config.hostname,
    }
    mounts = [mount for mount in target.get("Mounts", []) if mount.get("Destination") == CONTAINER_BUNDLE]
    if any(mount.get("Destination", "").startswith(CONTAINER_BUNDLE + "/") for mount in target.get("Mounts", [])):
        raise SyncError("NESTED_SMTP_BUNDLE_MOUNT")
    if target.get("Id") != container_id or labels.get("com.docker.compose.project") != config.project or labels.get("com.docker.compose.service") != "smtp" or labels.get("com.docker.compose.oneoff", "False").lower() != "false":
        raise SyncError("INVALID_SMTP_TARGET")
    if any(env.get(key) != value for key, value in expected.items()):
        raise SyncError("INVALID_SMTP_ENVIRONMENT")
    if len(mounts) != 1 or mounts[0].get("Type") != "bind" or mounts[0].get("RW") is not False or mounts[0].get("Source") != str(config.bundle):
        raise SyncError("INVALID_SMTP_BUNDLE_MOUNT")
    if not target.get("State", {}).get("Running") or target.get("Config", {}).get("Healthcheck", {}).get("Test") != SMTP_HEALTHCHECK:
        raise SyncError("SMTP_NOT_RUNNING_WITH_HEALTHCHECK")
    return target


def find_target(config, run):
    ids = run([*DOCKER, "ps", "-a", "--no-trunc", "--filter", f"label=com.docker.compose.project={config.project}", "--filter", "label=com.docker.compose.service=smtp", "--format", "{{.ID}}"]).decode("ascii").split()
    if len(ids) != 1 or not re.fullmatch(r"[0-9a-f]{64}", ids[0]):
        raise SyncError("SMTP_TARGET_NOT_UNIQUE")
    inspect_target(ids[0], config, run)
    return ids[0]


def check_health(container_id, config, run, *, wait=False):
    deadline = time.monotonic() + (HEALTH_SECONDS if wait else 0)
    while True:
        target = inspect_target(container_id, config, run)
        if target.get("State", {}).get("Health", {}).get("Status") == "healthy":
            return
        if time.monotonic() >= deadline:
            raise SyncError("SMTP_HEALTHCHECK_FAILED")
        time.sleep(2)


def save_activation(bundle, fingerprint, container_id):
    target = bundle / ".activated.json"
    if target.exists() or target.is_symlink():
        read_file(target, secret=True, limit=4096)
    fd, name = tempfile.mkstemp(prefix=".activation-", dir=bundle)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump({"fingerprint": fingerprint, "containerId": container_id}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, target)
        fsync_directory(bundle)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)


def read_activation(bundle):
    path = bundle / ".activated.json"
    if not path.exists() and not path.is_symlink():
        return {}
    value = json.loads(read_file(path, secret=True, limit=4096))
    if not isinstance(value, dict) or set(value) != {"fingerprint", "containerId"} or any(
        not isinstance(item, str) or not re.fullmatch(r"[0-9a-f]{64}", item) for item in value.values()
    ):
        raise SyncError("INVALID_ACTIVATION_RECORD")
    return value


def synchronize(config, *, restart=False, run=command):
    deadline = time.monotonic() + OPERATION_SECONDS
    execute = run

    def run(args, **kwargs):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SyncError("SYNC_DEADLINE_EXCEEDED")
        kwargs["timeout"] = min(kwargs.get("timeout", 10), remaining)
        return execute(args, **kwargs)

    with locked_bundle(config.bundle):
        before = current_fingerprint(config.bundle)
        container_id = find_target(config, run) if restart else None
        activated = read_activation(config.bundle)
        fingerprint, expires = prepare_release(config, run)
        if before != fingerprint:
            switch_current(config.bundle, fingerprint)
        needs_restart = activated.get("fingerprint") != fingerprint
        restarted = False
        if restart:
            if needs_restart:
                # Address the already-verified immutable container ID, never a
                # broad compose project, service glob or unverified name.
                inspect_target(container_id, config, run)
                run([*DOCKER, "restart", "--time", str(RESTART_SECONDS), container_id], timeout=RESTART_SECONDS + 30)
                restarted = True
            check_health(container_id, config, run, wait=restarted)
            save_activation(config.bundle, fingerprint, container_id)
        return {"hostname": config.hostname, "fingerprint": fingerprint, "expiresAt": expires,
                "changed": before != fingerprint, "restarted": restarted,
                "activationPending": needs_restart and not restart}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=pathlib.Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--copy-only", action="store_true")
    mode.add_argument("--restart", action="store_true")
    args = parser.parse_args()
    try:
        result = synchronize(load_config(args.config), restart=args.restart)
        print(json.dumps(result, separators=(",", ":")))
    except Exception as error:
        # CLI output is intentionally sanitized, including unexpected failures.
        # Docker inspect output and private keys must never reach a traceback.
        code = str(error) if isinstance(error, SyncError) else "CERTIFICATE_SYNC_FAILED"
        print(json.dumps({"error": code}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Send a fixed, sanitized systemd failure event to an operator-selected Sentry DSN."""

import argparse
import contextlib
import dataclasses
import datetime
import http.client
import ipaddress
import json
import os
import pathlib
import re
import signal
import ssl
import stat
import sys
import time
import urllib.parse
import uuid


SYSTEM_CA_FILE = "/etc/ssl/certs/ca-certificates.crt"
NETWORK_TIMEOUT_SECONDS = 5
DEADLINE_SECONDS = 15
CHECKS = {
    "nervion-backup.service": ("OPS_BACKUP_FAILED", "backup", "Nervion database backup failed"),
    "nervion-backup-monitor.service": (
        "OPS_BACKUP_FRESHNESS_FAILED", "backup", "Nervion encrypted backup freshness check failed"
    ),
    "smtp-cert-sync.service": ("OPS_SMTP_CERT_SYNC_FAILED", "smtp-tls", "Nervion SMTP certificate synchronization failed"),
}


class AlertError(Exception):
    """Only fixed public error codes are permitted in CLI output."""


@dataclasses.dataclass(frozen=True)
class Destination:
    host: str
    endpoint: str
    public_key: str = dataclasses.field(repr=False)


def read_dsn(path):
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise AlertError("UNSAFE_DSN_FILE")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in (0, os.geteuid()) or info.st_mode & 0o077:
            raise AlertError("UNSAFE_DSN_FILE")
        data = source.read(2049)
    if not data or len(data) > 2048:
        raise AlertError("INVALID_DSN_FILE_SIZE")
    return parse_dsn(data.decode("ascii").strip())


def parse_dsn(value):
    if not isinstance(value, str) or any(ord(char) < 33 or ord(char) > 126 for char in value) or any(char in value for char in "\\%?#"):
        raise AlertError("INVALID_DSN")
    try:
        parts = urllib.parse.urlsplit(value)
        host = parts.hostname or ""
        key = parts.username or ""
        if parts.scheme != "https" or parts.password is not None or parts.port not in (None, 443):
            raise AlertError("INVALID_DSN")
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", key):
            raise AlertError("INVALID_DSN")
        if len(host) > 253 or "." not in host or not all(
            re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")
        ):
            raise AlertError("INVALID_DSN")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise AlertError("INVALID_DSN")
        if not re.fullmatch(r"/(?:[A-Za-z0-9_-]+/)*[1-9][0-9]{0,19}", parts.path):
            raise AlertError("INVALID_DSN")
        prefix, project = parts.path.rsplit("/", 1)
        return Destination(host, f"{prefix}/api/{project}/envelope/", key)
    except ValueError as error:
        raise AlertError("INVALID_DSN") from error


def build_event(unit):
    if unit not in CHECKS:
        raise AlertError("UNSUPPORTED_UNIT")
    code, component, message = CHECKS[unit]
    event_id = uuid.uuid4().hex
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    event = {
        "event_id": event_id,
        "timestamp": timestamp,
        "platform": "other",
        "level": "error",
        "environment": "production",
        "logger": "nervion.operations",
        "message": message,
        "fingerprint": ["nervion-ops", code],
        "tags": {"component": component, "check": code},
    }
    payload = json.dumps(event, separators=(",", ":")).encode("utf8")
    header = json.dumps({"event_id": event_id, "sent_at": timestamp}, separators=(",", ":")).encode("ascii")
    item = json.dumps({"type": "event", "length": len(payload)}, separators=(",", ":")).encode("ascii")
    return event_id, code, b"\n".join((header, item, payload)) + b"\n"


def submit(destination, envelope):
    # Explicit system CA file ignores SSL_CERT_FILE/SSL_CERT_DIR. http.client
    # does not consume proxy environment variables or follow redirects.
    context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=SYSTEM_CA_FILE)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    connection = http.client.HTTPSConnection(destination.host, port=443, timeout=NETWORK_TIMEOUT_SECONDS, context=context)
    try:
        connection.request("POST", destination.endpoint, body=envelope, headers={
            "Content-Type": "application/x-sentry-envelope",
            "X-Sentry-Auth": f"Sentry sentry_version=7, sentry_key={destination.public_key}, sentry_client=nervion-ops/1",
            "User-Agent": "nervion-ops/1",
        })
        # Never read or print the server response body, even on failure.
        return connection.getresponse().status
    finally:
        connection.close()


@contextlib.contextmanager
def deadline(seconds=DEADLINE_SECONDS):
    def expire(_signal, _frame):
        raise AlertError("ALERT_DEADLINE_EXCEEDED")

    previous_handler = signal.signal(signal.SIGALRM, expire)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *previous_timer)
        signal.signal(signal.SIGALRM, previous_handler)


def deliver(unit, destination, transport=submit):
    event_id, code, envelope = build_event(unit)
    for attempt in range(2):
        try:
            status = transport(destination, envelope)
            if 200 <= status < 300:
                return {"status": "accepted", "check": code, "eventId": event_id}
            if status < 500 or attempt == 1:
                raise AlertError("ALERT_HTTP_REJECTED")
        except ssl.SSLError as error:
            raise AlertError("ALERT_TLS_FAILED") from error
        except (OSError, http.client.HTTPException) as error:
            if attempt == 1:
                raise AlertError("ALERT_NETWORK_FAILED") from error
        # Retry an uncertain network/5xx result once with the same event ID.
        time.sleep(1)
    raise AlertError("ALERT_DELIVERY_FAILED")


class QuietParser(argparse.ArgumentParser):
    def error(self, _message):
        raise AlertError("INVALID_ARGUMENTS")


def main(argv=None):
    try:
        parser = QuietParser(description=__doc__)
        parser.add_argument("--dsn-file", required=True, type=pathlib.Path)
        parser.add_argument("--unit", required=True)
        args = parser.parse_args(argv)
        if args.unit not in CHECKS:
            raise AlertError("UNSUPPORTED_UNIT")
        with deadline():
            result = deliver(args.unit, read_dsn(args.dsn_file))
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except Exception as error:
        # No exception text from network, parsing or filesystem operations: it
        # could contain a DSN, response body, private path or certificate details.
        code = str(error) if isinstance(error, AlertError) else "ALERT_FAILED"
        print(json.dumps({"error": code}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

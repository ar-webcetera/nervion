"""Offline checks for the fixed operational event transport. No real DSN is used."""

import contextlib
import http.client
import importlib.util
import io
import json
import os
import pathlib
import shutil
import signal
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("ops_alert", pathlib.Path(__file__).with_name("ops-alert.py"))
ALERT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ALERT
SPEC.loader.exec_module(ALERT)
KEY = "abcdef0123456789abcdef0123456789"
DSN = "https://" + KEY + "@alerts.example.test/17"
UNIT = "nervion-backup.service"


class OpsAlertTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="nervion-ops-alert-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.dsn_file = self.root / "dsn"
        self.dsn_file.write_text(DSN + "\n")
        self.dsn_file.chmod(0o600)
        self.destination = ALERT.parse_dsn(DSN)

    def test_valid_https_dsn_with_optional_prefix_and_explicit_443(self):
        self.assertEqual(ALERT.read_dsn(self.dsn_file).endpoint, "/api/17/envelope/")
        value = ALERT.parse_dsn("https://" + KEY + "@alerts.example.test:443/prefix/17")
        self.assertEqual(value.host, "alerts.example.test")
        self.assertEqual(value.endpoint, "/prefix/api/17/envelope/")
        self.assertNotIn(KEY, repr(value))

    def test_dsn_rejects_injection_password_non_tls_ip_query_and_traversal(self):
        for value in (
            DSN.replace("https:", "http:"), DSN + "?secret=1", DSN + "#fragment", DSN + "/",
            DSN.replace("/17", "/../17"), DSN.replace("/17", "/%2e/17"), DSN.replace("/17", "/0"),
            DSN.replace("@", ":deprecated-secret@"), DSN.replace("@", ":@"),
            DSN.replace("alerts.example.test", "127.0.0.1"), DSN.replace("alerts.example.test", "localhost"),
            DSN.replace("alerts.example.test", "[::1]"), DSN.replace("alerts.example.test", "alerts.example.test:444"),
            DSN.replace("alerts.example.test", "alerts..test"), DSN.replace(KEY, "x"),
            DSN + "\nX-Header: injected", DSN.replace("alerts", "alérts"), DSN.replace("/17", "\\17"),
        ):
            with self.subTest(value=value), self.assertRaises(ALERT.AlertError):
                ALERT.parse_dsn(value)

    def test_secret_file_rejects_permissions_symlinks_hardlinks_and_oversize(self):
        self.dsn_file.chmod(0o644)
        with self.assertRaises(ALERT.AlertError):
            ALERT.read_dsn(self.dsn_file)
        self.dsn_file.chmod(0o600)
        alias = self.root / "alias"
        alias.symlink_to(self.dsn_file)
        with self.assertRaises(ALERT.AlertError):
            ALERT.read_dsn(alias)
        alias.unlink()
        os.link(self.dsn_file, alias)
        with self.assertRaises(ALERT.AlertError):
            ALERT.read_dsn(self.dsn_file)
        alias.unlink()
        self.dsn_file.write_text("x" * 2049)
        with self.assertRaisesRegex(ALERT.AlertError, "INVALID_DSN_FILE_SIZE"):
            ALERT.read_dsn(self.dsn_file)

    def test_event_has_only_fixed_sanitized_fields_and_no_environment_or_credentials(self):
        with mock.patch.dict(os.environ, {"PASSWORD": "private-marker", "MONITOR_SERVICE_RESULT": "injected-marker"}):
            for unit in ALERT.CHECKS:
                event_id, code, envelope = ALERT.build_event(unit)
                header, item, payload = envelope.rstrip(b"\n").split(b"\n")
                event = json.loads(payload)
                self.assertEqual(json.loads(header)["event_id"], event_id)
                self.assertEqual(json.loads(item), {"type": "event", "length": len(payload)})
                self.assertEqual(set(event), {"event_id", "timestamp", "platform", "level", "environment", "logger", "message", "fingerprint", "tags"})
                self.assertEqual(event["tags"]["check"], code)
                self.assertEqual(event["fingerprint"], ["nervion-ops", code, event_id])
                for forbidden in (KEY, "private-marker", "injected-marker", "server_name", "extra", "contexts", "request", "user", "pid"):
                    self.assertNotIn(forbidden, envelope.decode())
        with self.assertRaisesRegex(ALERT.AlertError, "UNSUPPORTED_UNIT"):
            ALERT.build_event("other.service")

    def test_each_new_unit_failure_gets_a_distinct_issue_without_suppressing_repeat_alerts(self):
        first_id, first_code, first_envelope = ALERT.build_event(UNIT)
        second_id, second_code, second_envelope = ALERT.build_event(UNIT)
        first = json.loads(first_envelope.rstrip(b"\n").split(b"\n")[-1])
        second = json.loads(second_envelope.rstrip(b"\n").split(b"\n")[-1])
        self.assertEqual(first_code, second_code)
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(first["fingerprint"][:2], second["fingerprint"][:2])
        self.assertNotEqual(first["fingerprint"], second["fingerprint"])

    def test_submit_uses_system_ca_hostname_verification_no_proxy_and_fixed_headers(self):
        connection = mock.Mock()
        connection.getresponse.return_value.status = 202
        with mock.patch.dict(os.environ, {"HTTPS_PROXY": "https://untrusted.invalid", "SSL_CERT_FILE": "/untrusted-ca"}), \
             mock.patch.object(http.client, "HTTPSConnection", return_value=connection) as connect:
            self.assertEqual(ALERT.submit(self.destination, b"fixture-envelope"), 202)
        args, kwargs = connect.call_args
        self.assertEqual(args, ("alerts.example.test",))
        self.assertEqual(kwargs["port"], 443)
        self.assertEqual(kwargs["timeout"], 5)
        self.assertEqual(kwargs["context"].verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(kwargs["context"].check_hostname)
        self.assertEqual(kwargs["context"].minimum_version, ssl.TLSVersion.TLSv1_2)
        args, kwargs = connection.request.call_args
        self.assertEqual(args, ("POST", "/api/17/envelope/"))
        self.assertEqual(kwargs["body"], b"fixture-envelope")
        self.assertIn("sentry_key=" + KEY, kwargs["headers"]["X-Sentry-Auth"])
        connection.getresponse.return_value.read.assert_not_called()
        connection.close.assert_called_once()

    def test_redirect_and_rate_limit_are_rejected_without_following_or_retry(self):
        for status in (301, 302, 307, 308, 400, 401, 403, 429):
            transport = mock.Mock(return_value=status)
            with self.subTest(status=status), self.assertRaisesRegex(ALERT.AlertError, "ALERT_HTTP_REJECTED"):
                ALERT.deliver(UNIT, self.destination, transport)
            transport.assert_called_once()

    def test_retries_once_with_identical_event_id_after_network_or_server_failure(self):
        for failure in (503, OSError("secret-response"), http.client.BadStatusLine("secret-response")):
            transport = mock.Mock(side_effect=[failure, 200])
            with mock.patch.object(time, "sleep") as sleep:
                result = ALERT.deliver(UNIT, self.destination, transport)
            self.assertEqual(result["status"], "accepted")
            self.assertEqual(transport.call_count, 2)
            self.assertEqual(transport.call_args_list[0], transport.call_args_list[1])
            event = json.loads(transport.call_args_list[0].args[1].rstrip(b"\n").split(b"\n")[-1])
            self.assertEqual(event["fingerprint"][-1], result["eventId"])
            sleep.assert_called_once_with(1)

    def test_exhausted_network_or_http_failures_and_tls_failures_are_sanitized(self):
        for side_effect, code, attempts in (
            ([500, 500], "ALERT_HTTP_REJECTED", 2),
            (OSError("private-marker"), "ALERT_NETWORK_FAILED", 2),
            (ssl.SSLCertVerificationError("private-marker"), "ALERT_TLS_FAILED", 1),
        ):
            transport = mock.Mock(side_effect=side_effect)
            with mock.patch.object(time, "sleep"), self.assertRaisesRegex(ALERT.AlertError, code):
                ALERT.deliver(UNIT, self.destination, transport)
            self.assertEqual(transport.call_count, attempts)

    def test_overall_deadline_interrupts_blocked_operations_and_restores_signal_handler(self):
        previous = signal.getsignal(signal.SIGALRM)
        with self.assertRaisesRegex(ALERT.AlertError, "ALERT_DEADLINE_EXCEEDED"):
            with ALERT.deadline(0.01):
                time.sleep(0.1)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)

    def test_cli_never_prints_dsn_private_path_args_or_raw_exception(self):
        for args in (["--unexpected", DSN], ["--unit", "private-marker", "--dsn-file", str(self.dsn_file)]):
            error = io.StringIO()
            with contextlib.redirect_stderr(error):
                self.assertEqual(ALERT.main(args), 1)
            for value in (KEY, "private-marker", str(self.dsn_file)):
                self.assertNotIn(value, error.getvalue())
        error = io.StringIO()
        with mock.patch.object(ALERT, "deliver", side_effect=OSError(DSN)), contextlib.redirect_stderr(error):
            self.assertEqual(ALERT.main(["--unit", UNIT, "--dsn-file", str(self.dsn_file)]), 1)
        self.assertEqual(json.loads(error.getvalue()), {"error": "ALERT_FAILED"})

    def test_cli_success_reports_only_acceptance_not_email_delivery(self):
        output = io.StringIO()
        with mock.patch.object(ALERT, "deliver", return_value={"status": "accepted", "check": "OPS_BACKUP_FAILED", "eventId": "a" * 32}), contextlib.redirect_stdout(output):
            self.assertEqual(ALERT.main(["--unit", UNIT, "--dsn-file", str(self.dsn_file)]), 0)
        self.assertEqual(set(json.loads(output.getvalue())), {"status", "check", "eventId"})

    @unittest.skipUnless(shutil.which("systemd-analyze"), "systemd parser is unavailable")
    def test_systemd_template_and_all_onfailure_bindings_parse(self):
        base = pathlib.Path(__file__).parent
        units = self.root / "units"
        units.mkdir()
        for name in ("sysinit.target", "basic.target", "network-online.target", "shutdown.target"):
            (units / name).write_text("[Unit]\nDescription=Offline parser fixture\nDefaultDependencies=no\n")
        shutil.copyfile(base / "nervion-ops-alert@.service.example", units / "nervion-ops-alert@.service")
        self.assertNotIn("OnFailure=", (units / "nervion-ops-alert@.service").read_text())
        for name in ALERT.CHECKS:
            source = base / "postgres" / name if name.startswith("nervion-backup") else base / (name + ".example")
            self.assertIn("OnFailure=nervion-ops-alert@%n.service", source.read_text())
        result = subprocess.run(["systemd-analyze", "verify", "--man=no", str(units / "nervion-ops-alert@nervion-backup.service.service")],
                                capture_output=True, timeout=10, check=False,
                                env={"PATH": "/usr/bin:/bin", "SYSTEMD_UNIT_PATH": str(units)})
        self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == "__main__":
    unittest.main()

"""Offline monitoring regression tests. No production endpoints or mail sends."""

import contextlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("infra_monitor", pathlib.Path(__file__).with_name("infra-monitor.py"))
MONITOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MONITOR
SPEC.loader.exec_module(MONITOR)
CONTAINER = "a" * 64


class InfraMonitorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="nervion-infra-monitor-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o700)
        self.config_path = self.root / "config.json"
        self.config_data = {"composeProject": "nervion-production", "postgresService": "postgres", "diskPaths": [str(self.root)], "stateDirectory": str(self.state)}
        self.write_config()
        self.config = MONITOR.load_config(self.config_path)

    def write_config(self):
        self.config_path.write_text(json.dumps(self.config_data))
        self.config_path.chmod(0o600)

    def inspect(self, **overrides):
        mount = {"Type": "volume", "Name": "nervion-production_postgres_data", "Destination": "/var/lib/postgresql/data", "Source": str(self.root), "RW": True}
        values = {"id": CONTAINER, "project": "nervion-production", "service": "postgres", "running": True, "mounts": [mount]}
        values.update(overrides)
        return b"\n".join(json.dumps(values[key]).encode() for key in ("id", "project", "service", "running", "mounts"))

    def test_private_configuration_schema_and_optional_smtp(self):
        self.assertIsNone(self.config.smtp_bundle)
        for patch in ({"unknown": 1}, {"postgresService": "other"}, {"composeProject": "bad;command"}, {"diskPaths": []}, {"diskPaths": ["/a/../b"]}, {"diskPaths": ["/"]}, {"diskPaths": [str(self.root)] * 2}, {"smtpHostname": "mail.example.test"}, {"smtpHostname": "127.0.0.1", "smtpBundleDirectory": str(self.root)}):
            with self.subTest(patch=patch):
                self.config_data.update(patch)
                self.write_config()
                with self.assertRaises(MONITOR.MonitorError):
                    MONITOR.load_config(self.config_path)
                self.config_data = {"composeProject": "nervion-production", "postgresService": "postgres", "diskPaths": [str(self.root)], "stateDirectory": str(self.state)}
        self.write_config()
        self.config_path.chmod(0o644)
        with self.assertRaises(MONITOR.MonitorError):
            MONITOR.load_config(self.config_path)
        self.config_path.chmod(0o600)
        alias = self.root / "alias"
        alias.symlink_to(self.config_path)
        with self.assertRaises(MONITOR.MonitorError):
            MONITOR.load_config(alias)
        alias.unlink()
        os.link(self.config_path, alias)
        with self.assertRaises(MONITOR.MonitorError):
            MONITOR.load_config(self.config_path)

    def test_duplicate_json_keys_are_rejected(self):
        self.config_path.write_text('{"composeProject":"a","composeProject":"b"}')
        with self.assertRaisesRegex(MONITOR.MonitorError, "INVALID_JSON"):
            MONITOR.load_config(self.config_path)

    def test_exact_owned_container_volume_no_environment_inspection(self):
        with mock.patch.object(MONITOR, "command", side_effect=[(0, CONTAINER.encode()), (0, self.inspect())]) as run:
            self.assertEqual(MONITOR.postgres_target(self.config), (CONTAINER, self.root))
        self.assertEqual(run.call_count, 2)
        all_args = str(run.call_args_list)
        self.assertNotIn(".Config.Env", all_args)
        self.assertIn("unix:///var/run/docker.sock", all_args)
        self.assertIn("com.docker.compose.project=nervion-production", all_args)
        self.assertNotIn("restart", all_args)

    def test_foreign_missing_multiple_stopped_or_overridden_container_rejected(self):
        for ids in (b"", (CONTAINER + "\n" + "b" * 64).encode(), b"not-id"):
            with mock.patch.object(MONITOR, "command", return_value=(0, ids)) as run, self.assertRaises(MONITOR.MonitorError):
                MONITOR.postgres_target(self.config)
            run.assert_called_once()
        for override in ({"project": "foreign"}, {"service": "backend"}, {"running": False}, {"id": "b" * 64}, {"mounts": []}, {"mounts": [{"Destination": "/var/lib/postgresql/data", "Type": "bind", "Name": "nervion-production_postgres_data", "RW": True}]}, {"mounts": [{"Destination": "/var/lib/postgresql/data", "Type": "volume", "Name": "foreign_postgres_data", "RW": True}]}):
            with self.subTest(override=override), mock.patch.object(MONITOR, "command", side_effect=[(0, CONTAINER.encode()), (0, self.inspect(**override))]), self.assertRaises(MONITOR.MonitorError):
                MONITOR.postgres_target(self.config)
        nested = json.loads(self.inspect().splitlines()[-1]) + [{"Destination": "/var/lib/postgresql/data/pgdata"}]
        with mock.patch.object(MONITOR, "command", side_effect=[(0, CONTAINER.encode()), (0, self.inspect(mounts=nested))]), self.assertRaises(MONITOR.MonitorError):
            MONITOR.postgres_target(self.config)

    def test_wal_thresholds_and_sql_is_static_read_only_with_timeouts(self):
        data = {"archiveEnabled": True, "unresolvedArchiveFailure": False, "oldestPendingWalAgeSeconds": 300, "walBytes": MONITOR.GIB}
        with mock.patch.object(MONITOR, "command", return_value=(0, json.dumps(data).encode())) as run:
            self.assertEqual(MONITOR.wal_failures(CONTAINER), set())
        args = run.call_args.args[0]
        self.assertIn("PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=3000 -c lock_timeout=1000", args)
        self.assertEqual(args[-1], MONITOR.POSTGRES_SQL)
        self.assertEqual(args[3:7], ["exec", "--user", "postgres", "--env"])
        self.assertIn(CONTAINER, args)
        data.update(unresolvedArchiveFailure=True, oldestPendingWalAgeSeconds=301, walBytes=MONITOR.GIB + 1)
        with mock.patch.object(MONITOR, "command", return_value=(0, json.dumps(data).encode())):
            self.assertEqual(MONITOR.wal_failures(CONTAINER), {"WAL_ARCHIVE_FAILURE", "WAL_BACKLOG", "WAL_TOO_LARGE"})
        for bad in (b'{}', b'not-json', json.dumps(dict(data, walBytes=True)).encode(), json.dumps(dict(data, walBytes=-1)).encode()):
            with mock.patch.object(MONITOR, "command", return_value=(0, bad)), self.assertRaises(Exception):
                MONITOR.wal_failures(CONTAINER)

    def test_archive_disabled_is_reported_without_idle_timestamp_false_positive(self):
        data = {"archiveEnabled": False, "unresolvedArchiveFailure": False, "oldestPendingWalAgeSeconds": 0, "walBytes": 0}
        with mock.patch.object(MONITOR, "command", return_value=(0, json.dumps(data).encode())):
            self.assertEqual(MONITOR.wal_failures(CONTAINER), {"WAL_ARCHIVE_FAILURE"})
        self.assertNotIn("last_archived_time)", MONITOR.POSTGRES_SQL)

    def test_disk_minimum_and_ninety_percent_boundaries(self):
        for total, free, expected in ((20, 4, False), (20, 3, True), (40, 4, True), (100, 11, False), (100, 10, True)):
            usage = mock.Mock(f_blocks=total * MONITOR.GIB, f_bavail=free * MONITOR.GIB, f_frsize=1)
            with self.subTest(total=total, free=free), mock.patch.object(os, "statvfs", return_value=usage):
                self.assertEqual(MONITOR.disk_low(self.root), expected)

    def test_memavailable_reads_only_fixed_kernel_counter(self):
        with mock.patch("builtins.open", mock.mock_open(read_data=b"MemTotal: 1000 kB\nMemAvailable: 234 kB\n")) as opened:
            self.assertEqual(MONITOR.memory_available(), 234 * 1024)
        opened.assert_called_once_with("/proc/meminfo", "rb")
        with mock.patch("builtins.open", mock.mock_open(read_data=b"MemTotal: 1000 kB\n")), self.assertRaises(MONITOR.MonitorError):
            MONITOR.memory_available()

    def test_memory_requires_three_separated_samples_and_resets_after_gap_or_recovery(self):
        state, due = MONITOR.advance_state(MONITOR.empty_state(), set(), True, 10000)
        self.assertEqual((state["memoryStreak"], due), (1, []))
        state, due = MONITOR.advance_state(state, set(), True, 10001)
        self.assertEqual((state["memoryStreak"], state["lastSampleAt"], due), (1, 10000, []))
        state, due = MONITOR.advance_state(state, set(), True, 10300)
        self.assertEqual((state["memoryStreak"], due), (2, []))
        state, due = MONITOR.advance_state(state, set(), True, 10600)
        self.assertEqual(due, ["MEMORY_LOW"])
        reset, _ = MONITOR.advance_state(state, set(), True, 12000)
        self.assertEqual(reset["memoryStreak"], 1)
        reset, _ = MONITOR.advance_state(state, set(), False, 10900)
        self.assertEqual((reset["memoryStreak"], reset["active"]), (0, {}))
        reset, _ = MONITOR.advance_state(state, set(), None, 10900)
        self.assertEqual(reset["memoryStreak"], 0)

    def test_six_hour_reminder_new_code_and_recovery(self):
        state, due = MONITOR.advance_state(MONITOR.empty_state(), {"DISK_LOW"}, False, 10000)
        self.assertEqual(due, ["DISK_LOW"])
        state, due = MONITOR.advance_state(state, {"DISK_LOW"}, False, 10001)
        self.assertEqual(due, [])
        state, due = MONITOR.advance_state(state, {"DISK_LOW", "WAL_BACKLOG"}, False, 10002)
        self.assertEqual(due, ["WAL_BACKLOG"])
        state, due = MONITOR.advance_state(state, {"DISK_LOW"}, False, 31600)
        self.assertEqual(due, ["DISK_LOW"])
        state, _ = MONITOR.advance_state(state, set(), False, 31900)
        state, due = MONITOR.advance_state(state, {"DISK_LOW"}, False, 32200)
        self.assertEqual(due, ["DISK_LOW"])

    def smtp_config(self):
        bundle = self.root / "bundle"
        bundle.mkdir(mode=0o700)
        (bundle / "releases").mkdir(mode=0o700)
        release = bundle / "releases" / ("c" * 64)
        release.mkdir(mode=0o700)
        (release / "fullchain.pem").write_bytes(b"synthetic-public-cert")
        (release / "fullchain.pem").chmod(0o600)
        (bundle / "current").symlink_to("releases/" + "c" * 64)
        return MONITOR.Config(self.config.project, self.config.disk_paths, self.state, bundle, "mail.example.test")

    def test_smtp_only_reads_public_certificate_and_expiry_boundary(self):
        config = self.smtp_config()
        for exit_code, expected in ((0, set()), (1, {"SMTP_CERT_EXPIRING"})):
            with mock.patch.object(MONITOR, "command", side_effect=[(0, b"Hostname mail.example.test does match certificate\n"), (exit_code, b"")]) as run, mock.patch.object(MONITOR, "read_file", wraps=MONITOR.read_file) as read:
                self.assertEqual(MONITOR.smtp_failures(config), expected)
            self.assertEqual(read.call_count, 1)
            self.assertEqual(read.call_args.args[0].name, "fullchain.pem")
            self.assertEqual(run.call_args.args[0][-1], str(14 * 86400))
        with mock.patch.object(MONITOR, "command") as run:
            self.assertEqual(MONITOR.smtp_failures(self.config), set())
        run.assert_not_called()

    def test_smtp_hostname_mismatch_and_path_escape_are_rejected(self):
        config = self.smtp_config()
        with mock.patch.object(MONITOR, "command", return_value=(0, b"Hostname mail.example.test does NOT match certificate")), self.assertRaises(MONITOR.MonitorError):
            MONITOR.smtp_failures(config)
        (config.smtp_bundle / "current").unlink()
        (config.smtp_bundle / "current").symlink_to("../outside")
        with mock.patch.object(MONITOR, "command") as run, self.assertRaises(MONITOR.MonitorError):
            MONITOR.smtp_failures(config)
        run.assert_not_called()

    @unittest.skipUnless(shutil.which("openssl"), "openssl unavailable")
    def test_real_public_certificate_hostname_and_expiry(self):
        config = self.smtp_config()
        release = config.smtp_bundle / "releases" / ("c" * 64)
        result = subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "20", "-subj", "/CN=mail.example.test", "-addext", "subjectAltName=DNS:mail.example.test", "-keyout", str(self.root / "fixture-key"), "-out", str(release / "fullchain.pem")], capture_output=True, timeout=10, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(MONITOR.smtp_failures(config), set())

    def test_command_uses_local_socket_clean_environment_timeouts_and_sanitized_errors(self):
        with mock.patch.dict(os.environ, {"DOCKER_HOST": "tcp://foreign", "PASSWORD": "private-marker"}), mock.patch.object(subprocess, "run", return_value=mock.Mock(returncode=0, stdout=b"ok")) as run:
            self.assertEqual(MONITOR.command(MONITOR.DOCKER + ["ps"]), (0, b"ok"))
        self.assertEqual(run.call_args.kwargs["env"], {"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        self.assertEqual(run.call_args.kwargs["timeout"], 8)
        self.assertIs(run.call_args.kwargs["stderr"], subprocess.DEVNULL)
        with mock.patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("private-marker", 8)), self.assertRaisesRegex(MONITOR.MonitorError, "^COMMAND_FAILED$"):
            MONITOR.command(["fixture"])

    def test_collect_reports_fixed_codes_without_raw_failure_or_private_data(self):
        with mock.patch.object(MONITOR, "postgres_target", side_effect=OSError("private-marker")), mock.patch.object(MONITOR, "disk_low", side_effect=OSError("private-marker")), mock.patch.object(MONITOR, "memory_available", side_effect=OSError("private-marker")), mock.patch.object(MONITOR, "smtp_failures", side_effect=OSError("private-marker")):
            self.assertEqual(MONITOR.collect(self.config), ({"POSTGRES_CHECK_FAILED", "DISK_CHECK_FAILED", "MEMORY_CHECK_FAILED", "SMTP_CERT_CHECK_FAILED"}, None))

    def test_state_atomic_mode_locking_and_corruption_detection(self):
        path = self.state / "state.json"
        self.assertEqual(MONITOR.load_state(path), MONITOR.empty_state())
        MONITOR.save_state(path, MONITOR.empty_state())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(MONITOR.load_state(path), MONITOR.empty_state())
        with MONITOR.lock_state(self.state) as first:
            self.assertTrue(first)
            with MONITOR.lock_state(self.state) as second:
                self.assertFalse(second)
        for value in ({"version": 2}, dict(MONITOR.empty_state(), active={"SECRET": 1}), dict(MONITOR.empty_state(), memoryStreak=4), dict(MONITOR.empty_state(), lastSampleAt=float("nan"))):
            path.write_text(json.dumps(value))
            with self.assertRaises(MONITOR.MonitorError):
                MONITOR.load_state(path)
        self.state.chmod(0o755)
        with self.assertRaises(MONITOR.MonitorError), MONITOR.lock_state(self.state):
            pass

    def test_main_persists_attempt_before_failure_and_suppresses_repeat(self):
        for expected in (1, 0):
            output = io.StringIO()
            with mock.patch.object(MONITOR, "collect", return_value=({"DISK_LOW"}, False)), contextlib.redirect_stdout(output):
                self.assertEqual(MONITOR.main(["--config", str(self.config_path)]), expected)
            result = json.loads(output.getvalue())
            self.assertEqual(result["codes"], ["DISK_LOW"])
            self.assertEqual(set(result), {"status", "codes", "due"})

    def test_config_only_does_not_collect_or_write_state_and_cli_errors_are_sanitized(self):
        with mock.patch.object(MONITOR, "collect") as collect, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(MONITOR.main(["--config", str(self.config_path), "--check-config"]), 0)
        collect.assert_not_called()
        self.assertFalse((self.state / "state.json").exists())
        output = io.StringIO()
        with mock.patch.object(MONITOR, "load_config", side_effect=OSError("private-marker")), contextlib.redirect_stderr(output):
            self.assertEqual(MONITOR.main(["--config", str(self.config_path)]), 1)
        self.assertEqual(json.loads(output.getvalue()), {"error": "MONITOR_FAILED"})

    def test_deadline_cannot_be_swallowed_by_individual_check(self):
        handler = signal.getsignal(signal.SIGALRM)
        with mock.patch.object(MONITOR, "postgres_target", side_effect=lambda _config: time.sleep(0.1)), self.assertRaises(MONITOR.MonitorDeadline):
            with MONITOR.deadline(0.01):
                MONITOR.collect(self.config)
        self.assertEqual(signal.getsignal(signal.SIGALRM), handler)

    @unittest.skipUnless(shutil.which("systemd-analyze"), "systemd parser unavailable")
    def test_units_parse_and_never_start_docker_or_repair(self):
        base = pathlib.Path(__file__).parent
        units = self.root / "units"
        units.mkdir()
        for name in ("sysinit.target", "basic.target", "shutdown.target", "timers.target", "network-online.target"):
            (units / name).write_text("[Unit]\nDescription=Offline fixture\nDefaultDependencies=no\n")
        for name in ("nervion-infra-monitor.service", "nervion-infra-monitor.timer"):
            shutil.copyfile(base / (name + ".example"), units / name)
        unit = (units / "nervion-infra-monitor.service").read_text()
        self.assertIn("OnFailure=nervion-ops-alert@%n.service", unit)
        self.assertIn("TimeoutStartSec=55", unit)
        self.assertIn("TasksMax=64", unit)
        self.assertNotIn("Requires=docker", unit)
        self.assertNotIn("Restart=", unit)
        result = subprocess.run(["systemd-analyze", "verify", "--man=no", str(units / "nervion-infra-monitor.service"), str(units / "nervion-infra-monitor.timer")], capture_output=True, timeout=10, check=False, env={"PATH": "/usr/bin:/bin", "SYSTEMD_UNIT_PATH": str(units)})
        self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == "__main__":
    unittest.main()

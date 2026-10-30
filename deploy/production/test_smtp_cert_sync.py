"""Offline TLS fixtures; Docker is always simulated and no network is used."""

import copy
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "smtp_cert_sync", pathlib.Path(__file__).with_name("smtp-cert-sync.py")
)
SYNC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SYNC
SPEC.loader.exec_module(SYNC)
CONTAINER_ID = "a" * 64


def private_write(path, value):
    path.write_bytes(value if isinstance(value, bytes) else value.encode())
    path.chmod(0o600)


class Runner:
    def __init__(self, config, ca):
        self.ca = ca
        self.calls = []
        self.ids = [CONTAINER_ID]
        self.fail_restart = False
        self.target = {
            "Id": CONTAINER_ID,
            "Config": {
                "Labels": {
                    "com.docker.compose.project": config.project,
                    "com.docker.compose.service": "smtp",
                    "com.docker.compose.oneoff": "False",
                },
                "Env": [
                    "TENANCY_ENABLED=true", "NODE_ENV=production",
                    "SMTP_TLS_SERVER_NAME=" + config.hostname,
                    "SMTP_TLS_CERT_FILE=" + SYNC.CONTAINER_BUNDLE + "/current/fullchain.pem",
                    "SMTP_TLS_KEY_FILE=" + SYNC.CONTAINER_BUNDLE + "/current/privkey.pem",
                ],
                "Healthcheck": {"Test": SYNC.SMTP_HEALTHCHECK},
            },
            "Mounts": [{"Type": "bind", "Source": str(config.bundle),
                        "Destination": SYNC.CONTAINER_BUNDLE, "RW": False}],
            "State": {"Running": True, "Health": {"Status": "healthy"}},
        }

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        if args[0] == "openssl":
            if args[1] == "verify":
                args = args[:2] + ["-CAfile", str(self.ca)] + args[2:]
            return SYNC.command(args, **kwargs)
        if args[:3] != SYNC.DOCKER:
            raise AssertionError("Unexpected executable")
        action = args[3]
        if action == "ps":
            return "\n".join(self.ids).encode()
        if action == "inspect":
            return json.dumps([self.target]).encode()
        if action == "restart":
            if args[4:] != ["--time", "60", CONTAINER_ID]:
                raise AssertionError("Restart must address only the exact validated ID")
            if self.fail_restart:
                raise SYNC.SyncError("COMMAND_FAILED")
            return CONTAINER_ID.encode()
        raise AssertionError("Unexpected Docker operation")

    @property
    def restarts(self):
        return [call for call in self.calls if call[:4] == [*SYNC.DOCKER, "restart"]]


class CertificateSyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory(prefix="nervion-cert-tests-ca-")
        cls.ca = pathlib.Path(cls.shared.name) / "ca.crt"
        cls.ca_key = pathlib.Path(cls.shared.name) / "ca.key"
        SYNC.command(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt",
                      "ec_paramgen_curve:P-256", "-nodes", "-days", "365", "-subj", "/CN=Offline fixture CA",
                      "-keyout", str(cls.ca_key), "-out", str(cls.ca)])

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="nervion-cert-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.storage = self.root / "caddy"
        self.source = self.storage / "certificates" / "fixture-acme" / "mail.example.com"
        for path in (self.storage, self.storage / "certificates", self.source.parent, self.source):
            path.mkdir(mode=0o700)
        self.bundle = self.root / "smtp-tls"
        self.config = SYNC.Config("mail.example.com", self.storage, self.bundle, "fixture-saas")
        self.runner = Runner(self.config, self.ca)
        self.create_certificate()

    def create_certificate(self, *, san="DNS:mail.example.com", days=90):
        key, csr, leaf, extensions = [self.root / name for name in ("new.key", "new.csr", "new.crt", "new.ext")]
        private_write(extensions, "subjectAltName=" + san + "\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n")
        SYNC.command(["openssl", "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
                      "-nodes", "-subj", "/CN=mail.example.com", "-keyout", str(key), "-out", str(csr)])
        SYNC.command(["openssl", "x509", "-req", "-in", str(csr), "-CA", str(self.ca), "-CAkey", str(self.ca_key),
                      "-set_serial", str(int.from_bytes(os.urandom(8), "big")), "-days", str(days),
                      "-extfile", str(extensions), "-out", str(leaf)])
        self.cert = self.source / "mail.example.com.crt"
        self.key = self.source / "mail.example.com.key"
        private_write(self.cert, leaf.read_bytes() + self.ca.read_bytes())
        private_write(self.key, key.read_bytes())

    def write_config(self, **overrides):
        values = {"hostname": self.config.hostname, "caddyStorageRoot": str(self.storage),
                  "bundleDirectory": str(self.bundle), "composeProject": self.config.project,
                  "composeService": "smtp"}
        values.update(overrides)
        path = self.root / "config.json"
        private_write(path, json.dumps(values))
        return path

    def sync(self, *, restart=False):
        return SYNC.synchronize(self.config, restart=restart, run=self.runner)

    def source_snapshot(self):
        return [(file.stat().st_mtime_ns, file.stat().st_mode, hashlib.sha256(file.read_bytes()).hexdigest())
                for file in (self.cert, self.key)]

    def test_copy_only_is_private_atomic_idempotent_and_does_not_touch_source_or_docker(self):
        before = self.source_snapshot()
        first = self.sync()
        second = self.sync()
        self.assertTrue(first["changed"])
        self.assertTrue(first["activationPending"])
        self.assertFalse(second["changed"])
        self.assertEqual(before, self.source_snapshot())
        self.assertFalse(any(call[0] == "docker" for call in self.runner.calls))
        self.assertEqual(os.readlink(self.bundle / "current"), "releases/" + first["fingerprint"])
        self.assertEqual((self.bundle / "current/fullchain.pem").read_bytes(), self.cert.read_bytes())
        for path in self.bundle.rglob("*"):
            if not path.is_symlink():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode) & 0o077, 0)

    def test_strict_config(self):
        self.assertEqual(SYNC.load_config(self.write_config()), self.config)
        for fields in ({"unknown": True}, {"hostname": "*.example.com"}, {"hostname": "127.0.0.1"},
                       {"composeService": "backend"}, {"composeProject": "project; command"},
                       {"minimumValiditySeconds": True}, {"bundleDirectory": str(self.storage / "nested")},
                       {"bundleDirectory": str(self.root) + "/../smtp-tls"}):
            with self.subTest(fields=fields), self.assertRaises(SYNC.SyncError):
                SYNC.load_config(self.write_config(**fields))
        path = self.write_config()
        path.chmod(0o644)
        with self.assertRaisesRegex(SYNC.SyncError, "UNSAFE_SECRET_FILE"):
            SYNC.load_config(path)
        private_write(path, '{"hostname":"mail.example.com","hostname":"other.example.com"}')
        with self.assertRaisesRegex(SYNC.SyncError, "DUPLICATE_CONFIG_KEY"):
            SYNC.load_config(path)

    def test_wrong_or_multiple_or_wildcard_san_is_rejected(self):
        for san in ("DNS:other.example.com", "DNS:*.example.com", "DNS:mail.example.com,DNS:other.example.com"):
            with self.subTest(san=san):
                self.create_certificate(san=san)
                with self.assertRaisesRegex(SYNC.SyncError, "NO_VALID_SOURCE_CERTIFICATE"):
                    self.sync()
                self.assertFalse((self.bundle / "current").exists())

    def test_short_lived_future_and_expired_material_is_rejected(self):
        self.create_certificate(days=3)
        with self.assertRaisesRegex(SYNC.SyncError, "NO_VALID_SOURCE_CERTIFICATE"):
            self.sync()
        for now in (datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc).timestamp(),
                    datetime.datetime(2100, 1, 1, tzinfo=datetime.timezone.utc).timestamp()):
            with self.assertRaisesRegex(SYNC.SyncError, "CERTIFICATE_NOT_VALID_LONG_ENOUGH"):
                SYNC.validate_material(self.cert, self.key, self.config, self.runner, now=now)

    def test_mismatched_key_and_untrusted_chain_are_rejected(self):
        private_write(self.key, self.ca_key.read_bytes())
        with self.assertRaisesRegex(SYNC.SyncError, "NO_VALID_SOURCE_CERTIFICATE"):
            self.sync()
        self.create_certificate()
        with self.assertRaisesRegex(SYNC.SyncError, "NO_VALID_SOURCE_CERTIFICATE"):
            SYNC.synchronize(self.config, run=SYNC.command)

    def test_source_symlink_hardlink_and_insecure_key_are_rejected(self):
        original = self.key.read_bytes()
        self.key.unlink()
        self.key.symlink_to(self.ca_key)
        with self.assertRaises(SYNC.SyncError):
            self.sync()
        self.key.unlink()
        os.link(self.ca_key, self.key)
        with self.assertRaisesRegex(SYNC.SyncError, "UNSAFE_FILE"):
            self.sync()
        self.key.unlink()
        private_write(self.key, original)
        self.key.chmod(0o644)
        with self.assertRaisesRegex(SYNC.SyncError, "UNSAFE_SECRET_FILE"):
            self.sync()

    def test_invalid_rotation_keeps_previous_current(self):
        first = self.sync()
        private_write(self.cert, "not a certificate")
        with self.assertRaisesRegex(SYNC.SyncError, "NO_VALID_SOURCE_CERTIFICATE"):
            self.sync()
        self.assertEqual(SYNC.current_fingerprint(self.bundle), first["fingerprint"])

    def test_invalid_previous_issuer_does_not_block_valid_current_issuer(self):
        previous = self.storage / "certificates" / "previous-acme" / self.config.hostname
        previous.parent.mkdir(mode=0o700)
        previous.mkdir(mode=0o700)
        private_write(previous / (self.config.hostname + ".crt"), "expired or invalid old issuer material")
        private_write(previous / (self.config.hostname + ".key"), self.key.read_bytes())
        self.assertTrue(self.sync()["changed"])

    def test_symlinked_source_directory_and_excess_issuers_are_rejected(self):
        actual = self.source.with_name("actual-source")
        self.source.rename(actual)
        self.source.symlink_to(actual)
        with self.assertRaisesRegex(SYNC.SyncError, "UNSAFE_DIRECTORY"):
            self.sync()
        self.source.unlink()
        actual.rename(self.source)
        for index in range(32):
            (self.storage / "certificates" / ("extra-" + str(index))).mkdir(mode=0o700)
        with self.assertRaisesRegex(SYNC.SyncError, "TOO_MANY_ISSUERS"):
            self.sync()
        self.assertFalse((self.bundle / "current").exists())

    def test_restart_is_exact_scoped_and_only_needed_for_new_material(self):
        first = self.sync(restart=True)
        self.assertTrue(first["restarted"])
        self.assertEqual(len(self.runner.restarts), 1)
        second = self.sync(restart=True)
        self.assertFalse(second["restarted"])
        self.assertEqual(len(self.runner.restarts), 1)
        self.create_certificate()
        third = self.sync(restart=True)
        self.assertNotEqual(first["fingerprint"], third["fingerprint"])
        self.assertEqual(len(self.runner.restarts), 2)
        self.assertTrue((self.bundle / "releases" / first["fingerprint"]).is_dir())
        self.assertEqual(json.loads((self.bundle / ".activated.json").read_text())["fingerprint"], third["fingerprint"])

    def test_prepared_copy_is_activated_later(self):
        self.sync()
        activated = self.sync(restart=True)
        self.assertFalse(activated["changed"])
        self.assertTrue(activated["restarted"])

    def test_missing_or_multiple_smtp_targets_do_not_publish(self):
        for ids in ([], [CONTAINER_ID, "b" * 64]):
            self.runner.ids = ids
            with self.assertRaisesRegex(SYNC.SyncError, "SMTP_TARGET_NOT_UNIQUE"):
                self.sync(restart=True)
            self.assertFalse((self.bundle / "current").exists())
        self.assertFalse(self.runner.restarts)

    def test_wrong_target_environment_mount_labels_or_healthcheck_do_not_publish(self):
        correct = copy.deepcopy(self.runner.target)
        for change in (
            lambda value: value["Config"]["Labels"].update({"com.docker.compose.project": "another"}),
            lambda value: value["Config"]["Labels"].update({"com.docker.compose.service": "backend"}),
            lambda value: value["Config"]["Labels"].update({"com.docker.compose.oneoff": "True"}),
            lambda value: value["Config"].update(Env=["TENANCY_ENABLED=false"]),
            lambda value: value["Mounts"][0].update(RW=True),
            lambda value: value["Mounts"][0].update(Source="/another/bundle"),
            lambda value: value["Config"].update(Healthcheck={"Test": ["NONE"]}),
            lambda value: value["Config"].update(Healthcheck={"Test": ["CMD", "true"]}),
            lambda value: value["State"].update(Running=False),
        ):
            self.runner.target = copy.deepcopy(correct)
            change(self.runner.target)
            with self.assertRaises(SYNC.SyncError):
                self.sync(restart=True)
            self.assertFalse((self.bundle / "current").exists())
        self.assertFalse(self.runner.restarts)

    def test_nested_mount_cannot_hide_rotated_certificate(self):
        for suffix in ("/current", "/current/fullchain.pem", "/current/privkey.pem"):
            self.runner.target["Mounts"] = self.runner.target["Mounts"][:1] + [
                {"Type": "bind", "Source": str(self.source), "Destination": SYNC.CONTAINER_BUNDLE + suffix, "RW": False}
            ]
            with self.subTest(suffix=suffix), self.assertRaisesRegex(SYNC.SyncError, "NESTED_SMTP_BUNDLE_MOUNT"):
                self.sync(restart=True)
            self.assertFalse((self.bundle / "current").exists())
        self.assertFalse(self.runner.restarts)

    @unittest.skipUnless(shutil.which("systemd-analyze"), "systemd parser is unavailable")
    def test_systemd_unit_templates_parse_without_starting_services(self):
        units = self.root / "units"
        units.mkdir(mode=0o700)
        for name in ("smtp-cert-sync.service", "smtp-cert-sync.timer"):
            shutil.copyfile(pathlib.Path(__file__).with_name(name + ".example"), units / name)
        private_write(units / "docker.service", "[Unit]\nDescription=Offline parser fixture\n[Service]\nType=oneshot\nExecStart=/bin/true\n")
        result = subprocess.run(["systemd-analyze", "verify", "--man=no", str(units / "smtp-cert-sync.service"),
                                 str(units / "smtp-cert-sync.timer")], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=10, check=False, env={"PATH": "/usr/bin:/bin", "SYSTEMD_UNIT_PATH": str(units) + ":"})
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_failed_restart_and_health_are_retryable_and_never_mark_activated(self):
        self.runner.fail_restart = True
        with self.assertRaisesRegex(SYNC.SyncError, "COMMAND_FAILED"):
            self.sync(restart=True)
        self.assertFalse((self.bundle / ".activated.json").exists())
        self.runner.fail_restart = False
        self.runner.target["State"]["Health"]["Status"] = "unhealthy"
        with mock.patch.object(SYNC, "HEALTH_SECONDS", 0), self.assertRaisesRegex(SYNC.SyncError, "SMTP_HEALTHCHECK_FAILED"):
            self.sync(restart=True)
        self.assertFalse((self.bundle / ".activated.json").exists())
        self.runner.target["State"]["Health"]["Status"] = "healthy"
        self.assertTrue(self.sync(restart=True)["restarted"])

    def test_bad_current_and_activation_records_fail_closed(self):
        self.bundle.mkdir(mode=0o700)
        (self.bundle / "current").symlink_to(self.source)
        with self.assertRaisesRegex(SYNC.SyncError, "UNSAFE_CURRENT_POINTER"):
            self.sync()
        (self.bundle / "current").unlink()
        private_write(self.bundle / ".activated.json", "[]")
        with self.assertRaisesRegex(SYNC.SyncError, "INVALID_ACTIVATION_RECORD"):
            self.sync()
        self.assertFalse((self.bundle / "current").exists())

    def test_symlink_bundle_or_corrupt_existing_release_is_rejected(self):
        self.bundle.symlink_to(self.source)
        with self.assertRaises(SYNC.SyncError):
            self.sync()
        self.bundle.unlink()
        first = self.sync()
        private_write(self.bundle / "releases" / first["fingerprint"] / "privkey.pem", "corrupt")
        with self.assertRaisesRegex(SYNC.SyncError, "EXISTING_RELEASE_MISMATCH"):
            self.sync()

    def test_concurrent_sync_and_expired_deadline_are_rejected(self):
        with SYNC.locked_bundle(self.bundle), self.assertRaisesRegex(SYNC.SyncError, "SYNC_ALREADY_RUNNING"):
            self.sync()
        with mock.patch.object(SYNC, "OPERATION_SECONDS", -1), self.assertRaisesRegex(SYNC.SyncError, "NO_VALID_SOURCE_CERTIFICATE"):
            self.sync()


if __name__ == "__main__":
    unittest.main()

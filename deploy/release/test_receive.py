"""Offline privileged-dispatch contract tests, no Docker or deployment calls."""

import contextlib
import importlib.util
import io
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


DIRECTORY = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("nervion_receive", DIRECTORY / "receive.py")
RECEIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECEIVE)
COMMIT = "a" * 40
REQUEST = ("0" * 40 + " " + COMMIT + " refs/heads/master\n").encode()


class ReceiveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="nervion-receive-tests-")
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.config_path = self.root / "hook.json"
        self.repository = self.root / "repository.git"
        self.repository.mkdir(mode=0o700)
        self.runner = self.root / "run.sh"
        self.runner.write_text("#!/bin/bash\nexit 0\n")
        self.runner.chmod(0o755)
        self.manifests = self.root / "manifests"
        self.state = self.root / "state"
        self.manifests.mkdir(mode=0o700)
        self.state.mkdir(mode=0o700)
        self.config = {"schemaVersion": 1, "branch": "master", "project": "fixture-production", "runner": str(self.runner),
                       "manifestDirectory": str(self.manifests), "stateDirectory": str(self.state),
                       "repository": str(self.repository), "repositoryUser": "git-release"}
        self.account = types.SimpleNamespace(pw_uid=os.geteuid() or 1000, pw_gid=os.getegid() or 1000)
        self.write_config()

    def write_config(self):
        self.config_path.write_text(json.dumps(self.config))
        self.config_path.chmod(0o600)

    @contextlib.contextmanager
    def root_metadata(self, *, owners=None, modes=None):
        # Simulate deployment ownership only. Files, hashes, paths and locks are
        # real; Git-owner subprocesses and release steps are always mocked.
        owners = owners or {}
        modes = modes or {}
        actual_lstat = pathlib.Path.lstat
        actual_stat = pathlib.Path.stat
        actual_fstat = os.fstat

        def modified(path, info):
            fields = list(info)
            fields[4] = owners.get(path, self.account.pw_uid if path == self.repository else 0)
            mode = modes.get(path)
            if mode is None and path == pathlib.Path(tempfile.gettempdir()):
                mode = 0o755
            if mode is not None:
                fields[0] = (fields[0] & ~0o7777) | mode
            return os.stat_result(fields)

        def lstat(path, *args, **kwargs):
            return modified(path, actual_lstat(path, *args, **kwargs))

        def stat(path, *args, **kwargs):
            return modified(path, actual_stat(path, *args, **kwargs))

        def fstat(fd):
            fields = list(actual_fstat(fd)); fields[4] = 0
            return os.stat_result(fields)

        with mock.patch.object(pathlib.Path, "lstat", lstat), mock.patch.object(pathlib.Path, "stat", stat), mock.patch.object(os, "fstat", fstat), mock.patch.object(RECEIVE.pwd, "getpwnam", return_value=self.account):
            yield

    def manifest(self):
        path = self.manifests / (COMMIT + ".json")
        path.write_text(json.dumps({"commit": COMMIT, "project": self.config["project"]}))
        path.chmod(0o600)
        return path

    def test_accepts_one_master_and_ignores_other_refs_without_deployment(self):
        other = REQUEST.replace(b"refs/heads/master", b"refs/heads/feature")
        self.assertEqual(RECEIVE.parse_request(other + REQUEST), COMMIT)
        self.assertIsNone(RECEIVE.parse_request(other))
        self.assertIsNone(RECEIVE.parse_request(b""))

    def test_malformed_duplicate_deleted_and_oversized_requests_fail_closed(self):
        for data in (REQUEST + REQUEST, REQUEST.replace(COMMIT.encode(), b"0" * 40), REQUEST.rstrip(),
                     REQUEST.replace(b"refs/heads/master", b"refs/heads/master extra"), REQUEST.replace(b" ", b"\x00", 1),
                     b"x" * (RECEIVE.MAX_REQUEST + 1), REQUEST.replace(b"refs/heads/master", b"refs/tags/a") * 257):
            with self.subTest(size=len(data)), self.assertRaises(RECEIVE.ReceiveError):
                RECEIVE.parse_request(data)

    def test_request_reader_uses_real_pipe_and_has_deadline(self):
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, REQUEST); os.close(write_fd); write_fd = None
            self.assertEqual(RECEIVE.read_request(read_fd), REQUEST)
            with mock.patch.object(RECEIVE, "INPUT_TIMEOUT", 0), self.assertRaisesRegex(RECEIVE.ReceiveError, "REQUEST_TIMEOUT"):
                RECEIVE.read_request(read_fd)
        finally:
            os.close(read_fd)
            if write_fd is not None: os.close(write_fd)

    def test_request_reader_stops_at_byte_limit_before_parsing(self):
        selector = mock.MagicMock()
        selector.__enter__.return_value = selector
        selector.select.return_value = [(None, None)]
        with mock.patch.object(RECEIVE.selectors, "DefaultSelector", return_value=selector), mock.patch.object(RECEIVE.os, "read", side_effect=[b"x" * 8192] * 8 + [b"x"]) as reader, self.assertRaisesRegex(RECEIVE.ReceiveError, "REQUEST_TOO_LARGE"):
            RECEIVE.read_request(123)
        self.assertEqual(reader.call_count, 9)

    def test_private_config_and_all_root_ancestors_are_required(self):
        with self.root_metadata():
            config, account = RECEIVE.load_config(self.config_path)
            self.assertEqual(config["runner"], self.runner)
            self.assertEqual(account.pw_uid, self.account.pw_uid)
        for owners, modes in (({self.runner: 1000}, {}), ({self.root: 1000}, {}), ({}, {self.root: 0o777}), ({}, {self.config_path: 0o644})):
            with self.root_metadata(owners=owners, modes=modes), self.assertRaises(RECEIVE.ReceiveError):
                RECEIVE.load_config(self.config_path)
        for key, value in (("branch", "main"), ("schemaVersion", True), ("repositoryUser", "root; command"), ("unknown", True)):
            previous = dict(self.config)
            self.config[key] = value; self.write_config()
            with self.root_metadata(), self.assertRaises(RECEIVE.ReceiveError):
                RECEIVE.load_config(self.config_path)
            self.config = previous

    def test_duplicate_config_keys_symlinks_and_root_repository_account_are_rejected(self):
        self.config_path.write_text('{"schemaVersion":1,"schemaVersion":1}')
        with self.root_metadata(), self.assertRaises(RECEIVE.ReceiveError):
            RECEIVE.load_config(self.config_path)
        self.write_config()
        alias = self.root / "runner-alias"; alias.symlink_to(self.runner)
        self.config["runner"] = str(alias); self.write_config()
        with self.root_metadata(), self.assertRaises(RECEIVE.ReceiveError):
            RECEIVE.load_config(self.config_path)
        self.config["runner"] = str(self.runner); self.write_config()
        self.account.pw_uid = 0
        with self.root_metadata(), self.assertRaisesRegex(RECEIVE.ReceiveError, "INVALID_REPOSITORY_OWNER"):
            RECEIVE.load_config(self.config_path)

    def test_empty_manifest_directory_never_calls_git_or_runner(self):
        with self.root_metadata(), mock.patch.object(RECEIVE, "current_master") as current, mock.patch.object(RECEIVE, "run_step") as step:
            config, account = RECEIVE.load_config(self.config_path)
            with self.assertRaises(FileNotFoundError):
                RECEIVE.release(config, account, COMMIT, self.config_path)
            current.assert_not_called(); step.assert_not_called()
            self.assertEqual(list(self.manifests.iterdir()), [])

    def test_exact_commit_pipeline_and_current_ref_recheck_before_each_step(self):
        self.manifest()
        with self.root_metadata(), mock.patch.object(RECEIVE, "current_master", return_value=COMMIT) as current, mock.patch.object(RECEIVE, "run_step") as step:
            config, account = RECEIVE.load_config(self.config_path)
            RECEIVE.release(config, account, COMMIT, self.config_path)
            self.assertEqual([call.args[3] for call in step.call_args_list], ["prepare", "migrate", "deploy"])
            self.assertEqual(current.call_count, 3)
        with self.root_metadata(), mock.patch.object(RECEIVE, "current_master", side_effect=[COMMIT, "b" * 40]), mock.patch.object(RECEIVE, "run_step") as step:
            with self.assertRaisesRegex(RECEIVE.ReceiveError, "MASTER_CHANGED"):
                RECEIVE.release(config, account, COMMIT, self.config_path)
            self.assertEqual([call.args[3] for call in step.call_args_list], ["prepare"])

    def test_changed_runner_or_manifest_stops_before_further_steps(self):
        manifest = self.manifest()
        for changed in (self.runner, manifest):
            with self.subTest(path=changed.name), self.root_metadata(), mock.patch.object(RECEIVE, "current_master", return_value=COMMIT), mock.patch.object(RECEIVE, "run_step", side_effect=lambda *_: changed.write_text("changed")) as step:
                config, account = RECEIVE.load_config(self.config_path)
                with self.assertRaisesRegex(RECEIVE.ReceiveError, "RELEASE_INPUT_CHANGED"):
                    RECEIVE.release(config, account, COMMIT, self.config_path)
                self.assertEqual(step.call_count, 1)

    def test_pipeline_lock_rejects_parallel_invocations_and_symlink(self):
        with self.root_metadata(), RECEIVE.pipeline_lock(self.state), self.assertRaisesRegex(RECEIVE.ReceiveError, "ANOTHER_RELEASE_IS_RUNNING"):
            with RECEIVE.pipeline_lock(self.state): pass
        (self.state / ".receive.lock").unlink()
        (self.state / ".receive.lock").symlink_to(self.config_path)
        with self.root_metadata(), self.assertRaises(OSError):
            with RECEIVE.pipeline_lock(self.state): pass

    def test_git_read_runs_as_repository_owner_with_clean_environment(self):
        result = subprocess.CompletedProcess([], 0, (COMMIT + "\n").encode())
        with self.root_metadata(): config, account = RECEIVE.load_config(self.config_path)
        with mock.patch.object(RECEIVE.subprocess, "run", return_value=result) as execute:
            self.assertEqual(RECEIVE.current_master(config, account), COMMIT)
        args, options = execute.call_args
        self.assertEqual(args[0][0], "/usr/bin/git")
        self.assertEqual(args[0][-3:], ["rev-parse", "--verify", "refs/heads/master^{commit}"])
        self.assertEqual(options["user"], self.account.pw_uid)
        self.assertEqual(options["group"], self.account.pw_gid)
        self.assertEqual(options["extra_groups"], [])
        self.assertNotIn("GIT_DIR", options["env"])
        self.assertNotIn("DOCKER_HOST", options["env"])

    def test_runner_failure_and_timeout_are_not_success(self):
        with self.root_metadata(): config, _ = RECEIVE.load_config(self.config_path)
        process = mock.Mock(pid=1234)
        process.wait.return_value = 7
        with mock.patch.object(RECEIVE.subprocess, "Popen", return_value=process) as launch, self.assertRaisesRegex(RECEIVE.ReceiveError, "RELEASE_STEP_FAILED"):
            RECEIVE.run_step(config, self.manifests / (COMMIT + ".json"), COMMIT, "migrate")
        args, options = launch.call_args
        self.assertEqual(args[0][:3], ["/bin/bash", str(self.runner), "migrate"])
        self.assertEqual(options["env"], RECEIVE.CLEAN_ENV)
        self.assertTrue(options["start_new_session"])
        process.wait.side_effect = [subprocess.TimeoutExpired("fixture", 1), 0]
        with mock.patch.object(RECEIVE.subprocess, "Popen", return_value=process), mock.patch.object(RECEIVE.os, "killpg") as stop, self.assertRaisesRegex(RECEIVE.ReceiveError, "RELEASE_STEP_TIMEOUT"):
            RECEIVE.run_step(config, self.manifests / (COMMIT + ".json"), COMMIT, "migrate")
        stop.assert_called_once_with(1234, signal.SIGTERM)

    def test_noargs_root_boundary_and_failure_message(self):
        for uid, argv in ((1000, ["receive.py"]), (0, ["receive.py", "arbitrary-command"])):
            output = io.StringIO()
            with mock.patch.object(RECEIVE.os, "geteuid", return_value=uid), mock.patch.object(sys, "argv", argv), contextlib.redirect_stderr(output), mock.patch.object(RECEIVE, "read_request") as reader:
                self.assertEqual(RECEIVE.main(), 1)
            reader.assert_not_called()
            self.assertIn("Git accepted the update, but deployment is not confirmed", output.getvalue())
        result = subprocess.run(["/bin/sh", str(DIRECTORY / "dispatch"), "argument"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"does not accept arguments", result.stderr)


if __name__ == "__main__":
    unittest.main()

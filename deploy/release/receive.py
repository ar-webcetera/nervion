#!/usr/bin/env python3
"""Fixed root boundary for releasing one explicitly configured Git repository."""

import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import pwd
import re
import selectors
import signal
import stat
import subprocess
import sys
import time


CONFIG = pathlib.Path("/etc/nervion-release/hook.json")
CLEAN_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root", "LANG": "C"}
MAX_REQUEST = 65536
INPUT_TIMEOUT = 5
RUNNER_TIMEOUT = 3900


class ReceiveError(Exception):
    """Fixed public error codes only; no Git/config/secret output."""


def canonical(raw):
    if not isinstance(raw, str) or not raw.startswith("/") or raw == "/" or any(ord(c) < 32 for c in raw):
        raise ReceiveError("INVALID_PATH")
    path = pathlib.Path(raw)
    if str(path) != raw or path.resolve(strict=True) != path:
        raise ReceiveError("INVALID_PATH")
    return path


def trusted(path, *, directory=False, private=False):
    path = canonical(str(path))
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise ReceiveError("UNTRUSTED_RELEASE_INPUT")
    if info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022) or (not directory and info.st_nlink != 1):
        raise ReceiveError("UNTRUSTED_RELEASE_INPUT")
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ReceiveError("UNTRUSTED_RELEASE_PARENT")
    return path


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ReceiveError("INVALID_CONFIG")
        value[key] = item
    return value


def load_config(path=CONFIG):
    trusted(path, private=True)
    if path.stat().st_size > 8192:
        raise ReceiveError("INVALID_CONFIG")
    value = json.loads(path.read_bytes(), object_pairs_hook=unique_object)
    keys = {"schemaVersion", "branch", "project", "runner", "manifestDirectory", "stateDirectory", "repository", "repositoryUser"}
    if not isinstance(value, dict) or set(value) != keys or type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or value["branch"] != "master":
        raise ReceiveError("INVALID_CONFIG")
    if not isinstance(value["project"], str) or not re.fullmatch(r"[a-z][a-z0-9_-]{2,62}", value["project"]):
        raise ReceiveError("INVALID_CONFIG")
    if not isinstance(value["repositoryUser"], str) or not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", value["repositoryUser"]):
        raise ReceiveError("INVALID_CONFIG")
    value["runner"] = trusted(value["runner"])
    for name in ("manifestDirectory", "stateDirectory"):
        value[name] = trusted(value[name], directory=True, private=True)
    value["repository"] = canonical(value["repository"])
    account = pwd.getpwnam(value["repositoryUser"])
    if account.pw_uid == 0 or not value["repository"].is_dir() or value["repository"].stat().st_uid != account.pw_uid:
        raise ReceiveError("INVALID_REPOSITORY_OWNER")
    return value, account


def read_request(fd):
    deadline = time.monotonic() + INPUT_TIMEOUT
    result = bytearray()
    with selectors.DefaultSelector() as selector:
        selector.register(fd, selectors.EVENT_READ)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise ReceiveError("REQUEST_TIMEOUT")
            part = os.read(fd, min(8192, MAX_REQUEST + 1 - len(result)))
            if not part:
                return bytes(result)
            result.extend(part)
            if len(result) > MAX_REQUEST:
                raise ReceiveError("REQUEST_TOO_LARGE")


def parse_request(data):
    if len(data) > MAX_REQUEST or (data and not data.endswith(b"\n")):
        raise ReceiveError("INVALID_REQUEST")
    lines = data.split(b"\n")[:-1]
    if len(lines) > 256:
        raise ReceiveError("INVALID_REQUEST")
    selected = None
    for line in lines:
        match = re.fullmatch(rb"([0-9a-f]{40}) ([0-9a-f]{40}) (refs/[A-Za-z0-9_./-]{1,512})", line)
        if not match:
            raise ReceiveError("INVALID_REQUEST")
        if match[3] != b"refs/heads/master":
            continue
        if selected is not None or match[2] == b"0" * 40:
            raise ReceiveError("INVALID_MASTER_UPDATE")
        selected = match[2].decode("ascii")
    return selected


def current_master(config, account):
    # Git reads its own unprivileged repository as that owner, never as root.
    env = {**CLEAN_ENV, "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"}
    result = subprocess.run(
        ["/usr/bin/git", "--no-pager", "-c", f"safe.directory={config['repository']}", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
         "--git-dir", str(config["repository"]), "rev-parse", "--verify", "refs/heads/master^{commit}"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, timeout=5,
        user=account.pw_uid, group=account.pw_gid, extra_groups=[], check=False,
    )
    if result.returncode or not re.fullmatch(rb"[0-9a-f]{40}\n", result.stdout):
        raise ReceiveError("MASTER_LOOKUP_FAILED")
    return result.stdout.decode("ascii").strip()


@contextlib.contextmanager
def pipeline_lock(state):
    fd = os.open(state / ".receive.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ReceiveError("INVALID_PIPELINE_LOCK")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReceiveError("ANOTHER_RELEASE_IS_RUNNING") from error
        yield
    finally:
        os.close(fd)


def digest(path):
    trusted(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_step(config, manifest, commit, action):
    process = subprocess.Popen(
        ["/bin/bash", str(config["runner"]), action, "--manifest", str(manifest), "--state-dir", str(config["stateDirectory"]),
         "--project", config["project"], "--expected-commit", commit],
        stdin=subprocess.DEVNULL, env=CLEAN_ENV, start_new_session=True,
    )
    try:
        status = process.wait(timeout=RUNNER_TIMEOUT)
    except subprocess.TimeoutExpired as error:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=40)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise ReceiveError("RELEASE_STEP_TIMEOUT") from error
    if status:
        raise ReceiveError("RELEASE_STEP_FAILED")


def release(config, account, commit, config_path=CONFIG):
    if commit is None:
        return
    manifest = trusted(config["manifestDirectory"] / (commit + ".json"), private=True)
    if manifest.stat().st_size > 65536:
        raise ReceiveError("INVALID_MANIFEST")
    inputs = {path: digest(path) for path in (config_path, config["runner"], manifest)}
    with pipeline_lock(config["stateDirectory"]):
        for action in ("prepare", "migrate", "deploy"):
            if current_master(config, account) != commit:
                raise ReceiveError("MASTER_CHANGED")
            if any(digest(path) != value for path, value in inputs.items()):
                raise ReceiveError("RELEASE_INPUT_CHANGED")
            run_step(config, manifest, commit, action)


def main():
    commit = None
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise ReceiveError("ROOT_NO_ARGUMENTS_REQUIRED")
        os.umask(0o077)
        request = read_request(sys.stdin.fileno())
        commit = parse_request(request)
        config, account = load_config()
        release(config, account, commit)
        if commit:
            print(f"Commit {commit} was deployed and passed health checks.")
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, ReceiveError) else "DEPLOYMENT_NOT_PREPARED"
        print(f"Git accepted the update, but deployment is not confirmed: {code}. No Git ref rollback was attempted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

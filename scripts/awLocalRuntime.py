"""Explicit user-local Ollama setup. No sudo, shell installer or public listener."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time
import urllib.request

ENDPOINT = "http://127.0.0.1:11436"


def local_json(route, body=None, timeout=3):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(ENDPOINT + route, data=data, headers={"Content-Type": "application/json"})
    # Never send loopback requests through an inherited HTTP proxy.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=timeout) as response:
        return json.load(response)


def root_path(value):
    candidate = Path(value).expanduser().absolute()
    home = Path.home().resolve()
    if any(p.is_symlink() for p in [candidate, *candidate.parents] if p != home and p.is_relative_to(home)):
        raise ValueError("Use an unlinked dedicated user-local installation")
    root = candidate.resolve()
    if not root.is_relative_to(home) or root == home:
        raise ValueError("Choose a dedicated directory below your home")
    return root


def install(root, version, checksum):
    if not re.fullmatch(r"v\d+\.\d+\.\d+", version or "") or not re.fullmatch(r"[a-f0-9]{64}", checksum or ""):
        raise ValueError("Supply exact --version and published --sha256")
    root.mkdir(parents=True, exist_ok=False)
    archive = root / "runtime.tar.zst"
    url = f"https://github.com/ollama/ollama/releases/download/{version}/ollama-linux-amd64.tar.zst"
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=60) as source, archive.open("xb") as target:
        while chunk := source.read(1024 * 1024):
            target.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != checksum:
        raise ValueError("Runtime checksum mismatch; archive retained, nothing extracted")
    # Stream decompression: no multi-GB uncompressed temporary archive.
    proc = subprocess.Popen(["zstd", "-dc", str(archive)], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
            for member in tar:
                # tarfile's data filter checks traversal, external links and devices.
                tar.extract(member, path=root, filter="data")
        if proc.wait() != 0:
            raise ValueError("Decompression failed; partial installation retained")
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait()
    executable = root / "bin/ollama"
    if not executable.is_file():
        raise ValueError("Missing runtime executable")
    receipt = {"version": version, "sha256": checksum, "url": url, "endpoint": ENDPOINT,
               "models": str(root / "models"), "sudo": False}
    (root / "installation.json").write_text(json.dumps(receipt, indent=2) + "\n")
    archive.unlink()  # Exact verified installer archive only; installed runtime remains.
    return receipt


def _start(root):
    receipt = json.loads((root / "installation.json").read_text())
    if receipt["endpoint"] != ENDPOINT:
        raise ValueError("Wrong runtime endpoint")
    pid_file = root / "server.json"
    try:
        local_json("/api/version")
    except OSError:
        pass
    else:
        if not pid_file.is_file():
            raise ValueError("Port is occupied by an unowned runtime; leave it untouched")
        saved = json.loads(pid_file.read_text())
        pid = saved.get("pid")
        if not isinstance(pid, int) or pid < 2:
            raise ValueError("Invalid saved runtime process; inspect before recovery")
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        if not cmdline or cmdline[0].decode() != str(root / "bin/ollama") or b"serve" not in cmdline:
            raise ValueError("Port/process ownership changed; leave the runtime untouched")
        return {"status": "running", "endpoint": ENDPOINT}
    env = {**os.environ, "OLLAMA_HOST": "127.0.0.1:11436", "OLLAMA_MODELS": str(root / "models"),
           "OLLAMA_NO_CLOUD": "1", "OLLAMA_NUM_PARALLEL": "1", "OLLAMA_MAX_LOADED_MODELS": "1",
           "OLLAMA_CONTEXT_LENGTH": "8192", "OLLAMA_KEEP_ALIVE": "0", "OLLAMA_MAX_QUEUE": "1"}
    with (root / "server.log").open("ab") as log:
        proc = subprocess.Popen([str(root / "bin/ollama"), "serve"], env=env, cwd=root,
                                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    pid_file.write_text(json.dumps({"pid": proc.pid, "endpoint": ENDPOINT}) + "\n")
    for _ in range(40):
        if proc.poll() is not None:
            raise ValueError("Runtime stopped: inspect its server.log; no repeated restart")
        try:
            local_json("/api/version")
            return {"status": "started", "endpoint": ENDPOINT}
        except OSError:
            time.sleep(0.25)
    raise ValueError("Runtime did not become ready; inspect server.log before retry")


def start(root):
    lock = root / "start.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError("Runtime startup busy/interrupted; inspect start.lock, never loop") from None
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return _start(root)
    finally:
        lock.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["install", "start", "status", "pull", "unload"])
    parser.add_argument("--installation", required=True)
    parser.add_argument("--version")
    parser.add_argument("--sha256")
    parser.add_argument("--model", default="qwen3:8b")
    args = parser.parse_args()
    root = root_path(args.installation)
    if args.command == "install":
        result = install(root, args.version, args.sha256)
    elif args.command == "start":
        result = start(root)
    elif args.command == "pull":
        if args.model != "qwen3:8b":
            raise ValueError("Only the explicitly scoped qwen3:8b download is enabled")
        result = local_json("/api/pull", {"model": args.model, "stream": False}, timeout=1800)
    elif args.command == "unload":
        result = local_json("/api/generate", {"model": args.model, "keep_alive": 0}, timeout=30)
    else:
        result = {"runtime": local_json("/api/version"), "installed": local_json("/api/tags"), "loaded": local_json("/api/ps")}
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)

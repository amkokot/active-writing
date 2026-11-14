"""Explicit, user-local Linux setup. Does not copy credentials or launch agents.

Run only with the host owner's installation permission. Node archives are checked
against the official release checksum. Existing tools/directories are preserved.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import urllib.request


def installation_root(requested, home=None):
    home = (home or Path.home()).resolve()
    requested = requested.expanduser().absolute()
    if any(part.is_symlink() for part in [requested, *requested.parents] if part != home and part.is_relative_to(home)):
        raise ValueError("Do not install through a linked root")
    root = requested.resolve()
    if not root.is_relative_to(home) or root == home:
        raise ValueError("Choose a dedicated user-local subdirectory, not the home root")
    return root


def valid_archive_layout(members, folder):
    return all(
        (item.name == folder and item.isdir()) or
        (item.name.startswith(folder + "/") and ".." not in Path(item.name).parts)
        for item in members
    )


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def install(root, node_version, codex_version, requirements):
    os.umask(0o077)
    root = installation_root(root)
    root.mkdir(parents=True, exist_ok=True)
    cache = root / "downloads"
    cache.mkdir(exist_ok=True)
    if not re.fullmatch(r"v24\.\d+\.\d+", node_version):
        raise ValueError("Choose an exact Node 24 release")
    filename = f"node-{node_version}-linux-x64.tar.xz"
    sums = fetch(f"https://nodejs.org/dist/{node_version}/SHASUMS256.txt").decode()
    checksum = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == filename)
    archive = cache / filename
    if not archive.exists():
        data = fetch(f"https://nodejs.org/dist/{node_version}/{filename}")
        if hashlib.sha256(data).hexdigest() != checksum:
            raise ValueError("Node archive checksum mismatch; nothing extracted")
        with archive.open("xb") as handle:
            handle.write(data)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != checksum:
        raise ValueError("Existing Node download changed; preserved for inspection")
    runtime = root / "runtime"
    runtime.mkdir(exist_ok=True)
    node_folder = runtime / filename.removesuffix(".tar.xz")
    if not node_folder.exists():
        with tarfile.open(archive) as package:
            if not valid_archive_layout(package.getmembers(), node_folder.name):
                raise ValueError("Unexpected Node archive layout")
            package.extractall(runtime, filter="data")
    node = node_folder / "bin/node"
    actual_node = subprocess.check_output([str(node), "--version"], text=True).strip()
    if actual_node != node_version:
        raise ValueError("Installed Node version differs from requested release")
    env = dict(os.environ, PATH=str(node_folder / "bin") + os.pathsep + os.environ["PATH"])
    npm = node_folder / "bin/npm"
    codex = root / "codex/node_modules/.bin/codex"
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[\w.]+)?", codex_version):
        raise ValueError("Choose an exact official @openai/codex package version")
    if not codex.exists():
        subprocess.run([str(npm), "install", "--prefix", str(root / "codex"), "--no-audit", "--no-fund", f"@openai/codex@{codex_version}"], env=env, check=True, timeout=300)
    actual_codex = subprocess.check_output([str(codex), "--version"], env=env, text=True).strip()
    if actual_codex.split()[-1] != codex_version:
        raise ValueError("Existing Codex version differs; do not replace it silently")
    venv = root / "python"
    if not venv.exists():
        subprocess.run(["python3", "-m", "venv", str(venv)], check=True, timeout=90)
    python = venv / "bin/python"
    if requirements:
        subprocess.run([str(python), "-m", "pip", "install", "--only-binary=:all:", "--disable-pip-version-check", "-r", str(requirements)], check=True, timeout=600)
    bindir = Path.home() / ".local/bin"
    bindir.mkdir(parents=True, exist_ok=True)
    for name, target in {"node": node, "npm": npm, "npx": node_folder / "bin/npx", "codex": codex}.items():
        link = bindir / name
        if link.is_symlink() and link.resolve() == target.resolve():
            continue
        if link.exists() or link.is_symlink():
            raise ValueError(f"Existing tool preserved; choose how to expose {name} separately")
        link.symlink_to(target)
    receipt = dict(root=str(root), node=actual_node, node_sha256=checksum, codex=actual_codex, python=str(python), installed_packages=subprocess.check_output([str(python), "-m", "pip", "freeze"], text=True).splitlines(), credentials_copied=False, agent_started=False)
    with (root / "installation.json").open("w") as handle:
        json.dump(receipt, handle, indent=2)
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--node-version", required=True)
    parser.add_argument("--codex-version", required=True)
    parser.add_argument("--requirements", type=Path)
    args = parser.parse_args()
    install(args.root, args.node_version, args.codex_version, args.requirements)

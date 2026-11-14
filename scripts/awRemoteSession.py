"""Persistent, private tmux control for an explicitly configured Linux desktop.

The desktop owns Codex; SSH is only an attachable terminal. No public listener,
credentials transfer, model prompt, automatic experiment or elevated OS changes.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess


def checked_home_path(value):
    requested = value.expanduser().absolute()
    home = Path.home().resolve()
    if not requested.resolve().is_relative_to(home) or requested.resolve() == home:
        raise ValueError("Choose a dedicated directory inside this user's home")
    if any(p.is_symlink() for p in [requested, *requested.parents] if p.is_relative_to(home)):
        raise ValueError("Linked workspace/install directories are not supported")
    return requested.resolve()


def host_environment(root):
    env = dict(os.environ)
    env.update(PATH=str(Path.home() / '.local/bin') + os.pathsep + env['PATH'],
               PAPERFOCUS_PYTHON=str(root / 'python/bin/python'),
               OPENBLAS_NUM_THREADS='2', OMP_NUM_THREADS='2', MKL_NUM_THREADS='2')
    return env


def prepare_shell(root):
    """Explicit setup only. Preserve all existing startup content."""
    env_file = root / 'host-env.sh'
    content = '# Active Writing desktop tools; no credentials.\n'
    content += 'export PATH=' + shlex.quote(str(Path.home() / '.local/bin')) + ':"$PATH"\n'
    content += 'export PAPERFOCUS_PYTHON=' + shlex.quote(str(root / 'python/bin/python')) + '\n'
    if env_file.exists():
        if env_file.is_symlink() or env_file.read_text() != content:
            raise ValueError("Existing host environment differs; preserved")
    else:
        with env_file.open('x') as handle:
            handle.write(content)
        env_file.chmod(0o600)
    line = '. ' + shlex.quote(str(env_file)) + ' # Active Writing desktop tools\n'
    changed = []
    # Bash reads .bashrc for noninteractive SSH; .profile covers login shells.
    for name in ['.bashrc', '.profile']:
        target = Path.home() / name
        if target.is_symlink():
            raise ValueError('Linked shell startup file preserved: ' + name)
        previous = target.read_text() if target.exists() else ''
        if line.strip() in previous:
            continue
        if 'Active Writing desktop tools' in previous:
            raise ValueError('Another Aw shell setup exists; inspect it first')
        # Put PATH before conventional noninteractive early returns.
        with target.open('w' if target.exists() else 'x') as handle:
            handle.write(line + previous)
        target.chmod(0o600)
        changed.append(name)
    return dict(changed=changed, environment=str(env_file), credentials_copied=False)


def tmux(args, **options):
    return subprocess.run(['tmux', '-L', 'active-writing', *args], **options)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare-shell', 'start', 'attach', 'status'])
    parser.add_argument('--installation', type=Path, required=True)
    parser.add_argument('--workspace', type=Path)
    parser.add_argument('--name', default='aw-research')
    args = parser.parse_args()
    root = checked_home_path(args.installation)
    if not (root / 'installation.json').is_file():
        raise ValueError('Finish the user-local installer first')
    if not re.fullmatch(r'aw-[a-z0-9][a-z0-9-]{0,47}', args.name):
        raise ValueError('Use a simple aw- session name')
    if args.command == 'prepare-shell':
        print(json.dumps(prepare_shell(root)))
    elif args.command == 'status':
        result = tmux(['list-sessions', '-F', '#{session_name}: #{session_windows} windows, #{session_attached} attached'], capture_output=True, text=True)
        print(json.dumps(dict(sessions=result.stdout.splitlines(), running=result.returncode == 0)))
    elif args.command == 'attach':
        if not os.isatty(0):
            raise ValueError('Attach from an interactive terminal: ssh -t HOST ...')
        # No -d: never evict another attached viewer/controller.
        raise SystemExit(tmux(['attach-session', '-t', args.name]).returncode)
    else:
        if not args.workspace:
            raise ValueError('Specify the confirmed desktop data home')
        workspace = checked_home_path(args.workspace)
        if not (workspace / 'AGENTS.md').is_file() or not (workspace / '.paperfocus/projects.json').is_file():
            raise ValueError('Choose a prepared Aw data home, not an unrelated directory')
        exists = tmux(['has-session', '-t', args.name], capture_output=True).returncode == 0
        if not exists:
            env = host_environment(root)
            tmux(['new-session', '-d', '-s', args.name, '-c', str(workspace),
                  'env', *[k + '=' + env[k] for k in ['PATH', 'PAPERFOCUS_PYTHON', 'OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS']],
                  str(Path.home() / '.local/bin/codex'), '-C', str(workspace)], check=True)
            tmux(['set-option', '-t', args.name, 'history-limit', '50000'], check=True)
        print(json.dumps(dict(session=args.name, already_running=exists, workspace=str(workspace),
                              started_prompt=False, persistent_until='desktop shutdown, explicit exit or administrator policy')))


if __name__ == '__main__':
    main()

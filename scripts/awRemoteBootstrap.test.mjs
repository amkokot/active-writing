import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("remote installer permits the official top-level directory and rejects unsafe layouts", () => {
  const code = `
import importlib.util, pathlib, tarfile, tempfile
spec = importlib.util.spec_from_file_location('bootstrap', 'scripts/awRemoteBootstrap.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
folder = 'node-v24.22.1-linux-x64'
directory = tarfile.TarInfo(folder)
directory.type = tarfile.DIRTYPE
file = tarfile.TarInfo(folder + '/bin/node')
assert module.valid_archive_layout([directory, file], folder)
assert not module.valid_archive_layout([tarfile.TarInfo(folder)], folder)
assert not module.valid_archive_layout([tarfile.TarInfo('../escape')], folder)
assert not module.valid_archive_layout([tarfile.TarInfo(folder + '/../escape')], folder)
assert not module.valid_archive_layout([tarfile.TarInfo('other/file')], folder)
with tempfile.TemporaryDirectory() as temp:
    home = pathlib.Path(temp).resolve()
    assert module.installation_root(home / 'aw', home) == home / 'aw'
    for bad in [home, home.parent / 'elsewhere']:
        try: module.installation_root(bad, home)
        except ValueError: pass
        else: raise AssertionError('unsafe root accepted')
print('ok')
`;
  const python = process.env.PAPERFOCUS_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, ["-B", "-c", code], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /ok/);
});

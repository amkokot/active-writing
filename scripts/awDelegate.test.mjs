import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

test("bounded local delegation: cache, scope, concurrency, caps, malformed replies and no cloud", () => {
  const python = process.env.PAPERFOCUS_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, ["-B", "scripts/awDelegateChecks.py"], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stderr, /Ran 7 tests/);
});

test("delegation help works without server, model or configured credentials", () => {
  const result = spawnSync(process.execPath, ["scripts/awDelegate.ts", "--help"], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ownership|Ownership/);
  assert.match(result.stdout, /no server/);
});

test("guidance makes useful delegation conditional and preserves compute scope", async () => {
  const guide = await readFile("docs/DESKTOP_ASSISTANCE.md", "utf8");
  assert.match(guide, /do not delegate/i);
  assert.match(guide, /Triton remains\s+disabled/);
  assert.match(guide, /permission/);
  assert.match(guide, /300/);
  assert.match(await readFile("AGENTS.md", "utf8"), /DESKTOP_ASSISTANCE/);
});

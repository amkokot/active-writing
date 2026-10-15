import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { appName, appInitials, appDescription } from "../src/brand.ts";
import { routeLabels, effortLabels } from "../src/rewrite.ts";
import { thinkingLevels } from "../src/workspaceTools.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { validateWorkbench } from "./workbenchStore.ts";

const source = (file: string) => readFile(file, "utf8");

test("browser tabs use the small self-contained Aw mark", async () => {
  const [html, icon] = await Promise.all([source("index.html"), source("public/aw-icon.svg")]);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" sizes="any" href="\/aw-icon.svg"/);
  assert.match(icon, /viewBox="0 0 32 32"/);
  assert.match(icon, />Aw<\/text>/);
  assert.doesNotMatch(icon, /<script|<image|href=|url\(/i);
});

test("Active Writing is consistent in the app, page metadata and package metadata", async () => {
  assert.equal(appName, "Active Writing");
  assert.equal(appInitials, "Aw");
  const [html, app, pkg, lock] = await Promise.all([source("index.html"), source("src/App.tsx"), source("package.json"), source("package-lock.json")]);
  assert.ok(html.includes(`<title>${appName}</title>`));
  assert.ok(html.includes(appDescription));
  assert.ok(app.includes("{appName}") && app.includes("{appInitials}"));
  assert.equal(JSON.parse(pkg).name, "active-writing");
  assert.equal(JSON.parse(lock).name, "active-writing");
  assert.equal(JSON.parse(lock).packages[""].name, "active-writing");
  for (const file of (await readdir("src/components")).filter(file => file.endsWith(".tsx"))) {
    assert.doesNotMatch(await source(`src/components/${file}`), /Paper ?Focus/, `old visible brand in ${file}`);
  }
});

test("plain assistance labels retain the same destinations and all effort levels", () => {
  assert.deepEqual(routeLabels, { rules: "Quick suggestions", local: "On this computer", codex: "Shared folder", chatgpt: "Copy to chat" });
  assert.deepEqual(effortLabels.rules, ["Basic", "Full"]);
  assert.deepEqual(effortLabels.local, ["Tiny", "Light", "Balanced", "Thorough"]);
  assert.deepEqual(thinkingLevels, ["Quick", "Light", "Medium", "High", "Maximum"]);
  assert.deepEqual(effortLabels.chatgpt, thinkingLevels);
  assert.deepEqual(effortLabels.codex, thinkingLevels);
});

test("the rename leaves stored text, task formats and installed-model locations compatible", async () => {
  const data = emptyWorkbench();
  data.attentionTasks.push({ id: "legacy-task", title: "PaperFocus notes", nodeId: "intro", route: "codex", status: "ready", packet: "# Paper Focus · original request", reply: "Original $$x^2$$ reply", createdAt: "now", updatedAt: "now" });
  const restored = structuredClone(data);
  validateWorkbench(restored);
  assert.deepEqual(restored, data);
  assert.match(await source("src/state.ts"), /paperfocus\.prototype\.v1/);
  assert.match(await source("server/localModels.ts"), /process\.env\.LOCALAPPDATA, "PaperFocus", "Ollama"/);
  assert.match(await source("server/experiment_runner.py"), /application\/vnd\.paperfocus\.plot\+json/);
  assert.match(await source("src/handoffs.ts"), /\/api\/paperfocus\/handoff/);
});

test("shorter interface copy keeps execution, review and manual-sharing boundaries visible", async () => {
  const [experiments, study, reply, repo, prompts] = await Promise.all([source("src/components/ExperimentWorkspace.tsx"), source("src/components/StudyWorkspace.tsx"), source("src/components/HandoffReply.tsx"), source("src/components/RepositoryPanel.tsx"), source("src/components/AgentHandoff.tsx")]);
  assert.match(experiments, /normal file and network access; it isn't sandboxed/);
  assert.match(study, /Longer replies aren't necessarily more accurate/);
  assert.match(reply, /doesn't mark the mathematics correct/);
  assert.match(reply, /Done without saving reply/);
  assert.match(repo, /Save, compile & push/);
  assert.doesNotMatch(repo, /Save, verify & push/);
  assert.match(prompts, /nothing is sent automatically/);
  assert.match(prompts, /\.paperfocus\//);
});

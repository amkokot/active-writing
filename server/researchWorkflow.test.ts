import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { experimentRuntime } from "./experiments.ts";
import { validateExperimentNotebook, experimentContext } from "../src/experiments.ts";
import { parseStudyAnswer } from "../src/study.ts";

const guide = await readFile(path.resolve("docs/RESEARCH_WORKFLOW.md"), "utf8");
test("file-only research is not gated on starting or visiting Aw", async () => {
  const agent = await readFile(path.resolve("docs/AGENT_GUIDE.md"), "utf8");
  assert.match(guide, /Agents work in Aw without opening its UI/);
  assert.match(agent, /Aw remains the working harness/);
  assert.match(agent, /Do not skip notebook storage or task completion/);
  assert.match(guide, /human setup for an interactive Aw session, not an agent checklist/);
  assert.match(agent, /Do not open Aw, test its server, start a launcher/);
  assert.match(agent, /Creating a file does not switch the project-wide main file/);
  assert.match(agent, /One connection failure is enough/);
  assert.match(agent, /state clearly that import\/finish is pending/);
  assert.match(agent, /existing publication text, locks and saved writing rounds still require/);
  const setup = agent.slice(agent.indexOf("### When notebook or saved-task access"), agent.indexOf("The research lab record"));
  assert.doesNotMatch(setup, /Invoke-RestMethod/);
});
function example(name: string, language: string) {
  const start = guide.indexOf(`<!-- aw-example: ${name} -->`);
  assert.ok(start >= 0, `Missing ${name} example`);
  const match = guide.slice(start).match(new RegExp("```" + language + "\\r?\\n([\\s\\S]*?)\\r?\\n```"));
  assert.ok(match, `Missing ${language} fence for ${name}`);
  return match[1];
}

test("documented notebook example passes the actual validator without claiming a run", () => {
  const notebook = JSON.parse(example("minimal-notebook", "json"));
  validateExperimentNotebook(notebook);
  assert.equal(notebook.cells[1].execution_count, null);
  assert.deepEqual(notebook.cells[1].outputs, []);
  assert.match(experimentContext(notebook, "workflow-demo"), /unrun \/ imported output/);
});

test("documented research answer and envelope have compatible return shapes", () => {
  const answer = JSON.parse(example("study-answer", "json"));
  assert.ok(parseStudyAnswer(JSON.stringify(answer)));
  const envelope = JSON.parse(example("response-envelope", "json"));
  assert.equal(envelope.version, 1);
  assert.equal(envelope.complete, true);
  assert.equal(typeof envelope.reply, "string");
  envelope.reply = JSON.stringify(answer);
  assert.deepEqual(parseStudyAnswer(envelope.reply), answer);
});

test("documented deterministic experiment runs through the real display runner", async () => {
  const source = example("affine-control", "python");
  const runtime = await experimentRuntime();
  const result = spawnSync(runtime.executable, ["-I", path.resolve("server/experiment_runner.py")], {
    input: JSON.stringify({ source }), encoding: "utf8", timeout: 10_000, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.error, null);
  const table = record.outputs.find((output: any) => output.data?.["application/json"]);
  const plot = record.outputs.find((output: any) => output.data?.["application/vnd.paperfocus.plot+json"]);
  assert.equal(table.data["application/json"].length, 3);
  assert.equal(plot.data["application/vnd.paperfocus.plot+json"].series.length, 3);
  const notebook = JSON.parse(example("minimal-notebook", "json"));
  notebook.cells[1].source = source;
  notebook.cells[1].outputs = record.outputs;
  validateExperimentNotebook(notebook);
  assert.ok(record.outputs.some((output: any) => /controls passed/.test(output.text ?? "")));
});

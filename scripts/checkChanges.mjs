import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import { checkPlan, testFiles } from "./checkPlan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), areas = [], changed = [];
let full = false, planOnly = false, build = false, styleOnly = false;
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag === "--area" || flag === "--changed") {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    (flag === "--area" ? areas : changed).push(value);
  } else if (flag === "--full") full = true;
  else if (flag === "--plan") planOnly = true;
  else if (flag === "--build") build = true;
  else if (flag === "--style-only") styleOnly = true;
  else throw new Error(`Unknown option: ${flag}`);
}
const scripts = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).scripts;
const statePath = path.join(root, ".paperfocus", "checks", "rotation.json");
let cursor = 0;
try { cursor = JSON.parse(await readFile(statePath, "utf8")).cursor; } catch { /* First run or missing cache. */ }
const plan = checkPlan({ areas, full, cursor, changed, tests: testFiles(scripts) });
if (styleOnly && (plan.broad || areas.some(area => area !== "ui") || changed.some(file => !/\.css$|\.md$/.test(file)))) throw new Error("--style-only is for CSS/text-only UI changes, not code or broad checks.");
console.log(`${plan.broad ? "Full checkpoint" : `Focused checks (${areas.join(", ")})`}: ${plan.targeted.length} test files${plan.sampled.length ? ` + ${plan.sampled.length} rotating regression samples` : ""}.`);
console.log(plan.files.join("\n"));
console.log(build ? "Typecheck and production build." : styleOnly ? "No typecheck (CSS/text only)." : "Typecheck; no production build.");
if (planOnly) process.exit(0);

async function run(executable, arguments_) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject); child.once("close", resolve);
  });
  if (code !== 0) throw new Error(`Check failed (exit ${code}): ${path.basename(executable)} ${arguments_.join(" ")}`);
}
// Keep the complete test selection without spawning a worker per CPU core on
// a laptop. The host may explicitly choose 1–8 workers; no tests are sampled out.
const testConcurrency = Number(process.env.AW_CHECK_CONCURRENCY ?? 4);
if (!Number.isInteger(testConcurrency) || testConcurrency < 1 || testConcurrency > 8) throw new Error("AW_CHECK_CONCURRENCY must be an integer from 1 to 8.");
await run(process.execPath, ["--test", `--test-concurrency=${testConcurrency}`, ...plan.files]);
if (!styleOnly) await run(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-b", "--pretty", "false"]);
if (build) await run(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build"]);
// Advance only after success. A cache error must not invalidate passing tests.
if (!plan.broad) {
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ cursor: plan.nextCursor }) + "\n");
    await rename(temporary, statePath);
  } catch (error) { console.warn(`Checks passed; sample rotation was not saved: ${error.message}`); }
}
console.log(`Passed: ${plan.broad ? "full checkpoint" : "targeted checks and sampled regressions"}${build ? ", production build" : ""}.`);

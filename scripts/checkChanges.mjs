import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import { checkPlan, testFiles } from "./checkPlan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), areas = [], changed = [], only = [];
let full = false, planOnly = false, build = false, styleOnly = false, sample = false, match;
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag === "--area" || flag === "--changed" || flag === "--test" || flag === "--match") {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    if (flag === "--match") { if (match !== undefined) throw new Error("Repeat --test, not --match."); new RegExp(value); match = value; }
    else (flag === "--area" ? areas : flag === "--test" ? only : changed).push(value);
  } else if (flag === "--full") full = true;
  else if (flag === "--plan") planOnly = true;
  else if (flag === "--build") build = true;
  else if (flag === "--style-only") styleOnly = true;
  else if (flag === "--sample") sample = true;
  else throw new Error(`Unknown option: ${flag}`);
}
const scripts = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).scripts;
const statePath = path.join(root, ".paperfocus", "checks", "rotation.json");
let cursor = 0;
try { cursor = JSON.parse(await readFile(statePath, "utf8")).cursor; } catch { /* First run or missing cache. */ }
if (full && match) throw new Error("--full must not filter test names.");
if (sample && match) throw new Error("Run optional regression samples without --match so their tests are not silently filtered out.");
const plan = checkPlan({ areas, full, cursor, changed, only, sample, tests: testFiles(scripts) });
if (styleOnly && (plan.broad || areas.some(area => area !== "ui") || changed.some(file => !/\.css$|\.md$/.test(file)))) throw new Error("--style-only is for CSS/text-only UI changes, not code or broad checks.");
console.log(`${plan.broad ? "Full checkpoint" : `Focused checks${areas.length ? ` (${areas.join(", ")})` : ""}`}: ${plan.targeted.length} test files${plan.sampled.length ? ` + ${plan.sampled.length} rotating regression samples` : ""}.`);
console.log(plan.files.join("\n"));
if (match) console.log(`Test names: ${match}`);
console.log(build ? "Typecheck and production build." : styleOnly ? "No typecheck (CSS/text only)." : "Typecheck; no production build.");
if (planOnly) process.exit(0);

async function run(executable, arguments_, requireTests = false) {
  let tail = "";
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd: root, stdio: requireTests ? ["ignore","pipe","pipe"] : "inherit", windowsHide: true });
    if (requireTests) for (const [stream, output] of [[child.stdout,process.stdout],[child.stderr,process.stderr]]) stream.on("data",bytes=>{output.write(bytes);tail=(tail+bytes.toString()).slice(-8192);});
    child.once("error", reject); child.once("close", resolve);
  });
  if (code !== 0) throw new Error(`Check failed (exit ${code}): ${path.basename(executable)} ${arguments_.join(" ")}`);
  if (requireTests) {
    // Node counts an otherwise empty file as a passing wrapper when a name
    // filter selects none of its tests. Do not mistake that for verification.
    const wrappers = tail.split(/\r?\n/).filter(line => {
      const name = line.match(/^✔ (.+) \([\d.]+ms\)$/)?.[1] ?? line.match(/^ok \d+ - (.+)$/)?.[1];
      return name && plan.files.includes(name.replaceAll("\\", "/"));
    }).length;
    const passed = Number([...tail.matchAll(/(?:#|ℹ)\s+pass\s+(\d+)/g)].at(-1)?.[1] ?? 0);
    if (passed <= wrappers) throw new Error("No matching tests passed. Correct --match; this is not a verified change.");
  }
}
// Keep the complete test selection without spawning a worker per CPU core on
// a laptop. The host may explicitly choose 1–8 workers; no tests are sampled out.
const testConcurrency = Number(process.env.AW_CHECK_CONCURRENCY ?? 4);
if (!Number.isInteger(testConcurrency) || testConcurrency < 1 || testConcurrency > 8) throw new Error("AW_CHECK_CONCURRENCY must be an integer from 1 to 8.");
await run(process.execPath, ["--test", `--test-concurrency=${testConcurrency}`, ...(match ? [`--test-name-pattern=${match}`] : []), ...plan.files], Boolean(match));
if (!styleOnly) await run(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-b", "--pretty", "false"]);
if (build) await run(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build"]);
// Advance only after success. A cache error must not invalidate passing tests.
if (!plan.broad && sample) {
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ cursor: plan.nextCursor }) + "\n");
    await rename(temporary, statePath);
  } catch (error) { console.warn(`Checks passed; sample rotation was not saved: ${error.message}`); }
}
console.log(`Passed: ${plan.broad ? "full checkpoint" : plan.sampled.length ? "targeted checks and sampled regressions" : "targeted checks"}${build ? ", production build" : ""}.`);

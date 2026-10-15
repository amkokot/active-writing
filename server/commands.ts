import { spawn } from "node:child_process";

export interface CommandResult { code: number; output: string }

export function run(command: string, args: string[], cwd: string, options: {
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
} = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    // Scope repository trust to the explicitly selected checkout (never global Git config).
    const commandArgs = command === "git" ? ["-c", `safe.directory=${cwd.replaceAll("\\", "/")}`, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd, windowsHide: true, shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...options.env },
    });
    let output = "";
    const append = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-100_000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.stdin.end(options.input);
    const timer = setTimeout(() => { child.kill(); reject(new Error("The operation timed out. Check connectivity and authentication, then retry.")); }, options.timeoutMs ?? 120_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}

export async function checked(command: string, args: string[], cwd: string, options?: Parameters<typeof run>[3]) {
  const result = await run(command, args, cwd, options);
  if (result.code !== 0) throw new Error(result.output.trim().slice(-4000).replace(/(https?:\/\/)[^/\s@]+@/g, "$1[redacted]@") || `${command} could not finish.`);
  return result.output.trim();
}

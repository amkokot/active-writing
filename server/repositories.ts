import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { RepoRemote, RepoStatus, RepositoryAccount } from "../src/types.ts";
import { checked, run } from "./commands.ts";
import { editableProject, getProject, parseProject, projectFiles, projectRevision, publicDocument, registerProject, registry, safeFolder, saveRegistry } from "./projects.ts";
import { projectBuildFolder } from "./projectStorage.ts";
import { discoverManuscriptRoots } from "./manuscriptRoots.ts";

export function normalizeRemote(input: string) {
  const value = input.trim().replace(/^git clone\s+/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value.replace(/\.git$/, "")}.git`;
  if (/^git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Paste a GitHub repository URL, owner/repo, or Overleaf project URL."); }
  if (url.protocol !== "https:" || url.password || url.search || url.hash) throw new Error("Use an HTTPS Git URL without a password, query, or fragment.");
  if (url.hostname === "github.com" && /^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname)) {
    if (url.username) throw new Error("Use GitHub sign-in rather than embedding credentials in the URL.");
    return `https://github.com${url.pathname.replace(/\/$/, "").replace(/\.git$/, "")}.git`;
  }
  if (["www.overleaf.com", "overleaf.com"].includes(url.hostname) && /^\/project\/\w+$/.test(url.pathname)) return `https://git.overleaf.com/${url.pathname.split("/").at(-1)}`;
  if (url.hostname === "git.overleaf.com" && /^\/\w+\/?$/.test(url.pathname) && (!url.username || url.username === "git")) return `https://git.overleaf.com${url.pathname.replace(/\/$/, "")}`;
  throw new Error("This connection supports github.com and Overleaf Cloud Git URLs.");
}

function provider(url: string): RepoRemote["provider"] {
  return url.includes("github.com") ? "github" : url.includes("git.overleaf.com") ? "overleaf" : "git";
}
function credentials(url: string, token?: string) {
  if (provider(url) === "overleaf" && token) {
    return { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://git.overleaf.com/.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`git:${token}`).toString("base64")}` };
  }
  return {};
}
function gitArgs(url: string, args: string[]) {
  return provider(url) === "github" && url.startsWith("https:")
    ? ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...args]
    : args;
}
async function remoteCommand(root: string, remote: RepoRemote, args: string[], token?: string) {
  try { return await checked("git", gitArgs(remote.url, args), root, { env: credentials(remote.url, token) }); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(token ? message.replaceAll(token, "[redacted]").replaceAll(Buffer.from(`git:${token}`).toString("base64"), "[redacted]") : message);
  }
}
export async function fullVerified(workspace: string, id?: string) {
  try {
    const build = await projectBuildFolder(workspace, id);
    const record = JSON.parse(await readFile(path.join(build, "full-compile.json"), "utf8"));
    const parsed = await parseProject(workspace, id);
    return Boolean(record.success && record.sourceRevision === parsed.revision && record.mainFile === parsed.project.mainFile && record.engine === parsed.project.engine);
  } catch { return false; }
}
async function excludeLocalFiles(root: string) {
  const file = await checked("git", ["rev-parse", "--git-path", "info/exclude"], root);
  const target = path.resolve(root, file);
  let contents = "";
  try { contents = await readFile(target, "utf8"); } catch { /* fresh repository */ }
  const patterns = [".paperfocus/", "*.aux", "*.log", "*.out", "*.fls", "*.fdb_latexmk", "*.synctex.gz"];
  const missing = patterns.filter((item) => !contents.split(/\r?\n/).includes(item));
  if (missing.length) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${contents}\n# Active Writing local files\n${missing.join("\n")}\n`, "utf8"); }
}
export async function repoStatus(workspace: string, id?: string): Promise<RepoStatus> {
  const { root } = await getProject(workspace, id);
  const probe = await run("git", ["rev-parse", "--show-toplevel"], root);
  if (probe.code !== 0 && !/not a git repository/i.test(probe.output)) throw new Error(probe.output.trim());
  const initialized = probe.code === 0 ? probe.output.trim() : "";
  // A paper folder inside another repository is not silently treated as that repository.
  if (path.resolve(initialized) !== path.resolve(root)) return { initialized: false, ahead: 0, behind: 0, remotes: [], changes: (await projectFiles(root)).map((file) => ({ path: file, status: "??" })), conflicts: [], fullVerified: await fullVerified(workspace, id) };
  await excludeLocalFiles(root);
  const branch = await checked("git", ["branch", "--show-current"], root);
  const remoteNames = (await checked("git", ["remote"], root)).split(/\r?\n/).filter(Boolean);
  const remotes: RepoRemote[] = [];
  for (const name of remoteNames) {
    const url = await checked("git", ["remote", "get-url", name], root);
    const remoteProvider = provider(url);
    const targetBranch = remoteProvider === "overleaf" ? "master" : branch;
    const comparison = await run("git", ["rev-list", "--left-right", "--count", `HEAD...refs/remotes/${name}/${targetBranch}`], root);
    const [ahead, behind] = comparison.code === 0 ? comparison.output.trim().split(/\s+/).map(Number) : [undefined, undefined];
    remotes.push({ name, url: url.replace(/(https?:\/\/)[^/@]+@/, "$1"), provider: remoteProvider, branch: targetBranch, ahead, behind });
  }
  const status = (await run("git", ["status", "--porcelain=v1", "-z"], root)).output;
  const changes: RepoStatus["changes"] = [];
  const entries = status.split("\0").filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    changes.push({ status: entries[i].slice(0, 2), path: entries[i].slice(3) });
    if (/R|C/.test(entries[i].slice(0, 2))) i++;
  }
  const tracking = await run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], root);
  const [ahead, behind] = tracking.code === 0 ? tracking.output.trim().split(/\s+/).map(Number) : [0, 0];
  const conflicts = changes.filter((item) => ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(item.status)).map((item) => item.path);
  return { initialized: true, branch: branch || "detached", ahead, behind, remotes, changes, conflicts, fullVerified: await fullVerified(workspace, id) };
}

export async function cloneRepository(workspace: string, input: string, name?: string, token?: string, testRemote?: string) {
  const url = testRemote ?? normalizeRemote(input);
  const folder = path.join("papers", `${(name || url.split(/[/:]/).at(-1) || "paper").replace(/\.git$/, "").replace(/[^\w-]/g, "-").slice(0, 50)}-${randomUUID().slice(0, 8)}`);
  const target = path.join(workspace, folder);
  await mkdir(path.dirname(target), { recursive: true });
  await safeFolder(workspace, "papers");
  const remote = { name: provider(url) === "overleaf" ? "overleaf" : "origin", url, provider: provider(url) } as RepoRemote;
  await remoteCommand(workspace, remote, ["clone", "--origin", remote.name, "--", url, target], token);
  await excludeLocalFiles(target);
  const project = await registerProject(workspace, folder, name);
  return selectProject(workspace, project.id);
}
export async function connectRemote(workspace: string, id: string, input: string) {
  const url = normalizeRemote(input);
  const { root } = await getProject(workspace, id);
  const status = await repoStatus(workspace, id);
  if (!status.initialized) { await checked("git", ["init", "-b", "main"], root); await excludeLocalFiles(root); }
  const name = provider(url) === "overleaf" ? "overleaf" : "origin";
  if ((await checked("git", ["remote"], root)).split(/\r?\n/).includes(name)) throw new Error(`The ${name} remote is already connected. Use its pull/push controls.`);
  await checked("git", ["remote", "add", name, url], root);
  return repoStatus(workspace, id);
}
export async function syncRepository(workspace: string, id: string, action: string, remoteName: string, message?: string, token?: string) {
  const { root } = await getProject(workspace, id);
  const status = await repoStatus(workspace, id);
  const remote = status.remotes.find((item) => item.name === remoteName);
  if (!remote) throw new Error("Connect a remote repository first.");
  if (status.conflicts.length) throw new Error("Resolve the listed merge conflicts before syncing.");
  if (status.branch === "detached") throw new Error("Check out a branch before syncing.");
  if (action === "fetch") {
    await remoteCommand(root, remote, ["fetch", remote.name], token);
  } else if (action === "pull") {
    if (status.changes.length) throw new Error("Save and commit your local changes before pulling. They remain available in this checkout.");
    const branch = remote.provider === "overleaf" ? "master" : status.branch!;
    await remoteCommand(root, remote, ["pull", "--ff-only", remote.name, branch], token);
  } else if (action === "push") {
    if (!status.fullVerified) throw new Error("Save your edits and compile the full paper before pushing.");
    if (status.changes.length) {
      if (!message?.trim()) throw new Error("Add a commit message for your changes.");
      const tracked = await checked("git", ["ls-files", "--", ".paperfocus"], root);
      if (tracked) throw new Error("The repository tracks generated .paperfocus files. Remove them from version control before publishing.");
      await checked("git", ["add", "-A", "--", "."], root);
      await checked("git", ["commit", "-m", message.trim()], root);
    }
    const target = remote.provider === "overleaf" ? "master" : status.branch!;
    await remoteCommand(root, remote, ["push", "-u", remote.name, `HEAD:refs/heads/${target}`], token);
  } else throw new Error("Choose fetch, pull, or push.");
  return { status: await repoStatus(workspace, id), document: publicDocument(await parseProject(workspace, id)) };
}

export async function githubAccount(workspace: string): Promise<RepositoryAccount> {
  const version = await run("gh", ["--version"], workspace).catch(() => ({ code: 1, output: "" }));
  if (version.code !== 0) return { installed: false, authenticated: false, message: "Install GitHub CLI to sign in and publish from this app." };
  const account = await run("gh", ["api", "user", "--jq", ".login"], workspace, { timeoutMs: 20_000 });
  return account.code === 0 ? { installed: true, authenticated: true, login: account.output.trim() }
    : { installed: true, authenticated: false, message: "Sign in to GitHub to browse private repositories and publish your paper." };
}
export async function githubRepositories(workspace: string) {
  return JSON.parse(await checked("gh", ["repo", "list", "--limit", "100", "--json", "nameWithOwner,url,isPrivate,description"], workspace));
}
export async function publishGithub(workspace: string, id: string, name: string, visibility: string, message: string) {
  if (!/^(?:[\w.][\w.-]*\/)?[\w.][\w.-]*$/.test(name)) throw new Error("Use a repository name or owner/name (not a command-line option).");
  if (!["private", "public"].includes(visibility)) throw new Error("Choose private or public visibility.");
  if (!(await githubAccount(workspace)).authenticated) throw new Error("Sign in to GitHub before creating the repository.");
  if (!(await fullVerified(workspace, id))) throw new Error("Save and compile the full paper before publishing.");
  const { root } = await getProject(workspace, id);
  const status = await repoStatus(workspace, id);
  if (status.remotes.some((remote) => remote.provider === "github")) throw new Error("This project already has a GitHub remote. Use Push to publish updates.");
  if (status.branch === "detached") throw new Error("Check out a branch before publishing this paper.");
  if (!status.initialized) await checked("git", ["init", "-b", "main"], root);
  await excludeLocalFiles(root);
  if (status.conflicts.length) throw new Error("Resolve merge conflicts before publishing.");
  if (await checked("git", ["ls-files", "--", ".paperfocus"], root)) throw new Error("Generated .paperfocus files are tracked. Remove them from version control first.");
  await checked("git", ["add", "-A", "--", "."], root);
  const staged = await run("git", ["diff", "--cached", "--quiet"], root);
  if (staged.code !== 0) await checked("git", ["commit", "-m", message?.trim() || "Publish LaTeX manuscript"], root);
  const remote = status.remotes.some((item) => item.name === "origin") ? "github" : "origin";
  await checked("gh", ["repo", "create", name, `--${visibility}`, "--source", root, "--remote", remote], root);
  const updated = await repoStatus(workspace, id);
  const github = updated.remotes.find((item) => item.name === remote)!;
  try { await remoteCommand(root, github, ["push", "-u", remote, `HEAD:refs/heads/${updated.branch}`]); }
  catch (error) { throw new Error(`Repository created and connected, but the first push failed. Retry Push. ${error instanceof Error ? error.message : String(error)}`); }
  return repoStatus(workspace, id);
}

const logins = new Map<string, { id: string; status: "waiting" | "complete" | "failed"; code?: string; url: string; message?: string }>();
export function startGithubLogin(workspace: string) {
  const current = [...logins.values()].find((item) => item.status === "waiting");
  if (current) return current;
  const job: (typeof logins extends Map<string, infer V> ? V : never) = { id: randomUUID(), status: "waiting", url: "https://github.com/login/device" };
  logins.set(job.id, job);
  const child = spawn("gh", ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"], {
    cwd: workspace, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_BROWSER: process.platform === "win32" ? "cmd /c exit" : "true" },
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-5000);
    const match = output.match(/code:\s*([A-Z0-9-]{4,})/i);
    if (match) job.code = match[1];
  };
  child.stdout.on("data", append); child.stderr.on("data", append); child.stdin.end("\n");
  const timer = setTimeout(() => { child.kill(); job.status = "failed"; job.message = "GitHub sign-in expired. Try again."; }, 15 * 60_000);
  child.on("error", () => { clearTimeout(timer); job.status = "failed"; job.message = "GitHub CLI could not start."; });
  child.on("close", (code) => { clearTimeout(timer); job.status = code === 0 ? "complete" : "failed"; if (code !== 0) job.message = "GitHub sign-in did not complete. Try again."; });
  return job;
}
export function githubLoginStatus(id: string) { return logins.get(id); }

export async function selectProject(workspace: string, id: string, mainFile?: string, engine?: string, expected?: { mainFile: string; revision: string }) {
  const entries = await registry(workspace);
  const previous = structuredClone(entries);
  const project = entries.projects.find((item) => item.id === id);
  if (!project) throw new Error("Project not found.");
  if (expected) {
    const root = await safeFolder(workspace, project.folder);
    if (expected.mainFile !== project.mainFile || expected.revision !== await projectRevision(root, await projectFiles(root))) throw new Error("Source or selected root changed before switching manuscripts. Recheck Paper & files; your work is kept.");
  }
  if (mainFile) {
    const root = await safeFolder(workspace, project.folder);
    if (!(await projectFiles(root)).includes(mainFile) || !mainFile.endsWith(".tex")) throw new Error("Choose a .tex file inside the project.");
    if (!(await discoverManuscriptRoots(root, await projectFiles(root))).includes(mainFile)) throw new Error("Choose a parent manuscript root containing \\documentclass (directly or in its preamble), not an included section file.");
    project.mainFile = mainFile;
  }
  if (engine) {
    if (!["pdflatex", "xelatex", "lualatex"].includes(engine)) throw new Error("Choose pdfLaTeX, XeLaTeX, or LuaLaTeX.");
    project.engine = engine as typeof project.engine;
  }
  project.lastOpenedAt = new Date().toISOString();
  entries.activeId = id; await saveRegistry(workspace, entries);
  try { return publicDocument(await editableProject(workspace, id)); }
  catch (error) { await saveRegistry(workspace, previous); throw error; }
}

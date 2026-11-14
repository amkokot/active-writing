import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { appCodeRoot } from "./appPaths.ts";
import {readOptionalTools,saveOptionalTools} from './optionalTools.ts';
import { withRecordLock } from "./recordLock.ts";
import { sectionPdfGroups, sectionPageCount } from "./sectionPdf.ts";
import {pairedSetupBrief} from './syncSetupBrief.ts';
import {autoSyncStatus,withSyncCycle} from './syncAuto.ts';
import {listReadingSourceReviews,readReadingSourceReview,chooseReadingSource} from './syncReadingSource.ts';
import {bulkEnabled} from './syncBulkCapture.ts';
import { run } from "./commands.ts";
import { checked } from "./commands.ts";
import { editableProject, getProject, hash, inside, parseProject, publicDocument, readSourceFile, registerProject, registry, saveEdits } from "./projects.ts";
import { changeEnvironment } from "./environmentEditing.ts";
import { joinParagraphs, undoParagraphJoin } from "./paragraphEditing.ts";
import { createSectionFile, undoSectionFile } from "./sectionFiles.ts";
import { createManuscriptVersion } from "./manuscriptVersions.ts";
import { transferNotebook } from "./notebookTransfer.ts";
import { setManuscriptPurpose, setManuscriptPin } from "./manuscriptPurpose.ts";
import { addProjectFiles, createPaperProject, projectFileContent, projectFilePreview } from "./projectFiles.ts";
import {desktopFiles,fetchDesktopFile} from './syncColdStore.ts';
import { sourceZip } from "./sourceZip.ts";
import { portableZip } from "./portableExport.ts";
import { initializeSyncDevice, syncStatus } from "./deviceSync.ts";
import { prepareSyncReview, previewStagedSync, stageSyncSnapshot, stagedSnapshots } from "./syncStaging.ts";
import { acknowledgeSyncHead, exchangeStatus, exportExchangeForPeer, receiveSyncExchange, syncWorkingCheckpoint } from "./syncExchange.ts";
import { previewResearchMerge, commitResearchMerge, researchMergeFile } from "./syncResearchMerge.ts";
import { listSshPeers, previewSshPeer, commitSshPeer, reconnectSshPeer } from "./syncSsh.ts";
import { previewPairedSync, commitPairedSync, pendingPairedSyncs } from "./syncPaired.ts";
import { collaboratorExport } from "./collaboratorExport.ts";
import {readCorpus,saveCorpus,corpusCompileSource} from './researchCorpus.ts';
import { checkedBuildFile, prepareBuildFolders, projectBuildFolder } from "./projectStorage.ts";
import type { CompileResult, SectionPdfPart } from "../src/types.ts";
import type { ParsedProject } from "./projects.ts";
import { visiblePreviewNodes } from "../src/workspaceTools.ts";
import { buildDependencies, dependenciesUnchanged, focusedJobName, seedFocusedBuild, compilationCommand, type BuildDependency } from "./buildCache.ts";
import { compiledSourceRanges, correspondingRange, pagesForSource, querySync, sourceLine, sourcePath, type CompiledSourceRange } from "./sourceSync.ts";
import { cloneRepository, connectRemote, fullVerified, githubAccount, githubLoginStatus, githubRepositories, publishGithub, repoStatus, selectProject, startGithubLogin, syncRepository } from "./repositories.ts";
import { focusedDocument, focusedSourceSnippets, writeFocusedSource } from "./focus.ts";
import { missingPdfDestinations } from "../src/pdfLinks.ts";
import { attachProjectPdf, downloadArxiv, maxReferenceBytes, readReferencePdf, referenceLibrary, saveReferencePage, storeReference } from "./referenceLibrary.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperimentsIfChanged, experimentEtag, writeExperiments, runExperiment, readExperimentJob, cancelExperimentJob, readExperimentSession, restartExperimentSession, experimentRuntime, ExperimentConflict } from "./experiments.ts";
import { readResearchCell } from "./researchCell.ts";
import { readWorkbench, writeWorkbench, WorkbenchConflict } from "./workbenchStore.ts";
import { createHandoff, readHandoff, readHandoffTicket } from "./handoffs.ts";
import { finishResearch } from "./researchFinish.ts";
import { researchReadiness } from "./researchReadiness.ts";
import { activityOrderedProjects } from "./projectActivity.ts";
import {linkedWorkspaces,openLinkedWorkspace} from './linkedWorkspaces.ts';
import { readProjectQueue } from "./projectQueue.ts";
import { readEvidenceFile, saveEvidenceSnapshot } from "./experimentEvidence.ts";
import { exportReview, annotateCompletedReview } from "./reviewExport.ts";
import { createSourceMonitor } from "./sourceMonitor.ts";
import { workspaceFolders, openWorkspaceFolder } from "./workspaceFolders.ts";
import { readSourceDraftCopies, saveSourceDraftCopy } from "./sourceDrafts.ts";
import { localModels, localDiagnostic, queueLocalRewrite, queueLocalStudy, readLocalJob, unloadLocalModels, cancelLocalJob } from "./localModels.ts";

type CompileMode = "focus" | "full";

interface CompileRequest {
  projectId?: string;
  revision?: string;
  mode?: CompileMode;
  focusNodeId?: string;
  lens?: "paper" | "proofs" | "themes";
  paragraphEdits?: Record<string, string>;
  hiddenNodeIds?: string[];
  paragraphIds?: string[];
  originalPages?: boolean;
  force?: boolean;
  draft?: boolean;
  sectionPdf?: boolean;
  sectionPages?: boolean;
  sectionReference?: string;
}

interface BuildRecord extends CompileResult { cacheVersion?: number; inputHash?: string; dependencies?: BuildDependency[]; sourceRanges?: CompiledSourceRange[]; workingKey?: string }

async function originalPageResult(result: CompileResult, parsed: Awaited<ReturnType<typeof parseProject>>, root: string, request: CompileRequest, buildRoot: string) {
  if (!request.originalPages || !result.success) return result;
  const selected = visiblePreviewNodes(parsed.nodes, request.lens ?? "paper", request.focusNodeId, request.hiddenNodeIds ?? []);
  const ids = new Set(selected.flatMap(node => node.paragraphIds).filter(id => !request.paragraphIds || request.paragraphIds.includes(id)));
  const ranges = compiledSourceRanges(parsed).filter(range => ids.has(range.paragraphId));
  for (const node of selected) if (node.sourceInsertion && (!request.paragraphIds || node.paragraphIds.some(id => ids.has(id)))) {
    const line = Math.max(1, sourceLine(parsed.sources[node.sourceInsertion.file], node.sourceInsertion.offset) - 1);
    ranges.push({ paragraphId: node.id, file: node.sourceInsertion.file, startLine: line, endLine: line });
  }
  let pages: number[] = [];
  try { pages = await pagesForSource(root, path.join(buildRoot, "full", `${path.basename(parsed.project.mainFile, ".tex")}.synctex.gz`), ranges); } catch { /* A missing mapping must not turn a successful build into a failure. */ }
  return { ...result, originalPages: pages.length ? pages : undefined,
    viewNote: pages.length ? `Original pages ${pages.join(", ")}: complete pages from the full paper, including neighboring sections, floats and both columns. ${result.cacheHit ? "Reused the unchanged full build." : "Updated the full build to preserve exact layout."}` : "No page mapping was found for this selection. Showing the full PDF instead." };
}

type DiagnosticSeverity = "error" | "warning" | "info";

interface LatexDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  code: string;
  line?: number;
  file?: string;
  excerpt?: string;
  suggestions: string[];
}


function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function conditionalStoreJson(req: IncomingMessage, res: ServerResponse, payload: unknown) {
  const body = JSON.stringify(payload), etag = `"aw-store-${hash(body)}"`;
  res.setHeader("ETag", etag); res.setHeader("Cache-Control", "no-store");
  if (req.headers["if-none-match"] === etag) { res.statusCode = 304; res.end(); return; }
  res.statusCode = 200; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(body);
}

async function requestBody(req: IncomingMessage, limit = 5_000_000) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > limit) throw new Error("This request is too large. Send a smaller set of edits or files.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function logTail(output: string, lines = 50) {
  return output.split(/\r?\n/).slice(-lines).join("\n").trim();
}

function diagnosticSuggestions(code: string) {
  const suggestions: Record<string, string[]> = {
    restricted_compilation: ["No correction is needed for ordinary LaTeX. External command execution is intentionally disabled; do not enable it automatically."],
    undefined_control_sequence: [
      "Check the command spelling and whether its package is loaded in the preamble.",
      "If this is a project macro, search the project for its definition before replacing it.",
    ],
    missing_math_delimiter: [
      "Inspect the reported line and the preceding line for an unmatched $, \\(, or \\[ delimiter.",
      "Keep prose outside math mode and wrap only the mathematical fragment.",
    ],
    runaway_argument: [
      "Look immediately above the reported line for an unmatched brace or an unclosed environment.",
      "Check the most recent command with a braced argument before changing document structure.",
    ],
    undefined_reference: [
      "Confirm that the label or citation key exists and is spelled exactly the same way.",
      "Run a full build after fixing the key so LaTeX can complete all reference passes.",
    ],
    overfull_box: [
      "Inspect the indicated lines for a long URL, inline equation, or unbreakable phrase.",
      "Break the long line or shorten the wording; avoid changing spacing throughout the paper.",
    ],
    underfull_box: [
      "Check whether a forced line break or unusually short paragraph caused loose spacing.",
      "Ignore isolated mild cases when the rendered page looks intentional.",
    ],
    latex_warning: [
      "Read the nearby source before changing anything; many warnings are informational.",
      "Recompile the full document after a correction to confirm the warning is gone.",
    ],
    latex_error: [
      "Start at the first error, not the later cascade, and inspect the preceding source lines.",
      "Make one small correction and recompile the focused view before continuing.",
    ],
  };
  return suggestions[code] ?? suggestions.latex_warning;
}

export function parseLatexDiagnostics(log: string): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = [];
  const seen = new Set<string>();
  const add = (diagnostic: Omit<LatexDiagnostic, "id" | "suggestions">) => {
    const key = `${diagnostic.severity}:${diagnostic.title}:${diagnostic.file ?? ""}:${diagnostic.line ?? ""}:${diagnostic.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({
      ...diagnostic,
      id: `latex-${diagnostics.length + 1}`,
      suggestions: diagnosticSuggestions(diagnostic.code),
    });
  };

  // -file-line-error supplies reliable locations even when an included file is
  // active. Do not guess a file for legacy warnings based on the root document.
  for (const match of log.matchAll(/^([^\r\n]+?\.tex):(\d+):\s*([^\r\n]+)/gm)) {
    const message = match[3].trim();
    const lower = message.toLowerCase();
    add({ severity: "error", title: message.replace(/\.$/, ""), message,
      code: lower.includes("undefined control sequence") ? "undefined_control_sequence"
        : lower.includes("missing $") ? "missing_math_delimiter" : "latex_error",
      file: match[1].trim(), line: Number(match[2]) });
  }

  for (const match of log.matchAll(/!\s+([^\r\n]+)(?:[\s\S]{0,500}?l\.(\d+)\s*([^\r\n]*))?/g)) {
    const message = match[1].trim();
    if (message.startsWith("==>")) continue;
    const lower = message.toLowerCase();
    const code = lower.includes("undefined control sequence")
      ? "undefined_control_sequence"
      : lower.includes("missing $") || lower.includes("math")
        ? "missing_math_delimiter"
        : lower.includes("runaway") || lower.includes("file ended while scanning")
          ? "runaway_argument"
          : "latex_error";
    add({
      severity: "error",
      title: message.replace(/\.$/, ""),
      message,
      code,
      line: match[2] ? Number(match[2]) : undefined,
      excerpt: match[3]?.trim() || undefined,
    });
  }

  for (const match of log.matchAll(/(?:LaTeX|Package\s+[^\r\n]+) Warning:\s*([^\r\n]+)/g)) {
    const message = match[1].trim();
    const lower = message.toLowerCase();
    if (lower.includes("shell escape feature is not enabled")) {
      add({ severity: "info", title: "External command execution disabled", message, code: "restricted_compilation" });
      continue;
    }
    const code = lower.includes("undefined") || lower.includes("rerun")
      ? "undefined_reference"
      : "latex_warning";
    add({
      severity: "warning",
      title: code === "undefined_reference" ? "Reference needs attention" : "LaTeX warning",
      message,
      code,
      line: Number(message.match(/(?:on input line|at lines?)\s+(\d+)/)?.[1]) || undefined,
    });
  }

  for (const match of log.matchAll(/((?:Over|Under)full \\hbox[^\r\n]*)/g)) {
    const overfull = match[1].startsWith("Overfull");
    add({
      severity: "warning",
      title: overfull ? "Text runs past the margin" : "Loose line spacing",
      message: match[1].trim(),
      code: overfull ? "overfull_box" : "underfull_box",
      line: Number(match[1].match(/at lines?\s+(\d+)(?:--\d+)?/)?.[1]) || undefined,
    });
  }

  return diagnostics.slice(0, 30);
}

export function focusedCacheDiagnostics(diagnostics: LatexDiagnostic[], cleanCurrentFullCache: boolean) {
  if (!cleanCurrentFullCache) return diagnostics;
  const repeated = diagnostics.filter((item) => /^(?:Label [`'][^']+' multiply defined\.|There were multiply-defined labels\.)$/.test(item.message));
  if (!repeated.length) return diagnostics;
  return [...diagnostics.filter((item) => !repeated.includes(item)), {
    id: "focus-cache-labels", severity: "info" as const, code: "cached_focus_labels",
    title: "Focused view repeats cached labels",
    message: repeated.map((item) => item.message).join("\n"),
    suggestions: ["The unchanged full build has no multiply-defined label warning. This focused shadow imports those full labels and defines its visible labels again; no manuscript edit is needed for these cache notices.", "If labels change, compile Full again. The complete engine log remains available."],
  }];
}


const compilingRequests = new Map<string, Promise<CompileResult>>();
export async function compile(workspaceRoot: string, request: CompileRequest): Promise<CompileResult> {
  const key = JSON.stringify([path.resolve(workspaceRoot), request]);
  const existing = compilingRequests.get(key); if (existing) return existing;
  const pending = (async () => {
    const build = await projectBuildFolder(workspaceRoot, request.projectId);
    // Other services/tools must not write the same persistent compiler state.
    return withRecordLock(await checkedBuildFile(build, "compiler"), () => compileUnlocked(workspaceRoot, request));
  })();
  compilingRequests.set(key, pending);
  try { return await pending; } finally { if (compilingRequests.get(key) === pending) compilingRequests.delete(key); }
}

async function compileSectionPdf(workspace: string, request: CompileRequest, parsed: ParsedProject, build: string): Promise<CompileResult> {
  const started = performance.now(), groups = sectionPdfGroups(parsed, request);
  let sectionReference: string | undefined;
  // Reuse a full build's reference table, or create one ordinary view baseline
  // once. Local wording edits do not regenerate this global reference table.
  let fullReferences = false;
  try {
    const r = JSON.parse(await readFile(path.join(build, "full-compile.json"), "utf8"));
    const folder = await projectBuildFolder(workspace, parsed.project.id, "full", undefined, false);
    fullReferences = r.success && r.mainFile === parsed.project.mainFile && r.engine === parsed.project.engine
      && (await stat(await checkedBuildFile(folder, path.basename(parsed.project.mainFile, ".tex") + ".aux"))).isFile();
  } catch { /* first build or removed reference artifacts */ }
  if (!fullReferences) {
    const pointer = await checkedBuildFile(build, `section-reference-${hash(JSON.stringify([parsed.project.mainFile, parsed.project.engine])).slice(0, 16)}.json`);
    try {
      const saved = JSON.parse(await readFile(pointer, "utf8"));
      if (/^[a-f0-9]{16}$/.test(saved.artifactKey)) {
        const folder = await projectBuildFolder(workspace, parsed.project.id, "focus", saved.artifactKey, false);
        const record = JSON.parse(await readFile(path.join(folder, "compile.json"), "utf8"));
        if (record.success && record.mainFile === parsed.project.mainFile && record.engine === parsed.project.engine && !record.sectionParts) {
          await stat(await checkedBuildFile(folder, `${focusedJobName(folder)}.aux`)); sectionReference = saved.artifactKey;
        }
      }
    } catch { /* create a baseline below */ }
    if (!sectionReference) {
      const baseline = await compileUnlocked(workspace, { projectId: parsed.project.id, mode: "focus", revision: parsed.revision }, parsed);
      if (!baseline.success) return baseline;
      sectionReference = baseline.artifactKey;
      await writeFile(pointer, JSON.stringify({ artifactKey: sectionReference }), "utf8");
    }
  }
  const parts: SectionPdfPart[] = [], diagnostics: NonNullable<CompileResult["diagnostics"]> = []; let offset = 0;
  for (const group of groups) {
    const result = await compileUnlocked(workspace, { projectId: parsed.project.id, mode: "focus", revision: parsed.revision,
      lens: "paper", paragraphIds: group.paragraphIds, sectionPages: true, sectionReference, draft: request.draft, force: request.force }, parsed);
    if (!result.success || !result.artifactKey || !result.pdfUrl) return result;
    diagnostics.push(...(result.diagnostics ?? []).map(d => ({ ...d, id: `${group.nodeId}:${d.id}`, title: `${group.title}: ${d.title}` })));
    const output = await projectBuildFolder(workspace, parsed.project.id, "focus", result.artifactKey, false);
    const pageCount = await sectionPageCount(path.join(output, `${focusedJobName(output)}.synctex.gz`));
    parts.push({ ...group, artifactKey: result.artifactKey, pdfUrl: result.pdfUrl, compiledAt: result.compiledAt,
      pageCount, pageOffset: offset, cacheHit: Boolean(result.cacheHit), unavailablePdfDestinations: result.unavailablePdfDestinations });
    offset += pageCount;
  }
  const artifactKey = hash(JSON.stringify(["section-pdf-v1", parsed.project.mainFile, parsed.project.engine, parts.map(p => [p.nodeId, p.artifactKey, p.compiledAt, p.pageCount])])).slice(0, 16);
  const output = await projectBuildFolder(workspace, parsed.project.id, "focus", artifactKey);
  const recordFile = await checkedBuildFile(output, "compile.json");
  let compiledAt = new Date().toISOString();
  try { const saved = JSON.parse(await readFile(recordFile, "utf8")); if (saved.success && saved.sectionParts) compiledAt = saved.compiledAt; } catch { /* first manifest */ }
  const reused = parts.filter(p => p.cacheHit).length;
  const result: CompileResult = { mode: "focus", success: true, pdfUrl: `/api/paperfocus/section-pdf?projectId=${parsed.project.id}&build=${artifactKey}`, artifactKey,
    sectionParts: parts, mainFile: parsed.project.mainFile, engine: parsed.project.engine, sourceRevision: parsed.revision, compiledAt,
    durationMs: Math.round(performance.now() - started), cacheHit: reused === parts.length, draft: request.draft,
    requestedAt: new Date().toISOString(),
    scope: { focusNodeId: request.focusNodeId, lens: request.lens, hiddenNodeIds: request.hiddenNodeIds ?? [], paragraphIds: request.paragraphIds, sectionPdf: true },
    log: `${parts.length} sections · ${reused} reused · ${parts.length - reused} rebuilt.`,
    viewNote: `Section layout · ${reused}/${parts.length} sections reused. Each section starts on its own page with local page numbers. Reference numbers use the last reference baseline; Full PDF refreshes them and checks continuous layout. Shared source files are unchanged.`, diagnostics: diagnostics.slice(0, 100) };
  const ids = new Set(parts.flatMap(p => p.paragraphIds));
  await writeFile(recordFile, JSON.stringify({ ...result, sourceRanges: compiledSourceRanges(parsed).filter(r => ids.has(r.paragraphId)) }), "utf8");
  for (const name of ["last-compile.json", "focus-compile.json"]) await writeFile(path.join(build, name), JSON.stringify(result), "utf8");
  return result;
}

async function compileUnlocked(workspaceRoot: string, request: CompileRequest, snapshot?: ParsedProject): Promise<CompileResult> {
  const started = performance.now();
  const { project, root: projectRoot } = await getProject(workspaceRoot, request.projectId);
  const corpus = await readCorpus(workspaceRoot, project.id);
  // A research directory is a sharing preview, including its normal download.
  // Compile the untouched master through a private audience-specific entry file.
  const corpusSource = corpus && project.mainFile === corpus.corpus.mainFile
    ? corpusCompileSource(corpus.corpus, path.join(projectRoot, project.mainFile)) : undefined;
  const mode: CompileMode = corpusSource || request.originalPages || request.mode === "full" ? "full" : "focus";
  const draft = mode === "focus" && request.draft === true;
  const buildRoot = await projectBuildFolder(workspaceRoot, project.id);
  let outputRoot = await projectBuildFolder(workspaceRoot, project.id, mode);
  if (Object.keys(request.paragraphEdits ?? {}).length) {
    await saveEdits(workspaceRoot, project.id, request.paragraphEdits ?? {}, request.revision);
  }
  const parsed = snapshot ?? await parseProject(workspaceRoot, project.id, mode === "focus");
  if (parsed.project.id !== project.id || parsed.project.mainFile !== project.mainFile || parsed.project.engine !== project.engine) throw new Error("The compilation manuscript changed.");
  if (request.revision && request.revision !== parsed.revision && !Object.keys(request.paragraphEdits ?? {}).length) {
    throw new Error("The project changed on disk. Reload it before compiling or publishing.");
  }
  if (mode === "focus" && request.sectionPdf) return compileSectionPdf(workspaceRoot, request, parsed, buildRoot);
  const sourceSnippets = mode === "focus" ? focusedSourceSnippets(parsed, request) : [];

  let input =
    mode === "full"
      ? path.join(projectRoot, project.mainFile)
      : path.join(outputRoot, `${focusedJobName(outputRoot)}.tex`);
  let cachedReferences = false;
  let cachedAuxFolder: string | undefined;
  let cleanCurrentFullCache = false;
  let shadow: string | undefined = corpusSource;
  if (corpusSource) {
    input = await checkedBuildFile(outputRoot, path.basename(project.mainFile));
    await writeFocusedSource(input, corpusSource);
  }
  let artifactKey: string | undefined;
  let warmRecord: string | undefined;
  let workingKey: string | undefined;
  let workingOutput: string | undefined;
  let reusedAuxiliaries = 0;
  if (mode === "focus") {
    let cachedAux: string | undefined;
    try {
      const record = JSON.parse(await readFile(path.join(buildRoot, "full-compile.json"), "utf8"));
      const full = await projectBuildFolder(workspaceRoot, project.id, "full", undefined, false);
      const aux = await checkedBuildFile(full, path.basename(project.mainFile, ".tex") + ".aux");
      if (record.success && record.mainFile === project.mainFile && record.engine === project.engine && (await stat(aux)).isFile()) {
        cachedAux = aux.replaceAll("\\", "/");
        cachedAuxFolder = full;
        if (record.sourceRevision === parsed.revision) {
          const fullLog = await readFile(await checkedBuildFile(full, path.basename(project.mainFile, ".tex") + ".log"), "utf8");
          cleanCurrentFullCache = !/multiply[- ]defined/i.test(fullLog);
        }
      }
    } catch { /* A first focus build can use the project's normal bibliography instead. */ }
    cachedReferences = Boolean(cachedAux);
    if (request.sectionReference) {
      if (!/^[a-f0-9]{16}$/.test(request.sectionReference)) throw new Error("Invalid section reference baseline.");
      const reference = await projectBuildFolder(workspaceRoot, project.id, "focus", request.sectionReference, false);
      const record = JSON.parse(await readFile(path.join(reference, "compile.json"), "utf8"));
      if (!record.success || record.mainFile !== project.mainFile || record.engine !== project.engine || record.sectionParts) throw new Error("The section reference baseline belongs to another document.");
      cachedAux = (await checkedBuildFile(reference, `${focusedJobName(reference)}.aux`)).replaceAll("\\", "/");
      cachedAuxFolder = reference; cachedReferences = true;
    }
    shadow = focusedDocument(parsed, { ...request, cachedAux, synchronize: true });
    artifactKey = hash((draft ? "draft\0" : "") + shadow).slice(0, 16);
    outputRoot = await projectBuildFolder(workspaceRoot, project.id, "focus", artifactKey);
    input = path.join(outputRoot, `${focusedJobName(outputRoot)}.tex`);
    await checkedBuildFile(outputRoot, `${focusedJobName(outputRoot)}.tex`);
    await writeFocusedSource(input, shadow);
    const warmScope: unknown[] = [project.mainFile, project.engine, parsed.preamble, request.focusNodeId, request.lens, request.hiddenNodeIds, request.paragraphIds];
    if (request.sectionPages) warmScope.push("section-pages");
    const warmKey = hash(JSON.stringify(warmScope)).slice(0, 16);
    workingKey = hash(`compiler-work-v1:${warmKey}:${draft}`).slice(0, 16);
    workingOutput = await projectBuildFolder(workspaceRoot, project.id, "focus", workingKey);
    warmRecord = await checkedBuildFile(buildRoot, `focus-warm-${warmKey}.json`);
  }
  const inputHash = hash(shadow ?? parsed.sources[project.mainFile]);
  const recordFile = mode === "full" ? path.join(buildRoot, "full-compile.json") : path.join(outputRoot, "compile.json");
  try {
    const record = JSON.parse(await readFile(recordFile, "utf8")) as BuildRecord;
    const dependencyMetadata = JSON.stringify(record.dependencies);
    if (!request.force && record.cacheVersion === 1 && record.success && Boolean(record.draft) === draft && record.inputHash === inputHash && record.mainFile === project.mainFile && record.engine === project.engine
      && record.corpusRevision === corpus?.revision
      && (mode === "focus" || record.sourceRevision === parsed.revision) && await dependenciesUnchanged(record.dependencies)) {
      if (dependencyMetadata !== JSON.stringify(record.dependencies)) await writeFile(recordFile, JSON.stringify(record, null, 2), "utf8");
      const { dependencies: _dependencies, sourceRanges: _ranges, workingKey: _working, ...publicRecord } = record;
      const cached = { ...publicRecord, cacheHit: true, requestedAt: new Date().toISOString(), sourceRevision: parsed.revision, durationMs: Math.round(performance.now() - started) };
      const presentation = await originalPageResult(cached, parsed, projectRoot, request, buildRoot);
      await writeFile(path.join(buildRoot, "last-compile.json"), JSON.stringify(presentation, null, 2), "utf8");
      return presentation;
    }
  } catch { /* Missing or invalid caches always fall back to the compiler. */ }
  const jobName = mode === "full" ? path.basename(project.mainFile, ".tex") : focusedJobName(outputRoot);
  const engineOutput = workingOutput ?? outputRoot;
  if (workingOutput) {
    if (focusedJobName(workingOutput) !== jobName) throw new Error("Focused build paths have incompatible job names.");
    input = await checkedBuildFile(workingOutput, `${jobName}.tex`);
    await writeFocusedSource(input, shadow!);
    try {
      const previous = JSON.parse(await readFile(warmRecord!, "utf8"));
      if (/^[a-f0-9]{16}$/.test(previous.artifactKey)) {
        await seedFocusedBuild(await projectBuildFolder(workspaceRoot, project.id, "focus", previous.artifactKey, false), workingOutput);
      }
    } catch { /* Retained working state or a cold build is safe without a seed. */ }
    for (const ext of ["aux", "toc", "out", "lof", "lot", "bbl"]) {
      try { if ((await stat(await checkedBuildFile(workingOutput, `${jobName}.${ext}`))).isFile()) reusedAuxiliaries++; } catch { /* optional */ }
    }
  }
  if (mode === "full") await prepareBuildFolders(outputRoot, parsed.files);
  for (const extension of ["pdf", "log", "aux", "fls", "fdb_latexmk", "synctex.gz", "toc", "bbl", "blg", "out", "lof", "lot", "bcf", "run.xml"]) {
    await checkedBuildFile(outputRoot, `${jobName}.${extension}`);
    await checkedBuildFile(engineOutput, `${jobName}.${extension}`);
  }
  let needsSyncMap = false;
  try { await stat(path.join(engineOutput, `${jobName}.synctex.gz`)); } catch {
    try { await stat(path.join(engineOutput, `${jobName}.fdb_latexmk`)); needsSyncMap = true; } catch { /* A cold build already runs TeX. */ }
  }
  const command = compilationCommand(project.engine, input, engineOutput, draft, Boolean(request.force || needsSyncMap));

  try {
    // Cached main.aux may reference \include child auxiliaries. Search the full
    // build folder as well, never write them back into the manuscript checkout.
    const env = cachedAuxFolder ? { TEXINPUTS: [".", cachedAuxFolder.replaceAll("\\", "/") + "/", process.env.TEXINPUTS ?? ""].join(path.delimiter) } : undefined;
    const result = await run(command.command, command.args, projectRoot, { env });
    const pdfName = `${jobName}.pdf`;
    const logName = `${jobName}.log`;
    const pdfPath = path.join(engineOutput, pdfName);
    let engineLog = result.output;
    try {
      engineLog = await readFile(path.join(engineOutput, logName), "utf8");
    } catch {
      // latexmk output is still useful when TeX stopped before creating a log.
    }
    let pdfExists = false;
    try {
      pdfExists = (await stat(pdfPath)).isFile();
    } catch {
      pdfExists = false;
    }
    const success = result.code === 0 && pdfExists;
    if (success && workingOutput) {
      // Publish snapshots only after TeX succeeds; subsequent local edits reuse
      // the private working database without changing these PDF/map bytes.
      for (const extension of ["pdf", "synctex.gz", "aux", "log", "toc", "out", "lof", "lot", "bbl"]) {
        const source = await checkedBuildFile(engineOutput, `${jobName}.${extension}`);
        const target = await checkedBuildFile(outputRoot, `${jobName}.${extension}`);
        try { await copyFile(source, target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || ["pdf", "synctex.gz"].includes(extension)) throw error; }
      }
    }
    if (corpus && (await readCorpus(workspaceRoot, project.id))?.revision !== corpus.revision) throw new Error("The Show / hide selection changed. Compile again before sharing.");
    const compileResult: CompileResult = {
      corpusRevision: corpus?.revision,
      mode,
      success,
      pdfUrl: success ? `/api/paperfocus/pdf/${mode}?projectId=${project.id}${artifactKey ? `&build=${artifactKey}` : ""}&v=${Date.now()}` : undefined,
      durationMs: Math.round(performance.now() - started),
      compiledAt: new Date().toISOString(),
      log: logTail(engineLog, 90) || (success ? "latexmk completed successfully." : "latexmk failed."),
      diagnostics: [...focusedCacheDiagnostics(parseLatexDiagnostics(engineLog), mode === "focus" && cleanCurrentFullCache), ...(sourceSnippets.length ? [{ id: "focus-source-snippets", severity: "info" as const, code: "focus_source_snippets", title: `${sourceSnippets.length} snippets shown as source`, message: sourceSnippets.map(p => `${p.file}: ${p.renderIssue}`).join("\n"), suggestions: ["Only this temporary focused PDF uses placeholders. The snippets remain editable in the app and unchanged in the shared LaTeX source. The full build checks all source normally."] }] : [])],
      unavailablePdfDestinations: missingPdfDestinations(engineLog),
      sourceRevision: parsed.revision,
      mainFile: project.mainFile,
      engine: project.engine,
      artifactKey,
      draft,
      reusedAuxiliaries,
      scope: mode === "focus" ? { focusNodeId: request.focusNodeId, lens: request.lens, hiddenNodeIds: request.hiddenNodeIds ?? [], paragraphIds: request.paragraphIds } : undefined,
      viewNote: [draft ? "One-pass draft: references, contents and bibliography may need Compile view or Full to settle." : "", reusedAuxiliaries ? "Reused auxiliary files from the previous view build." : "", mode === "focus" && request.paragraphIds ? `Block window PDF: ${request.paragraphIds.length} selected blocks. Statements and proofs may be excerpts, not complete arguments.` : "", sourceSnippets.length ? `${sourceSnippets.length} ${sourceSnippets.length === 1 ? "snippet has a placeholder" : "snippets have placeholders"}. See source in Quick reading; the shared paper is unchanged.` : "", cachedReferences ? "Reference numbers use the last full build. Omitted PDF targets cannot be followed here; use source links or Full. Recompile Full after changing labels or citations." : ""].filter(Boolean).join(" ") || undefined,
    };
    const sourceRanges = compiledSourceRanges(parsed, corpusSource ? undefined : shadow);
    let dependencies: BuildDependency[] | undefined;
    // BibTeX/Biber inputs are not necessarily listed by TeX's recorder.
    if (success) try { dependencies = await buildDependencies(projectRoot, engineOutput, jobName, parsed.files.filter(file => /\.(bib|bst)$/i.test(file)), outputRoot); } catch { /* Without a complete recorder, do not skip future builds. */ }
    const record: BuildRecord = { ...compileResult, cacheVersion: 1, inputHash, dependencies, sourceRanges, workingKey };
    const presentation = await originalPageResult(compileResult, parsed, projectRoot, request, buildRoot);
    await writeFile(
      path.join(buildRoot, "last-compile.json"),
      JSON.stringify(presentation, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(buildRoot, `${mode}-compile.json`),
      JSON.stringify(compileResult, null, 2),
      "utf8",
    );
    await writeFile(recordFile, JSON.stringify(record, null, 2), "utf8");
    if (success && warmRecord) await writeFile(warmRecord, JSON.stringify({ artifactKey }), "utf8");
    return presentation;
  } catch (error) {
    const compileResult = {
      mode,
      success: false,
      durationMs: Math.round(performance.now() - started),
      compiledAt: new Date().toISOString(),
      log: error instanceof Error ? error.message : String(error),
      diagnostics: [],
    };
    await writeFile(
      path.join(buildRoot, "last-compile.json"),
      JSON.stringify(compileResult, null, 2),
      "utf8",
    );
    return compileResult;
  }
}

export function latexMiddleware(workspaceRoot: string) {
  const sourceStatus = createSourceMonitor();
  let exportingSource = false;
  let mutation = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = mutation.then(task);
    mutation = result.then(() => undefined, () => undefined);
    return result;
  };
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://paperfocus.local");
    if (url.pathname === "/api/paperfocus/health" && req.method === "GET") {
// The desktop launcher must not open a different app or another checkout.
json(res, 200, { app: "active-writing", workspaceRoot: path.resolve(workspaceRoot), codeRoot: appCodeRoot, features: { paragraphEditing: true, collaboratorOverview: true, notebookTransfer: true, manuscriptPurpose: true, manuscriptVersions: true, environmentHeadings: true, projectFiles: true, directNotebook: true, researchPreflight: true, projectActivity: true, sourceZip: true, sharingPdf: true, experimentInputs: true, researchCells: true } });
      return;
    }
    if (url.pathname.startsWith("/api/paperfocus/") && req.method === "POST" && req.headers.origin) {
      let matches = false;
      try { matches = new URL(req.headers.origin).host === req.headers.host; } catch { /* opaque origins are not trusted */ }
      if (!matches) { json(res, 403, { error: "Use this app's local origin." }); return; }
    }
    if (url.pathname.startsWith("/api/paperfocus/subscription")) {
      json(res, 410, { error: "Direct subscription integration was removed. Use an installed local model; saved request history remains intact." });
      return;
    }
    if(url.pathname==='/api/paperfocus/optional-tools'){
      try{
        if(req.method==='GET')json(res,200,await readOptionalTools(workspaceRoot));
        else if(req.method==='POST'){
          if(req.headers.origin!==`http://${req.headers.host}`)throw Error('Change optional tools from this editor.');
          const request=JSON.parse(await requestBody(req));
          json(res,200,await saveOptionalTools(workspaceRoot,request.revision,request.sync));
        }else json(res,405,{error:'Use GET or POST.'});
      }catch(error){json(res,400,{error:(error as Error).message});}
      return;
    }
    if (url.pathname === "/api/paperfocus/research/preflight") {
      if (req.method !== "POST") { json(res, 405, { error: "Run the setup check explicitly from this editor." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Check setup from this editor's local origin." }); return; }
      try {
        const request = JSON.parse(await requestBody(req));
        json(res, 200, await researchReadiness(workspaceRoot, request.projectId, request.entryId));
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/research/cell") {
      if (req.method !== "GET") { json(res, 405, { error: "Research cell reads never save or run code." }); return; }
      try { json(res, 200, await readResearchCell(workspaceRoot, url.searchParams.get("projectId") ?? "", url.searchParams.get("entryId") ?? "", url.searchParams.get("cellId") ?? "", url.searchParams.get("output") ?? undefined, url.searchParams.get("owner") ?? undefined)); }
      catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/project-queue") {
      if (req.method !== "GET") { json(res, 405, { error: "The project queue is read-only. Open a task to change it." }); return; }
      try { json(res, 200, await readProjectQueue(workspaceRoot, url.searchParams.get("excludeProjectId") ?? undefined)); }
      catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/workspace-folders" && req.method === "GET") {
      try { json(res, 200, await workspaceFolders(workspaceRoot, url.searchParams.get("projectId") || undefined)); }
      catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/workspace-folders/open" && req.method === "POST") {
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Open folders from this editor's local origin." }); return; }
      try {
        const request = JSON.parse(await requestBody(req));
        json(res, 200, await openWorkspaceFolder(workspaceRoot, request.projectId, request.target));
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if(url.pathname==='/api/paperfocus/desktop-files'||url.pathname==='/api/paperfocus/desktop-files/fetch'){
      try{if(req.method==='GET'&&url.pathname.endsWith('desktop-files')){json(res,200,await desktopFiles(workspaceRoot,url.searchParams.get('projectId')??''));}
      else if(req.method==='POST'&&url.pathname.endsWith('/fetch')&&req.headers.origin===`http://${req.headers.host}`){const r=JSON.parse(await requestBody(req,4000));json(res,200,await fetchDesktopFile(workspaceRoot,r.projectId,r.path));}
      else json(res,405,{error:'Use this editor to fetch an exact desktop file.'});}catch(e){json(res,400,{error:(e as Error).message});}return;
    }
    if(url.pathname==='/api/paperfocus/device-sync/attention'){
      if(req.method!=='GET'){json(res,405,{error:'Read saved sync status only.'});return;}
      try{const projectId=(await getProject(workspaceRoot,url.searchParams.get('projectId')??'')).project.id;
        const automatic=await autoSyncStatus(workspaceRoot,projectId);
        const pendingSyncs=automatic.locks.project.status==='active'?[]:await pendingPairedSyncs(workspaceRoot,projectId);
        json(res,200,{automatic,pendingSyncs,sourceReviews:await listReadingSourceReviews(workspaceRoot,projectId)});
      }catch(error){json(res,400,{error:(error as Error).message});}return;
    }
    if(url.pathname==='/api/paperfocus/device-sync/source-review'){
      try{
        if(req.method==='GET'){const projectId=url.searchParams.get('projectId')??'',reviewId=url.searchParams.get('reviewId');json(res,200,reviewId?await readReadingSourceReview(workspaceRoot,projectId,reviewId):await listReadingSourceReviews(workspaceRoot,projectId));}
        else if(req.method==='POST'&&req.headers.origin===`http://${req.headers.host}`){const value=JSON.parse(await requestBody(req,4000));json(res,200,await chooseReadingSource(workspaceRoot,value.projectId,value.reviewId,value.choice));}
        else json(res,405,{error:'Choose a saved source version from this editor.'});
      }catch(error){json(res,400,{error:(error as Error).message});}return;
    }
    if (url.pathname === "/api/paperfocus/device-sync") {
      if (req.method !== "GET" && req.method !== "POST") { json(res, 405, { error: "Use device preparation; live synchronization is not implemented." }); return; }
      if (req.method === "POST" && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Name this installation from its local editor." }); return; }
      try {
        const status = req.method === "GET" ? await syncStatus(workspaceRoot) : await initializeSyncDevice(workspaceRoot, JSON.parse(await requestBody(req, 2000)).label);
        const projectId = req.method === "GET" ? url.searchParams.get("projectId") : undefined;
        const snapshots = projectId ? await stagedSnapshots(workspaceRoot, projectId) : undefined;
        // The private storage path belongs to the offline tool, not the browser.
        const exchange = projectId && status.device ? await exchangeStatus(workspaceRoot, projectId) : undefined;
        const peers = projectId && status.device ? await listSshPeers(workspaceRoot, projectId) : undefined;
        const pendingSyncs = projectId && status.device ? await pendingPairedSyncs(workspaceRoot,projectId) : undefined;
        const automatic=projectId&&status.device?await autoSyncStatus(workspaceRoot,projectId):undefined;
        const setupInstructions=projectId?pairedSetupBrief(appCodeRoot,workspaceRoot,(await getProject(workspaceRoot,projectId)).project.id):undefined;
        const bulk=projectId?await bulkEnabled(workspaceRoot,projectId):false;
        const { folder: _folder, ...publicStatus } = status; json(res, 200, { ...publicStatus, stagingSupported: true, exchangeSupported: true, mergeSupported: true, projectId: projectId ?? undefined, snapshots, exchange, peers, pendingSyncs,automatic,setupInstructions,bulk });
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (["/api/paperfocus/device-sync/stage", "/api/paperfocus/device-sync/compare", "/api/paperfocus/device-sync/prepare"].includes(url.pathname)) {
      if (req.method !== "POST") { json(res, 405, { error: "Inspect snapshots explicitly; no live synchronization is enabled." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Inspect snapshots from this editor's local origin." }); return; }
      try {
        const request = JSON.parse(await requestBody(req, url.pathname.endsWith("/stage") ? 8 * 1024 * 1024 : 2000));
        if (url.pathname.endsWith("/stage")) json(res, 200, await stageSyncSnapshot(workspaceRoot, request.projectId, request.snapshot));
        else if (url.pathname.endsWith("/prepare")) json(res, 200, await prepareSyncReview(workspaceRoot, request.projectId, request.planId));
        else {
          const localId = request.refreshLocal === true ? (await syncWorkingCheckpoint(workspaceRoot, request.projectId, request.localId || undefined)).id : request.localId;
          const result = await previewStagedSync(workspaceRoot, request.projectId, localId, request.remoteId);
          let merge, mergeError; try { merge = await previewResearchMerge(workspaceRoot, request.projectId, result.id); } catch (error) { mergeError = (error as Error).message; }
          json(res, 200, { id: result.id, localId, historyChecked: true, applySupported: false, summary: result.plan.summary,
            conflicts: result.plan.conflicts.slice(0, 100).map(({ path: file, field, reason }) => ({ path: file, field, reason })), merge, mergeError });
        }
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (["export", "receive", "merge", "merge-file", "acknowledge", "pair", "reconnect", "sync-preview", "sync-commit"].some(action => url.pathname === `/api/paperfocus/device-sync/${action}`)) {
      if (req.method !== "POST") { json(res, 405, { error: "Choose this exchange operation explicitly." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Exchange files from this editor's local origin." }); return; }
      try {
        const request = JSON.parse(await requestBody(req, url.pathname.endsWith("/receive") ? 24 * 1024 * 1024 : 6000)), action = url.pathname.split("/").at(-1);
        if (action === "export") {
          const checkpoint = await syncWorkingCheckpoint(workspaceRoot, request.projectId, request.parent || undefined), result = await exportExchangeForPeer(workspaceRoot, request.projectId, checkpoint.id, request.peerDevice || undefined);
          if(result.externalBlobs.length)throw new Error('This project has separately streamed evidence. Use its SSH connection or awPair setup, not a partial download.');
          res.statusCode = 200; res.setHeader("Content-Type", "application/gzip"); res.setHeader("Content-Disposition", `attachment; filename="aw-exchange-${request.projectId}.aw-sync"`);
          res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Aw-Head", checkpoint.id); res.end(result.bytes);
        } else if (action === "receive") {
          if (typeof request.bytes !== "string" || request.bytes.length > Math.ceil(16 * 1024 * 1024 / 3) * 4) throw new Error("Use the offline receive tool for exchanges above 16 MB.");
          const bytes = Buffer.from(request.bytes, "base64"); if (bytes.toString("base64") !== request.bytes) throw new Error("Invalid exchange encoding."); json(res, 200, await receiveSyncExchange(workspaceRoot, request.projectId, bytes));
        } else if (action === "sync-preview") json(res, 200, await withSyncCycle(workspaceRoot,request.projectId,()=>previewPairedSync(workspaceRoot, request.projectId, request.peerId),2000));
        else if (action === "sync-commit") {
          if (request.draftsSaved !== true) throw new Error("Save open drafts on both copies before this two-copy collection.");
          json(res, 200, await withSyncCycle(workspaceRoot,request.projectId,()=>commitPairedSync(workspaceRoot, request.projectId, request.reviewId),2000));
        } else if (action === "merge-file") json(res, 200, await researchMergeFile(workspaceRoot, request.projectId, request.planId, request.path));
        else if (action === "merge") {
          if (request.draftsSaved !== true) throw new Error("Save open editor drafts before collecting; source is never replaced behind an unsaved draft.");
          json(res, 200, await commitResearchMerge(workspaceRoot, request.projectId, request.planId, request.reviewId));
        } else if (action === "acknowledge") json(res, 200, await acknowledgeSyncHead(workspaceRoot, request.projectId, request.head));
        else if (action === "pair") json(res, 200, request.commit === true ? await commitSshPeer(workspaceRoot, request.projectId, request.options, request.reviewId) : await previewSshPeer(workspaceRoot, request.projectId, request.options));
        else json(res, 200, await reconnectSshPeer(workspaceRoot, request.projectId, request.peerId));
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/export-aw.zip") {
      if (req.method !== "POST") { json(res, 405, { error: "Choose Export Aw explicitly from this editor." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Export Aw from this editor's local origin." }); return; }
      if (exportingSource) { json(res, 409, { error: "Another download is being prepared. Try again shortly." }); return; }
      exportingSource = true;
      try {
        // The app code, not workspaceRoot: isolated/remote paper stores must
        // never be mistaken for the distributable app or copied into its ZIP.
        const data = await portableZip(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
        res.statusCode = 200; res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Disposition", 'attachment; filename="active-writing.zip"');
        res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.end(data);
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      finally { exportingSource = false; }
      return;
    }
    if(url.pathname==='/api/paperfocus/corpus'){
      try{
        if(req.method==='GET')json(res,200,await readCorpus(workspaceRoot,url.searchParams.get('projectId')??'')??null);
        else if(req.method==='POST' && req.headers.origin===`http://${req.headers.host}`){const r=JSON.parse(await requestBody(req,12000));json(res,200,await saveCorpus(workspaceRoot,r.projectId,r.revision,r.change));}
        else json(res,405,{error:'Change the research list from this editor.'});
      }catch(e){json(res,400,{error:(e as Error).message});}return;
    }
    if (url.pathname === "/api/paperfocus/share.zip" && req.method === "POST") {
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Prepare a sharing copy from this editor." }); return; }
      if (exportingSource) { json(res, 409, { error: "Another download is being prepared. Try again shortly." }); return; }
      exportingSource = true;
      try {
        const result = await collaboratorExport(workspaceRoot, JSON.parse(await requestBody(req)));
        res.statusCode = 200; res.setHeader("Content-Type", result.mime); res.setHeader("Content-Disposition", `attachment; filename="aw-sharing-copy.${result.extension}"`); res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.end(result.data);
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      finally { exportingSource = false; }
      return;
    }
    if (url.pathname === "/api/paperfocus/source.zip" && req.method === "GET") {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Download source from this editor." }); return; }
      if (exportingSource) { json(res, 409, { error: "Another source download is being prepared. Try again shortly." }); return; }
      exportingSource = true;
      try {
        const data = await sourceZip(workspaceRoot, url.searchParams.get("projectId") ?? "");
        res.statusCode = 200; res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Disposition", 'attachment; filename="source.zip"'); res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.end(data);
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      finally { exportingSource = false; }
      return;
    }
    if(url.pathname==='/api/paperfocus/linked-workspaces'){
      try{
        if(req.method==='GET'){json(res,200,{links:await linkedWorkspaces(workspaceRoot)});return;}
        if(req.method==='POST'&&req.headers.origin===`http://${req.headers.host}`){const request=JSON.parse(await requestBody(req,2000));json(res,200,await openLinkedWorkspace(workspaceRoot,request.projectId));return;}
        json(res,405,{error:'Choose a linked workspace.'});
      }catch(error){json(res,400,{error:error instanceof Error?error.message:String(error)});}return;
    }
    if (url.pathname === "/api/paperfocus/projects") {
      try {
        if (req.method === "GET") { json(res, 200, await activityOrderedProjects(workspaceRoot)); return; }
        if (req.method === "POST") {
          const request = JSON.parse(await requestBody(req, 60_000_000));
          if (request.action === "create" && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Create papers from this editor's local origin." }); return; }
          const document = await serialize(async () => {
            if (request.action === "create") {
              const project = await createPaperProject(workspaceRoot, request.name, request.files);
              return selectProject(workspaceRoot, project.id);
            }
            if (request.action === "clone") return cloneRepository(workspaceRoot, request.url, request.name, request.token);
            if (request.action === "open") {
              const project = await registerProject(workspaceRoot, request.folder, request.name);
              return selectProject(workspaceRoot, project.id);
            }
            if (request.action === "select") return selectProject(workspaceRoot, request.projectId, request.mainFile, request.engine, request.expected);
            throw new Error("Choose create, clone, open, or select.");
          });
          json(res, 200, { success: true, document }); return;
        }
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); return; }
    }
    if (url.pathname === "/api/paperfocus/manuscripts/pin") {
      if (req.method !== "POST") { json(res, 405, { error: "Use POST to pin a manuscript." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Pin from this editor's local origin." }); return; }
      try { const request = JSON.parse(await requestBody(req)); json(res, 200, await serialize(() => setManuscriptPin(workspaceRoot, request))); }
      catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/manuscripts/purpose") {
      if (req.method !== "POST") { json(res, 405, { error: "Use POST to change manuscript purpose." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Change manuscript purpose from this editor's local origin." }); return; }
      try { const request = JSON.parse(await requestBody(req)); json(res, 200, await serialize(() => setManuscriptPurpose(workspaceRoot, request))); }
      catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/notebook/transfer") {
      if (req.method !== "POST") { json(res, 405, { error: "Use POST to transfer notebook conversations." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Transfer from this editor's local origin." }); return; }
      try { const request = JSON.parse(await requestBody(req)); json(res, 200, await serialize(() => transferNotebook(workspaceRoot, request))); }
      catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/manuscripts/version") {
      if (req.method !== "POST") { json(res, 405, { error: "Use POST to create a version." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Create versions from this editor's local origin." }); return; }
      try { const request = JSON.parse(await requestBody(req)); json(res, 200, await serialize(() => createManuscriptVersion(workspaceRoot, request))); }
      catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/paragraph-join") {
      if (req.method !== "POST") { json(res, 405, { error: "Use an explicit POST to merge blocks." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Merge blocks from this editor's local origin." }); return; }
      try {
        const request = JSON.parse(await requestBody(req));
        const result = await serialize(async () => request.undo ? { parsed: await undoParagraphJoin(workspaceRoot, request.undo) } : joinParagraphs(workspaceRoot, request));
        json(res, 200, { document: publicDocument(result.parsed), saveAcknowledgement: result.parsed.saveAcknowledgement,
          ...("undo" in result ? { undo: result.undo, caret: result.caret } : {}) });
      } catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/files/section" || url.pathname === "/api/paperfocus/files/section/undo") {
      if (req.method !== "POST") { json(res, 405, { error: "Use an explicit POST to create a section file." }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Create section files from this editor's local origin." }); return; }
      try { const request = JSON.parse(await requestBody(req)); json(res, 200, url.pathname.endsWith("/undo") ? await serialize(() => undoSectionFile(workspaceRoot, request)) : await serialize(() => createSectionFile(workspaceRoot, request))); }
      catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/files" || url.pathname === "/api/paperfocus/files/content") {
      try {
        if (req.method === "POST" && url.pathname.endsWith("/files")) {
          if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Add files from this editor's local origin." }); return; }
          const request = JSON.parse(await requestBody(req, 60_000_000));
          const document = await serialize(async () => {
            await addProjectFiles(workspaceRoot, request.projectId, request.revision, request.mainFile, request.files);
            return publicDocument(await editableProject(workspaceRoot, request.projectId));
          });
          json(res, 200, { document }); return;
        }
        if (req.method === "GET") {
          const id = url.searchParams.get("projectId") ?? "", file = url.searchParams.get("file");
          if (url.pathname.endsWith("/content")) {
            const result = await projectFileContent(workspaceRoot, id, file);
            res.setHeader("Content-Type", result.mime); res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
            res.end(result.data);
          } else json(res, 200, await projectFilePreview(workspaceRoot, id, file));
          return;
        }
        json(res, 405, { error: "Use GET to preview or POST to add files." });
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/source-status") {
      if (req.method !== "GET") { json(res, 405, { error: "Source checks are read-only." }); return; }
      try { json(res, 200, await sourceStatus(workspaceRoot, url.searchParams.get("projectId") ?? "")); }
      catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/source-drafts") {
      try {
        if (req.method === "GET") { json(res, 200, await readSourceDraftCopies(workspaceRoot, url.searchParams.get("projectId") ?? "")); return; }
        if (req.method === "POST") { const request = JSON.parse(await requestBody(req)); json(res, 200, await saveSourceDraftCopy(workspaceRoot, request.projectId, request)); return; }
        json(res, 405, { error: "Use GET or POST for source draft copies." });
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/document") {
      try {
        if (req.method === "GET") { const id=url.searchParams.get("projectId") ?? undefined,file=url.searchParams.get("sourceFile");json(res,200,file ? await readSourceFile(workspaceRoot,id,file) : publicDocument(await editableProject(workspaceRoot,id))); return; }
        if (req.method === "POST") {
          const request = JSON.parse(await requestBody(req));
          if (request.environmentChange && (Object.keys(request.paragraphEdits ?? {}).length || request.sourceRanges !== undefined)) throw new Error("Save text edits before changing an environment type.");
          const saved = await serialize(() => request.environmentChange ? changeEnvironment(workspaceRoot, { ...request.environmentChange, projectId: request.projectId, revision: request.revision, mainFile: request.mainFile }) : saveEdits(workspaceRoot, request.projectId, request.paragraphEdits ?? {}, request.revision, request.sourceRanges, request.mainFile));
          json(res, 200, { success: true, document: publicDocument(saved), saveAcknowledgement: saved.saveAcknowledgement }); return;
        }
      } catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); return; }
    }
    if (url.pathname === "/api/paperfocus/workbench") {
      try {
        if (req.method === "GET") { conditionalStoreJson(req, res, await readWorkbench(workspaceRoot, url.searchParams.get("projectId") ?? "")); return; }
        if (req.method === "POST") {
          const request = JSON.parse(await requestBody(req));
          json(res, 200, await writeWorkbench(workspaceRoot, request.projectId, request.revision, request.data)); return;
        }
        json(res, 405, { error: "Use GET or POST for saved work." }); return;
      } catch (error) { json(res, error instanceof WorkbenchConflict ? 409 : 400, { error: error instanceof Error ? error.message : String(error) }); return; }
    }
    if (url.pathname === "/api/paperfocus/notebook") {
      try {
        if (req.method === "GET") { conditionalStoreJson(req, res, await readNotebook(workspaceRoot, url.searchParams.get("projectId") ?? "")); return; }
        if (req.method === "POST") {
          const request = JSON.parse(await requestBody(req));
          // Sidecar saves have their own per-paper queue; a long TeX build must
          // not delay retaining a question or reply in another workspace.
          json(res, 200, await writeNotebook(workspaceRoot, request.projectId, request.revision, request.entries)); return;
        }
      } catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); return; }
    }
    if (url.pathname.startsWith("/api/paperfocus/experiments")) {
      try {
        if (req.method === "POST" && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: "Experiment actions require this editor's local origin." }); return; }
        const projectId = url.searchParams.get("projectId") ?? "", notebookId = url.searchParams.get("notebookId") ?? "";
        if (req.method === "GET" && url.pathname === "/api/paperfocus/experiments/evidence/file") {
          const file = await readEvidenceFile(workspaceRoot, projectId, notebookId, url.searchParams.get("id") ?? "", url.searchParams.get("format") ?? "");
          res.statusCode = 200; res.setHeader("Content-Type", file.mime); res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`); res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.end(file.data); return;
        }
        if (req.method === "GET" && url.pathname.endsWith("/session")) { json(res, 200, await readExperimentSession(workspaceRoot, projectId, notebookId)); return; }
        if (req.method === "GET" && url.pathname.endsWith("/job")) { json(res, 200, await readExperimentJob(workspaceRoot, projectId, notebookId, url.searchParams.get("id") ?? "")); return; }
        if (req.method === "GET" && url.pathname === "/api/paperfocus/experiments") {
          const etag = typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : undefined;
          const store = await readExperimentsIfChanged(workspaceRoot, projectId, notebookId, etag);
          res.setHeader("ETag", store ? experimentEtag(store.revision) : etag!);
          if (!store) { res.statusCode = 304; res.setHeader("Cache-Control", "no-store"); res.end(); return; }
          json(res, 200, { ...store, runtime: await experimentRuntime() }); return;
        }
        if (req.method === "POST") {
          const request = JSON.parse(await requestBody(req));
          if (url.pathname === "/api/paperfocus/experiments/evidence") { json(res, 200, await saveEvidenceSnapshot(workspaceRoot, request.projectId, request.entryId, request.notebookId, request.revision)); return; }
          if (url.pathname.endsWith("/run")) { json(res, 202, await runExperiment(workspaceRoot, request.projectId, request.notebookId, request.cellId, request.revision, request.acknowledgeLocalExecution, request.executionMode, request.timeoutMs)); return; }
          if (url.pathname.endsWith("/restart-session")) { json(res, 200, await restartExperimentSession(workspaceRoot, request.projectId, request.notebookId)); return; }
          if (url.pathname.endsWith("/cancel")) { json(res, 200, await cancelExperimentJob(workspaceRoot, request.projectId, request.notebookId, request.id)); return; }
          if (url.pathname === "/api/paperfocus/experiments") { json(res, 200, await writeExperiments(workspaceRoot, request.projectId, request.notebookId, request.revision, request.notebook)); return; }
        }
        json(res, 405, { error: "Unknown experiment action." }); return;
      } catch (error) { json(res, error instanceof ExperimentConflict ? 409 : 400, { error: error instanceof Error ? error.message : String(error) }); return; }
    }
    if (url.pathname.startsWith("/api/paperfocus/references")) {
      try {
        const projectId = url.searchParams.get("projectId") ?? undefined;
        const key = url.searchParams.get("key") ?? "";
        if (req.method === "GET" && url.pathname === "/api/paperfocus/references/pdf") {
          const pdf = await readReferencePdf(workspaceRoot, projectId, key);
          res.setHeader("Content-Type", "application/pdf"); res.setHeader("Cache-Control", "no-store"); res.end(pdf); return;
        }
        if (req.method === "GET") { json(res, 200, await referenceLibrary(workspaceRoot, projectId)); return; }
        if (req.method === "POST" && url.pathname.endsWith("/upload")) {
          const parts: Buffer[] = []; let size = 0;
          for await (const part of req) { const bytes = Buffer.from(part); size += bytes.length; if (size > maxReferenceBytes) throw new Error("Choose a PDF smaller than 40 MB."); parts.push(bytes); }
          const copy = await serialize(() => storeReference(workspaceRoot, projectId, key, Buffer.concat(parts), url.searchParams.get("name") ?? "Local paper.pdf"));
          json(res, 200, { copy }); return;
        }
        if (req.method === "POST") {
          const request = JSON.parse(await requestBody(req));
          const copy = await serialize(() => {
            if (request.action === "attach") return attachProjectPdf(workspaceRoot, request.projectId, request.key, request.file);
            if (request.action === "arxiv") return downloadArxiv(workspaceRoot, request.projectId, request.key, request.arxivId);
            if (request.action === "location") return saveReferencePage(workspaceRoot, request.projectId, request.key, request.locator ?? "", request.page);
            throw new Error("Choose a PDF or a result location.");
          });
          json(res, 200, { copy }); return;
        }
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); return; }
    }
    if (url.pathname.startsWith("/api/paperfocus/github")) {
      try {
        if (req.method === "GET" && url.pathname.endsWith("/account")) { json(res, 200, await githubAccount(workspaceRoot)); return; }
        if (req.method === "GET" && url.pathname.endsWith("/repos")) { json(res, 200, await githubRepositories(workspaceRoot)); return; }
        if (req.method === "GET" && url.pathname.endsWith("/login")) { json(res, 200, githubLoginStatus(url.searchParams.get("id") ?? "") ?? { status: "failed", message: "Sign-in expired. Try again." }); return; }
        if (req.method === "POST" && url.pathname.endsWith("/login")) { json(res, 200, startGithubLogin(workspaceRoot)); return; }
        if (req.method === "POST" && url.pathname.endsWith("/publish")) {
          const request = JSON.parse(await requestBody(req));
          const status = await serialize(() => publishGithub(workspaceRoot, request.projectId, request.name, request.visibility, request.message));
          json(res, 200, { success: true, status }); return;
        }
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); return; }
    }
    if (req.method === "POST" && url.pathname === "/api/paperfocus/compile") {
      try {
        const raw = await requestBody(req);
        const request = raw ? (JSON.parse(raw) as CompileRequest) : {};
        json(res, 200, await serialize(() => compile(workspaceRoot, request)));
      } catch (error) {
        json(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/paperfocus/source-sync") {
      try {
        const request = JSON.parse(await requestBody(req));
        if (typeof request.projectId !== "string" || !request.projectId) throw new Error("Choose a paper before linking its source.");
        const answer = await serialize(async () => {
          const { project, root } = await getProject(workspaceRoot, request.projectId);
          const mode = request.mode === "focus" ? "focus" : "full";
          if (request.artifactKey && !/^[a-f0-9]{16}$/.test(request.artifactKey)) throw new Error("Invalid build link.");
          const build = await projectBuildFolder(workspaceRoot, project.id, undefined, undefined, false);
          let output = await projectBuildFolder(workspaceRoot, project.id, mode, mode === "focus" ? request.artifactKey : undefined, false);
          const recordPath = mode === "focus" && request.artifactKey ? path.join(output, "compile.json") : path.join(build, `${mode}-compile.json`);
          let record = JSON.parse(await readFile(recordPath, "utf8")) as BuildRecord;
          const parsed = await parseProject(workspaceRoot, project.id, true);
          if (!record.success || record.mainFile !== project.mainFile || record.engine !== project.engine || !record.sourceRanges
            || request.compiledAt && request.compiledAt !== record.compiledAt) {
            throw new Error("This PDF was replaced or belongs to another manuscript. Reopen its current PDF before linking.");
          }
          const currentRanges = compiledSourceRanges(parsed);
          const approximate = request.hasDrafts || record.sourceRevision !== parsed.revision;
          let pageOffset = 0;
          if (record.sectionParts) {
            const oldRange = request.direction === "forward" && correspondingRange(request.paragraphId, currentRanges, record.sourceRanges);
            const part = request.direction === "forward" ? record.sectionParts.find(p => oldRange && p.paragraphIds.includes(oldRange.paragraphId))
              : record.sectionParts.find(p => Number.isInteger(request.page) && request.page > p.pageOffset && request.page <= p.pageOffset + p.pageCount);
            if (!part || !/^[a-f0-9]{16}$/.test(part.artifactKey) || !Number.isSafeInteger(part.pageOffset) || part.pageOffset < 0) throw new Error("No section PDF matches this position.");
            pageOffset = part.pageOffset;
            if (request.direction === "inverse") request.page -= pageOffset;
            output = await projectBuildFolder(workspaceRoot, project.id, "focus", part.artifactKey, false);
            record = JSON.parse(await readFile(await checkedBuildFile(output, "compile.json"), "utf8"));
            if (!record.success || record.sectionParts || record.mainFile !== project.mainFile || record.engine !== project.engine || !record.sourceRanges) throw new Error("This section build is no longer available.");
          }
          if (record.workingKey && !/^[a-f0-9]{16}$/.test(record.workingKey)) throw new Error("Invalid compiler source identity.");
          const syncOutput = mode === "focus" && record.workingKey
            ? await projectBuildFolder(workspaceRoot, project.id, "focus", record.workingKey, false) : output;
          const pdf = path.join(output, `${mode === "full" ? path.basename(project.mainFile, ".tex") : focusedJobName(output)}.pdf`);
          if (request.direction === "forward") {
            const range = correspondingRange(request.paragraphId, currentRanges, record.sourceRanges);
            if (!range) throw new Error("This source file is not in this PDF. Open a PDF containing it first.");
            const file = mode === "focus" ? path.join(syncOutput, `${focusedJobName(syncOutput)}.tex`) : path.resolve(root, range.file);
            const results = await querySync(root, "view", `${range.startLine}:0:${file.replaceAll("\\", "/")}`, pdf);
            const target = results.find(item => Number(item.Page) >= 1 && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y)));
            if (!target) throw new Error("LaTeX supplied no position for this passage.");
            return { page: Number(target.Page) + pageOffset, x: Number(target.x), y: Number(target.y), approximate };
          }
          if (request.direction !== "inverse" || !Number.isInteger(request.page) || request.page < 1 || request.page > 100000
            || !Number.isFinite(request.x) || !Number.isFinite(request.y) || Math.abs(request.x) > 10000 || Math.abs(request.y) > 10000) throw new Error("Invalid PDF position.");
          const results = await querySync(root, "edit", `${request.page}:${request.x}:${request.y}`, pdf);
          for (const target of results) {
            if (!target.Input || !Number.isInteger(Number(target.Line))) continue;
            const file = path.resolve(root, target.Input);
            if (mode === "full" && !inside(root, file)) continue;
            if (mode === "focus" && sourcePath(file) !== sourcePath(path.resolve(syncOutput, `${focusedJobName(syncOutput)}.tex`))) continue;
            const candidates = record.sourceRanges.filter(range => mode === "focus" || sourcePath(path.resolve(root, range.file)) === sourcePath(file));
            const line = Number(target.Line);
            const distance = (range: CompiledSourceRange) => Math.max(range.startLine - line, line - range.endLine, 0);
            const range = candidates.sort((a, b) => distance(a) - distance(b))[0];
            const currentRange = range && correspondingRange(range.paragraphId, record.sourceRanges, currentRanges);
            const paragraph = currentRange && parsed.paragraphs.find(item => item.id === currentRange.paragraphId);
            if (paragraph) return { paragraphId: paragraph.id, nodeId: paragraph.nodeId, approximate };
          }
          throw new Error("No editable passage was found at this PDF position.");
        });
        json(res, 200, answer);
      } catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/paperfocus/review/export") {
      try {
        if (req.headers.origin !== `http://${req.headers.host}`) throw new Error("Review exports must originate in this editor.");
        const request = JSON.parse(await requestBody(req));
        json(res, 200, { success: true, ...await exportReview(workspaceRoot, request.projectId, request.task) });
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/paperfocus/review/annotated") {
      try {
        if (req.headers.origin !== `http://${req.headers.host}`) throw new Error("Review exports must originate in this editor.");
        const request = JSON.parse(await requestBody(req));
        json(res, 200, await annotateCompletedReview(workspaceRoot, request.projectId, request.id, request.reply));
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/research/finish") {
      try {
        if (req.method !== "POST" || req.headers.origin !== `http://${req.headers.host}`) throw new Error("Notebook completion must originate in this editor.");
        json(res, 200, await finishResearch(workspaceRoot, JSON.parse(await requestBody(req))));
      } catch (error) { json(res, error instanceof ExperimentConflict ? 409 : 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/handoff/ticket") {
      try {
        if (req.method !== "GET") throw new Error("Use GET to read saved prompt instructions.");
        json(res, 200, { ticket: await readHandoffTicket(workspaceRoot, url.searchParams.get("projectId") ?? "", url.searchParams.get("id") ?? "") });
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (url.pathname === "/api/paperfocus/handoff/status") {
      try {
        if (req.method !== "GET") throw new Error("Use GET to check a shared-file reply.");
        json(res, 200, await readHandoff(workspaceRoot, url.searchParams.get("projectId") ?? "", url.searchParams.get("id") ?? ""));
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/paperfocus/handoff") {
      try {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new Error("Handoffs must originate in this editor.");
        const request = JSON.parse(await requestBody(req));
        const ticket = await createHandoff(workspaceRoot, request.projectId, { id: request.id, packet: request.content,
          transport: request.transport ?? (request.mode === "codex" ? "files" : "paste"), label: request.label, notebookTarget: request.notebookTarget, origin: `http://${req.headers.host}` });
        json(res, 200, { success: true, path: ticket.promptPath, ticket });
      } catch (error) {
        json(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (url.pathname.startsWith("/api/paperfocus/local-")) {
      try {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new Error("Local model actions must originate in this editor.");
        if (req.method === "GET" && url.pathname === "/api/paperfocus/local-models") { json(res, 200, await localModels()); return; }
        if (req.method === "POST" && url.pathname === "/api/paperfocus/local-unload") { json(res, 200, await unloadLocalModels()); return; }
        if (req.method === "POST" && url.pathname === "/api/paperfocus/local-study") {
          const request = JSON.parse(await requestBody(req)); const { project } = await getProject(workspaceRoot, request.projectId);
          json(res, 202, await queueLocalStudy(workspaceRoot, { ...request, projectId: project.id })); return;
        }
        if (req.method === "POST" && url.pathname === "/api/paperfocus/local-rewrite/cancel") {
          const request = JSON.parse(await requestBody(req)); const { project } = await getProject(workspaceRoot, request.projectId);
          json(res, 200, await cancelLocalJob(workspaceRoot, request.id, project.id)); return;
        }
        if (req.method === "POST" && url.pathname === "/api/paperfocus/local-rewrite") {
          const request = JSON.parse(await requestBody(req));
          const { project } = await getProject(workspaceRoot, request.projectId);
          json(res, 202, await queueLocalRewrite(workspaceRoot, { ...request, projectId: project.id })); return;
        }
        if (req.method === "GET" && url.pathname === "/api/paperfocus/local-rewrite/job") {
          const { project } = await getProject(workspaceRoot, url.searchParams.get("projectId") ?? undefined);
          json(res, 200, await readLocalJob(workspaceRoot, url.searchParams.get("id") ?? "", project.id)); return;
        }
        json(res, 404, { error: "Unknown local-model action." });
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/paperfocus/latex-assist") {
      try {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new Error("Local model actions must originate in this editor.");
        const raw = await requestBody(req);
        const request = JSON.parse(raw) as {
          route?: "rules" | "local";
          effort?: string;
          diagnostics?: LatexDiagnostic[];
          log?: string;
          model?: string;
        };
        const diagnostics = request.diagnostics ?? [];
        if (request.route !== "local") {
          json(res, 200, {
            success: true,
            provider: "Built-in rules",
            cached: true,
            suggestions: diagnostics.flatMap((diagnostic) => diagnostic.suggestions),
          });
          return;
        }

        if (!request.model) throw new Error("Select a downloaded local model.");
        json(res, 200, await localDiagnostic(workspaceRoot, request.model, request.effort === "tiny" ? 0 : request.effort === "thorough" ? 3 : request.effort === "balanced" ? 2 : 1, diagnostics, request.log ?? ""));
      } catch (error) {
        json(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/paperfocus/git") {
      try {
        if (req.method === "GET") {
          json(res, 200, await repoStatus(workspaceRoot, url.searchParams.get("projectId") ?? undefined)); return;
        }
        const raw = await requestBody(req);
        const request = JSON.parse(raw);
        if (request.action === "identity") {
          const { root } = await getProject(workspaceRoot, request.projectId);
          if (!request.name?.trim() || !request.email?.trim() || /[\r\n]/.test(request.name + request.email)) throw new Error("Enter a valid author name and email.");
          await serialize(async () => {
            if (!(await repoStatus(workspaceRoot, request.projectId)).initialized) await checked("git", ["init", "-b", "main"], root);
            await checked("git", ["config", "user.name", request.name], root);
            await checked("git", ["config", "user.email", request.email], root);
          });
          json(res, 200, { success: true }); return;
        }
        if (request.action === "connect") {
          json(res, 200, { success: true, status: await serialize(() => connectRemote(workspaceRoot, request.projectId, request.url)) }); return;
        }
        const result = await serialize(() => syncRepository(workspaceRoot, request.projectId, request.action, request.remote ?? "origin", request.message, request.token));
        json(res, 200, { success: true, ...result });
      } catch (error) {
        json(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/paperfocus/git/diff") {
      try {
        const { root } = await getProject(workspaceRoot, url.searchParams.get("projectId") ?? undefined);
        let result = await run("git", ["diff", "HEAD", "--", ".", ":(exclude).paperfocus"], root);
        if (result.code !== 0) result = await run("git", ["diff", "--", ".", ":(exclude).paperfocus"], root);
        json(res, 200, { diff: result.output.slice(0, 60_000) });
      } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/paperfocus/status") {
      try {
        const { project } = await getProject(workspaceRoot, url.searchParams.get("projectId") ?? undefined);
        const buildRoot = await projectBuildFolder(workspaceRoot, project.id, undefined, undefined, false);
        const status = JSON.parse(await readFile(path.join(buildRoot, "last-compile.json"), "utf8")) as {
          mode: CompileMode;
          success: boolean;
          pdfUrl?: string;
          compiledAt: string;
          sourceRevision?: string;
          mainFile?: string;
          engine?: string;
          artifactKey?: string;
          sectionParts?: SectionPdfPart[];
          dependencies?: unknown;
          sourceRanges?: unknown;
        };
        let fullCompile: typeof status | undefined;
        try {
          fullCompile = JSON.parse(
            await readFile(path.join(buildRoot, "full-compile.json"), "utf8"),
          ) as typeof status;
        } catch {
          fullCompile = undefined;
        }
        const parsed = await editableProject(workspaceRoot, project.id);
        const statusStale = status.sourceRevision !== parsed.revision || status.mainFile !== project.mainFile || status.engine !== project.engine;
        if (status.success) status.pdfUrl = status.sectionParts ? `/api/paperfocus/section-pdf?projectId=${project.id}&build=${status.artifactKey}` : `/api/paperfocus/pdf/${status.mode}?projectId=${project.id}${status.artifactKey ? `&build=${status.artifactKey}` : ""}&v=${Date.parse(status.compiledAt)}`;
        delete status.dependencies; delete status.sourceRanges;
        if (fullCompile) { delete fullCompile.dependencies; delete fullCompile.sourceRanges; }
        json(res, 200, {
          ...status,
          stale: statusStale,
          fullVerified: await fullVerified(workspaceRoot, project.id),
          fullCompile,
        });
      } catch {
        res.statusCode = 204;
        res.end();
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/paperfocus/section-pdf") {
      try {
        const { project } = await getProject(workspaceRoot, url.searchParams.get("projectId") ?? undefined);
        const key = url.searchParams.get("build") ?? ""; if (!/^[a-f0-9]{16}$/.test(key)) throw new Error("Invalid section PDF identity.");
        const folder = await projectBuildFolder(workspaceRoot, project.id, "focus", key, false);
        const record = JSON.parse(await readFile(await checkedBuildFile(folder, "compile.json"), "utf8"));
        if (!record.success || !record.sectionParts || record.mainFile !== project.mainFile || record.engine !== project.engine) throw new Error("Section PDF unavailable for this manuscript.");
        const { sourceRanges: _ranges, dependencies: _deps, workingKey: _working, ...publicRecord } = record;
        json(res, 200, publicRecord);
      } catch (error) { json(res, 404, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    const match = url.pathname.match(/^\/api\/paperfocus\/pdf\/(focus|full)$/);
    if (req.method === "GET" && match) {
      const mode = match[1] as CompileMode;
      try {
        const { project } = await getProject(workspaceRoot, url.searchParams.get("projectId") ?? undefined);
        const key = mode === "focus" ? url.searchParams.get("build") : undefined;
        if (key && !/^[a-f0-9]{16}$/.test(key)) throw new Error("Invalid build link.");
        const output = await projectBuildFolder(workspaceRoot, project.id, mode, key ?? undefined, false);
        const corpus = await readCorpus(workspaceRoot, project.id);
        if (corpus) {
          const root = await projectBuildFolder(workspaceRoot, project.id);
          const record = JSON.parse(await readFile(mode === 'full' ? path.join(root, 'full-compile.json') : path.join(output, 'compile.json'), 'utf8'));
          if (record.corpusRevision !== corpus.revision) throw Error('Compile the current Show / hide selection first.');
        }
        const filename = mode === "full" ? `${path.basename(project.mainFile, ".tex")}.pdf` : `${focusedJobName(output)}.pdf`;
        const pdfPath = await checkedBuildFile(output, filename);
        const pdf = await readFile(pdfPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "no-store");
        res.end(pdf);
      } catch {
        json(res, 404, { error: "Compile this view before requesting its PDF." });
      }
      return;
    }
    next();
  };
}

export function latexPlugin(workspaceRoot: string): Plugin {
  return {
    name: "paperfocus-latex",
    configureServer(server) {
      server.middlewares.use(latexMiddleware(workspaceRoot));
    },
    configurePreviewServer(server) {
      server.middlewares.use(latexMiddleware(workspaceRoot));
    },
  };
}

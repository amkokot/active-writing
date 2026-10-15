import { manuscriptPurpose } from "../src/manuscripts.ts";
import type { ManuscriptPurpose } from "../src/types.ts";
import { parseProject, registry, saveRegistry } from "./projects.ts";

/** Metadata only: never writes TeX, approves prose or clears pending work. Caller serializes mutations. */
export async function setManuscriptPurpose(workspace: string, input: {
  projectId: string; mainFile: string; revision: string; file: string;
  purpose: ManuscriptPurpose; expectedPurpose: ManuscriptPurpose;
  targetFile?: string; expectedTarget?: string;
}) {
  if (!input || typeof input.projectId !== "string" || !input.projectId || typeof input.file !== "string"
    || !["notes", "overview", "publication"].includes(input.purpose) || !["notes", "overview", "publication"].includes(input.expectedPurpose)) throw new Error("Choose research notes, overview or publication draft for a specific manuscript.");
  const document = await parseProject(workspace, input.projectId);
  if (document.project.mainFile !== input.mainFile || document.revision !== input.revision) throw new Error("The manuscript or source changed. Inspect it before changing its purpose.");
  if (!document.rootFiles.includes(input.file)) throw new Error("Choose an independent TeX root, not an included section file.");
  const linkChange = Object.hasOwn(input, "targetFile");
  if (linkChange && (input.purpose !== "overview" || typeof input.targetFile !== "string" || input.targetFile && (input.targetFile === input.file || !document.rootFiles.includes(input.targetFile)))) throw new Error("An overview can link to another existing independent manuscript in this project.");
  const catalogue = await registry(workspace), project = catalogue.projects.find(p => p.id === input.projectId);
  if (!project || project.mainFile !== input.mainFile || manuscriptPurpose(project, input.file) !== input.expectedPurpose) throw new Error("The manuscript purpose changed in another window. Inspect it before retrying.");
  if (linkChange && (project.manuscriptOverviewTargets?.[input.file] ?? "") !== (input.expectedTarget ?? "")) throw new Error("The overview link changed in another window. Inspect before retrying.");
  project.manuscriptPurposes = { ...project.manuscriptPurposes, [input.file]: input.purpose };
  if (linkChange) {
    project.manuscriptOverviewTargets = { ...project.manuscriptOverviewTargets };
    if (input.targetFile) project.manuscriptOverviewTargets[input.file] = input.targetFile;
    else delete project.manuscriptOverviewTargets[input.file];
  }
  await saveRegistry(workspace, catalogue);
  document.project = { ...document.project, manuscriptPurposes: project.manuscriptPurposes, manuscriptOverviewTargets: project.manuscriptOverviewTargets };
  return { document };
}

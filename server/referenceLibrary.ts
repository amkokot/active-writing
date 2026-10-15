import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ReferenceCopy } from "../src/types.ts";
import { getProject, hash, inside, projectFiles } from "./projects.ts";
import { arxivId } from "./bibliography.ts";
import { replaceFile } from "./atomicFile.ts";
import { projectStorage } from "./projectStorage.ts";

export const maxReferenceBytes = 40_000_000;
interface Library { copies: Record<string, ReferenceCopy> }
async function validateCacheTarget(root: string, target: string) {
  try {
    if (!inside(root, await realpath(target))) throw new Error("Reference cache paths must stay inside the paper folder.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function saveLibrary(folder: string, library: Library) {
  const target = path.join(folder, "index.json");
  await validateCacheTarget(folder, target);
  const temporary = path.join(folder, `index-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(library, null, 2));
  await replaceFile(temporary, target);
}
async function context(workspace: string, projectId?: string) {
  const { paperRoot: root, folder: data } = await projectStorage(workspace, projectId);
  const folder = path.join(data, "references");
  await validateCacheTarget(data, folder);
  await validateCacheTarget(folder, path.join(folder, "index.json"));
  let library: Library = { copies: {} };
  try { library = JSON.parse(await readFile(path.join(folder, "index.json"), "utf8")); } catch { /* Empty local library. */ }
  library.copies = Object.assign(Object.create(null), library.copies);
  return { root, folder, library };
}
function citationKey(key: string) {
  if (!key?.trim() || key.length > 500 || /[\x00-\x1f]/.test(key)) throw new Error("Choose a citation key.");
}
export async function referenceLibrary(workspace: string, projectId?: string) {
  const { root, library } = await context(workspace, projectId);
  return { ...library, pdfFiles: (await projectFiles(root)).filter((file) => /\.pdf$/i.test(file)) };
}
export async function storeReference(workspace: string, projectId: string | undefined, key: string, bytes: Buffer, name: string) {
  citationKey(key);
  if (bytes.length > maxReferenceBytes || !bytes.subarray(0, 1024).toString("ascii").includes("%PDF-")) throw new Error("Choose a PDF smaller than 40 MB.");
  const { folder, library } = await context(workspace, projectId);
  await mkdir(folder, { recursive: true });
  const filename = `${hash(bytes.toString("base64"))}.pdf`;
  const target = path.join(folder, filename);
  await validateCacheTarget(folder, target);
  try { await writeFile(target, bytes, { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const old = library.copies[key];
  library.copies[key] = { filename, name: path.basename(name).slice(0, 200), pages: old?.filename === filename ? old.pages : {} };
  await saveLibrary(folder, library);
  return library.copies[key];
}
export async function attachProjectPdf(workspace: string, projectId: string | undefined, key: string, file: string) {
  const { root } = await context(workspace, projectId);
  if (!(await projectFiles(root)).includes(file) || !/\.pdf$/i.test(file)) throw new Error("Choose a PDF listed in this project.");
  const resolved = await realpath(path.resolve(root, file));
  if (!inside(root, resolved)) throw new Error("The PDF must stay inside the project.");
  return storeReference(workspace, projectId, key, await readFile(resolved), file);
}
export async function downloadArxiv(workspace: string, projectId: string | undefined, key: string, id: string) {
  const valid = arxivId(id);
  if (!valid) throw new Error("This bibliography entry does not contain a valid arXiv identifier.");
  // Only this fixed public host is fetched; bibliography URLs cannot become arbitrary server requests.
  const response = await fetch(`https://arxiv.org/pdf/${valid}`, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`arXiv returned ${response.status}. Open its link or attach a local PDF instead.`);
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const part of response.body) {
    length += part.length;
    if (length > maxReferenceBytes) { await response.body.cancel().catch(() => undefined); throw new Error("This arXiv PDF exceeds the 40 MB reader limit."); }
    parts.push(part);
  }
  return storeReference(workspace, projectId, key, Buffer.concat(parts), `arXiv ${valid}.pdf`);
}
export async function saveReferencePage(workspace: string, projectId: string | undefined, key: string, locator: string, page: number) {
  citationKey(key);
  const { folder, library } = await context(workspace, projectId);
  const copy = library.copies[key];
  if (!copy) throw new Error("Attach or fetch the cited PDF first.");
  if (!Number.isInteger(page) || page < 1 || page > 20_000 || locator.length > 500) throw new Error("Choose a valid page and a short result name.");
  copy.pages[locator.trim()] = page;
  await saveLibrary(folder, library);
  return copy;
}
export async function readReferencePdf(workspace: string, projectId: string | undefined, key: string) {
  const { folder, library } = await context(workspace, projectId);
  const copy = library.copies[key];
  if (!copy || !/^[a-f0-9]{64}\.pdf$/.test(copy.filename)) throw new Error("Attach or fetch this cited paper first.");
  const resolved = await realpath(path.join(folder, copy.filename));
  if (!inside(folder, resolved)) throw new Error("The reference copy must stay inside the local cache.");
  return readFile(resolved);
}

export type ProjectFileKind = "tex" | "image" | "pdf" | "text" | "other";
export interface ProjectUpload { path: string; data: string }
export interface ProjectFilePreview { file: string; size: number; kind: ProjectFileKind; text?: string; truncated?: boolean }
export const maxProjectFileBytes = 20 * 1024 * 1024;
export const maxProjectUploadBytes = 40 * 1024 * 1024;
export const maxProjectUploadFiles = 200;

export function projectFileKind(file: string): ProjectFileKind {
  const extension = file.split(".").at(-1)?.toLowerCase();
  if (extension === "tex") return "tex";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension ?? "")) return "image";
  if (extension === "pdf") return "pdf";
  if (["bib", "sty", "cls", "txt", "md", "csv", "json", "svg", "eps", "bst", "py", "r"].includes(extension ?? "")) return "text";
  return "other";
}

export function projectFileCommand(file: string): string | undefined {
  if (/[\\{}%#\r\n\x00-\x1f]/.test(file)) return undefined;
  const argument = /\s/.test(file) ? `\\detokenize{${file}}` : file;
  if (projectFileKind(file) === "tex") return `\\input{${argument}}`;
  if (["image", "pdf"].includes(projectFileKind(file)) || /\.eps$/i.test(file)) return `\\includegraphics[width=\\linewidth]{${argument}}`;
  return undefined;
}

// Folder pickers include the selected directory's name; project paths do not.
export function uploadPaths(files: Array<{ name: string; webkitRelativePath?: string }>) {
  const paths = files.map(file => file.webkitRelativePath || file.name);
  const commonRoot = paths.length > 0 && files.every(file => Boolean(file.webkitRelativePath)) && paths.every(file => file.split("/")[0] === paths[0].split("/")[0]);
  return paths.map(file => commonRoot ? file.split("/").slice(1).join("/") : file);
}

export function isProjectCachePath(file: string) {
  return file.split("/").some(part => [".git", ".paperfocus", "node_modules", "dist"].includes(part.toLowerCase()));
}

export async function prepareProjectUploads(files: File[]): Promise<{ files: ProjectUpload[]; skipped: number }> {
  const paths = uploadPaths(files);
  const selected = files.map((file, index) => ({ file, path: paths[index] })).filter(item => !isProjectCachePath(item.path));
  if (!selected.length) throw new Error("Choose at least one project file.");
  if (selected.length > maxProjectUploadFiles) throw new Error(`Add at most ${maxProjectUploadFiles} files at a time.`);
  if (selected.some(item => item.file.size > maxProjectFileBytes)) throw new Error("Each file must be at most 20 MB.");
  if (selected.reduce((total, item) => total + item.file.size, 0) > maxProjectUploadBytes) throw new Error("Add at most 40 MB at a time.");
  const uploads: ProjectUpload[] = [];
  for (const item of selected) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error(`Could not read ${item.path}.`));
      reader.readAsDataURL(item.file);
    });
    uploads.push({ path: item.path, data });
  }
  return { files: uploads, skipped: files.length - selected.length };
}

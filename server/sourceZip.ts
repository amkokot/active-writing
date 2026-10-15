import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { getProject, inside } from "./projects.ts";
import { readerSnapshotPaths } from "./readerFolder.ts";

const compress = promisify(deflateRaw);
const ignoredFolders = new Set(["node_modules", "dist", "build", "out", "target", "__pycache__", "venv", "env"]);
const generated = /\.(?:aux|log|toc|lof|lot|out|fls|fdb_latexmk|synctex(?:\.gz)?|nav|snm|vrb|bcf|run\.xml|blg|pyc|aw-lock)$/i;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  return c >>> 0;
});
function crc32(data: Buffer) {
  let c = 0xffffffff;
  for (const byte of data) c = (c >>> 8) ^ crcTable[(c ^ byte) & 255];
  return (c ^ 0xffffffff) >>> 0;
}

// Standard ZIP with UTF-8 names and DEFLATE; no dependency, shell or temporary archive.
export async function zipEntries(entries: Array<{ name: string; data: Buffer }>) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0, directorySize = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = await compress(entry.data), crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // 1980-01-01; archive timestamps are intentionally neutral.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(entry.data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(entry.data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name); directorySize += record.length + name.length;
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

async function inventory(root: string, mainFile: string) {
  const files: Array<{ name: string; size: number; mtimeMs: number; ctimeMs: number }> = [];
  const readerPaths = await readerSnapshotPaths(root);
  let total = 0, visited = 0;
  async function walk(relative: string, depth: number) {
    if (depth > 32) throw new Error("Project folders are too deeply nested to export.");
    const folder = path.join(root, relative), info = await lstat(folder);
    if (info.isSymbolicLink() || !info.isDirectory() || !inside(root, await realpath(folder))) throw new Error("Source export cannot follow folder links.");
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (++visited > 10000) throw new Error("Project has too many files to export.");
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (readerPaths.has(name)) continue;
      if (entry.isDirectory()) { if (!ignoredFolders.has(entry.name.toLowerCase())) await walk(name, depth + 1); continue; }
      if (!entry.isFile() || generated.test(name)) continue;
      const target = path.join(root, name), stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile() || !inside(root, await realpath(target))) throw new Error("A project file moved during export. Try again.");
      if (stat.size > 20 * 1024 * 1024 || (total += stat.size) > 100 * 1024 * 1024 || files.length >= 5000) throw new Error("Source export supports 5,000 files, 20 MB per file and 100 MB in total.");
      files.push({ name, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
    }
  }
  await walk("", 0);
  // A PDF figure may have a companion .tex diagram; keep those assets.
  const compiledPdf = mainFile.replace(/\.tex$/i, ".pdf").toLowerCase();
  return files.filter(file => file.name.toLowerCase() !== compiledPdf).sort((a, b) => a.name.localeCompare(b.name));
}

export async function sourceEntries(workspace: string, projectId: string) {
  const { root, project } = await getProject(workspace, projectId);
  const before = await inventory(root, project.mainFile), entries: Array<{ name: string; data: Buffer }> = [];
  for (const file of before) {
    let target = root;
    for (const part of file.name.split("/")) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink() || !inside(root, await realpath(target))) throw new Error("A source path changed during export. Try again.");
    }
    const handle = await open(target, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs || stat.ctimeMs !== file.ctimeMs) throw new Error("Source changed during export. Try again.");
      // Bound reads even if another process grows a file while the archive is prepared.
      const data = Buffer.alloc(file.size + 1);
      let length = 0;
      while (length < data.length) {
        const { bytesRead } = await handle.read(data, length, data.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== file.size) throw new Error("Source changed during export. Try again.");
      entries.push({ name: file.name, data: data.subarray(0, length) });
    } finally { await handle.close(); }
  }
  if (JSON.stringify(before) !== JSON.stringify(await inventory(root, project.mainFile))) throw new Error("Source changed during export. Try again.");
  return entries;
}

export async function sourceZip(workspace: string, projectId: string) { return zipEntries(await sourceEntries(workspace, projectId)); }

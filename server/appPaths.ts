import path from "node:path";
import { fileURLToPath } from "node:url";

// The executing code installation, not the selected research-data home or cwd.
export const appCodeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

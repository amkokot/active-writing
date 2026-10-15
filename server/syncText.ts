// Bounded, literal diff3 proposals. No model, TeX expansion or code execution.
export const textMergeLimits = { bytes: 512 * 1024, lines: 12000, cells: 2_000_000 };
interface Edit { start: number; end: number; lines: string[] }
const linesOf = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
function edits(base: string[], other: string[]): Edit[] | undefined {
  let first = 0, end = base.length, last = other.length;
  while (first < end && first < last && base[first] === other[first]) first++;
  while (end > first && last > first && base[end - 1] === other[last - 1]) { end--; last--; }
  const n = end - first, m = last - first, width = m + 1;
  if ((n + 1) * width > textMergeLimits.cells) return undefined;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * width + j] = base[first + i] === other[first + j]
    ? 1 + dp[(i + 1) * width + j + 1] : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  const result: Edit[] = []; let i = 0, j = 0, active: Edit | undefined;
  const flush = () => { if (active) result.push(active); active = undefined; };
  while (i < n || j < m) {
    if (i < n && j < m && base[first + i] === other[first + j]) { flush(); i++; j++; continue; }
    active ??= { start: first + i, end: first + i, lines: [] };
    if (i < n && (j === m || dp[(i + 1) * width + j] >= dp[i * width + j + 1])) { i++; active.end = first + i; }
    else active.lines.push(other[first + j++]);
  }
  flush(); return result;
}
export function mergeLiteralText(base: string, local: string, remote: string): { status: "combined" | "conflict" | "too-large"; text?: string } {
  if ([base, local, remote].some(text => Buffer.byteLength(text) > textMergeLimits.bytes)) return { status: "too-large" };
  if (local === remote) return { status: "combined", text: local };
  if (local === base) return { status: "combined", text: remote };
  if (remote === base) return { status: "combined", text: local };
  const b = linesOf(base), l = linesOf(local), r = linesOf(remote);
  if ([b, l, r].some(lines => lines.length > textMergeLimits.lines)) return { status: "too-large" };
  const left = edits(b, l), right = edits(b, r);
  if (!left || !right) return { status: "too-large" };
  const combined = [...left];
  for (const edit of right) {
    let duplicate = false;
    for (const other of left) {
      if (edit.start === other.start && edit.end === other.end && edit.lines.join("") === other.lines.join("")) { duplicate = true; continue; }
      const insertion = edit.start === edit.end || other.start === other.end;
      if (insertion ? edit.start <= other.end && other.start <= edit.end : edit.start < other.end && other.start < edit.end) return { status: "conflict" };
    }
    if (!duplicate) combined.push(edit);
  }
  combined.sort((a, b) => a.start - b.start || a.end - b.end);
  const output: string[] = []; let offset = 0;
  for (const edit of combined) { output.push(...b.slice(offset, edit.start), ...edit.lines); offset = edit.end; }
  output.push(...b.slice(offset)); const text = output.join("");
  return Buffer.byteLength(text) > textMergeLimits.bytes ? { status: "too-large" } : { status: "combined", text };
}

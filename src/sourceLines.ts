/** Hard source lines, not wrapped display rows. Offsets remain literal TeX offsets. */
export function sourceLineStarts(text: string) {
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === "\n") starts.push(index + 1);
  return starts;
}
export function lineAtOffset(starts: number[], offset: number) {
  let low = 0, high = starts.length;
  while (low < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle + 1; else high = middle; }
  return Math.max(1, low);
}

/** Source-only overscan. Never widen the preview or LaTeX compile selection. */
export function reelRange(total: number, first: number, count: number, overscan = 8) {
  const buffer = Math.max(2, Math.min(16, Math.round(overscan)));
  return { start: Math.max(0, first - buffer), end: Math.min(total, first + count + buffer) };
}

export function reelOpacity(distance: number, radius: number) {
  if (distance <= radius) return 1;
  return Math.max(0.16, 0.78 * Math.pow(0.7, distance - radius - 1));
}

/** Prefer the block containing the reading line, including a very tall block. */
export function reelCandidate(blocks: Array<{ id: string; top: number; bottom: number }>, line: number) {
  let nearest: string | undefined, score = Infinity;
  for (const block of blocks) {
    const distance = line < block.top ? block.top - line : line > block.bottom ? line - block.bottom : 0;
    if (distance < score) { nearest = block.id; score = distance; }
  }
  return nearest;
}

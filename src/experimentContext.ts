/** Local models get results from several cells, not the first cell's code prefix.
 * Keep this small helper independent of notebook editing/plot code so ordinary
 * study prompts do not eagerly load the experiment workspace implementation.
 * Legacy saved context remains readable; new context has explicit cell boundaries.
 */
export function compactExperimentContext(context: string | undefined, max = 1800) {
  if (!context) return "";
  const parts = context.split("\n\n## Cell ");
  if (parts.length === 1) return context.length > max ? `${context.slice(0, max - 65)}\n[Legacy context shortened; inspect the full notebook.]` : context;
  const header = parts.shift()!.slice(0, Math.min(350, Math.floor(max / 5)));
  const suffix = "\n[Bounded cell summaries; inspect the notebook for full evidence.]";
  const budget = Math.floor((max - header.length - suffix.length - 2 * parts.length) / parts.length);
  return [header, ...parts.map((part) => {
    const [metadata, evidence = ""] = part.split("\nSource excerpt:\n")[0].split("\nFindings excerpt:\n");
    const [title, ...state] = metadata.split("\n");
    // Long imported titles/folders must not consume a cell's entire findings share.
    const label = `## Cell ${title.slice(0, Math.min(70, Math.floor(budget / 5)))}\n${state.join(" ").slice(0, Math.min(100, Math.floor(budget / 4)))}\nFindings: `;
    return (label + evidence.slice(0, Math.max(0, budget - label.length))).slice(0, budget);
  })].join("\n\n") + suffix;
}

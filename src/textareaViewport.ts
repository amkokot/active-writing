/** Native textarea caret geometry after soft wrapping; never edits its value. */
export function textareaLineTops(input: HTMLTextAreaElement) {
  const style = getComputedStyle(input), mirror = document.createElement("div");
  mirror.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;box-sizing:border-box;border:0;margin:0;";
  for (const property of ["font", "line-height", "letter-spacing", "padding", "tab-size", "text-indent"]) mirror.style.setProperty(property, style.getPropertyValue(property));
  mirror.style.width = `${input.clientWidth}px`;
  const markers = input.value.split("\n").map((line, index, lines) => {
    const marker = document.createElement("span"); marker.textContent = "\u200b"; mirror.append(marker, document.createTextNode(line + (index < lines.length - 1 ? "\n" : ""))); return marker;
  });
  document.body.append(mirror);
  try { const top = mirror.getBoundingClientRect().top; return markers.map(marker => marker.getBoundingClientRect().top - top); }
  finally { mirror.remove(); }
}

export function textareaCaretTop(input: HTMLTextAreaElement, position: number) {
  const style = getComputedStyle(input), prefix = input.value.slice(0, Math.max(0, Math.min(input.value.length, position)));
  const lineHeight = parseFloat(style.lineHeight) || 20;
  // Avoid building a huge offscreen document for unusually large source files.
  if (prefix.length > 256_000) return (prefix.split("\n").length - 1) * lineHeight;
  const mirror = document.createElement("div"), marker = document.createElement("span");
  mirror.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;box-sizing:border-box;border:0;margin:0;";
  for (const property of ["font", "line-height", "letter-spacing", "padding", "tab-size", "text-indent"]) mirror.style.setProperty(property, style.getPropertyValue(property));
  mirror.style.width = `${input.clientWidth}px`;
  mirror.textContent = prefix; marker.textContent = "\u200b"; mirror.append(marker); document.body.append(mirror);
  try { return marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top; }
  finally { mirror.remove(); }
}

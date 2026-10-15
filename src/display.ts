import type { DisplayMode } from "./types";

export const defaultDisplayMode: DisplayMode = "source";
export const displayModes: Array<{ id: DisplayMode; label: string; description: string }> = [
  { id: "source", label: "Overleaf source", description: "Monaco / Menlo / Consolas; LaTeX text." },
  { id: "project", label: "Project-like", description: "Approximate paper font, not a typeset page." },
  { id: "manuscript", label: "Manuscript", description: "Serif text with simple page styling." },
  { id: "editing", label: "Editing", description: "Roomier text for revision." },
  { id: "compact", label: "Compact", description: "More text on screen." },
];

// Retain explicit saved appearances, including those from before source mode existed.
export function normalizeDisplayMode(value: unknown): DisplayMode {
  return displayModes.find(mode => mode.id === value)?.id ?? defaultDisplayMode;
}

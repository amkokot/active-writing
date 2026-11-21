import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { isPersonalNote, manuscriptDisplayLabel, pinnedManuscripts } from "../src/manuscripts.ts";
import type { PaperProject } from "../src/types.ts";
const project = (patch: Partial<PaperProject> = {}) => ({ id: "personal-note-trial", mainFile: "research-notes.tex", ...patch } as PaperProject);

test("personal references have separate navigation without changing automatic research pins", () => {
  const p = project();
  const roots = ["research-notes.tex", "personal-notes-mmd.tex"];
  assert.equal(isPersonalNote(p, roots[1]), true);
  assert.equal(manuscriptDisplayLabel(p, roots[1]), "Personal notes");
  assert.equal(pinnedManuscripts(p, roots).notes, "research-notes.tex");
  assert.equal(pinnedManuscripts(p, [roots[1]]).notes, undefined);
  assert.equal(isPersonalNote(p, "notes-on-personal-notes.tex"), false);
  assert.equal(isPersonalNote(p, "personal-notes/intuition.tex"), true);
  assert.equal(isPersonalNote(p, "Personal-Notes.tex"), true);
});

test("explicit document roles and human-selected pins take precedence over personal-note filenames", () => {
  const p = project({ manuscriptPurposes: { "personal-notes-paper.tex": "publication", "personal-notes-overview.tex": "overview" }, manuscriptPins: { notes: "personal-notes-mmd.tex" } });
  assert.equal(isPersonalNote(p, "personal-notes-paper.tex"), false);
  assert.equal(manuscriptDisplayLabel(p, "personal-notes-paper.tex"), "Publication draft");
  assert.equal(manuscriptDisplayLabel(p, "personal-notes-overview.tex"), "Overview");
  assert.equal(pinnedManuscripts(p, ["research-notes.tex", "personal-notes-mmd.tex"]).notes, "personal-notes-mmd.tex");
});

test("document menu exposes a personal-notes group and respects disabled navigation", async () => {
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
  try {
    const { ManuscriptSwitcher } = await server.ssrLoadModule("/src/components/ManuscriptSwitcher.tsx");
    const props = { document: { project: project({ mainFile: "personal-notes-mmd.tex" }), rootFiles: ["research-notes.tex", "personal-notes-mmd.tex"], revision: "test" }, disabled: true, onSelect: async () => {}, onCreate: async () => {}, onVersion: async () => {}, onPurpose: async () => {}, onPin: async () => {}, onPinSlides: async () => {}, onSectionFile: async () => {} };
    const html = renderToStaticMarkup(createElement(ManuscriptSwitcher, props));
    assert.ok(html.includes('<summary>Personal notes · 1</summary>'));
    assert.match(html, /Current · Personal notes/);
    assert.match(html, /aria-label="Personal notes"/);
    assert.match(html, /disabled="" title="personal-notes-mmd.tex" aria-pressed="true"/);
    assert.ok(html.includes('<strong>Research notes</strong><small>research-notes.tex'));
    const plain = renderToStaticMarkup(createElement(ManuscriptSwitcher, { ...props, document: { ...props.document, project: project(), rootFiles: ["research-notes.tex"] } }));
    assert.doesNotMatch(plain, /aria-label="Personal notes"/);
  } finally { await server.close(); }
});

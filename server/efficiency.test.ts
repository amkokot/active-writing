import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJsonSnapshotter, snapshotRequest } from "../src/jsonSnapshot.ts";
import { LazyDisclosure } from "../src/lazyDisclosure.ts";
import { ReplyMarkdown } from "../src/replyMarkdown.ts";
import { replyOutline } from "../src/replyOutline.ts";
import { defaultDisplayMode, displayModes, normalizeDisplayMode } from "../src/display.ts";

test("Overleaf source is the default without discarding existing appearance choices", () => {
  assert.equal(defaultDisplayMode, "source");
  assert.equal(normalizeDisplayMode(undefined), "source");
  assert.equal(normalizeDisplayMode("unknown"), "source");
  for (const mode of displayModes) assert.equal(normalizeDisplayMode(mode.id), mode.id);
  assert.equal(displayModes[0].label, "Overleaf source");
});

test("immutable snapshots preserve native JSON escaping, order, omissions and array semantics", () => {
  const snapshot = createJsonSnapshotter();
  for (const value of [null, false, 12, NaN, undefined, "escaped \"\\\n\r\t😀", { z: 1, 10: "ten", 2: "two", omit: undefined, nil: null },
    [undefined, , NaN, Infinity, Symbol("omit"), () => 1], Object.assign(Object.create(null), { x: "value" }), { date: new Date("2026-10-03T00:00:00Z") },
    { custom: { toJSON: (key: string) => ({ value: key }) } }]) assert.equal(snapshot(value), JSON.stringify(value));
  assert.throws(() => snapshot({ n: 1n }), TypeError);
  const circular: { self?: unknown } = {}; circular.self = circular;
  assert.throws(() => snapshot(circular), /circular/);
});
test("native fallback does not cache accessors or lose property keys passed to toJSON", () => {
  const snapshot = createJsonSnapshotter(), special = { toJSON: (key: string) => key };
  assert.equal(snapshot({ first: special, second: special }), JSON.stringify({ first: special, second: special }));
  const callable = Object.assign(() => undefined, { toJSON: (key: string) => key });
  assert.equal(snapshot({ callable }), JSON.stringify({ callable }));
  let calls = 0; const accessor = { get value() { calls++; return calls; } };
  assert.equal(snapshot(accessor), '{"value":1}'); assert.equal(calls, 1);
  assert.equal(snapshot(accessor), '{"value":2}'); assert.equal(calls, 2);
});
test("immutable note edits preserve unchanged large histories and request wire format", () => {
  const snapshot = createJsonSnapshotter(), history = Object.freeze({ reply: "Exact \\LaTeX\n".repeat(10_000), data: Object.freeze([1, 2, 3]) });
  const before = { notes: "First", history }, after = { ...before, notes: "Second" };
  assert.equal(snapshot(before), JSON.stringify(before)); assert.equal(snapshot(after), JSON.stringify(after));
  const metadata = { projectId: "quoted\"ID", revision: 3 }, data = snapshot(after);
  assert.equal(snapshotRequest(metadata, "data", data), JSON.stringify({ ...metadata, data: after }));
  assert.equal(snapshotRequest({}, "entries", "[]"), '{"entries":[]}');
  assert.equal(snapshot(before), JSON.stringify(before), "prior immutable snapshots remain exact");
});
test("closed disclosures skip expensive Markdown/math without discarding the exact source", () => {
  const source = "Body with $x^2$ and **formatting**.";
  const child = createElement(ReplyMarkdown, { text: source });
  const closed = renderToStaticMarkup(createElement(LazyDisclosure, { summary: "Derivation", children: child }));
  assert.doesNotMatch(closed, /katex|formatting/); assert.match(closed, /<summary>Derivation<\/summary>/);
  const open = renderToStaticMarkup(createElement(LazyDisclosure, { summary: "Checks", initialOpen: true, children: child }));
  assert.match(open, /katex/); assert.match(open, /<strong>formatting<\/strong>/);
  assert.equal(source, "Body with $x^2$ and **formatting**.");
});
test("long-reply outlines protect later code/math headings and retain all exact source", () => {
  const source = "## First\n" + "Equation \\(x\\).\n".repeat(300) + "```md\n## Not a section\n```\n\\[\n## Not a heading either\n\\]\n## Checks\nKeep this visible.\n";
  const outline = replyOutline(source); assert.deepEqual(outline.sections.map((section) => section.title), ["First", "Checks"]);
  assert.equal(outline.intro + outline.sections.map((section) => section.source).join(""), source);
});

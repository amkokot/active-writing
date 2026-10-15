import assert from "node:assert/strict";
import { test } from "node:test";
import { checkParagraph, contextWindow, turboWindows, scrollTurbo, freshTurbo, reviewed, turboPass, undoCheck } from "../src/turbo.ts";
import { generateRuleCandidates, sameProtectedLatex } from "../src/rewrite.ts";
import type { ManuscriptNode, Paragraph } from "../src/types.ts";
import { editableText, splitEditCaret } from "../src/editableText.ts";

test("acknowledged prose splits map the caret without guessing a different source", () => {
  const text="First paragraph.\r\n\r\n  Second paragraph.\n\nThird paragraph.";
  const mapped=splitEditCaret(text,"First paragraph.",text.indexOf("Second")+6)!;
  assert.deepEqual(mapped.parts,["First paragraph.","Second paragraph.","Third paragraph."]);assert.equal(mapped.index,1);assert.equal(mapped.offset,6);
  assert.equal(splitEditCaret(text,"Wrong source",text.length),undefined);
  assert.equal(splitEditCaret("Unsplit text","Unsplit text",2),undefined);
  assert.equal(splitEditCaret(text,"First paragraph.",text.length)!.offset,"Third paragraph.".length);
});

const nodes: ManuscriptNode[] = [
  { id: "document", title: "Document", kind: "section", depth: 0, paragraphIds: ["front"] },
  { id: "intro", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["first", "later"] },
  { id: "lemma", parentId: "intro", title: "Lemma", kind: "lemma", depth: 1, paragraphIds: ["statement"] },
  { id: "proof", parentId: "lemma", title: "Proof", kind: "proof", depth: 2, paragraphIds: ["proof-text"] },
  { id: "hidden", title: "Hidden", kind: "section", depth: 0, paragraphIds: ["hidden-text"] },
];
const paragraphs: Paragraph[] = [
  { id: "front", nodeId: "document", text: "\\maketitle" },
  { id: "first", nodeId: "intro", text: "This paper explains the result." },
  { id: "statement", nodeId: "lemma", text: "For every $x$ the following bound holds." },
  { id: "proof-text", nodeId: "proof", text: "We apply the preceding estimate." },
  { id: "later", nodeId: "intro", text: "We now discuss its consequences." },
  { id: "math", nodeId: "intro", text: "\\[x = y\\]" },
  { id: "hidden-text", nodeId: "hidden", text: "This section is intentionally hidden." },
];

test("Turbo keeps actual paragraph order across parent prose, statements, and proofs, while honoring hidden ancestors", () => {
  assert.deepEqual(turboPass(paragraphs, nodes, ["hidden"], false).map((p) => p.id), ["first", "statement", "proof-text", "later"]);
  assert.deepEqual(turboPass(paragraphs, nodes, ["intro"], false).map((p) => p.id), ["hidden-text"]);
  assert.equal(turboPass(paragraphs, nodes, [], true).length, paragraphs.length);
  assert.equal(contextWindow(paragraphs, "proof-text", 1).paragraphs.length, 3);
  assert.deepEqual(contextWindow(paragraphs, "proof-text", 0).paragraphs.map((p) => p.id), ["proof-text"]);
});

test("a prose pass skips bibliography entries, setup and reference branches unless all blocks are requested", () => {
  const referenceNodes: ManuscriptNode[] = [{ id: "refs", title: "References", kind: "section", depth: 0, paragraphIds: [], environment: "thebibliography" }];
  const items = [
    { id: "item", nodeId: "intro", text: "\\bibitem{key} Jane Doe. A long paper title." },
    { id: "setup", nodeId: "intro", text: "{\\small\\bibliographystyle{plainnat}\\bibliography{refs}}" },
    { id: "refs", nodeId: "refs", text: "Jane Doe. A long paper title." },
    { id: "prose", nodeId: "intro", text: "We cite several relevant papers." },
  ];
  assert.deepEqual(turboPass(items, [...nodes, ...referenceNodes], [], false).map((p) => p.id), ["prose"]);
  assert.equal(turboPass(items, [...nodes, ...referenceNodes], [], true).length, 4);
});

test("Turbo keeps the previous block and gives reading two more blocks of lookahead than source", () => {
  const windows = turboWindows(paragraphs, "proof-text", 1);
  assert.deepEqual(windows.source.paragraphs.map(p => p.id), ["statement", "proof-text", "later"]);
  assert.deepEqual(windows.preview.paragraphs.map(p => p.id), ["statement", "proof-text", "later", "math", "hidden-text"]);
  assert.equal(windows.source.before, 2); assert.equal(windows.source.after, 2);
  assert.equal(windows.preview.after, 0);
  assert.deepEqual(turboWindows(paragraphs, "proof-text", 0).source.paragraphs.map(p => p.id), ["statement", "proof-text"]);
  assert.equal(turboWindows(paragraphs, "front", 1).source.before, 0);
  assert.equal(turboWindows(paragraphs, "hidden-text", 2).preview.paragraphs.length, 2);
  assert.equal(turboWindows([], undefined, 1).source.paragraphs.length, 0);
});

test("Turbo scroll checks only a consecutive forward block, not skipped blocks or queued comments", () => {
  const initial = { ...freshTurbo(), enabled: true, activeParagraphId: "first" };
  const moved = scrollTurbo(initial, paragraphs, "statement", paragraphs[1].text, false);
  assert.ok(reviewed(moved, "first", paragraphs[1].text));
  assert.equal(moved.activeParagraphId, "statement");
  assert.equal(scrollTurbo(initial, paragraphs, "statement", paragraphs[1].text, true).history.length, 0);
  assert.equal(scrollTurbo({ ...initial, autoCheck: false }, paragraphs, "statement", paragraphs[1].text, false).history.length, 0);
  assert.equal(scrollTurbo(initial, paragraphs, "later", paragraphs[1].text, false).history.length, 0);
  assert.equal(scrollTurbo(moved, paragraphs, "first", paragraphs[2].text, false).history.length, 1);
  assert.equal(scrollTurbo(initial, paragraphs, "missing", "", false), initial);
  assert.equal(scrollTurbo(initial, paragraphs, "first", "", false), initial);
});

test("wording checks persist, invalidate on changed text, and undo without modifying manuscript content", () => {
  const initial = freshTurbo();
  const one = checkParagraph(initial, "first", paragraphs[1].text, "scroll");
  const restored = JSON.parse(JSON.stringify(one));
  assert.ok(reviewed(restored, "first", paragraphs[1].text));
  assert.equal(reviewed(restored, "first", "Changed wording"), false);
  assert.deepEqual(undoCheck(one).reviews, initial.reviews);
  const two = checkParagraph(one, "first", "Changed wording", "reply");
  assert.deepEqual(undoCheck(two).reviews, one.reviews);
  assert.equal(undoCheck(two).activeParagraphId, "first");
  assert.equal(paragraphs[1].text, "This paper explains the result.");
  assert.equal("progressByNode" in one, false);
});

test("cheap suggestions do not remove demonstrative subjects or invent whitespace-only alternatives", () => {
  for (const text of ["This paper studies a\nknown problem.", "This section gives a result.", "This result is useful.", "We differentiate with respect to time."]) {
    assert.deepEqual(generateRuleCandidates(text), []);
  }
  assert.ok(generateRuleCandidates("This paper studies the problem in order to establish a bound.").every((c) => c.text.startsWith("This paper studies")));
});

test("whole-paragraph cheap suggestions preserve commands, math, comments, nested arguments, and literal marker collisions", () => {
  const protectedParts = ["$x  + y$", "\\citep[Theorem~2.1]{a,b}", "\\textbf{in order to {prove}}", "% due to the fact that\n", "\\begin{align}a  &= b \\\\ c &= d\\end{align}", "\\%", "ZZPFPROTECTED0ZZ"];
  const source = `It is important to note that we are able to proceed in order to prove the claim with ${protectedParts.join(" and ")} at this point in time.`;
  const candidates = generateRuleCandidates(source);
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.ok(candidate.text.includes("to prove the claim"));
    for (const part of protectedParts) assert.ok(candidate.text.includes(part), `lost ${part}`);
    assert.ok(sameProtectedLatex(source, candidate.text));
  }
  const unchanged = "$x  + y$ \\cite{a} % leave  this\n";
  for (const candidate of generateRuleCandidates(unchanged)) {
    assert.ok(candidate.text.includes("$x  + y$"));
    assert.ok(candidate.text.includes("% leave  this\n"));
  }
});

test("Turbo's replacement guard refuses changed math, references, comments, and command arguments", () => {
  const source = "We use $x  + y$ with \\ref{lemma} and \\emph{this point}. % keep comment\n";
  assert.ok(sameProtectedLatex(source, source.replace("We use", "We consider")));
  assert.equal(sameProtectedLatex(source, source.replace("x  + y", "x - y")), false);
  assert.equal(sameProtectedLatex(source, source.replace("ref{lemma}", "ref{other}")), false);
  assert.equal(sameProtectedLatex(source, source.replace("keep comment", "deleted")), false);
  assert.equal(sameProtectedLatex(source, source.replace("emph{this point}", "emph{other point}")), false);
});

test("cheap phrasing keeps sentence capitalization when shortening In order to", () => {
  const source = "We run a trial. In order to preserve $x  + y$, we keep \\ref{bound}.";
  const candidates = generateRuleCandidates(source);
  assert.ok(candidates.some((candidate) => candidate.text.includes(". To preserve")));
  assert.ok(candidates.every((candidate) => !candidate.text.includes(". to preserve")));
  assert.ok(candidates.every((candidate) => candidate.text.includes("$x  + y$")));
});

test("live editable drafts keep exact source whitespace and explicit Enter line breaks", () => {
  const text = (value: string) => ({ nodeType: 3, textContent: value, childNodes: [] });
  const element = (tagName: string, ...childNodes: unknown[]) => ({ nodeType: 1, tagName, childNodes });
  const source = element("P", text("Keep $x  + y$.\n% comment\n"), element("SPAN", text("\\ref{lemma}")), text(" here."));
  assert.equal(editableText(source as unknown as Node), "Keep $x  + y$.\n% comment\n\\ref{lemma} here.");
  const edited = element("P", text("Before."), element("DIV", text("% comment")), element("DIV", text("After.")), element("DIV", element("BR")));
  assert.equal(editableText(edited as unknown as Node), "Before.\n% comment\nAfter.\n");
  const blankLines = element("P", text("Before."), element("DIV", element("BR")), element("DIV", element("BR")), element("DIV", text("After.")));
  assert.equal(editableText(blankLines as unknown as Node), "Before.\n\n\nAfter.");
  const placeholder = { ...element("BR"), getAttribute: (name: string) => name === "data-editor-placeholder" ? "true" : null };
  const oneEnter = element("P", element("SPAN", text("Before."), element("BR"), placeholder));
  assert.equal(editableText(oneEnter as unknown as Node), "Before.\n");
  assert.equal(editableText(element("P", element("SPAN", text("Before."), element("BR"), text("Same block."), placeholder)) as unknown as Node), "Before.\nSame block.");
});

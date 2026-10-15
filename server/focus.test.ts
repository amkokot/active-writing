import assert from "node:assert/strict";
import { test } from "node:test";
import { focusedDocument, focusedSourceSnippets, writeFocusedSource } from "./focus.ts";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { missingPdfDestinations, unavailablePdfDestination } from "../src/pdfLinks.ts";
import type { ParsedProject } from "./projects.ts";
import { focusedCacheDiagnostics, parseLatexDiagnostics } from "./latexPlugin.ts";

test("only an unchanged duplicate-free full cache explains focused label repeats as notices", () => {
  const raw = parseLatexDiagnostics("LaTeX Warning: Label `claim' multiply defined.\nLaTeX Warning: There were multiply-defined labels.\nLaTeX Warning: Reference 'missing' undefined on input line 23.");
  assert.deepEqual(focusedCacheDiagnostics(raw, false), raw, "stale caches and full builds retain all warnings");
  const focused = focusedCacheDiagnostics(raw, true);
  assert.equal(focused.length, 2);
  assert.equal(focused[0].code, "undefined_reference");
  assert.equal(focused[0].severity, "warning");
  assert.equal(focused[1].severity, "info");
  assert.ok(focused[1].message.includes("Label `claim' multiply defined."));
});

test("compile diagnostics keep explicit multi-file locations and recover box line numbers", () => {
  const diagnostics = parseLatexDiagnostics(String.raw`./sections/theory.tex:42: Undefined control sequence.
C:/paper/appendix.tex:18: Missing $ inserted.
LaTeX Warning: Reference 'unknown' on input line 23.
Overfull \hbox (2.3pt too wide) in paragraph at lines 81--84
Underfull \hbox (badness 1000) in paragraph at line 97`);
  assert.equal(diagnostics[0].file, "./sections/theory.tex");
  assert.equal(diagnostics[0].line, 42);
  assert.equal(diagnostics[0].code, "undefined_control_sequence");
  assert.equal(diagnostics[1].file, "C:/paper/appendix.tex");
  assert.equal(diagnostics[1].code, "missing_math_delimiter");
  assert.equal(diagnostics[2].line, 23);
  assert.equal(diagnostics[2].file, undefined, "do not guess the root file");
  assert.equal(diagnostics[3].line, 81);
  assert.equal(diagnostics[4].line, 97);
});

test("unchanged focus source keeps its timestamp so latexmk can reuse the existing PDF", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "paperfocus-shadow-"));
  const file = path.join(folder, "focus.tex");
  assert.equal(await writeFocusedSource(file, "First source"), true);
  const before = await stat(file);
  assert.equal(await writeFocusedSource(file, "First source"), false);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal(await writeFocusedSource(file, "Changed source"), true);
  assert.equal(await readFile(file, "utf8"), "Changed source");
});

test("cached PDF links reject synthetic missing-target fallbacks while retaining real destinations", () => {
  const missing = missingPdfDestinations("pdfTeX warning (dest): name{theorem.5.12} has been referenced but does not exist, replaced by a fixed one\npdfTeX warning (dest): name{cite.long\n key} has been referenced but does not exist\npdfTeX warning (dest): name{theorem.5.12} has been referenced but does not exist");
  assert.deepEqual(missing, ["theorem.5.12", "cite.longkey"]);
  assert.ok(unavailablePdfDestination("theorem.5.12", missing));
  assert.equal(unavailablePdfDestination("theorem.5.1", missing), false);
  assert.equal(unavailablePdfDestination([0, { name: "Fit" }], missing), false);
  assert.deepEqual(missingPdfDestinations("pdfTeX warning (dest): name{theorem.5.12} has been referenced but does not exis\nt, replaced by a fixed one"), ["theorem.5.12"], "real TeX logs wrap inside the warning text too");
});

function fixture(): ParsedProject {
  return {
    project: { id: "test", name: "Test", folder: "test", mainFile: "main.tex", createdAt: "" },
    files: [], rootFiles: [], revision: "", sources: {}, spans: [], paragraphs: [],
    preamble: "\\documentclass{article}\n",
    body: "\\newcommand{\\M}{\\mathcal{M}}\n\\section{Other}\nOther prose.\n\\begin{proof}\\newcommand{\\privateMacro}{x}\\end{proof}\n",
    nodes: [
      { id: "other", kind: "section", title: "Other", depth: 0, paragraphIds: [] },
      { id: "section", kind: "section", title: "Theory", depth: 0, paragraphIds: [] },
      { id: "claim", kind: "theorem", title: "Claim 7", depth: 2, parentId: "section", paragraphIds: [], environment: "claim", environmentCounter: "theorem", environmentNumber: 7 },
      { id: "proof", kind: "proof", title: "Proof", depth: 2, parentId: "claim", paragraphIds: [], environment: "proof" },
    ],
    nodeBodies: {
      other: "\\section*{Other}\nOther prose.",
      section: "\\section*{Theory}\nTheory prose.",
      claim: "\\begin{claim}[Local claim]\n$\\M$ has a property.\n\\end{claim}",
      proof: "\\begin{proof}[Proof of Claim 7]\nThe proof text.\n\\end{proof}",
    },
  };
}

test("a focus build retains global macros, original environment syntax, numbering, and cached references", () => {
  const source = focusedDocument(fixture(), { focusNodeId: "claim", cachedAux: ".paperfocus/build/full/main.aux" });
  assert.ok(source.includes("\\newcommand{\\M}{\\mathcal{M}}"));
  assert.ok(!source.includes("\\privateMacro"));
  assert.ok(source.includes("\\begin{claim}[Local claim]"));
  assert.ok(source.includes("\\begin{proof}[Proof of Claim 7]"));
  assert.ok(source.includes("\\setcounter{theorem}{6}"));
  assert.ok(source.includes("\\@input{.paperfocus/build/full/main.aux}"));
  assert.ok(source.indexOf("\\@input{.paperfocus/build/full/main.aux}") < source.indexOf("\\begin{document}"));
  assert.ok(source.includes("\\icml@noticeprintedtrue"));
  assert.ok(!source.includes("Other prose."));
  assert.ok(!source.includes("Theory prose."));
});

test("proof focus and hidden ancestors are honored instead of falling back to the whole manuscript", () => {
  const parsed = fixture();
  const proofs = focusedDocument(parsed, { lens: "proofs", focusNodeId: "section" });
  assert.ok(proofs.includes("The proof text."));
  assert.ok(!proofs.includes("Theory prose."));
  assert.ok(!proofs.includes("Other prose."));
  assert.throws(() => focusedDocument(parsed, { focusNodeId: "claim", hiddenNodeIds: ["section"] }), /no visible material/);
  assert.throws(() => focusedDocument(parsed, { focusNodeId: "missing" }), /no visible material/);
});

test("macros are not emitted twice and bibliography setup is retained when no full cache exists", () => {
  const parsed = fixture();
  parsed.nodeBodies.section += "\n\\newcommand{\\M}{\\mathcal{M}}";
  parsed.body += "\n\\bibliography{refs}\n\\bibliographystyle{plain}\n";
  const source = focusedDocument(parsed, { focusNodeId: "section" });
  assert.equal(source.split("\\newcommand{\\M}").length - 1, 1);
  assert.ok(source.includes("\\bibliography{refs}"));
  assert.ok(source.includes("\\bibliographystyle{plain}"));
});

test("block-window PDFs typeset only selected paragraphs while keeping environment wrappers and original source", () => {
  const parsed = fixture();
  parsed.paragraphs = [
    { id: "a", nodeId: "section", text: "First paragraph." },
    { id: "b", nodeId: "section", text: "Repeated paragraph." },
    { id: "c", nodeId: "section", text: "Repeated paragraph." },
    { id: "d", nodeId: "proof", text: "Step one." },
    { id: "e", nodeId: "proof", text: "Step two." },
  ];
  parsed.nodes.find(n => n.id === "section")!.paragraphIds = ["a", "b", "c"];
  parsed.nodes.find(n => n.id === "proof")!.paragraphIds = ["d", "e"];
  parsed.nodeBodies.section = "\\section*{Theory}\nFirst paragraph.\n\nRepeated paragraph.\n\nRepeated paragraph.";
  parsed.nodeBodies.proof = "\\begin{proof}[Proof of Claim 7]\nStep one.\n\nStep two.\n\\end{proof}";
  const before = JSON.stringify(parsed);
  const source = focusedDocument(parsed, { paragraphIds: ["c", "d"] });
  assert.equal((source.match(/Repeated paragraph\./g) ?? []).length, 1);
  assert.ok(!source.includes("First paragraph.")); assert.ok(!source.includes("Step two."));
  assert.ok(source.includes("\\section*{Theory}")); assert.ok(source.includes("\\begin{proof}[Proof of Claim 7]"));
  assert.ok(source.includes("Step one.\n\\end{proof}")); assert.ok(!source.includes("Other prose."));
  assert.equal(JSON.stringify(parsed), before);
  assert.throws(() => focusedDocument(parsed, { paragraphIds: [] }), /empty or has changed/);
  assert.throws(() => focusedDocument(parsed, { paragraphIds: ["unknown"] }), /empty or has changed/);
  assert.throws(() => focusedDocument(parsed, { paragraphIds: ["d"], hiddenNodeIds: ["section"] }), /no visible material/);
  parsed.paragraphs[0].renderIssue = "Unfinished snippet";
  assert.deepEqual(focusedSourceSnippets(parsed, { paragraphIds: ["c", "d"] }), []);
  assert.equal(focusedSourceSnippets(parsed, { paragraphIds: ["a"] }).length, 1);
  parsed.paragraphs = [parsed.paragraphs[1], parsed.paragraphs[3], parsed.paragraphs[0], parsed.paragraphs[2], parsed.paragraphs[4]];
  parsed.paragraphs.find(p => p.id === "a")!.renderIssue = undefined;
  const ordered = focusedDocument(parsed, { paragraphIds: ["b", "d", "a"] });
  assert.ok(ordered.indexOf("Repeated paragraph.") < ordered.indexOf("Step one."));
  assert.ok(ordered.indexOf("Step one.") < ordered.indexOf("First paragraph."), "returning section prose stays after the nested proof");
});

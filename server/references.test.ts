import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBibliography, parseInlineBibliography, arxivId } from "./bibliography.ts";
import { referenceTokens, safeLink, sourceReferenceSummary, expandSourceReference } from "../src/references.ts";
import { editableText } from "../src/editableText.ts";
import { parseProject, publicDocument, registerProject, saveEdits } from "./projects.ts";
import { attachProjectPdf, downloadArxiv, readReferencePdf, referenceLibrary, saveReferencePage, storeReference } from "./referenceLibrary.ts";
import { editorFont, paperAppearance } from "../src/paperAppearance.ts";

test("long source references fold just their target, preserve labels/options and retain exact original offsets", () => {
  const key = "long_".repeat(25), url = `https://example.org/${key}?x=1\\&y=2`;
  for (const [source, expected] of [
    [`\\href{${url}}{\\textbf{Readable label}}`, String.raw`\href{…}{\textbf{Readable label}}`],
    [`\\url{${url}}`, String.raw`\url{…}`],
    [`\\ref{${key}}`, String.raw`\ref{…}`],
    [`\\eqref{${key}}`, String.raw`\eqref{…}`],
    [`\\hyperref[${key}]{Readable label}`, String.raw`\hyperref[…]{Readable label}`],
    [`\\cite[Theorem 3]{${key}}`, String.raw`\cite[Theorem 3]{…}`],
  ]) {
    const token = referenceTokens(`Before ${source} after`)[0];
    assert.equal(sourceReferenceSummary(token), expected);
    assert.equal(token.raw, source); assert.equal(token.start, 7); assert.equal(token.end, 7 + source.length);
  }
  for (const source of [String.raw`\ref{ordinary:key}`, String.raw`\href{https://example.org}{Readable label}`, `\\href{https://example.org}{${key}}`]) assert.equal(sourceReferenceSummary(referenceTokens(source)[0]), undefined);
});

test("expanding an ellipsis changes presentation only: editable extraction keeps all real LaTeX", () => {
  const source = `\\href{https://example.org/${"long_".repeat(25)}}{Evidence}`;
  const attributes = new Map<string, string>();
  const link = { nodeType: 1, tagName: "SPAN", childNodes: [{ nodeType: 3, textContent: source, childNodes: [] }], dataset: { compactLabel: String.raw`\href{…}{Evidence}` }, contentEditable: "false", setAttribute(key: string, value: string) { attributes.set(key, value); } };
  assert.equal(editableText(link as unknown as Node), source);
  expandSourceReference(link as unknown as HTMLElement, true);
  assert.equal(attributes.get("aria-expanded"), "true"); assert.equal(link.contentEditable, "inherit");
  assert.equal(editableText(link as unknown as Node), source);
  expandSourceReference(link as unknown as HTMLElement, false);
  assert.equal(link.contentEditable, "false"); assert.equal(editableText(link as unknown as Node), source);
});

test("folded references persist while typing around them and support explicit mouse/keyboard expansion", async () => {
  const [manuscript, css] = await Promise.all(["src/components/Manuscript.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(manuscript, /sourceReferenceSummary\(token\)/); assert.match(manuscript, /link.textContent = token.raw/);
  assert.match(manuscript, /paint\(value, true, caret\)/); assert.match(manuscript, /caret > chunk.start \+ token.start/);
  assert.match(manuscript, /\["Enter", " "\].includes\(event.key\)/); assert.match(manuscript, /expandReference\(link\)/);
  assert.match(manuscript, /expandedReferences.current.clear\(\)/);
  assert.match(manuscript, /link.dataset.referenceExpanded !== "true"/);
  assert.match(manuscript, /clipboardData.setData\("text\/plain", editableText\(range.cloneContents\(\)\)\)/);
  const foldRules = css.split(/\r?\n/).filter(line => line.includes('data-compact-aw-links="true"'));
  assert.equal(foldRules.length, 2); assert.ok(foldRules.every(rule => !rule.includes(":focus-within")));
  assert.ok(foldRules.every(rule => rule.includes(':not([data-reference-expanded="true"])')));
  assert.ok(foldRules.every(rule => rule.includes('data-cross-block-selection="true"')));
});

test("source-editor font hints follow literal class/packages, never claim exact PDF layout", () => {
  const modern = paperAppearance(String.raw`\documentclass[11pt]{article}\usepackage{lmodern}`);
  assert.equal(modern.family, "modern"); assert.equal(modern.sizePt, 11);
  assert.match(editorFont(modern.family), /Active Writing Modern/);
  const conference = paperAppearance(String.raw`\documentclass{article}\usepackage[accepted]{icml2024}`);
  assert.equal(conference.family, "times"); assert.equal(conference.columns, 2);
  assert.equal(paperAppearance(String.raw`\documentclass{article}\usepackage[final]{neurips_2020}`).family, "times");
  assert.equal(paperAppearance(String.raw`\documentclass{article}\usepackage{newpxtext}`).family, "palatino");
});

test("unknown fonts and commented declarations do not invent source-editor fidelity", () => {
  const source = "\\documentclass[12pt]{custom}\n% \\usepackage{times}\n\\usepackage{fontspec}\n\\setmainfont{Not installed}";
  const hint = paperAppearance(source);
  assert.equal(hint.family, "unknown"); assert.equal(hint.sizePt, 12);
  assert.equal(editorFont(hint.family), '"Times New Roman", serif');
  assert.ok(!editorFont(hint.family).includes("Not installed"));
});

test("public editor-appearance metadata includes the preamble file without changing the source", async () => {
  const workspace = await mkdtemp(path.join(process.cwd(), ".paperfocus/trials/appearance-"));
  const root = path.join(workspace, "paper"); await mkdir(root);
  const main = String.raw`\documentclass[11pt]{article}\input{style}\begin{document}\section{Text}Exact source.\end{document}`;
  await writeFile(path.join(root, "main.tex"), main);
  await writeFile(path.join(root, "style.tex"), String.raw`\usepackage{lmodern}`);
  const project = await registerProject(workspace, root);
  const document = publicDocument(await parseProject(workspace, project.id));
  assert.equal(document.appearance?.family, "modern"); assert.equal(document.appearance?.sizePt, 11);
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
  assert.equal("preamble" in document, false, "font hints do not expose raw source internals");
});

test("Windows literal included-file casing resolves to the actual filename without source rewriting", { skip: process.platform !== "win32" }, async () => {
  const workspace = await mkdtemp(path.join(process.cwd(), ".paperfocus/trials/input-case-"));
  const root = path.join(workspace, "paper"); await mkdir(root);
  await mkdir(path.join(root, "resources"));
  const main = String.raw`\documentclass{article}\begin{document}\section{Text}\input{resources/Finetuning}\end{document}`;
  await writeFile(path.join(root, "main.tex"), main);
  await writeFile(path.join(root, "resources/finetuning.tex"), "Exact included source.");
  const project = await registerProject(workspace, root);
  const parsed = await parseProject(workspace, project.id);
  assert.ok(parsed.sourceFiles?.includes("resources/finetuning.tex"));
  assert.ok(parsed.paragraphs.some(p => p.text === "Exact included source."));
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
});

test("source reference tokens keep exact edit offsets, optional result locators, and nested link text", () => {
  const source = "See \\eqref{eq:a}, \\cref{one,two}, \\citep[see][Theorem~2.3]{paper,other}, \\href{https://example.test}{A {nested} title}, and \\hyperref[one]{here}.\n% \\ref{ignored}\n\\url{https://example.test/x}";
  const tokens = referenceTokens(source);
  assert.equal(tokens.length, 6);
  assert.deepEqual(tokens[1].keys, ["one", "two"]);
  assert.deepEqual(tokens[2].keys, ["paper", "other"]);
  assert.equal(tokens[2].locator, "Theorem 2.3");
  assert.equal(tokens[3].raw, "\\href{https://example.test}{A {nested} title}");
  assert.equal(referenceTokens("\\parencite[Thm.~2.3, p.~7]{paper}")[0].locator, "Theorem 2.3");
  assert.equal(referenceTokens("\\textcite{paper}")[0].kind, "citation");
  assert.deepEqual(tokens[4].keys, ["one"]);
  for (const token of tokens) assert.equal(source.slice(token.start, token.end), token.raw);
  assert.equal(safeLink("javascript:alert(1)"), undefined);
  assert.equal(safeLink("file:///C:/private.pdf"), undefined);
  assert.equal(safeLink("https://user:secret@example.test"), undefined);
});

test("BibTeX metadata resolves public links and both modern and legacy arXiv IDs", () => {
  const source = '@article{key, title={{A {Nested} Title}}, author="Doe, Jane", year=2024, eprint={2404.02554v2}, archivePrefix={arXiv}, url={https://arxiv.org/abs/2404.02554}, doi={https://doi.org/10.1/test}, file={paper.pdf}}\n@article{old, title={Older}, journal={arXiv preprint arXiv:math/0309136}, url={javascript:alert(1)}}';
  const entries = parseBibliography(source, "refs.bib");
  assert.equal(entries[0].title, "A Nested Title");
  assert.equal(entries[0].doi, "10.1/test");
  assert.equal(entries[0].arxivId, "2404.02554v2");
  assert.equal(entries[1].arxivId, "math/0309136");
  assert.equal(entries[1].url, undefined);
  assert.equal(arxivId("https://other.test/2404.02554"), undefined);
  assert.equal(arxivId("../private"), undefined);
});

test("inline bibliographies retain citation links without inventing unknown titles", () => {
  const text = String.raw`% \bibitem{ignored} Fake
\begin{thebibliography}{99}
\bibitem[Doe(2026)]{known} A. Doe.
\newblock An explicit title.
\newblock arXiv:2610.02095v1. \url{https://arxiv.org/abs/2610.02095v1}.
\bibitem{unknown} Undelimited bibliography text. \url{javascript:alert(1)}
\end{thebibliography}`;
  const entries = parseInlineBibliography(text, "main.tex");
  assert.equal(entries.length, 2); assert.equal(entries[0].title, "An explicit title.");
  assert.equal(entries[0].arxivId, "2610.02095v1");
  assert.equal(entries[1].title, undefined); assert.equal(entries[1].url, undefined);
});

test("inline references get their own contents branch and remain intact in a focused view", async () => {
  const base = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "inline-refs-")); await mkdir(path.join(workspace, "paper"));
  const source = String.raw`\documentclass{article}\begin{document}\section{Conclusion}
End of paper.\begin{thebibliography}{99}\bibitem{key}Author.
\newblock Example title.\newblock \url{https://arxiv.org/abs/2610.02095v1}
\end{thebibliography}\end{document}`;
  await writeFile(path.join(workspace, "paper/main.tex"), source);
  const project = await registerProject(workspace, "paper"); const parsed = await parseProject(workspace, project.id);
  const refs = parsed.nodes.find((node) => node.title === "References")!;
  assert.equal(refs.kind, "section"); assert.equal(refs.parentId, undefined);
  assert.equal(parsed.citations?.[0].key, "key");
  assert.match(parsed.nodeBodies[refs.id], /\\begin\{thebibliography\}\s*\{99\}/);
  assert.ok(!parsed.nodeBodies[parsed.nodes.find((node) => node.title === "Conclusion")!.id].includes("\\bibitem"));
  assert.equal(await readFile(path.join(workspace, "paper/main.tex"), "utf8"), source);
});

test("multi-file labels, included theorem definitions, and local citation copies survive reload without rewriting shared source", async () => {
  const trials = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(trials, { recursive: true });
  const workspace = await mkdtemp(path.join(trials, "references-"));
  const root = path.join(workspace, "paper"); await mkdir(path.join(root, "sections"), { recursive: true });
  const main = "\\documentclass{article}\n\\input{macros}\n\\includeonly{sections/body}\n\\begin{document}\n\\section{Introduction}\\label{sec:intro}\nSee \\ref{claim:target} and \\citep[Theorem~2.3]{key}.\n\\include{sections/body}\n\\include{excluded}\n\\end{document}\n";
  const body = "\\section{Theory}\n\\label{sec:theory}\n\\begin{claim}[Useful result]\\label{claim:target}\nA useful result.\n\\end{claim}\n\n% \\label{not-real}\n\\input{details}\n";
  await writeFile(path.join(root, "main.tex"), main);
  await writeFile(path.join(root, "macros.tex"), "\\usepackage{amsthm}\n\\newtheorem{claim}{Claim}\n");
  await writeFile(path.join(root, "sections/body.tex"), body);
  await writeFile(path.join(root, "sections/details.tex"), "\\subsection{Detail}\\label{detail}\nDetails here.\n");
  await writeFile(path.join(root, "excluded.tex"), "\\section{Not included}\\label{excluded}\nExcluded.\n");
  await writeFile(path.join(root, "refs.bib"), "@misc{key,title={Test paper},eprint={2404.02554},year={2024}}");
  const project = await registerProject(workspace, root);
  const parsed = await parseProject(workspace, project.id);
  assert.equal(parsed.nodes.find((node) => node.environment === "claim")?.title, "Claim 1 · Useful result");
  assert.deepEqual(parsed.labels?.map((label) => label.key), ["sec:intro", "sec:theory", "claim:target", "detail"]);
  assert.ok(parsed.sourceFiles?.includes("macros.tex"));
  const label = parsed.labels!.find((label) => label.key === "claim:target")!;
  assert.equal(label.file, "sections/body.tex"); assert.equal(label.line, 3);
  assert.equal(parsed.nodes.find((node) => node.id === label.nodeId)?.environment, "claim");
  const publicData = publicDocument(parsed);
  assert.ok(!("sources" in publicData)); assert.equal(publicData.citations?.[0].title, "Test paper");
  const paragraph = parsed.paragraphs.find((item) => item.nodeId === label.nodeId)!;
  await saveEdits(workspace, project.id, { [paragraph.id]: "An edited result with \\ref{sec:intro}." }, parsed.revision);
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
  assert.ok((await readFile(path.join(root, "sections/body.tex"), "utf8")).includes("\\label{claim:target}"));
  const afterSave = await parseProject(workspace, project.id);
  const fakePdf = Buffer.from("%PDF-1.7\nLocal fixture only.");
  const copy = await storeReference(workspace, project.id, "key", fakePdf, "Local paper.pdf");
  await saveReferencePage(workspace, project.id, "key", "Theorem 2.3", 7);
  assert.equal((await referenceLibrary(workspace, project.id)).copies.key.pages["Theorem 2.3"], 7);
  assert.deepEqual(await readReferencePdf(workspace, project.id, "key"), fakePdf);
  assert.equal((await parseProject(workspace, project.id)).revision, afterSave.revision);
  assert.equal((await storeReference(workspace, project.id, "key", fakePdf, "Same paper.pdf")).pages["Theorem 2.3"], 7);
  assert.ok(copy.filename.endsWith(".pdf"));
  await assert.rejects(() => storeReference(workspace, project.id, "key", Buffer.from("Not a PDF"), "bad.pdf"), /Choose a PDF/);
  await assert.rejects(() => attachProjectPdf(workspace, project.id, "key", "../secret.pdf"), /listed in this project/);
  await assert.rejects(() => downloadArxiv(workspace, project.id, "key", "https://other.test/a.pdf"), /valid arXiv/);
  await assert.rejects(() => saveReferencePage(workspace, project.id, "key", "x", -1), /valid page/);
});

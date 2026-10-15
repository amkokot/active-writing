import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { manuscriptHeadingTag, sectionHeadingLevel } from "../src/headingHierarchy.ts";
import { outlineRows, sourceOrderedBlocks } from "../src/workspaceTools.ts";
import { parseProject, registerProject, saveEdits } from "./projects.ts";
import { focusedDocument } from "./focus.ts";
import type { ManuscriptNode } from "../src/types.ts";

test("heading controls do not move later section prose ahead of a newly wrapped theorem",()=>{
  const nodes:ManuscriptNode[]=[{id:"s",title:"Section",kind:"section",depth:0,paragraphIds:["before","after"]},{id:"t",title:"Theorem",kind:"theorem",depth:1,parentId:"s",paragraphIds:["statement"]},{id:"e",title:"Empty",kind:"section",depth:0,paragraphIds:[]}];
  const blocks=sourceOrderedBlocks(nodes,[{id:"before",nodeId:"s",text:"Before"},{id:"statement",nodeId:"t",text:"Statement"},{id:"after",nodeId:"s",text:"After"}]);
  assert.deepEqual(blocks.map(b=>[b.id,b.paragraphIds,!!b.continued]),[["s",["before"],false],["t",["statement"],false],["s",["after"],true],["e",[],false]]);
  assert.equal(new Set(blocks.map(b=>b.renderKey)).size,blocks.length);
  const startsWithTheorem=sourceOrderedBlocks(nodes,[{id:"statement",nodeId:"t",text:"Statement"},{id:"after",nodeId:"s",text:"After"}]);
  assert.deepEqual(startsWithTheorem.map(b=>b.id),["s","t","s","e"]);
  const placeholder=sourceOrderedBlocks(nodes,[{id:"statement",nodeId:"t",text:"Statement"},{id:"empty",nodeId:"s",text:"",emptySource:true}]);
  assert.deepEqual(placeholder.map(b=>[b.id,b.paragraphIds]),[["s",["empty"]],["t",["statement"]],["e",[]]]);
});

test("heading tags distinguish five section levels without mistaking proofs for subsections", () => {
  for (let depth = 0; depth < 5; depth++) {
    const node: ManuscriptNode = { id: `s${depth}`, kind: depth ? "subsection" : "section", title: "Heading", depth, paragraphIds: [] };
    assert.equal(sectionHeadingLevel(node), depth);
    assert.equal(manuscriptHeadingTag(node), `h${depth + 1}`);
  }
  for (const kind of ["theorem", "lemma", "corollary", "proof"] as const) {
    const node: ManuscriptNode = { id: kind, kind, title: kind, depth: 4, paragraphIds: [] };
    assert.equal(sectionHeadingLevel(node), undefined);
    assert.equal(manuscriptHeadingTag(node), "h3");
  }
  assert.equal(sectionHeadingLevel({ id: "abstract", title: "Abstract", kind: "section", environment: "abstract", depth: 0, paragraphIds: [] }), undefined);
});
test("source markers identify persistent blocks separately from generated position IDs", async () => {
  const workspace = await mkdtemp(path.join(process.cwd(), ".paperfocus/trials/stable-block-"));
  const root = path.join(workspace, "paper"); await mkdir(root);
  await writeFile(path.join(root, "main.tex"), String.raw`\documentclass{article}
\begin{document}
\section{Example}
% paperfocus:paragraph=remembered-proof
A revised proof.

An unmarked paragraph.
\end{document}`);
  const project = await registerProject(workspace, root);
  const parsed = await parseProject(workspace, project.id);
  assert.equal(parsed.paragraphs.find(p => p.id === "remembered-proof")?.explicitId, true);
  assert.equal(parsed.paragraphs.find(p => p.text === "An unmarked paragraph.")?.explicitId, undefined);
});
test("preserving an old generated ID cannot alias a new block or redirect source saves", async () => {
  const workspace = await mkdtemp(path.join(process.cwd(), ".paperfocus/trials/block-collision-"));
  const root = path.join(workspace, "paper"); await mkdir(root);
  const prefix = "\\documentclass{article}\n\\begin{document}\n\\section{Example}\n";
  await writeFile(path.join(root, "main.tex"), prefix + "Original proof.\n\\end{document}");
  const project = await registerProject(workspace, root);
  const before = await parseProject(workspace, project.id), retained = before.paragraphs[0].id;
  // The inserted block now occupies the old ordinal. The preserved block
  // remains in an included file, exercising reservation across file visits.
  await writeFile(path.join(root, "main.tex"), prefix + "A new unrelated example.\n\n\\input{detail}\n\\end{document}");
  await writeFile(path.join(root, "detail.tex"), `% paperfocus:paragraph=${retained}\nOriginal proof.`);
  const after = await parseProject(workspace, project.id);
  assert.equal(new Set(after.paragraphs.map(p => p.id)).size, after.paragraphs.length);
  assert.equal(after.paragraphs.find(p => p.id === retained)?.text, "Original proof.");
  assert.equal(after.paragraphs.find(p => p.id === retained)?.explicitId, true);
  assert.notEqual(after.paragraphs.find(p => p.text === "A new unrelated example.")?.id, retained);
  await saveEdits(workspace, project.id, { [retained]: "Expanded proof." }, after.revision);
  assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /A new unrelated example/);
  assert.equal(await readFile(path.join(root, "detail.tex"), "utf8"), `% paperfocus:paragraph=${retained}\nExpanded proof.`);
});

test("multi-file headings retain nesting, starred commands, focus syntax and source edits", async () => {
  const workspace = await mkdtemp(path.join(process.cwd(), ".paperfocus/trials/headings-"));
  const root = path.join(workspace, "paper"); await mkdir(root);
  const main = String.raw`\documentclass{article}
\usepackage{amsthm}
\newtheorem{theorem}{Theorem}[subsubsection]
\begin{document}
\section{Approach}
Main text.
\input{detail}
\section*{Discussion}
Final text.
\end{document}`;
  const detail = String.raw`\subsection[Setup]{The setup}
Setup text.
\subsubsection{Assumptions}
Assumption text.
\paragraph{A condition}
Condition text.
\subparagraph*{An exception}
Exception text.
\begin{theorem}
A statement.
\end{theorem}
\begin{proof}
A proof.
\end{proof}`;
  await writeFile(path.join(root, "main.tex"), main);
  await writeFile(path.join(root, "detail.tex"), detail);
  const project = await registerProject(workspace, root);
  const parsed = await parseProject(workspace, project.id);
  const headings = parsed.nodes.filter(node => !node.environment);
  assert.deepEqual(headings.map(node => node.depth), [0, 1, 2, 3, 4, 0]);
  assert.deepEqual(headings.map(node => node.title), ["Approach", "The setup", "Assumptions", "A condition", "An exception", "Discussion"]);
  for (let index = 1; index < 5; index++) assert.equal(headings[index].parentId, headings[index - 1].id);
  assert.equal(headings[5].parentId, undefined);
  assert.match(parsed.nodes.find(node => node.kind === "theorem")!.title, /1\.1\.1\.1$/);
  const rows = outlineRows(parsed.nodes, "paper", []);
  assert.deepEqual(rows.filter(({ node }) => !node.environment).map(row => row.depth), [0, 1, 2, 3, 4, 0]);
  const folded = outlineRows(parsed.nodes, "paper", [headings[1].id]);
  assert.deepEqual(folded.map(({ node }) => node.title), ["Approach", "The setup", "Discussion"]);
  const focused = focusedDocument(parsed, { focusNodeId: headings[3].id });
  assert.match(focused, /\\paragraph\*\{A condition\}/);
  assert.match(focused, /\\subparagraph\*\{An exception\}/);
  assert.ok(!focused.includes("Main text."));
  const paragraph = parsed.paragraphs.find(p => p.text === "Condition text.")!;
  await saveEdits(workspace, project.id, { [paragraph.id]: "Edited condition." }, parsed.revision);
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
  assert.equal(await readFile(path.join(root, "detail.tex"), "utf8"), detail.replace("Condition text.", "Edited condition."));
});

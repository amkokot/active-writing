import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { editableProject, parseProject, publicDocument, readSourceFile, registerProject, saveEdits, theoremDeclarations } from "./projects.ts";
import { changeEnvironment } from "./environmentEditing.ts";
import { preserveEnvironmentMarks, wrapSourceBlock, completeTypedEnvironment, validateEnvironmentFields } from "../src/environmentEditing.ts";
import { acknowledgeSave } from "../src/acknowledgedSave.ts";
import { makeReviewComment, reviewCommentTarget } from "../src/review.ts";
import { cycleQueuedProgress, sectionReminderTarget, togglePassageBookmarks, passageBookmark } from "../src/queueEntries.ts";
import { freshTurbo } from "../src/turbo.ts";
import { newNotebookEntry } from "../src/notebook.ts";
import type { AppState } from "../src/types.ts";

const preamble = "\\usepackage{amsthm}\n\\newtheorem{thm}{Theorem}[section]\n\\newtheorem{lem}[thm]{Lemma}\n\\newtheorem{prop}[thm]{Proposition}\n\\newtheorem*{remark}{Remark}\n";

test("typed opening commands complete only a whole ordinary chunk with a declared type", () => {
  const choices=[{name:"lem",title:"Lemma"}];
  assert.deepEqual(completeTypedEnvironment("\\begin{lem}",11,choices),{text:"\\begin{lem}\n\n\\end{lem}",caret:12});
  const text="Before.\n\n\\begin{lem}";
  assert.deepEqual(completeTypedEnvironment(text,text.length,choices),{text:text+"\n\n\\end{lem}",caret:text.length+1});
  for(const source of ["\\begin{unknown}","\\begin{align}","\\begin{cases}","Some \\begin{lem}","\\begin{lem}\n\\end{lem}","\\begin{lem"] ) assert.equal(completeTypedEnvironment(source,source.length,choices),undefined);
  assert.deepEqual(completeTypedEnvironment("\\begin {lem}",12,choices),{text:"\\begin {lem}\n\n\\end{lem}",caret:13});
});
test("theorem declarations support balanced titles, shared counters and starred custom types without math guesses",()=>{
  assert.deepEqual(theoremDeclarations("% \\newtheorem{fake}{Fake}\n\\newtheorem {claim} {A \\textbf{Claim}} [section]\n\\newtheorem {observation} [claim] {Observation}\n\\newtheorem * {aside} {Aside}\n\\begin{align}x=1\\end{align}"),[
    {name:"claim",title:"A \\textbf{Claim}",counter:"claim",within:"section"},
    {name:"observation",title:"Observation",counter:"claim",within:undefined},
    {name:"aside",title:"Aside",counter:undefined,within:undefined},
  ]);
  for(const unfinished of ["\\newtheorem{unfinished","\\newtheorem{x}{Title","\\newtheorem{x}[shared","\\newtheorem{x}{Title}[section"])assert.deepEqual(theoremDeclarations(unfinished),[]);
});
test("descriptions and labels produce standard LaTeX and reject unsafe field syntax", () => {
  assert.equal(wrapSourceBlock("Claim",0,5,"Claim","lem",{description:"Bound for $x$",label:"lem:bound"}),"\\begin{lem}[Bound for $x$]\\label{lem:bound}\nClaim\n\\end{lem}");
  for(const description of ["Unclosed {", "Extra }", "Bad ]", "Bad\nline", "Bad%comment", "\\end{lem}"]) assert.throws(()=>validateEnvironmentFields({description}));
  for(const label of ["has spaces","x}\\input{x}","x%comment"]) assert.throws(()=>validateEnvironmentFields({label}));
  validateEnvironmentFields({description:"A {[literal]} bracket and \\ref{other}",label:"thm:v1"});
});
async function fixture(body = "\\section{Trial}\nOrdinary text.\n\n\\begin{lem}[A useful fact]\\label{lem:fact}\nFirst statement $x=1$. % retained\n\nSecond statement.\n\\end{lem}\n\nClosing text.\n", extra: Record<string, string> = {}) {
  const trials = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(trials, { recursive: true });
  const workspace = await mkdtemp(path.join(trials, "environment-types-")); await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\n\\input{defs}\n\\begin{document}\n" + body + "\\end{document}\n");
  await writeFile(path.join(workspace, "paper/defs.tex"), preamble);
  for (const [file, text] of Object.entries(extra)) await writeFile(path.join(workspace, "paper", file), text);
  const project = await registerProject(workspace, "paper"); const parsed = await parseProject(workspace, project.id);
  return { workspace, project, parsed };
}
function request(f: Awaited<ReturnType<typeof fixture>>, environment: string, nodeId = f.parsed.nodes.find(n => n.environment === "lem")!.id) {
  return { projectId: f.project.id, revision: f.parsed.revision, mainFile: "main.tex", nodeId, environment };
}
test("preamble files load lazily and whole-file edits retain body text under the usual revision guard",async()=>{
  const f=await fixture(),source=await readSourceFile(f.workspace,f.project.id,"main.tex"),before=source.source;
  assert.equal(source.revision,f.parsed.revision);assert.match(source.source,/documentclass/);assert.ok(source.positions.length);
  assert.equal((await readSourceFile(f.workspace,f.project.id,"defs.tex")).source,preamble);
  for(const file of ["../main.tex","missing.tex","main.pdf"])await assert.rejects(readSourceFile(f.workspace,f.project.id,file));
  const changed=before.replace("\\input{defs}","\\input{defs}\n% Preamble edit"),range={paragraphId:"raw:main.tex",file:"main.tex",start:0,end:before.length,text:before};
  const saved=await saveEdits(f.workspace,f.project.id,{[range.paragraphId]:changed},source.revision,[range],source.mainFile);
  assert.equal(saved.sources["main.tex"],changed);
  assert.deepEqual(saved.paragraphs.map(p=>p.text),f.parsed.paragraphs.map(p=>p.text));
  await assert.rejects(saveEdits(f.workspace,f.project.id,{[range.paragraphId]:before},source.revision,[range],source.mainFile));
  assert.equal((await readSourceFile(f.workspace,f.project.id,"main.tex")).source,changed);
});
function stateFor(f: Awaited<ReturnType<typeof fixture>>, paragraphId: string): AppState {
  return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "unrelated", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "source", activeNodeId: f.parsed.paragraphs.find(p => p.id === paragraphId)!.nodeId, activeParagraphId: paragraphId, hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "hidden" };
}

test("inline structural command saves replace only their exact range and preserve included files", async () => {
  const f = await fixture("\\input{section}\n", {"section.tex": "\\section{Original}\nBody $x=1$.\n\n\\begin{lem}[Bound]\\label{lem:bound}\nStatement.\n\\end{lem}\n"});
  const before = f.parsed, node = before.nodes.find(n => n.title === "Original")!, command = node.sourceOpening!;
  const id = `command:${node.id}:start`, replacement = "\\section{Renamed}\\label{sec:renamed}";
  const range = {paragraphId: id, ...command};
  const saved = await saveEdits(f.workspace, f.project.id, {[id]: replacement}, before.revision, [range], before.project.mainFile);
  assert.equal(saved.sources["main.tex"], before.sources["main.tex"]);
  assert.equal(saved.sources["defs.tex"], before.sources["defs.tex"]);
  assert.equal(saved.sources["section.tex"], before.sources["section.tex"].slice(0, command.start) + replacement + before.sources["section.tex"].slice(command.end));
  assert.deepEqual(saved.paragraphs.map(p => p.text), before.paragraphs.map(p => p.text));
  await assert.rejects(saveEdits(f.workspace, f.project.id, {[id]: "\\section{Stale}"}, before.revision, [range], before.project.mainFile));
  assert.equal((await readSourceFile(f.workspace, f.project.id, "section.tex")).source, saved.sources["section.tex"]);
});

test("block wrapping changes only an exact selected chunk and preserves math, references and comments", () => {
  const quote = "Claim $x=1$; see \\ref{a}. % comment", text = "Before.\n\n" + quote + "\n\nAfter.";
  assert.equal(wrapSourceBlock(text, 9, 9 + quote.length, quote, "lem"), "Before.\n\n\\begin{lem}\n" + quote + "\n\\end{lem}\n\nAfter.");
  assert.equal(wrapSourceBlock("", 0, 0, "", "thm"), "\\begin{thm}\n\n\\end{thm}");
  assert.equal(wrapSourceBlock("A\r\n\r\nB", 5, 6, "B", "lem"), "A\r\n\r\n\\begin{lem}\r\nB\r\n\\end{lem}");
});
test("wrapping refuses stale ranges, unsafe names, headings and partial nested environments", () => {
  for (const quote of ["\\section{Heading}", "\\subsubsection*{Heading}", "\\begin{align} x=1", "x=1\\end{align}", "\\begin{a}\\end{b}"]) assert.throws(() => wrapSourceBlock(quote, 0, quote.length, quote, "lem"));
  assert.throws(() => wrapSourceBlock("New", 0, 3, "Old", "lem"));
  assert.throws(() => wrapSourceBlock("A", 0, 1, "A", "x}\\input{bad"));
  const nested = "\\begin{align}x=1\\end{align}";
  assert.match(wrapSourceBlock(nested, 0, nested.length, nested, "lem"), /begin\{lem\}/);
});
test("choices use actual included declarations, shared counters, unnumbered statements and proof support", async () => {
  const f = await fixture();
  assert.deepEqual(f.parsed.environmentOptions, [{ name: "thm", title: "Theorem" }, { name: "lem", title: "Lemma" }, { name: "prop", title: "Proposition" }, { name: "remark", title: "Remark" }, { name: "proof", title: "Proof" }]);
  const doc = publicDocument(f.parsed);
  assert.equal(doc.nodes.find(n => n.environment === "lem")!.canChangeEnvironment, true);
  assert.equal("environmentRanges" in doc, false);
  assert.equal(doc.environmentOptions!.some(e => e.name === "theorem"), false, "no undeclared guessed wrappers");
  const section=doc.nodes.find(n=>n.title==="Trial")!,lemma=doc.nodes.find(n=>n.environment==="lem")!;
  assert.equal(section.sourceOpening?.text,"\\section{Trial}");
  assert.equal(lemma.sourceOpening?.text,"\\begin{lem}[A useful fact]\\label{lem:fact}");
  assert.equal(lemma.sourceClosing?.text,"\\end{lem}");
  assert.equal(lemma.sourceLastParagraphId,lemma.paragraphIds.at(-1));
});
test("changing a whole statement updates both commands but leaves titles, labels, body and preamble intact", async () => {
  const f = await fixture(), before = f.parsed.sources["main.tex"];
  const saved = await changeEnvironment(f.workspace, request(f, "prop"));
  assert.equal(saved.sources["main.tex"], before.replace("\\begin{lem}", "\\begin{prop}").replace("\\end{lem}", "\\end{prop}"));
  assert.equal(saved.sources["defs.tex"], preamble);
  assert.equal(saved.nodes.find(n => n.environment === "prop")!.paragraphIds.length, 1);
  assert.ok(saved.paragraphs.find(p => p.nodeId === saved.nodes.find(n => n.environment === "prop")!.id)!.text.includes("\n\nSecond statement."), "spacing inside an environment stays in the same block");
  assert.equal(saved.saveAcknowledgement!.baseRevision, f.parsed.revision);
  assert.equal(saved.labels.find(l => l.key === "lem:fact")!.nodeId, saved.nodes.find(n => n.environment === "prop")!.id);
});
test("removing a wrapper retains named heading, labels, comments and every body paragraph", async () => {
  const f = await fixture(); const saved = await changeEnvironment(f.workspace, request(f, ""));
  assert.equal(saved.sources["main.tex"], f.parsed.sources["main.tex"].replace("\\begin{lem}[A useful fact]", "\\textbf{A useful fact}\\par\n\n").replace("\\end{lem}", ""));
  assert.equal(saved.nodes.some(n => n.environment === "lem"), false);
  assert.match(saved.sources["main.tex"], /\\label\{lem:fact\}/);
});

test("heading fields edit only the owning included-file environment and keep secondary/nested labels", async () => {
  const f=await fixture("\\section{Trial}\n\\input{results}\n\\input{appendix}\n",{
    "results.tex":"\\begin{lem}[Old title]\\label{lem:fact}\nClaim.\\label{lem:alias}\n\\begin{remark}\\label{nested}\nRemark.\n\\end{remark}\n\\end{lem}\n",
    "appendix.tex":"\\section{Appendix}\nReference \\ref{lem:fact}.\n"
  });
  const saved=await changeEnvironment(f.workspace,{...request(f,"prop"),fields:{description:"Bound for $x$",label:"prop:bound"}});
  assert.match(saved.sources["results.tex"],/\\begin\{prop\}\[Bound for \$x\$\]\\label\{prop:bound\}/);
  assert.match(saved.sources["results.tex"],/\\label\{lem:alias\}/);assert.match(saved.sources["results.tex"],/\\label\{nested\}/);
  assert.equal(saved.sources["main.tex"],f.parsed.sources["main.tex"]);assert.equal(saved.sources["appendix.tex"],f.parsed.sources["appendix.tex"]);
  assert.equal(saved.nodes.find(n=>n.environment==="prop")!.environmentTitle,"Bound for $x$");
});
test("inline labels use non-overlapping body edits, label insertion/removal and duplicate refusal are safe", async()=>{
  const f=await fixture("\\section{Trial}\n\\begin{lem}\nClaim \\label{old} stays.\n\\end{lem}\n\\begin{thm}\\label{taken}\nOther.\n\\end{thm}\n");
  await assert.rejects(changeEnvironment(f.workspace,{...request(f,"lem"),fields:{label:"taken"}}),/already used/);
  const changed=await changeEnvironment(f.workspace,{...request(f,"lem"),fields:{description:"Named",label:"new"}});
  assert.match(changed.sources["main.tex"],/Claim \\label\{new\} stays/);
  const removed=await changeEnvironment(f.workspace,{projectId:f.project.id,mainFile:"main.tex",revision:changed.revision,nodeId:changed.nodes.find(n=>n.environment==="lem")!.id,environment:"lem",fields:{description:"",label:""}});
  assert.doesNotMatch(removed.sources["main.tex"],/\\label\{new\}|\[Named\]/);assert.match(removed.sources["main.tex"],/\\label\{taken\}/);
  const added=await changeEnvironment(f.workspace,{projectId:f.project.id,mainFile:"main.tex",revision:removed.revision,nodeId:removed.nodes.find(n=>n.environment==="lem")!.id,environment:"lem",fields:{label:"inserted"}});
  assert.match(added.sources["main.tex"],/\\begin\{lem\}\\label\{inserted\}/);
});
test("included-file statement changes do not move appendix proofs or rewrite other files", async () => {
  const f = await fixture("\\section{Trial}\n\\input{results}\n\\appendix\n\\input{appendix}\n", {
    "results.tex": "\\begin{lem}\\label{lem:fact}\nClaim.\n\\end{lem}\n",
    "appendix.tex": "\\section{Proofs}\n\\begin{proof}[Proof of Lemma \\ref{lem:fact}]\nArgument.\n\\end{proof}\n",
  });
  const saved = await changeEnvironment(f.workspace, request(f, "thm"));
  assert.equal(saved.sources["main.tex"], f.parsed.sources["main.tex"]); assert.equal(saved.sources["appendix.tex"], f.parsed.sources["appendix.tex"]);
  assert.deepEqual(saved.nodes.find(n => n.environment === "proof")!.proofFor, [saved.nodes.find(n => n.environment === "thm")!.id]);
});
test("type changes and unwrapping re-anchor comments, bookmarks and notebook notes without resolving them", async () => {
  const f = await fixture(); let before = publicDocument(f.parsed);
  const quote = "Second statement.", p = before.paragraphs.find(p => p.text.includes(quote))!, start = p.text.indexOf(quote);
  const selection = { paragraphId: p.id, nodeId: p.nodeId, start, end: start + quote.length, text: quote, x: 0, y: 0 };
  const comment = makeReviewComment(before, {}, selection, "Keep this note.");
  let state = togglePassageBookmarks({ ...stateFor(f, p.id), attentionTasks: [comment] }, before, [selection]);
  const entry = newNotebookEntry(before, state, selection); entry.notes = "Retained research."; state.notebookEntries = [entry];
  for (const environment of ["thm", ""]) {
    const parsed = await parseProject(f.workspace, f.project.id), node = parsed.nodes.find(n => n.id === state.activeNodeId)!;
    const saved = await changeEnvironment(f.workspace, { projectId: f.project.id, mainFile: "main.tex", revision: parsed.revision, nodeId: node.id, environment });
    const current = before.paragraphs.find(p => p.id === state.activeParagraphId)!;
    const after = publicDocument(saved); state = acknowledgeSave(state, before, after, {}, saved.saveAcknowledgement, { paragraphId: state.activeParagraphId!, offset: current.text.indexOf(quote) + 1 }).state;
    assert.equal(state.attentionTasks[0].status, "queued"); assert.deepEqual(state.attentionTasks[0].review, comment.review);
    assert.equal(reviewCommentTarget(state.attentionTasks[0], after, {}).paragraphId, state.activeParagraphId);
    const next = after.paragraphs.find(p => p.id === state.activeParagraphId)!;
    const position = next.text.indexOf(quote);
    assert.ok(passageBookmark(state.attentionTasks, after, {}, { ...selection, nodeId: next.nodeId, paragraphId: next.id, start: position, end: position + quote.length }));
    assert.equal(state.notebookEntries[0].notes, "Retained research."); assert.equal(state.notebookEntries[0].source!.excerpt, quote);
    before = after;
  }
});
test("plain wrapping saves as standard LaTeX and preserves confirmed comment links", async () => {
  const f = await fixture(), before = publicDocument(f.parsed), p = before.paragraphs[0];
  const selection = { paragraphId: p.id, nodeId: p.nodeId, start: 0, end: p.text.length, text: p.text, x: 0, y: 0 };
  const comment = makeReviewComment(before, {}, selection, "Ordinary note.");
  const submitted = { [p.id]: wrapSourceBlock(p.text, 0, p.text.length, p.text, "thm") };
  const saved = await saveEdits(f.workspace, f.project.id, submitted, before.revision);
  const result = acknowledgeSave({ ...stateFor(f, p.id), paragraphEdits: submitted, attentionTasks: [comment] }, before, publicDocument(saved), submitted, saved.saveAcknowledgement, { paragraphId: p.id, offset: 12 });
  assert.equal(saved.nodes.find(n => n.id === result.state.activeNodeId)!.environment, "thm");
  assert.equal(result.state.attentionTasks[0].status, "queued");
  assert.equal(reviewCommentTarget(result.state.attentionTasks[0], publicDocument(saved), {}).paragraphId, result.state.activeParagraphId);
});
test("stale versions, foreign nodes and undeclared destinations fail without changing source", async () => {
  const f = await fixture();
  for (const bad of [{ revision: "old" }, { mainFile: "other.tex" }, { nodeId: "foreign" }, { environment: "undeclared" }, { environment: "x}\\input{bad" }]) await assert.rejects(changeEnvironment(f.workspace, { ...request(f, "thm"), ...bad }));
  assert.equal(await readFile(path.join(f.workspace, "paper/main.tex"), "utf8"), f.parsed.sources["main.tex"]);
});
test("incomplete and cross-file wrappers cannot be converted", async () => {
  for (const [body, extra] of [
    ["\\begin{lem}\nClaim.\n", {}],
    ["\\begin{lem}\n\\input{close}\n", { "close.tex": "Claim.\n\\end{lem}\n" }],
    ["\\begin{lem}\n\\begin{align}x=1\\end{wrong}\n\\end{lem}\n", {}],
  ] as Array<[string, Record<string, string>]>) {
    const f = await fixture(body, extra); await assert.rejects(changeEnvironment(f.workspace, request(f, "thm")));
    assert.equal(await readFile(path.join(f.workspace, "paper/main.tex"), "utf8"), f.parsed.sources["main.tex"]);
  }
});

test("adding a statement ahead of another moves checks and unfinished reminders through body identity", async () => {
  const f = await fixture(), before = publicDocument(f.parsed), ordinary = before.paragraphs[0], node = before.nodes.find(n => n.environment === "lem")!;
  let state = cycleQueuedProgress(stateFor(f, ordinary.id), before, node.id);
  const submitted = { [ordinary.id]: wrapSourceBlock(ordinary.text, 0, ordinary.text.length, ordinary.text, "lem") };
  const saved = await saveEdits(f.workspace, f.project.id, submitted, before.revision), after = publicDocument(saved);
  state = preserveEnvironmentMarks(acknowledgeSave({ ...state, paragraphEdits: submitted }, before, after, submitted, saved.saveAcknowledgement).state, before, after, saved.saveAcknowledgement!, submitted);
  const existing = after.nodes.find(n => n.environmentTitle === "A useful fact")!, inserted = after.nodes.find(n => n.environment === "lem" && n.id !== existing.id)!;
  assert.equal(state.progressByNode[existing.id], "progress"); assert.equal(state.progressByNode[inserted.id], undefined);
  assert.equal(sectionReminderTarget(state.attentionTasks[0], after)!.nodeId, existing.id);
  const changed = await changeEnvironment(f.workspace, { projectId: f.project.id, mainFile: "main.tex", revision: after.revision, nodeId: existing.id, environment: "thm" }), renamed = publicDocument(changed);
  state = preserveEnvironmentMarks(acknowledgeSave(state, after, renamed, {}, changed.saveAcknowledgement).state, after, renamed, changed.saveAcknowledgement!);
  const theorem = renamed.nodes.find(n => n.environment === "thm")!;
  assert.equal(state.progressByNode[theorem.id], "progress"); assert.equal(state.attentionTasks[0].status, "queued");
  assert.equal(sectionReminderTarget(state.attentionTasks[0], renamed)!.nodeId, theorem.id);
});

test("empty statement wrappers and unnamed removal preserve neighboring source", async () => {
  const f = await fixture("Before.\n\n\\begin{lem}\n\\end{lem}\n\nAfter.\n");
  f.parsed = await editableProject(f.workspace, f.project.id);
  const empty = f.parsed.paragraphs.find(p => p.nodeId === f.parsed.nodes.find(n => n.environment === "lem")!.id)!;
  assert.equal(f.parsed.nodes.find(n=>n.environment==="lem")!.sourceLastParagraphId,empty.id,"the literal closing command belongs after the empty writing surface");
  const changed = await changeEnvironment(f.workspace, request(f, "thm"));
  assert.equal(changed.sources["main.tex"], f.parsed.sources["main.tex"].replace("\\begin{lem}", "\\begin{thm}").replace("\\end{lem}", "\\end{thm}"));
  const marked = { ...stateFor(f, empty.id), progressByNode: { [empty.nodeId]: "progress" as const } };
  const next = acknowledgeSave(marked, publicDocument(f.parsed), publicDocument(changed), {}, changed.saveAcknowledgement, { paragraphId: empty.id, offset: 0 });
  assert.equal(next.caret!.nodeId, changed.nodes.find(n => n.environment === "thm")!.id);
  assert.equal(preserveEnvironmentMarks(next.state, publicDocument(f.parsed), publicDocument(changed), changed.saveAcknowledgement!).progressByNode[next.caret!.nodeId], "progress");
  const saved = await changeEnvironment(f.workspace, { projectId: f.project.id, mainFile: "main.tex", revision: changed.revision, nodeId: changed.nodes.find(n => n.environment === "thm")!.id, environment: "" });
  assert.equal(saved.sources["main.tex"], f.parsed.sources["main.tex"].replace("\\begin{lem}", "").replace("\\end{lem}", ""));
});

test("wrapping an empty writing surface returns a confirmed caret inside its new statement", async () => {
  const f = await fixture("\\section{Empty}\n"); f.parsed = await editableProject(f.workspace, f.project.id);
  const before = publicDocument(f.parsed), p = before.paragraphs[0], submitted = { [p.id]: wrapSourceBlock("", 0, 0, "", "thm") };
  const saved = await saveEdits(f.workspace, f.project.id, submitted, before.revision);
  const next = acknowledgeSave({ ...stateFor(f, p.id), paragraphEdits: submitted }, before, publicDocument(saved), submitted, saved.saveAcknowledgement, { paragraphId: p.id, offset: 12 });
  assert.equal(saved.nodes.find(n => n.id === next.caret!.nodeId)!.environment, "thm");
  assert.equal(next.caret!.offset, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromePreferencesKey, defaultChromePreferences, loadChromePreferences, saveChromePreferences } from "../src/chromePreferences.ts";
import { createHoverIntent, hoverRevealDelayMs } from "../src/hoverIntent.ts";
import { compiledPdfDownloadUrl, pdfDownloadName } from "../src/pdfLinks.ts";

test("queue toolbar separates current-location and next navigation from completion", async () => {
  const source = await readFile("src/components/PriorityQueue.tsx", "utf8");
  assert.match(source, /const currentTask = queue\.find\(task => task\.id === props\.activeId\) \?\? queue\[0\]/);
  assert.match(source, /nextQueueTask\(queue, currentTask\?\.id\)/);
  const current = source.slice(source.indexOf('<button className="queue-current"'), source.indexOf('<button className="queue-main"'));
  assert.match(current, /aria-label="Go to current priority task"/);
  assert.match(current, /if \(currentTask\) returnTo\(currentTask\)/);
  assert.match(current, /<LocateFixed size=\{13\} \/><span>Current<\/span>/);
  assert.doesNotMatch(current, /onFinishActive|onDismiss|onReady/);
  const next = source.slice(source.indexOf('<button className="queue-main"'), source.indexOf('<button className="queue-menu-button"'));
  assert.match(next, /if \(nextTask\) returnTo\(nextTask\)/);
  assert.match(next, /else if \(props\.suggestion\) next\(\)/);
  assert.match(next, /<ArrowRight size=\{13\} \/><span>Next<\/span>/);
  assert.doesNotMatch(next, /onFinishActive|onDismiss|onReady/);
  assert.match(source, /aria-label=\{`Open priority queue \(\$\{queue\.length\} items\)`\}/);
});

test("research phases scroll away with the notebook and list newest first", async () => {
  const notebook = await readFile("src/components/ResearchNotebook.tsx", "utf8");
  const css = await readFile("src/styles.css", "utf8");
  assert.match(notebook, /aria-label="Research phase navigation"/);
  assert.match(notebook, /<label>Research phase<select aria-label="Research phase"/);
  assert.ok(notebook.indexOf('aria-label="Research phase navigation"') < notebook.indexOf('className="notebook-heading"'));
  assert.match(notebook, /\[\.\.\.phases\]\.reverse\(\)\.map\(item[\s\S]*archived/);
  assert.ok(notebook.indexOf('className="research-notebook" ref={scrollRef}') < notebook.indexOf('aria-label="Research phase navigation"'));
  assert.match(notebook, /return <section className="research-notebook-pane">/);
  assert.match(css, /\.notebook-phase-toolbar \{ position: static; flex-shrink: 0/);
  assert.match(css, /\.research-notebook-pane \{ display: flex; flex-direction: column;[\s\S]*?overflow: hidden/);
  assert.doesNotMatch(notebook, /className="notebook-heading"[\s\S]*?<\/header>[\s\S]*?Notebook · \{manuscriptVersionLabel/);
});

test("compiled PDF pages are reachable without opening the LaTeX options menu", async () => {
  const viewer = await readFile("src/components/PdfViewer.tsx", "utf8");
  assert.match(viewer, /const pagination = <>[\s\S]*aria-label="Previous page"[\s\S]*aria-label="PDF page number"[\s\S]*aria-label="Next page"/);
  assert.match(viewer, /!renderControls && pagination/);
  assert.match(viewer, /renderControls && <nav className="pdf-controls pdf-pagination" aria-label="PDF page navigation">\s*\{pagination\}/);
  assert.match(viewer, /One page at a time/);
});

test("PDF canvases retain double-click source navigation without disruptive hover titles", async () => {
  for (const file of ["src/components/PdfViewer.tsx", "src/components/ContinuousPdfPages.tsx"]) {
    const viewer = await readFile(file, "utf8");
    assert.doesNotMatch(viewer, /<canvas[^>]*\btitle=/);
    assert.match(viewer, /onDoubleClick=/);
    assert.match(viewer, /onSourcePosition\?\.\(pageNumber/);
  }
});

test("both PDF layouts expose cancellable native text selection without blocking links or source navigation", async () => {
  const layer = await readFile("src/components/PdfTextLayer.tsx", "utf8");
  const continuous = await readFile("src/components/ContinuousPdfPages.tsx", "utf8");
  const single = await readFile("src/components/PdfViewer.tsx", "utf8");
  const css = await readFile("src/styles.css", "utf8");
  for (const viewer of [continuous, single]) {
    assert.match(viewer, /<PdfTextLayer document=\{document\} pageNumber=\{pageNumber\} scale=\{scale\} onSourcePosition=\{onSourcePosition\}/);
    assert.ok(viewer.indexOf("<PdfTextLayer") < viewer.indexOf('<div className="pdf-link-layer"'));
  }
  assert.match(layer, /new TextLayer\(\{ container, viewport, textContentSource: page.streamTextContent\(\) \}\)/);
  assert.match(layer, /viewport.scale \* viewport.userUnit/);
  assert.match(layer, /layer\?\.cancel\(\); container.replaceChildren\(\)/);
  assert.match(layer, /onDoubleClick=/); assert.match(layer, /onSourcePosition\?\./);
  assert.doesNotMatch(layer, /preventDefault\(|removeAllRanges\(|clipboard.write|innerHTML/);
  assert.match(continuous, /addEventListener\("selectionchange", update\)/);
  assert.match(continuous, /selection.getRangeAt\(i\).intersectsNode\(layer\)/);
  assert.match(css, /\.pdf-text-layer :is\(span, br\).*color: transparent.*user-select: text/);
  assert.match(css, /\.pdf-text-layer ::selection.*background:/);
  assert.match(css, /\.preview-page \{ user-select: text/);
  assert.match(css, /\.pdf-link-layer \{[^}]*pointer-events: none/);
});

test("PDF double-click locates a passage without the scope-changing outline navigation", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const sync = app.slice(app.indexOf("function syncToSource"), app.indexOf("async function syncPdf"));
  assert.match(sync, /locateSourcePassage\(current, paragraph.nodeId, paragraphId, manuscriptNodes\)/);
  assert.doesNotMatch(sync, /navigateNode\(/);
  assert.match(sync, /setJumpTarget/);
  assert.match(app, /currentSource.project.mainFile !== document.project.mainFile \|\| currentSource.revision !== document.revision/);
});

test("highlight action bars wait for pointer release without erasing the selection", async () => {
  const manuscript = await readFile("src/components/Manuscript.tsx", "utf8");
  assert.match(manuscript, /pendingSelection && !selectionDragging &&/);
  assert.match(manuscript, /setSelectionDragging\(true\)/);
  assert.match(manuscript, /window.addEventListener\("pointerup", finish\)/);
  assert.match(manuscript, /window.addEventListener\("pointercancel", finish\)/);
  assert.match(manuscript, /window.addEventListener\("blur", finish\)/);
  const finish = manuscript.slice(manuscript.indexOf("const finish = () =>"), manuscript.indexOf("// A drag can finish"));
  assert.match(finish, /setSelectionDragging\(false\)/); assert.match(finish, /requestAnimationFrame\(selectionChanged\)/);
  assert.doesNotMatch(finish, /clearCrossSelection|removeAllRanges|onSelection\(undefined\)/);
});

test("fresh manuscript defaults are split PDF and implicit blocks, with guarded linked-root navigation", async () => {
  const [app, state] = await Promise.all(["src/App.tsx", "src/state.ts"].map(file => readFile(file, "utf8")));
  assert.match(state, /sourcePresentation: "plain"/);
  assert.match(state, /previewMode: "split"/);
  assert.match(app, /const \[preambleEditing,\s*setPreambleEditing\]\s*=\s*useState\(false\)/);
  assert.match(app, /const \[previewFormat, setPreviewFormat\] = useState<"pdf" \| "reading">\("pdf"\)/);
  assert.match(app, /value=\{previewFormat\}/);
  assert.match(app, /automaticLinkedManuscript\(initialWindowRequest, document, latestState.current, preambleEditing\)/);
  assert.match(app, /linkedSourceAutoAttempt.current = true;\s*void openLinkedSource\(\)/);
  assert.match(app, /const next = await switchManuscript\(request.rootFile\)/);
  assert.match(app, /setPreviewFormat\(request.format\)/);
  assert.match(app, /if \(diskNavigationSaved\) setBrowserRecoveryError\(saveBrowserRecovery/);
  assert.match(app, /const kept = await prepareNavigation\(\)[\s\S]*activateDocument\(result.document, true, true, true\)/);
});

test("opening manuscripts restores their own PDFs and automatically builds missing views once", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(app, /manuscriptBuildCache.current.read\(next\)/);
  assert.match(app, /result.mainFile !== document.project.mainFile \|\| result.engine !== document.project.engine/);
  assert.match(app, /finally\(\(\) => \{ if \(!cancelled\) setRootCompileReady\(identity\)/);
  assert.match(app, /pendingRootCompile.current = undefined;[\s\S]*void compileLatex\("focus", false, true\)/);
  assert.match(app, /previewFormat !== "pdf" \|\| effectivePreviewMode === "hidden"/);
  assert.match(app, /manuscriptBuildIdentity\(current\) !== manuscriptBuildIdentity\(saved\)/);
  assert.match(app, /compileInFlight.current = true/); assert.match(app, /compileInFlight.current = false/);
});

test("manuscript PDF scrolling includes every selected page with bounded nearby rendering", async () => {
  const [preview, viewer, pages, css] = await Promise.all(["src/components/Preview.tsx", "src/components/PdfViewer.tsx", "src/components/ContinuousPdfPages.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(preview, /<PdfViewer continuous active=/);
  assert.match(viewer, /Array.from\(\{ length: document.numPages \}/);
  assert.match(viewer, /selectedPages\?\.length \? selectedPages/);
  assert.match(pages, /sizes.map\(size => <div[\s\S]*data-pdf-page=\{size.page\}/);
  assert.match(pages, /active && \(nearby.has\(size.page\) \|\| selectedPages.has\(size.page\)\) && <ContinuousPdfCanvas/);
  assert.match(pages, /IntersectionObserver[\s\S]*root: pane/);
  assert.match(pages, /task\?\.cancel\(\)/);
  assert.match(pages, /cancelled \|\| !canvasRef.current/);
  assert.match(pages, /onSourcePosition\?\.\(pageNumber/);
  assert.match(viewer, /continuousNavigator.current\?\.\(index \+ 1, y\)/);
  assert.match(pages, /previousScale.current !== scale && anchor.current/);
  assert.match(pages, /resume.top \/ \(resume.scale/);
  assert.match(css, /\.pdf-page-stack \{ display: flex; flex-direction: column/);
});

test("source ZIP download is menu-only, saves first, fences project changes and releases download bytes", async () => {
  const [app, download] = await Promise.all(["src/App.tsx", "src/components/SourceZipDownload.tsx"].map(file => readFile(file, "utf8")));
  assert.match(app, /compile-options[\s\S]*<SourceZipDownload/);
  assert.match(download, /await onSave\(\)[\s\S]*saved.project.id !== projectId[\s\S]*await fetch/);
  assert.match(download, /application\/zip/); assert.match(download, /response.ok/);
  assert.match(download, /controller.current\?\.abort/); assert.match(download, /revokeObjectURL/);
  assert.doesNotMatch(download, /\/compile|window\.open|window\.prompt/);
});

test("collaborator downloads default to an email-ready PDF and remain tucked in manuscript/notebook menus", async () => {
  const [app, download, notebook] = await Promise.all(["src/App.tsx", "src/components/CollaboratorDownload.tsx", "src/components/ResearchNotebook.tsx"].map(file => readFile(file, "utf8")));
  assert.match(app, /compile-options[\s\S]*<CollaboratorDownload/); assert.match(app, /shareControl=\{<CollaboratorDownload compact/);
  assert.match(notebook, /props.shareControl/);
  assert.match(download, /useState<"pdf" \| "html" \| "zip" \| "web" \| "overview">\("pdf"\)/);
  assert.match(download, /Private reader ZIP · for hosting/); assert.match(download, /Overview PDF · ready to email/);
  assert.match(download, /noteFiles: format === "web" \? noteFiles : \[\]/);
  assert.match(download, /application\/pdf/); assert.match(download, /Email previews may show source text/);
  assert.match(download, /await onSave\(\)[\s\S]*saved.project.id !== projectId[\s\S]*await fetch/);
  assert.match(download, /Nothing is uploaded/); assert.match(download, /Include filed and hidden notes/);
  assert.match(download, /disabled=\{busy \|\| blocked\}/); assert.match(download, /notebookRevision\(\)/);
  assert.doesNotMatch(download, /window\.open|navigator\.share|\/compile/);
});

test("PDF downloads offer optional project names inside Compile options without recompiling", async () => {
  assert.equal(pdfDownloadName("", "Transport", "main.tex"), "Transport.pdf");
  assert.equal(pdfDownloadName(" ", "Transport", "notes.tex", true), "Transport — notes — focused.pdf");
  assert.equal(pdfDownloadName("My draft.pdf", "Transport", "main.tex"), "My draft.pdf");
  assert.equal(pdfDownloadName("../report:final", "Transport", "main.tex"), "..-report-final.pdf");
  assert.equal(pdfDownloadName("NUL.pdf", "Transport", "main.tex"), "Paper — NUL.pdf");
  assert.equal(pdfDownloadName("...", "Transport", "main.tex"), "Transport.pdf");
  const origin = "http://127.0.0.1:4173";
  assert.equal(compiledPdfDownloadUrl("/api/paperfocus/pdf/full?projectId=paper&v=1", "paper", origin), `${origin}/api/paperfocus/pdf/full?projectId=paper&v=1`);
  for (const url of ["https://example.com/api/paperfocus/pdf/full?projectId=paper", "/api/paperfocus/pdf/full?projectId=other", "/api/paperfocus/projects?projectId=paper", "javascript:alert(1)"]) assert.equal(compiledPdfDownloadUrl(url, "paper", origin), undefined);
  const [app, download] = await Promise.all(["src/App.tsx", "src/components/PdfDownload.tsx"].map(file => readFile(file, "utf8")));
  assert.match(app, /compile-options[\s\S]*<PdfDownload/);
  assert.match(download, /Filename \(optional\)/);
  assert.match(download, /placeholder=\{suggested\}/);
  assert.match(download, /link.download = pdfDownloadName/);
  assert.match(download, /response.ok/); assert.match(download, /application\/pdf/);
  assert.match(download, /controller.current\?\.abort/);
  assert.match(download, /revokeObjectURL/);
  assert.match(download, /Saved PDF predates current edits/);
  assert.doesNotMatch(download, /compileLatex|\/compile|onCompile|window\.prompt/);
});

test("research setup stays in shared-file tools and only checks on request", async () => {
  const [experiments, setup] = await Promise.all(["src/components/ExperimentWorkspace.tsx", "src/components/ResearchSetup.tsx"].map(file => readFile(file, "utf8")));
  assert.match(experiments, /<summary>Jupyter & shared files<\/summary>[\s\S]*<ResearchSetup key=\{entryId\} projectId=\{projectId\} entryId=\{entryId\}/);
  assert.match(setup, /onClick=\{\(\) => \{ void check\(\); \}\}/);
  assert.match(setup, /current === generation.current/);
  assert.match(setup, /No notebook code runs/);
  assert.doesNotMatch(setup, /\/experiments\/run|setInterval|void check\(\);[^}]*useEffect/);
});

test("project controls offer a blank project, all assets, folder imports and editable unincluded TeX", async () => {
  const [panel, files, app] = await Promise.all(["src/components/RepositoryPanel.tsx", "src/components/ProjectFiles.tsx", "src/App.tsx"].map(file => readFile(file, "utf8")));
  assert.match(panel, />New project<\/button>/);
  assert.match(panel, /action: "create"/);
  assert.match(panel, /const saved = await onSave\(\)/);
  assert.match(panel, /revision: saved.revision, mainFile: saved.project.mainFile, files/);
  assert.match(files, /\[\.\.\.document.files\]/);
  assert.match(files, /webkitdirectory/);
  assert.match(files, /controller.abort\(\)/);
  assert.match(files, /onOpenFile\(file, true\)/);
  assert.match(files, /Copy LaTeX/);
  assert.match(app, /if\(await openPlainSource\(file,true\)\)setRepositoryOpen\(false\)/);
});

test("default source is unformatted, keeps block features and puts explicit boxes only in Advanced",async()=>{
  const [app,state,manuscript,css,plain]=await Promise.all(["src/App.tsx","src/state.ts","src/components/Manuscript.tsx","src/styles.css","src/components/PlainSourceEditor.tsx"].map(file=>readFile(file,"utf8")));
  assert.match(state,/sourcePresentation:\s*"plain"/);
  assert.match(app,/<summary>Advanced<\/summary>[\s\S]*aria-label="Explicit source blocks"/);
  assert.equal((app.match(/aria-label="Explicit source blocks"/g)??[]).length,1);
  assert.match(app,/preambleEditing && document/);
  assert.match(manuscript,/explicitBlocks \? <Heading/);
  assert.match(manuscript,/<SourceCommand nodeId=\{node.id\} command=\{node.sourceOpening\}/);assert.match(manuscript,/<SourceCommand nodeId=\{node.id\} closing command=\{node.sourceClosing\}/);
  const command=await readFile("src/components/SourceCommand.tsx","utf8");
  assert.match(command,/value=\{value\}/);assert.match(command,/onBlur=\{\(\) => \{ void save\(\)/);
  assert.match(app,/paragraphEdits: \{\[id\]: value\}, sourceRanges: \[\{paragraphId: id, \.\.\.range\}\]/);
  assert.match(manuscript,/linkedProofTitle/);assert.match(manuscript,/onChunkAction=\{onChunkAction\}/);
  assert.match(css,/plain-block-source[^\n]+outline: none; background: transparent/);
  assert.match(css,/selected-block-actions[^\n]+opacity: .4/);
  assert.match(css,/selected-block-actions:hover, .selected-block-actions:focus-within \{ opacity: 1/);
  assert.match(plain,/registration.current===owner/);
  assert.match(plain,/sourceRanges:\[\{paragraphId:id,file,start:0,end:before.source.length,text:before.source\}\]/);
});

test("hover requires an uninterrupted short dwell, cancels fly-bys and starts fresh on re-entry",()=>{
  let now=0,id=0,reveals=0;const pending=new Map();
  const clock={set(callback,delay){const handle=++id;pending.set(handle,{at:now+delay,callback});return handle;},clear(handle){pending.delete(handle);}};
  const tick=ms=>{now+=ms;for(const [handle,job] of pending)if(job.at<=now){pending.delete(handle);job.callback();}};
  const intent=createHoverIntent(()=>reveals++,clock);
  assert.equal(hoverRevealDelayMs,250);
  intent.enter();tick(200);intent.cancel();tick(200);assert.equal(reveals,0);
  intent.enter();tick(249);assert.equal(reveals,0);tick(1);assert.equal(reveals,1);
  intent.enter();tick(100);intent.enter();tick(150);assert.equal(reveals,2); // Child enters don't postpone the dwell.
  intent.enter();intent.cancel();intent.cancel();tick(1000);assert.equal(reveals,2);assert.equal(pending.size,0);
});

test("monitor controls cap their scale and split-button widths follow their icons", async()=>{
  const css=await readFile("src/styles.css","utf8");
  assert.match(css,/--aw-toolbar-scale: min\(1.2, var\(--aw-interface-scale\)\)/);
  assert.match(css,/editor-toolbar :is\(button, summary, select\) \{ --aw-interface-scale: var\(--aw-toolbar-scale\)/);
  assert.match(css,/priority-queue-control > \.queue-menu-button \{ min-width: calc\(20px \* var\(--aw-toolbar-scale\)\)/);
  assert.match(css,/latex-editor-button \{ width: calc\(34px \* var\(--aw-toolbar-scale\)\)/);
});

test("passage/notebook links stay compact, restore filed work and only navigate on intentional selection", async () => {
  const [app, notebook, link, prompt, details] = await Promise.all(["src/App.tsx", "src/components/ResearchNotebook.tsx", "src/components/NotebookLink.tsx", "src/components/ManuscriptPrompt.tsx", "src/components/ToolbarDetails.tsx"].map(file => readFile(file, "utf8")));
  assert.match(app, /<NotebookLink[^\n]+onOpen=\{openLinkedNotebook\}/);
  const opening = app.slice(app.indexOf("function openLinkedNotebook"), app.indexOf("function applyNotebookProposal"));
  assert.match(opening, /toggleNotebookConversation\(current, entry.id, true\)/); assert.doesNotMatch(opening, /archive|resolveReview|finishQueue/);
  const returning = app.slice(app.indexOf("function returnToTask"), app.indexOf("function returnReadyResponse"));
  assert.match(returning, /notebookEntries: opened.notebookEntries.map/);
  assert.match(returning, /!preferNotebook && document && notebookQueuePassage/);
  assert.match(returning, /returnFromNotebook\(entry\)/);
  assert.match(app, /action === "reply"\) \{ returnToTask\(task, true\)/);
  assert.match(app, /queueCursor && notebookQueuePassage\(task, document, state\)\?\.id === handoffParagraphId/);
  assert.match(notebook, /\}, \[entry\?\.id\]\)/); assert.match(notebook, /pane.scrollTop \+= heading.top - bounds.top/);
  assert.doesNotMatch(link, /activeEntry|onReturn/); assert.match(link, /Open linked notebook conversation/);
  assert.match(notebook, /<PassageLink entry=\{item\} href=\{props.passageHrefFor\(item\)\}/);
  assert.match(notebook, /<a className="conversation-passage" href=\{href\} target="_blank" rel="noopener noreferrer"/);
  assert.match(notebook, /event.button !== 0 \|\| event.ctrlKey \|\| event.metaKey \|\| event.shiftKey \|\| event.altKey/);
  assert.match(notebook, /event.preventDefault\(\); onReturn\(entry\)/);
  assert.doesNotMatch(notebook, /!active && <button onClick=\{\(\) => onReturn/);
  assert.match(link, /Open conversations linked to this passage/); assert.match(link, /entry.filed/);
  assert.match(details, /aria-label=\{summaryLabel\}/); assert.doesNotMatch(prompt, /onNotebook/);
});

test("Proofs and Themes retain plain source, safe lens switching and below-text passage actions", async () => {
  const [app, theme, manuscript, css] = await Promise.all(["src/App.tsx", "src/components/ThemeWorkspace.tsx", "src/components/Manuscript.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  const lensSwitch = app.slice(app.indexOf("async function changeLens"), app.indexOf("function flushParagraph"));
  assert.match(lensSwitch, /await savePaper\(\);setPreambleEditing\(false\)/);
  assert.match(app, /void changeLens\(id\)/);
  assert.match(theme, /explicitBlocks=false/);
  assert.match(theme, /explicitBlocks \? "explicit-source-blocks" : "plain-block-source"/);
  assert.match(theme, /data-source-surface/);
  for (const prop of ["onChunkAction", "hasBlockContext", "isQueued"]) assert.ok(theme.includes(`${prop}={${prop}}`));
  assert.match(theme, /editable=\{!readOnly\}/);
  assert.match(manuscript, /closest\("\.manuscript-page, \[data-source-surface\]"\)/);
  assert.match(theme, /className="paragraph-wrap"/);
  assert.match(css, /plain-block-source article.theme-card \{ border: 0; border-radius: 0; background: transparent; box-shadow: none; overflow: visible/);
  assert.match(css, /article.theme-card \{\s*margin: 0;\s*padding: 0;\s*overflow: visible/);
  assert.match(css, /\.outline-caption \{[^}]*margin: 3px 8px 5px/);
});

test("navigation is compact by default and storage failures don't block the workspace", () => {
  assert.deepEqual(loadChromePreferences(), defaultChromePreferences);
  assert.deepEqual(loadChromePreferences({ getItem() { throw new Error("disabled"); } }), loadChromePreferences());
  assert.equal(saveChromePreferences(loadChromePreferences(), { setItem() { throw new Error("full"); } }), false);
});

test("interface and editor sizes are separate Advanced preferences, with larger monitor defaults", async () => {
  for (const interfaceSize of ["auto", "compact", "comfortable", "large"]) assert.equal(loadChromePreferences({ getItem: () => JSON.stringify({ interfaceSize }) }).interfaceSize, interfaceSize);
  for (const interfaceSize of ["enormous", 3, null]) assert.equal(loadChromePreferences({ getItem: () => JSON.stringify({ interfaceSize }) }).interfaceSize, "auto");
  assert.equal(loadChromePreferences({ getItem: () => "{}" }).compactAwLinks, true);
  assert.equal(loadChromePreferences({ getItem: () => '{"compactAwLinks":false}' }).compactAwLinks, false);
  const [app, css, raw, hook, mirror] = await Promise.all(["src/App.tsx", "src/styles.css", "src/components/PlainSourceEditor.tsx", "src/usePaneZoom.ts", "src/textareaViewport.ts"].map(file => readFile(file, "utf8")));
  assert.match(app, /<summary>Advanced<\/summary>[\s\S]*aria-label="Interface size"[\s\S]*aria-label="Editor text size"/);
  assert.match(css, /min-width: 1440px[\s\S]*data-interface-size="auto"[\s\S]*--aw-interface-scale: 1.25/);
  assert.match(css, /min-width: 1920px[\s\S]*--aw-interface-scale: 1.4/);
  assert.doesNotMatch(css, /\.app-shell[^}]*\{[^}]*\bzoom:/);
  assert.match(raw, /wrap="soft"/); assert.match(raw, /fontSize:15\*zoom|fontSize: 15 \* zoom/);
  assert.match(raw, /textareaCaretTop/); assert.match(hook, /active-writing-pane-zoom/);
  assert.match(mirror, /white-space:pre-wrap;overflow-wrap:anywhere/); assert.match(mirror, /finally \{ mirror.remove\(\)/);
  assert.match(mirror, /mirror.textContent = prefix/); assert.doesNotMatch(mirror, /input.value\s*=|innerHTML/);
  assert.match(css, /data-compact-aw-links="true"[\s\S]*:not\(\[data-reference-expanded="true"\]\)[\s\S]*content: attr\(data-compact-label\)/);
});

test("plain-source selection retains visible passage actions but no top environment dropdown", async () => {
  const [manuscript, css] = await Promise.all(["src/components/Manuscript.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(manuscript, /onPointerDownCapture=\{event => \{ if \(\(event.target as HTMLElement\).closest\("\.source-chunks"\)\) setSelected\(true\)/);
  assert.match(css, /\.plain-block-source :is\(\.source-block-heading, \.environment-heading-tools\) \{ display: none/);
  assert.match(css, /\.source-editor-shell.is-chunk-selected > \.source-chunks \{ margin-bottom: 4px/);
  assert.match(css, /\.chunk-controls \{ position: relative; width: max-content; max-width: 100%; margin: 0 2px 6px auto/);
  assert.doesNotMatch(css, /\.manuscript-scroll:has\(\.selected-block-actions\) \.chunk-controls/);
  assert.match(manuscript, /delete p.dataset.hasTextSelection/);
  assert.match(manuscript, /blockActionsBottom\(box.bottom, frame.top, frame.width, shell.offsetWidth\)/);
  assert.match(manuscript, /onChunkAction && selected &&/);
  assert.match(css, /chunk-controls > button[^}]*color: var\(--muted\)/);
});

test("top bar and sidebar choices persist independently of manuscript storage", () => {
  const stored = new Map();
  const storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const choices = { autoHideTopbar: true, hideTopbarByDefault: true, sidebarPinned: true, theme: "dark", darkPdf: true, automaticCompilation: true, interfaceSize: "comfortable", compactAwLinks: false };
  assert.equal(saveChromePreferences(choices, storage), true);
  assert.deepEqual(loadChromePreferences(storage), choices);
  assert.deepEqual([...stored.keys()], [chromePreferencesKey]);
  assert.equal(chromePreferencesKey.startsWith("paperfocus.prototype"), false);
  for (const value of ["oops", "null", '{"sidebarPinned":"false","autoHideTopbar":1}']) {
    storage.setItem(chromePreferencesKey, value);
    assert.deepEqual(loadChromePreferences(storage), defaultChromePreferences);
  }
});

test("temporary top-bar hiding never changes the next startup default", () => {
  assert.equal(loadChromePreferences({ getItem: () => '{"autoHideTopbar":true}' }).autoHideTopbar, false);
  assert.equal(loadChromePreferences({ getItem: () => '{"autoHideTopbar":false,"hideTopbarByDefault":true}' }).autoHideTopbar, true);
  assert.equal(loadChromePreferences({ getItem: () => '{"hideTopbarByDefault":"true"}' }).autoHideTopbar, false);
});

test("project opens use split PDF and refresh phase hydration does not force Notebook", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(app, /showNotebook: Boolean\(linked\?\.panel === "notebook" && !hasSavedWindowState\(result.project.id\)\)/);
  assert.match(app, /if \(openManuscript\) loaded = \{ \.\.\.loaded, destination: "manuscript", previewMode: "split" \}/);
  assert.match(app, /setPreviewFormat\(openManuscript \? "pdf"/);
  assert.match(app, /activateDocument\(next, next.project.id === document\?\.project.id, true\)/);
  assert.match(app, /className="reference-toolbar-button source-preview-button"/);
  assert.match(app, /Hide top bar by default/);
});

test("themes migrate safely and PDF dark display is independent and opt-in", () => {
  assert.deepEqual(loadChromePreferences({ getItem: () => '{"sidebarPinned":true}' }), { ...defaultChromePreferences, sidebarPinned: true });
  assert.deepEqual(loadChromePreferences({ getItem: () => '{"theme":"dark","darkPdf":false}' }), { ...defaultChromePreferences, theme: "dark" });
  assert.deepEqual(loadChromePreferences({ getItem: () => '{"theme":"other","darkPdf":"true"}' }), defaultChromePreferences);
  assert.deepEqual(loadChromePreferences({ getItem: () => '{"theme":"light","darkPdf":true}' }), { ...defaultChromePreferences, darkPdf: true });
  assert.equal(loadChromePreferences({ getItem: () => '{"automaticCompilation":"true"}' }).automaticCompilation, false);
  assert.equal(loadChromePreferences({ getItem: () => '{"automaticCompilation":true}' }).automaticCompilation, true);
});

test("automatic compilation is opt-in in Advanced and waits for visible, unblocked PDF work", async () => {
  const [app, hook] = await Promise.all(["src/App.tsx", "src/useIdleCompilation.ts"].map(file => readFile(file, "utf8")));
  assert.match(app, /Automatic compilation/);
  assert.match(app, /Block window waits for 4 seconds/);
  assert.match(app, /enabled: !state.turbo.enabled && chromePreferences.automaticCompilation && previewFormat === "pdf" && effectivePreviewMode !== "hidden"/);
  assert.match(app, /autoSaveError \|\| incomingSource \|\| pendingSelection/);
  assert.match(app, /compileLatex\("focus", false, true\)/);
  assert.match(app, /if \(!automatic\) setToast/);
  assert.match(hook, /\["scroll", "wheel", "keydown", "beforeinput"\]/);
  assert.match(hook, /document.visibilityState === "visible"/);
  assert.match(hook, /compositionstart/);
  assert.match(hook, /pointercancel/);
});

test("theme controls stay compact and PDF styling never changes its loading dependencies", async () => {
  const [app, css, preview, viewer] = await Promise.all(["src/App.tsx", "src/styles.css", "src/components/Preview.tsx", "src/components/PdfViewer.tsx"].map(file => readFile(file, "utf8")));
  assert.match(app, /documentElement.dataset.theme = chromePreferences.theme/);
  assert.ok(app.indexOf('className="paper-files-button"') < app.indexOf('className="theme-toggle"'));
  assert.ok(app.indexOf('className="theme-toggle"') < app.indexOf('className="breadcrumb"'));
  assert.match(app, /<summary>Advanced<\/summary>/);
  assert.match(app, /Dark PDF display/);
  assert.match(preview, /darkDisplay=\{darkPdf\}/);
  assert.match(viewer, /darkDisplay = false/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /::-webkit-scrollbar \{ width: 6px; height: 6px/);
  assert.match(css, /scrollbar-color: var\(--scroll-thumb\) var\(--scroll-track\)/);
  assert.match(css, /::-webkit-scrollbar-thumb:hover \{ background: var\(--scroll-hover\)/);
  assert.match(css, /\.dark-pdf-display \.pdf-page-surface > canvas \{ filter: invert/);
  assert.match(css, /@media print.*filter: none/);
  assert.equal((viewer.match(/darkDisplay/g) ?? []).length, 3);
});

test("auto-hide has keyboard recovery and compact contents retain navigation and progress", async () => {
  const [app, outline, css, preview] = await Promise.all(["src/App.tsx", "src/components/Outline.tsx", "src/styles.css", "src/components/Preview.tsx"].map(file => readFile(file, "utf8")));
  assert.match(app, /aria-label="Keep top bar visible"/);
  assert.match(app, /Keep sidebar expanded/);
  assert.match(outline, /aria-current=\{current \? "location"/);
  assert.match(outline, /Progress for/);
  assert.match(css, /\.outline-pane:is\(\[data-hover-revealed="true"\], :focus-within\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.workspace\.compact-sidebar:not\(\.no-outline\)/);
  assert.match(preview, /className="preview-compile-bar" role="status"/);
  assert.match(app, /aria-label="Toggle toolbar controls"/);
  assert.match(css, /\.editor-toolbar:has\(\.toolbar-secondary-controls:focus-within\) \.toolbar-secondary-controls/);
  assert.equal((preview.match(/className="preview-compile-bar"/g) ?? []).length, 1);
});

test("auto-hide reclaims height, essential layout controls remain outside the secondary tray, and warnings can minimize without retrying a save", async () => {
  const [app, css] = await Promise.all(["src/App.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(css, /\.chrome-frame\.auto-hide \{ height: 17px/);
  assert.match(css, /--aw-chrome-offset: 61px/);
  assert.match(css, /\.chrome-hover-strip \{ height: 14px/);
  assert.match(css, /\.chrome-neutral-gap \{ height: 3px; background: var\(--canvas\)/);
  assert.equal(/className=\{`chrome-frame[^\n]*onPointerEnter/.test(app), false); // Neutral gap must not activate the parent.
  assert.match(app, /className="chrome-hover-strip" onPointerEnter/);
  assert.match(css, /\.chrome-frame\.auto-hide > \.topbar \{ display: none; position: relative/);
  assert.match(app, /className="chrome-band-brand"/);
  assert.match(app, /<\/div>\s*<div className="latex-control"/);
  assert.ok(app.includes('aria-label="Manuscript view"'));
  assert.ok(app.includes('aria-label="Preview format"'));
  for (const name of ["Source", "Split", "Preview", "Rendered text", "LaTeX PDF"]) assert.ok(app.includes(name));
  assert.match(app, /aria-label="Minimize save warning"[^>]*onClick=\{\(\) => setSaveNoticeCollapsed\(true\)\}/);
  assert.match(app, /autoSaveError && saveNoticeCollapsed && <button className="save-warning-badge"/);
});

test("manuscript scope is always visible, separate from layout, and plain windows don't enable wording checks", async () => {
  const [app, bar] = await Promise.all(["src/App.tsx", "src/components/BlockWindowBar.tsx"].map(file => readFile(file, "utf8")));
  assert.ok(app.indexOf('aria-label="Manuscript scope"') < app.indexOf('<div className="toolbar-secondary-controls"'));
  for (const scope of ["All sections", "This section", "Block window"]) assert.ok(app.includes(scope));
  assert.ok(app.includes("paragraphIds: savedView.turbo.enabled ? turboWindows"));
  assert.ok(app.includes(": savedView.blockWindow && !savedView.turbo.enabled"));
  assert.ok(bar.includes("no checks")); assert.equal(bar.includes("Check &"), false);
});

test("one compact folder control stays visible and project navigation is independent of strict publishing saves", async () => {
  const [app, panel] = await Promise.all(["src/App.tsx", "src/components/RepositoryPanel.tsx"].map(file => readFile(file, "utf8")));
  assert.equal((app.match(/aria-label="Open Paper & files"/g) ?? []).length, 1);
  assert.equal(app.includes('className="project-switcher"'), false);
  assert.ok(app.indexOf('aria-label="Open Paper & files"') < app.indexOf('<div className="toolbar-secondary-controls"'));
  assert.match(app, /onClick=\{openPaperFiles\}><FolderOpen size=\{16\} \/><\/button>/);
  assert.match(panel, /await onBeforeNavigate\(\)/);
  assert.equal(panel.includes("if (selectedDocument) await onSave()"), false);
  assert.match(panel, /const saved = await onSave\(\)/); // Publication remains strict.
  assert.match(panel, /GitHub \/ Overleaf sync & settings/);
});

test("contracted sidebar reserves only a 56px rail and keeps named navigation and progress", async () => {
  const [app, outline, css] = await Promise.all(["src/App.tsx", "src/components/Outline.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(css, /\.workspace\.compact-sidebar:not\(\.no-outline\) \{ grid-template-columns: 56px/);
  assert.match(css, /\.compact-sidebar > \.outline-pane \{ width: 56px/);
  assert.match(css, /\.outline-pane:is\(\[data-hover-revealed="true"\], :focus-within\) \{ width: 270px/);
  assert.equal(/compact-sidebar[^\n]*160px/.test(css), false);
  assert.match(outline, /className="outline-label" aria-label=\{label\} aria-current/);
  assert.match(outline, /className="outline-rail-label" aria-hidden="true"/);
  assert.match(outline, /Progress for/);
  assert.match(app, /sidebarPointerNavigation.current && focused instanceof HTMLButtonElement/);
  assert.match(app, /aria-label="Find text in this paper"/);
  assert.match(app, /className="outline-rail-label" aria-hidden="true"/); // Notebook uses the same rail.
});

test("preview controls live in the LaTeX menu without a floating button or permanent bars", async () => {
  const [preview, viewer, css, reference, app] = await Promise.all(["src/components/Preview.tsx", "src/components/PdfViewer.tsx", "src/styles.css", "src/components/ReferenceDrawer.tsx", "src/App.tsx"].map(file => readFile(file, "utf8")));
  assert.equal(preview.includes("<header>"), false);
  assert.equal(preview.includes("preview-reference-note"), false);
  assert.equal(preview.includes("PDF & build details"), false);
  assert.equal(preview.includes('aria-label="Preview options"'), false);
  assert.equal(css.includes(".preview-options {"), false);
  assert.match(preview, /controlsTarget \? createPortal/);
  assert.match(app, /className="preview-options-host" ref=\{setPreviewControlsTarget\}/);
  assert.match(app, /aria-label="Manuscript view"/);
  assert.match(app, /aria-label="Preview format"/);
  for (const label of ["Source", "Split", "Preview", "Rendered text", "LaTeX PDF"]) assert.ok(app.includes(label));
  assert.equal(app.includes('<option value="source">Raw source</option>'), false);
  for (const label of ["Excerpt PDF", "Full PDF", "Older PDF", "Quick reading", "Build details"]) assert.ok(preview.includes(label));
  assert.match(preview, /compileResult\?\.viewNote && !quickReading/);
  assert.match(preview, /renderControls=\{renderControls\}/);
  assert.match(viewer, /renderControls \? renderControls\(controls\) : controls/); // Other PDF viewers keep their toolbar.
  assert.equal(reference.includes("renderControls="), false);
  for (const label of ["Search PDF text", "PDF page number", "Zoom out", "Zoom in", "Fit PDF to width"]) assert.ok(viewer.includes(label));
  assert.match(viewer, /renderControls\?\.\(\).*pdf-error/); // Even a broken PDF can be switched to quick reading.
});

test("moving the block window preserves the selected PDF and only a new compile selects PDF automatically", async () => {
  const [preview, app] = await Promise.all(["src/components/Preview.tsx", "src/App.tsx"].map(file => readFile(file, "utf8")));
  assert.equal(preview.includes('onFormat("reading")'), false);
  assert.equal(preview.includes("windowKey"), false);
  assert.equal(preview.includes("onFormat"), false, "a restored build must not override the saved preview choice");
  const compileStart = app.indexOf("async function compileLatex");
  const compile = app.slice(compileStart, app.indexOf("function ", compileStart + "async function compileLatex".length));
  assert.match(compile, /if \(result.success\) \{\s*setPreviewFormat\("pdf"\)/);
  const restored = app.slice(app.indexOf("void fetch(`/api/paperfocus/status"), app.indexOf("const receiveWindowBuild"));
  assert.equal(restored.includes("setPreviewFormat("), false);
  assert.match(preview, /url=\{compileResult.pdfUrl\}/);
  assert.match(preview, /priorView \? "Older PDF"/);
  assert.match(preview, /Scope changes update it automatically; other view changes may require Compile/);
  const movement = app.slice(app.indexOf("function moveBlockWindow"), app.indexOf("function focusTurboParagraph"));
  assert.equal(movement.includes("setPreviewFormat("), false);
  assert.equal(movement.includes("setCompileResult("), false);
  assert.equal(movement.includes("compileLatex("), false);
});

test("block actions appear only on selection, are compact, and sit at the lower right", async () => {
  const [manuscript, css] = await Promise.all(["src/components/Manuscript.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(manuscript, /onChunkAction && selected &&/);
  assert.equal(manuscript.includes("onPointerOver="), false);
  assert.match(manuscript, /onClick=\{event => \{ setSelected\(true\)/);
  assert.doesNotMatch(manuscript, /className="chunk-controls" style=\{\{ top:/);
  assert.match(css, /\.chunk-controls \{ position: relative; width: max-content; max-width: 100%; margin: 0 2px 6px auto/);
  assert.match(css, /width: 19px; height: 19px/);
  for (const action of ["Focus this block", "Ask about this block", "Rephrase this block", "Comment on this block", "Return to this block later"]) assert.ok(manuscript.includes(`aria-label="${action}"`));
  assert.equal(manuscript.includes('aria-label="More block actions"'), false);
  assert.match(css, /\.paragraph-wrap \.source-chunks:focus-visible \{ outline: none/);
  assert.match(css, /\.source-editor-shell.is-chunk-selected \.source-chunk\[data-active=true\]/);
});

test("compile and its dropdown occupy the existing manuscript toolbar only", async () => {
  const [app, css] = await Promise.all(["src/App.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.equal((app.match(/className="compile-control"/g) ?? []).length, 1);
  assert.ok(app.indexOf('className="compile-control"') > app.indexOf('className={`editor-toolbar'));
  assert.match(app, /aria-label=\{compiling \? "Compiling…" : "Compile"\}/);
  assert.match(app, /aria-label="Compile options" aria-expanded=\{compileMenuOpen\}/);
  assert.ok(app.includes("Compile full paper"));
  assert.match(css, /\.editor-toolbar \.compile-control > button \{ height: 22px/);
  assert.match(app, /className="latex-logo" aria-hidden="true"/);
  assert.match(app, /previewMode !== "full" \? \{ displayMode: "source" \}/);
  assert.equal(css.includes(".editor-toolbar:hover .toolbar-secondary-controls"), false); // Compile/Preview cannot reveal another tray.
  assert.equal(css.includes(".toolbar-reveal-button:hover"), false); // The optional tray requires an explicit click.
  for (const label of ["LaTeX editor", "LaTeX options", "LaTeX warnings and fixes"]) assert.ok(app.includes(`aria-label="${label}"`));
  assert.match(app, /useDismissibleLayer\(latexMenuOpen, latexControlRef/);
});

test("editing views share resize-safe gutters and independently preserve reading position", async () => {
  const [css, hook, main, manuscript, preview, notebook] = await Promise.all(["src/editingFramework.css", "src/usePaneLayout.ts", "src/main.tsx", "src/components/Manuscript.tsx", "src/components/Preview.tsx", "src/components/ResearchNotebook.tsx"].map(file => readFile(file, "utf8")));
  assert.match(main, /import "\.\/editingFramework.css"/);
  assert.match(css, /--aw-page-measure: 760px/);
  assert.match(css, /scrollbar-gutter: stable/);
  assert.match(css, /grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(css, /\.outline-body \{ overflow-x: hidden/);
  assert.match(hook, /document.addEventListener\("fullscreenchange", changed\)/);
  assert.match(hook, /window.visualViewport\?\.addEventListener\("resize", changed\)/);
  assert.match(hook, /readingAnchorAdjustment\(anchor.offset, offset\)/);
  for (const view of [manuscript, preview, notebook]) assert.match(view, /useReadingLayout\(scrollRef\)/);
  assert.match(notebook, /data-notebook-entry=\{item.id\}/);
  assert.equal(hook.includes("compile"), false);
  assert.equal(hook.includes("onProgress"), false);
});

test("block actions reposition after wrapping and Escape closes the innermost editing menu", async () => {
  const [manuscript, layer, app] = await Promise.all(["src/components/Manuscript.tsx", "src/useDismissibleLayer.ts", "src/App.tsx"].map(file => readFile(file, "utf8")));
  assert.match(manuscript, /requestAnimationFrame\(repositionChunk\)/);
  assert.match(manuscript, /ResizeObserver\(changed\); observer.observe\(paragraphRef.current\)/);
  assert.match(manuscript, /repositionChunk/);
  assert.match(layer, /event.defaultPrevented/);
  assert.match(layer, /event.target.closest\('\[data-dismissible-layer="open"\]'\) !== root.current/);
  assert.match(layer, /querySelector<HTMLElement>\(triggerSelector\)\?\.focus\(\)/);
  assert.match(app, /useDismissibleLayer\(displayMenuOpen, displayControlRef/);
  assert.match(app, /aria-label="Editor appearance"/);
});

test("sidebar modes form a 2x2 grid with spacing inside the full-height column", async () => {
  const css = await readFile("src/editingFramework.css", "utf8");
  assert.match(css, /--aw-sidebar-top-gap: 4px/);
  assert.match(css, /padding-top: var\(--aw-sidebar-top-gap\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-rows: repeat\(2, 24px\)/);
  assert.match(css, /\.compact-sidebar > \.outline-pane \{ clip-path: none/);
  assert.match(css, /\.compact-sidebar > \.outline-pane \{ clip-path: none; transition: none/);
  assert.match(css, /\.outline-pane:is\(\[data-hover-revealed="true"\], :focus-within\) \.outline-lenses \.lens-tab span \{ display: inline/);
  assert.match(css, /\.workspace:not\(\.compact-sidebar\) > \.outline-pane \.outline-lenses \.lens-tab span/);
});

test("source reel is bounded and preserves editors without expanding preview or compilation", async () => {
  const [hook, manuscript, app, css] = await Promise.all(["src/useBlockReel.ts", "src/components/Manuscript.tsx", "src/App.tsx", "src/editingFramework.css"].map(file => readFile(file, "utf8")));
  assert.match(hook, /window.available.slice\(range.start, range.end\)/);
  assert.match(hook, /items.push\(protectedBlock\)/); // One held editor, not a full hidden document.
  assert.match(hook, /pane.scrollTop \+= target.getBoundingClientRect\(\).top - pane.getBoundingClientRect\(\).top - anchor.current.offset/);
  assert.match(hook, /getSelection\(\)\?\.isCollapsed/);
  assert.match(hook, /requestAnimationFrame/);
  assert.match(hook, /pane.clientHeight \/ zoom/);
  assert.match(manuscript, /key=\{turbo \|\| blockWindow \? nodeParagraphs\[0\]\?\.id : "renderKey" in node/);
  assert.match(manuscript, /onBeforeInputCapture=.*onPasteCapture=/);
  assert.match(manuscript, /function sourceSiblings/);
  assert.match(manuscript, /p.dataset.nodeId === root.dataset.nodeId && p.dataset.sourceFile === root.dataset.sourceFile/);
  assert.match(css, /transition: opacity 240ms ease-out/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-reel-held="true".*height: 0; overflow: hidden/);
  assert.equal(css.includes(".workspace:has(.block-window-bar)"), false); // Focus controls don't push the sidebar modes down.
  assert.match(app, /const blockWindowIds = useMemo\(\(\) => blockWindow\?\.paragraphs.map/);
  assert.match(app, /manuscriptBlockWindow\(saved.nodes, saved.paragraphs.*\.paragraphs.filter/);
  const scrollFocus = app.slice(app.indexOf("function scrollBlockWindow"), app.indexOf("function focusTurboParagraph"));
  assert.equal(scrollFocus.includes("setJumpTarget("), false);
  assert.equal(scrollFocus.includes("onProgress"), false);
  assert.equal(scrollFocus.includes("compile("), false);
});

test("Turbo shares the bounded reel, keeps an independent wider preview and never auto-compiles", async () => {
  const [app, manuscript, bar] = await Promise.all(["src/App.tsx", "src/components/Manuscript.tsx", "src/components/TurboBar.tsx"].map(file => readFile(file, "utf8")));
  assert.match(manuscript, /const sourceWindow = turbo \?\? blockWindow/);
  assert.match(manuscript, /useBlockReel\(scrollRef, sourceWindow/);
  assert.match(manuscript, /turbo \? onTurboScroll : onWindowFocus/);
  assert.equal(manuscript.includes("scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 75"), false);
  assert.match(app, /paragraphIds=\{state.turbo.enabled \? turboPreviewIds : blockWindowIds\}/);
  assert.match(app, /const position = sourcePositionReader.current\?\.\(\)/);
  assert.match(app, /previewMode: "split", activeNodeId: start/);
  assert.match(bar, /One previous block stays as context/);
});

test("review comments use the main queue and a compact detail view, not a duplicate toolbar workflow", async () => {
  const [app, panel] = await Promise.all(["src/App.tsx", "src/components/ReviewPanel.tsx"].map(file => readFile(file, "utf8")));
  assert.equal(app.includes('aria-label="Open review comments"'), false);
  assert.match(panel, /aria-label="Queue comment details"/);
  assert.match(panel, /Previous unresolved comment/); assert.match(panel, /Next unresolved comment/);
  assert.match(panel, /Resolve closes this comment and its replies; the full thread stays in History/);
  assert.match(panel, /Reopen affects only the selected comment/);
  assert.equal(panel.includes('className="review-mode-switch"'), false);
  assert.match(panel, /reviewComments\(blockComments \?\? attentionQueue\(tasks\)\)/);
  assert.match(panel, /Independent manuscript review/);
});

test("headings have exact comment controls and preview navigation is visible with a transient source flash", async () => {
  const [app, manuscript, command, reader, pages, css] = await Promise.all(["src/App.tsx", "src/components/Manuscript.tsx", "src/components/SourceCommand.tsx", "src/components/PdfViewer.tsx", "src/components/ContinuousPdfPages.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(command, /Comment on heading or opening command/);
  assert.match(command, /field.selectionStart/); assert.match(command, /field.selectionEnd/);
  assert.match(app, /const saved = await savePaper\(\);[\s\S]*makeCommandReviewComment\(saved, selection\)/);
  assert.match(app, /aria-label="Show source in preview"/);
  assert.match(manuscript, /aria-label="Show highlighted text in preview"/);
  assert.match(app, /paragraphId, flash: true, sequence: \+\+sourceSyncSequence.current/);
  assert.match(manuscript, /delete \(target as HTMLElement\).dataset.sourceFlash/);
  assert.match(css, /@keyframes aw-source-flash/); assert.match(css, /prefers-reduced-motion: reduce.*data-source-flash/);
  assert.match(reader, /compiledPdfResume\(lastReadingPosition.current, readingIdentity, url\)/);
  assert.match(pages, /live.current.onPosition\?\./);
});

test("scope switches retain source viewport anchors and automatically update the PDF independently of typing-idle preference", async () => {
  const [app, manuscript, preview] = await Promise.all(["src/App.tsx", "src/components/Manuscript.tsx", "src/components/Preview.tsx"].map(file => readFile(file, "utf8")));
  const change = app.slice(app.indexOf("function changeManuscriptScope"), app.indexOf("function moveBlockWindow"));
  assert.match(change, /sourcePositionReader.current\?\.\(\)/);
  assert.match(change, /activeNodeId: nodeId, activeParagraphId: paragraphId/);
  assert.match(change, /viewportOffset: position\?\.viewportOffset/);
  assert.match(change, /setPreviewJumpTarget\(\{ paragraphId, sequence/);
  assert.equal(change.includes("syncPdf("), false);
  assert.equal(change.includes("compileLatex("), false);
  assert.equal(change.includes("setPreviewFormat("), false);
  assert.match(change, /setScopeCompileRequest\(manuscriptBuildIdentity/);
  const effect = app.slice(app.indexOf("if (!scopeCompileRequest || !document)"), app.indexOf("useIdleCompilation({"));
  assert.match(effect, /compileInFlight.current/);
  assert.match(effect, /incomingSource \|\| autoSaveError \|\| pendingSelection/);
  assert.match(effect, /setScopeCompileRequest\(undefined\)/);
  assert.match(effect, /void compileLatex\("focus", false, true\)/);
  assert.equal(effect.includes("chromePreferences.automaticCompilation"), false);
  assert.match(app, /requestedScope !== renderedCompileScope.current\) return/);
  const compile = app.slice(app.indexOf("async function compileLatex"), app.indexOf("async function dispatchLatexAssistant"));
  assert.match(compile, /manuscriptBuildCache.current.read\(saved, requestedScope\)/);
  assert.ok(compile.indexOf("await savePaper()") < compile.indexOf("manuscriptBuildCache.current.read(saved, requestedScope)"), "cached scope switches must flush heading/command drafts too");
  assert.match(app, /focusedNodeId: resolveNode\(loaded.focusedNodeId\),/);
  assert.equal(app.includes("focusedNodeId: resolveNode(loaded.focusedNodeId) ?? (!loaded.activeNodeId"), false);
  assert.match(manuscript, /captureSourceViewport\(scrollRef.current\)/);
  assert.match(manuscript, /anchoredScrollTop\(scroll.scrollTop, rectangle.top, frame.top, jumpTarget.viewportOffset\)/);
  assert.match(preview, /ResizeObserver\(align\)/);
  assert.match(preview, /\["wheel", "pointerdown", "keydown", "touchmove"\]/);
});

test("focused results show original editable linked proofs using the same selection as preview and excerpts", async () => {
  const [manuscript, preview, focus] = await Promise.all(["src/components/Manuscript.tsx", "src/components/Preview.tsx", "server/focus.ts"].map(file => readFile(file, "utf8")));
  for (const source of [manuscript, preview, focus]) assert.match(source, /visiblePreviewNodes\(/);
  assert.match(manuscript, /linkedProof=.*node.proofFor\?\.includes\(focusedNodeId\)/);
  assert.match(manuscript, /Linked proof · /);
  assert.match(manuscript, /onEdit=\{editParagraph\}/);
  assert.match(manuscript, /data-paragraph-id=\{paragraph.id\}.*data-source-file=\{paragraph.file\}/);
  assert.match(preview, /Linked proof · /);
  assert.match(preview, /linkedProofTitle\(node, nodes\)/);
});

test("the main toolbar owns a split queue, with explicit checks, accessible reordering and no bottom strip", async () => {
  const [app, queue, list, study] = await Promise.all(["src/App.tsx", "src/components/PriorityQueue.tsx", "src/components/AttentionStrip.tsx", "src/components/StudyWorkspace.tsx"].map(file => readFile(file, "utf8")));
  assert.equal((app.match(/<PriorityQueue /g) ?? []).length, 1);
  assert.ok(app.indexOf("<PriorityQueue ") > app.indexOf('className={`editor-toolbar'));
  assert.equal(app.includes("<AttentionStrip "), false);
  for (const label of ["Go to current priority task", "Check active item", "Next priority task"]) assert.ok(queue.includes(`aria-label="${label}"`));
  assert.match(queue, /aria-label=\{`Open priority queue \(/);
  assert.match(queue, /useDismissibleLayer/);
  assert.match(list, /className="queue-drag-handle" draggable/);
  assert.match(list, /\["ArrowUp", "ArrowDown"\]/);
  assert.match(list, /canFinishWithoutImport\(task\)/);
  assert.match(study, /aria-label="Finish question and continue"/);
});

test("queue rows are compact, optional details stay collapsed, and warmth respects both themes and reduced motion", async () => {
  const [queue, list, css] = await Promise.all(["src/components/PriorityQueue.tsx", "src/components/AttentionStrip.tsx", "src/editingFramework.css"].map(file => readFile(file, "utf8")));
  assert.match(queue, /setInterval\(refresh, 15_000\)/);
  assert.match(queue, /queueWarmth\(queue, now\)/);
  assert.match(list, /task.packet && expandedId === task.id/);
  assert.match(list, /<details className="queue-suggestions"><summary>/);
  assert.match(list, /aria-label=\{`Saved prompt for/);
  assert.match(list, /queueWaitLabel\(task, now\)/);
  assert.match(list, /aria-label="Reset queue colors"/);
  assert.match(css, /light-dark\(oklch\(54% var\(--queue-chroma/);
  assert.match(css, /oklch\(77% calc\(var\(--queue-chroma/);
  assert.match(queue, /style=\{queueColorVariables\(warmth\)/);
  assert.match(list, /style=\{queueColorVariables\(warmth.get/);
  assert.match(list, /visibleQueue.map/);
  assert.match(list, /pages > 1 && <nav className="queue-pages"/);
  assert.match(css, /width: min\(420px/);
  assert.match(css, /\.priority-queue-menu \.work-task-line \{ flex-wrap: nowrap/);
  assert.match(css, /\.priority-queue-menu \.work-task-details \{ padding: 4px 6px/);
  assert.match(css, /prefers-reduced-motion: reduce.*priority-queue-control.*transition: none/);
});

test("color inactivity reset waits for both stores and counts human input, never background polling", async () => {
  const [app, hook, storage] = await Promise.all(["src/App.tsx", "src/useQueueActivity.ts", "src/useWorkbenchPersistence.ts"].map(file => readFile(file, "utf8")));
  assert.match(app, /useQueueActivity\(document\?\.project.id, workbenchStorage.ready && notebookStorage.ready/);
  assert.match(hook, /visibilityState !== "visible"/);
  assert.match(hook, /\["pointerdown", "keydown", "wheel"\]/);
  assert.equal(hook.includes("setInterval"), false);
  assert.match(storage, /state.queueLastActiveAt/);
});

test("queue additions share the task helper and bookmarks have pressed states without reply controls", async () => {
  const [app, manuscript, queue, outline] = await Promise.all(["src/App.tsx", "src/components/Manuscript.tsx", "src/components/AttentionStrip.tsx", "src/components/Outline.tsx"].map(file => readFile(file, "utf8")));
  assert.equal(app.includes("attentionTasks: [...current.attentionTasks"), false);
  assert.match(app, /onReviewLater=\{\(\) => toggleLater\(\)\}/);
  assert.match(app, /cycleQueuedProgress\(current, document, nodeId\)/);
  assert.match(manuscript, /aria-pressed=\{!!isQueued\?/);
  assert.match(manuscript, /pendingSelection.spans \?\? \[pendingSelection\]/);
  assert.match(queue, /!task.localJobId && !task.reminder/);
  assert.match(outline, /Mark in progress; add a section reminder/);
});

test("environment choices sit by headings, stay mounted during selection and retain saved marks", async () => {
  const [app, manuscript, css] = await Promise.all(["src/App.tsx", "src/components/Manuscript.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(manuscript, /aria-label="Block type"/);
  assert.match(manuscript, /disabled=\{!editable \|\| !control.enabled\}/);
  assert.match(manuscript, /EnvironmentHeadingTools/);
  assert.match(manuscript, /Environment description/);
  assert.match(manuscript, /completeTypedEnvironment\(editableText/);
  assert.match(manuscript, /Type for the whole/);
  assert.match(app, /readOnly=\{environmentBusy \|\| reviewOpen/);
  assert.match(app, /preserveEnvironmentMarks\(confirmed.state/);
  assert.match(app, /environmentCaret.current = confirmed.caret/);
  assert.match(css, /\.environment-heading-tools/);
  assert.doesNotMatch(manuscript, /\{typeControl && <select/);
});

test("cross-host highlights use exact document ranges, without rewriting or merging editable blocks",async()=>{
  const [manuscript,css]=await Promise.all(["src/components/Manuscript.tsx","src/styles.css"].map(file=>readFile(file,"utf8")));
  assert.match(manuscript,/crossBlockRange = useRef<Range/);
  assert.match(manuscript,/range.setStart\(forward\?a.startContainer:b.startContainer/);
  assert.match(manuscript,/range.setEnd\(forward\?b.startContainer:a.startContainer/);
  assert.match(manuscript,/clipSelectedChunks/);
  assert.match(manuscript,/new Highlight\(range\)/);
  assert.match(manuscript,/clipboardData.setData\("text\/plain",pendingSelection.text\)/);
  assert.match(manuscript,/if \(editable && !event.defaultPrevented\)/);
  assert.match(manuscript,/onCut=\{event=>\{if\(crossBlockRange.current \|\| selectedSource.current\)event.preventDefault/);
  assert.match(css,/::highlight\(aw-selection\)/);
  assert.doesNotMatch(css,/\.source-editor-shell.is-chunk-selected \{ padding-bottom/);
});

test("comment source highlights persist independently of selection and never steal comment focus", async () => {
  const [app, manuscript, css] = await Promise.all(["src/App.tsx", "src/components/Manuscript.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(app, /if \(!reviewOpen \|\| !document \|\| state.destination !== "manuscript"\) return undefined/);
  assert.match(app, /commentHighlight=\{activeCommentHighlight\}/);
  const highlight = manuscript.slice(manuscript.indexOf("const mountedBlockIds"), manuscript.indexOf("if (blocks.length === 0)"));
  assert.match(highlight, /text.slice\(start, end\) !== commentHighlight.text/);
  assert.match(highlight, /CSS.highlights.set\("aw-review-comment", new Highlight\(range\)\)/);
  assert.match(highlight, /new MutationObserver/); assert.match(highlight, /observer.disconnect\(\)/);
  assert.match(highlight, /delete marked.dataset.reviewCommentHighlight/);
  assert.doesNotMatch(highlight, /getSelection\(|\.focus\(|onSelection\(|onParagraphEdit\(|innerHTML\s*=|textContent\s*=/);
  assert.match(css, /::highlight\(aw-review-comment\)/);
  assert.match(manuscript, /endpoint.setStart\(selection.focusNode, selection.focusOffset\)/);
  assert.match(manuscript, /crossBlockEndpoint.current=b/);
  assert.match(css, /\.selected-block-actions \{ transform: none/);
});

test("comment jumps expose source without guessing changed passages; bulk Resolve requires a project-scoped confirmation", async () => {
  const [app, panel, queue] = await Promise.all(["src/App.tsx", "src/components/ReviewPanel.tsx", "src/components/AttentionStrip.tsx"].map(file => readFile(file, "utf8")));
  assert.match(panel, /aria-label="Jump to commented text" disabled=\{busy \|\| !location && !otherManuscript\}/);
  assert.match(panel, /onClick=\{\(\) => onJump\(selected\)\}/);
  const jump = app.slice(app.indexOf("function jumpToComment"), app.indexOf("function resolveProjectComments"));
  assert.match(jump, /reviewCommentLocation/); assert.match(jump, /if \(!target\)/); assert.match(jump, /syncToSource\(target.paragraphId\)/);
  assert.match(jump, /syncToPreview\(target.paragraphId\)/);
  assert.match(jump, /setReviewOpen\(false\)/);
  assert.match(jump, /owner.projectId !== before.project.id/);
  assert.match(jump, /item.projectId === owner.projectId && item.taskId === task.id/);
  assert.match(jump, /await useQueueItem\(item, "jump"\)/);
  assert.match(jump, /await switchManuscript\(owner.rootFile\)/);
  assert.match(jump, /opened.project.id !== owner.projectId \|\| opened.project.mainFile !== owner.rootFile/);
  assert.match(jump, /setPendingCommentJump\(\{ projectId: owner.projectId, rootFile: owner.rootFile, taskId: task.id \}\)/);
  assert.match(jump, /document\?\.project.id !== pendingCommentJump.projectId \|\| document.project.mainFile !== pendingCommentJump.rootFile/);
  assert.match(jump, /latestState.current.attentionTasks.find\(task => task.id === pendingCommentJump.taskId\)/);
  assert.match(app, /if \(action === "jump"\) void jumpToComment\(task\)/);
  assert.match(jump, /detachedPreview: false/); assert.doesNotMatch(jump, /displayMode: "source"/);
  assert.match(queue, /Resolve all comments…/); assert.match(queue, /setConfirmComments\(commentIds\)/);
  assert.match(queue, /aria-label="Confirm resolving all comments"/);
  assert.match(queue, /onResolveComments\?\.\(confirmComments\)/);
  assert.match(queue, /setConfirmComments\(undefined\); \}, \[resolveCommentsProjectId, scope\]/);
  const bulk = app.slice(app.indexOf("function resolveProjectComments"), app.indexOf("function toggleLater"));
  assert.match(bulk, /task.projectId === projectId && ids.includes\(task.id\)/);
  assert.match(bulk, /latestProjectId.current === projectId/);
  assert.match(bulk, /resolveQueuedReviewComments\(current, localIds\)/);
});
test("comment navigation is scope-preserving, with a visible focus exit, compact heading controls and short flashes", async () => {
  const [app, panel, command, manuscript, css] = await Promise.all(["src/App.tsx", "src/components/ReviewPanel.tsx", "src/components/SourceCommand.tsx", "src/components/Manuscript.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  const returnPath = app.slice(app.indexOf("function returnToTask"), app.indexOf("function returnReadyResponse"));
  assert.match(returnPath, /task.review\?\.kind === "comment"\) \{ openReview\(task\)/);
  assert.match(app, /onSelect=\{task => openReview\(task, reviewBlockId\)\} onJump=\{jumpToComment\}/);
  assert.match(panel, /Next comment outside this block/);
  assert.match(panel, /if \(outsideComment\) onOutsideComment\(outsideComment\)/);
  assert.match(panel, /disabled=\{!outsideComment\}/);
  assert.match(panel, /No open comments remain on this block/);
  assert.match(app, /onOutsideComment=\{task => openReview\(task\)\}/);
  assert.match(app, /className="theme-toggle exit-focus-button"[^\n]*aria-label="Exit focus · Show all sections"[^\n]*><Maximize2 size=\{14\}/);
  assert.doesNotMatch(app, />Show all sections · Exit focused view<\/button>/);
  assert.match(app, /nextCommentAfterResolve\(reviewBlockId \? blockComments\[reviewBlockId\] \?\? \[\] : latestState.current.attentionTasks, id, latestState.current.attentionTasks\)/);
  assert.match(app, /if \(next\) openReview\(next, reviewBlockId\)/);
  assert.match(app, /void compileLatex\("focus", false, true\).then\(show\)/);
  assert.match(app, /sequence === forwardSyncSequence.current/);
  assert.match(panel, /Your comment/); assert.doesNotMatch(panel, /Human comment/);
  assert.match(command, /<MessageSquareText size=\{14\} \/><\/button>/);
  assert.match(css, /\.inline-source-command:focus-within \.command-comment-button/);
  assert.match(css, /\.command-comment-button \{ position: absolute;[^}]*visibility: hidden/);
  assert.match(css, /aw-source-flash 650ms/);
  assert.match(manuscript, /delete \(target as HTMLElement\).dataset.sourceFlash; \}, 650\)/);
});
test("annotated blocks expose a right-margin comment count, while empty blocks have no indicator", async () => {
  const [button, manuscript, panel, app, css] = await Promise.all(["src/components/BlockCommentsButton.tsx", "src/components/Manuscript.tsx", "src/components/ReviewPanel.tsx", "src/App.tsx", "src/styles.css"].map(file => readFile(file, "utf8")));
  assert.match(button, /if \(!count \|\| !onOpen\) return null/);
  assert.match(button, /data-comment-block=\{blockId\}/);
  assert.match(button, /onClick=\{\(\) => onOpen\(blockId\)\}/);
  assert.match(manuscript, /commentCount=\{blockCommentCounts\?\.\[paragraph.id\]\}/);
  assert.match(manuscript, /before.blockCommentCounts !== after.blockCommentCounts/);
  assert.match(panel, /aria-label="Comments on this block"/);
  assert.match(panel, /rows\(blockComments\)/);
  assert.match(app, /if \(first\) openReview\(first, id\)/);
  assert.match(css, /\.block-comments-indicator \{ position: absolute; right: 0/);
});

test("second-screen controls stay in Advanced, retain independent window views, and cannot discard a blocked preview", async () => {
  const [app, zoom, cache, poll, resume] = await Promise.all(["src/App.tsx", "src/usePaneZoom.ts", "src/windowWorkspace.ts", "src/useSharedStorePoll.ts", "src/workspaceResume.ts"].map(file => readFile(file, "utf8")));
  assert.match(app, /<summary>Advanced<\/summary>[\s\S]*<summary>Second screen & windows<\/summary>/);
  assert.equal((app.match(/aria-label="Open notebook window"/g) ?? []).length, 1);
  assert.match(app, /if \(!companion\).*return;/);
  assert.match(app, /resetCompanionSession\(companion.sessionStorage\)/);
  assert.match(app, /panel === "preview" && !recoveryId/);
  assert.match(app, /current.previewMode === "hidden" && !current.detachedPreview/);
  assert.match(app, /message.kind === "compile"/);
  assert.match(app, /rememberProject\(sessionStorage, localStorage, incoming.project.id/);
  assert.match(resume, /sessionProjectKey = "active-writing.window.project"/);
  assert.match(resume, /session.setItem\(sessionProjectKey, id\)/);
  assert.match(zoom, /savePaneZoom\(key, zoom, window.sessionStorage\)/);
  assert.match(cache, /paragraphEdits: \{\}/);
  assert.match(cache, /writeRecovery\(local, `\$\{key\}.window.\$\{windowId\}`, packed, "local"\)/);
  assert.match(cache, /function writeRecovery[\s\S]*storage.setItem\(key, value\)/);
  assert.match(poll, /visibilityState === "hidden"/); assert.match(poll, /subscribeWindowMessages/);
  assert.equal(poll.includes("compile"), false);
});

test("stale passage link notices explain the current view and can be dismissed without navigation", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(app, /const \[linkedSourceNoticeDismissed, setLinkedSourceNoticeDismissed\] = useState\(false\)/);
  const notice = app.slice(app.indexOf('{document && initialWindowRequest?.projectId === document.project.id && initialWindowRequest.panel === "paper"'), app.indexOf('{document && initialWindowRequest?.panel === "notebook"'));
  assert.match(notice, /!linkedSourceNoticeDismissed/);
  assert.match(notice, /This passage link predates recent edits/);
  assert.match(notice, /not the manuscript currently open/);
  assert.match(notice, /aria-label="Dismiss passage link notice" title="Dismiss notice" onClick=\{\(\) => setLinkedSourceNoticeDismissed\(true\)\}/);
  assert.match(notice, /Open linked manuscript/);
  assert.doesNotMatch(notice, /No passage location was guessed/);
});

test("the top-bar manuscript chooser exposes paper/notes roots and explicit reversible section files", async () => {
  const [app, chooser, experiments, notebook] = await Promise.all(["src/App.tsx", "src/components/ManuscriptSwitcher.tsx", "src/components/ExperimentWorkspace.tsx", "src/components/ResearchNotebook.tsx"].map(file => readFile(file, "utf8")));
  assert.ok(app.indexOf("<ManuscriptSwitcher") > app.indexOf('className="topbar-actions"'));
  assert.match(chooser, /aria-label="Switch manuscript"/); assert.match(chooser, /useDismissibleLayer/);
  for (const text of ["Informative research notes", "New manuscript", "Sections & files", "Move section to file", "Create & include section"]) assert.ok(chooser.includes(text));
  assert.match(app, /await prepareNavigation\(\)/); assert.match(app, /expected: \{ mainFile: saved.project.mainFile, revision: saved.revision \}/);
  assert.match(app, /Undo section\/file change/); assert.match(app, /document.revision !== sectionUndo.revision/);
  assert.match(experiments, /await flushDraft\(\)/); assert.match(experiments, /Copy LaTeX reference/);
  assert.match(experiments, /setLinkedOutput/); assert.match(notebook, /no longer available/);
  assert.match(app, /Return to manuscript passage/);
});

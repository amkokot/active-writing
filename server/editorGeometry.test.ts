import assert from "node:assert/strict";
import { test } from "node:test";
import { pdfFitScale, readingAnchorAdjustment, resizedPdfPosition, highlightActionsPosition, arrowBlockDirection, blockActionsBottom } from "../src/editorGeometry.ts";

test("arrow keys change hosts only at the corresponding text or visual-line edge",()=>{
  assert.equal(arrowBlockDirection("ArrowLeft",0,40,true,false),-1);
  assert.equal(arrowBlockDirection("ArrowRight",40,40,false,true),1);
  assert.equal(arrowBlockDirection("ArrowUp",8,40,true,false),-1);
  assert.equal(arrowBlockDirection("ArrowDown",32,40,false,true),1);
  assert.equal(arrowBlockDirection("ArrowRight",8,40,true,false),0);
  assert.equal(arrowBlockDirection("ArrowUp",8,40,false,false),0);
});

test("highlight tools sit below the cursor endpoint, not above it or below the whole block",()=>{
  assert.deepEqual(highlightActionsPosition({right:310,bottom:278},{left:56,right:660,top:80,bottom:720},180,28),{x:324,y:284});
});
test("highlight tools stay inside the source pane and away from its toolbar",()=>{
  const pane={left:56,right:660,top:80,bottom:720};
  assert.deepEqual(highlightActionsPosition({right:75,bottom:82},pane,180,28),{x:89,y:88});
  assert.deepEqual(highlightActionsPosition({right:900,bottom:900},pane,180,28),{x:472,y:684});
  assert.deepEqual(highlightActionsPosition({right:70,bottom:200},{left:56,right:160,top:80,bottom:720},220,28),{x:64,y:206});
  assert.deepEqual(highlightActionsPosition({right:310,bottom:680},pane,180,48),{x:324,y:664});
});
import { anchoredScrollTop, viewportParagraph, currentSourceFile } from "../src/sourceViewport.ts";
import { boundedPaneShare } from "../src/editorGeometry.ts";
import { sourceLineStarts, lineAtOffset } from "../src/sourceLines.ts";
import { readFile } from "node:fs/promises";
import { layoutSchedule } from "../src/editorGeometry.ts";
import { bindReadingLayout } from "../src/usePaneLayout.ts";

test('closing a hidden comment inspector restores the visible passage through zero-size layout and repeated reflow',()=>{
  const names=['window','document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'] as const;
  const previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let resize=()=>{},serial=0,shown=true,width=600,documentY=380;
  const frames=new Map<number,FrameRequestCallback>(),events=new Map<string,()=>void>();
  const rect=()=>({top:documentY-pane.scrollTop+50,bottom:documentY-pane.scrollTop+250});
  const element={getBoundingClientRect:rect,isConnected:true};
  const pane={scrollTop:400,get clientWidth(){return shown?width:0;},get clientHeight(){return shown?500:0;},getClientRects:()=>shown?[{}]:[],
    getBoundingClientRect:()=>({top:50}),querySelectorAll:()=>[element],contains:(item:unknown)=>item===element,
    addEventListener:(name:string,fn:()=>void)=>events.set(name,fn),removeEventListener:(name:string)=>events.delete(name)};
  const flush=()=>{while(frames.size){const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(0);}};
  const surface={addEventListener(){},removeEventListener(){}};
  try{
    Object.assign(globalThis,{window:surface,document:surface,ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){}},
      requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:(id:number)=>frames.delete(id)});
    const close=bindReadingLayout(pane as unknown as HTMLElement);
    shown=false;pane.scrollTop=0;resize();events.get('scroll')?.();flush();
    shown=true;resize();flush();assert.equal(pane.scrollTop,400,'Hidden zero must not replace the reading anchor');
    width=900;documentY=600;resize();flush();assert.equal(pane.scrollTop,620,'Source reflow keeps the same passage offset');
    width=600;documentY=380;resize();flush();assert.equal(pane.scrollTop,400);
    pane.scrollTop=450;events.get('scroll')?.();flush();
    shown=false;pane.scrollTop=0;resize();flush();shown=true;resize();flush();assert.equal(pane.scrollTop,450,'A deliberate new reading position becomes the next return point');
    close();assert.equal(events.size,0);assert.equal(frames.size,0);
  }finally{for(const name of names){const descriptor=previous.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
});

test("typing coalesces line layout without starving updates or running after unmount", async (t) => {
  t.mock.timers.enable({apis:["setTimeout"]});
  let measurements = 0;
  const layout = layoutSchedule(() => measurements++);
  for (let key = 0; key < 10; key++) { layout.request(); t.mock.timers.tick(10); }
  assert.equal(measurements, 1);
  layout.request(); layout.cancel(); t.mock.timers.tick(200);
  assert.equal(measurements, 1);
  layout.request(); t.mock.timers.tick(100);
  assert.equal(measurements, 2);
});

test("typing keeps pane observers and unrelated rendered math stable without stale click handlers", async () => {
  const layout = await readFile(new URL("../src/usePaneLayout.ts", import.meta.url), "utf8");
  const passage = await readFile(new URL("../src/components/RenderedPassage.tsx", import.meta.url), "utf8");
  const preview = await readFile(new URL("../src/components/Preview.tsx", import.meta.url), "utf8");
  assert.ok(layout.indexOf("binding.current?.pane === ref.current") < layout.indexOf("pane.querySelectorAll"));
  assert.match(layout, /binding.current\?\.close\(\)/);
  assert.match(passage, /useStableEvent/);
  assert.match(passage, /onReference=\{props.onReference \|\| props.onPassageReference \? onReference : undefined\}/);
  assert.match(preview, /contentsCache.current.key !== contentsKey/);
  assert.match(passage, /export default memo\(function RenderedPassage/);
  assert.match(preview, /useDeferredValue\(props\)/);
  assert.match(preview, /navigation \? props : deferred/);
  assert.doesNotMatch(preview, /onReference=\{onReference \? token =>/);
});

test("source navigation, full-document reel scrollbar and divider stay in the shared editor", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const manuscript = await readFile(new URL("../src/components/Manuscript.tsx", import.meta.url), "utf8");
  const raw = await readFile(new URL("../src/components/PlainSourceEditor.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(app, /effectivePreviewMode === "split" && <PaneDivider/);
  assert.match(app, /value=\{preambleEditing \? "file"/);
  assert.match(app, /if \(preambleEditing\) await savePaper\(\);/);
  assert.match(app, /!preambleEditing && blockWindow && <BlockWindowBar/);
  assert.match(app, /manuscriptReturnPositions.current.get\(`\$\{document.project.id\}:\$\{document.project.mainFile\}`\)/);
  assert.match(app, /viewportOffset: saved.viewportOffset/);
  assert.match(manuscript, /if \(position\) rememberViewport\(position\);[\s\S]*positionReader.current = undefined/);
  assert.match(app, /commandSaveQueue.current.catch\(\(\) => undefined\).then\(async \(\) =>/);
  assert.match(app, /before.project.id !== owner.project.id \|\| before.project.mainFile !== owner.project.mainFile/);
  assert.match(manuscript, /total=\{sourceWindow.available.length\}/);
  assert.match(manuscript, /data-sync-preview=\{paragraph.id\}/);
  assert.match(manuscript, /<SourceLineNumbers target=\{paragraphRef\}/);
  assert.match(raw, /<SourceLineNumbers target=\{input\}/);
  assert.match(css, /manuscript-scroll.block-reel \{ scrollbar-width: none/);
  assert.match(css, /var\(--source-share, 1fr\)/);
});

test("split divider keeps both panes usable and handles invalid widths", () => {
  assert.equal(boundedPaneShare(NaN), .5);
  assert.equal(boundedPaneShare(.5, 1200), .5);
  assert.ok(boundedPaneShare(0, 1000) >= .18);
  assert.ok(boundedPaneShare(1, 1000) <= .82);
  assert.equal(boundedPaneShare(0, 100), .4);
  assert.equal(boundedPaneShare(1, 100), .6);
});
test("source line numbers count literal newlines, not visual wraps", () => {
  const source = "\\section{A}\r\n" + "long-reference".repeat(30) + "\n\ntext";
  const starts = sourceLineStarts(source);
  assert.equal(starts.length, 4);
  assert.equal(lineAtOffset(starts, 0), 1);
  assert.equal(lineAtOffset(starts, source.indexOf("long")), 2);
  assert.equal(lineAtOffset(starts, source.indexOf("text")), 4);
  assert.equal(lineAtOffset(starts, source.length), 4);
  assert.deepEqual(sourceLineStarts(""), [0]);
});

test("PDF fit uses actual pane width and never forces a too-wide minimum canvas", () => {
  assert.equal(pdfFitScale(640, 612), 1);
  assert.ok(pdfFitScale(180, 612) < 0.35);
  assert.equal(pdfFitScale(3000, 612), 1.4);
  assert.equal(pdfFitScale(0, 0), 0.55);
});
test("PDF resizing preserves a natural page point with old and new viewport sizes", () => {
  assert.deepEqual(resizedPdfPosition({ top: 300, left: 100, width: 600, height: 500, scale: 1 }, 1.5, 900, 800), { top: 425, left: 150 });
  assert.deepEqual(resizedPdfPosition({ top: 0, left: 0, width: 300, height: 300, scale: 1 }, 0.5, 500, 500), { top: 0, left: 0 });
});
test("reading layout preserves a block's offset without changing source or progress", () => {
  assert.equal(readingAnchorAdjustment(-20, 80), 100);
  assert.equal(readingAnchorAdjustment(25, -10), -35);
  assert.equal(readingAnchorAdjustment(NaN, 10), 0);
});

test("passage tools use their own host coordinates at every editor zoom", () => {
  assert.equal(blockActionsBottom(480, 240, 600, 600), 240);
  assert.equal(blockActionsBottom(540, 240, 750, 600), 240);
  assert.equal(blockActionsBottom(360, 240, 300, 600), 240);
  assert.equal(blockActionsBottom(100, 240, 600, 600), 0);
  assert.equal(blockActionsBottom(NaN, 0, 600, 600), 0);
});

test("scope anchors prefer a visible caret, not an old offscreen editing location", () => {
  const boxes = [{ id: "old", top: -600, bottom: -200 }, { id: "first", top: -40, bottom: 100 }, { id: "reading", top: 160, bottom: 480 }, { id: "below", top: 620, bottom: 900 }];
  assert.equal(viewportParagraph(boxes, 600, "old"), "reading");
  assert.equal(viewportParagraph(boxes, 600, "first"), "first");
  assert.equal(viewportParagraph(boxes, 600), "reading");
  assert.equal(viewportParagraph([], 600), undefined);
  assert.equal(viewportParagraph([{ id: "long-proof", top: -400, bottom: 1600 }], 600), "long-proof");
});

test("scope restoration retains pixel offsets across removed headings and reel spacers", () => {
  // A target moved from y=240 to y=800 while its pane still starts at y=100.
  assert.equal(anchoredScrollTop(200, 800, 100, 140), 760);
  assert.equal(anchoredScrollTop(760, 240, 100, 140), 760);
  // Partly visible paragraphs and top-of-document clamping remain valid.
  assert.equal(anchoredScrollTop(500, 170, 100, -70), 640);
  assert.equal(anchoredScrollTop(0, 120, 100, 300), 0);
});
import {sameBlockAnnotations} from '../src/editorGeometry.ts';
test('unrelated comment-map replacements keep source blocks stable; own comments, heading notes and wording locks update',()=>{
 const ids=['heading','p'],marker={taskId:'draft',label:'Review draft text',locked:false};
 assert.ok(sameBlockAnnotations(ids,{p:1},{p:1,other:8},{p:marker},{p:{...marker}}));
 assert.equal(sameBlockAnnotations(ids,{p:1},{p:2},undefined,undefined),false);
 assert.equal(sameBlockAnnotations(ids,{}, {heading:1},undefined,undefined),false);
 assert.equal(sameBlockAnnotations(ids,{}, {},{p:marker},{p:{...marker,locked:true}}),false);
 assert.equal(sameBlockAnnotations(ids,{}, {},{p:marker},{}),false);
});
test('source layout is contained without clipping controls below the editing box',async()=>{
 const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
 assert.match(css,/\.source-editor-shell \{ contain: layout; \}/);
 assert.doesNotMatch(css,/\.source-editor-shell \{ contain: (?:paint|strict|content);/);
});

test('file location follows the current included source and rejects stale version anchors',()=>{
 const doc={project:{id:'p',name:'Paper',folder:'paper',mainFile:'v2.tex',createdAt:''},files:['v1.tex','v2.tex','sections/main-v2.tex','appendix-v2.tex'],paragraphs:[{id:'body',nodeId:'section',file:'sections/main-v2.tex',text:'Current body'},{id:'proof',nodeId:'appendix',file:'appendix-v2.tex',text:'Proof'}],nodes:[{id:'section',kind:'section' as const,title:'Body',depth:1,paragraphIds:['body'],sourceOpening:{file:'sections/main-v2.tex',start:0,end:1,text:''}}]};
 assert.equal(currentSourceFile(doc,{paragraphId:'body',nodeId:'section'}),'sections/main-v2.tex');
 assert.equal(currentSourceFile(doc,{paragraphId:'proof',nodeId:'appendix'}),'appendix-v2.tex');
 assert.equal(currentSourceFile(doc,{nodeId:'section'}),'sections/main-v2.tex');
 assert.equal(currentSourceFile(doc,{paragraphId:'old-version',nodeId:'old-section'}),'v2.tex');
 assert.equal(currentSourceFile(doc,{raw:true,file:'appendix-v2.tex'}),'appendix-v2.tex');
 assert.equal(currentSourceFile(doc,{raw:true,file:'missing.tex'}),'v2.tex');
});

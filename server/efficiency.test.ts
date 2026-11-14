import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJsonSnapshotter, snapshotRequest } from "../src/jsonSnapshot.ts";
import { LazyDisclosure } from "../src/lazyDisclosure.ts";
import { ReplyMarkdown } from "../src/replyMarkdown.ts";
import { replyOutline } from "../src/replyOutline.ts";
import { defaultDisplayMode, displayModes, normalizeDisplayMode } from "../src/display.ts";
import { createCommentBuffer } from "../src/commentBuffer.ts";

function commentTyping() {
  let now = 0, serial = 0;
  const timers = new Map<number, {at:number; callback:()=>void}>();
  const commits:string[]=[], drafts:Array<{value:string;base:string}>=[];
  let conflicts=0;
  const buffer=createCommentBuffer('Original',{
    commit:value=>commits.push(value),keep:(value,base)=>drafts.push({value,base}),conflict:()=>conflicts++,
    schedule:(callback,delay)=>{const id=++serial;timers.set(id,{at:now+delay,callback});return id;},cancel:id=>{timers.delete(id as number);},
  });
  function advance(ms:number){const until=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();}now=until;}
  return {buffer,commits,drafts,advance,conflicts:()=>conflicts,timers};
}

test('comment typing retains each character without rerendering the workspace per key',()=>{
  const f=commentTyping();for(let i=1;i<=100;i++){f.buffer.change('x'.repeat(i));f.advance(10);}
  assert.equal(f.commits.length,0);assert.equal(f.drafts.length,100);
  f.advance(450);assert.deepEqual(f.commits,['x'.repeat(100)]);assert.equal(f.timers.size,0);
  f.buffer.flush();assert.equal(f.commits.length,1);
});
test('comment blur/navigation flushes once to its own owner and cancels pending timers',()=>{
  const a=commentTyping(),b=commentTyping();a.buffer.change('A');b.buffer.change('B');a.buffer.dispose();
  assert.deepEqual(a.commits,['A']);assert.deepEqual(b.commits,[]);a.advance(5000);assert.deepEqual(a.commits,['A']);
  b.buffer.flush();assert.deepEqual(b.commits,['B']);
});
test('continuous comment typing has a bounded save delay and respects composition',()=>{
  const f=commentTyping();for(let i=0;i<25;i++){f.buffer.change(String(i));f.advance(100);}
  assert.deepEqual(f.commits,['24']);
  f.buffer.composition(true);f.buffer.change('正在输入');f.advance(3000);assert.equal(f.commits.length,1);
  f.buffer.composition(false);f.advance(450);assert.equal(f.commits.at(-1),'正在输入');
});
test('incoming comment edits do not erase unsaved typing; acknowledgements keep newer input',()=>{
  const f=commentTyping();f.buffer.change('First');f.buffer.flush();f.buffer.change('Second');
  assert.equal(f.buffer.receive('First'),undefined);assert.deepEqual(f.drafts.at(-1),{value:'Second',base:'First'});
  f.advance(450);assert.deepEqual(f.commits,['First','Second']);f.buffer.receive('Second');
  assert.equal(f.buffer.receive('Remote revision'),'Remote revision');
  f.buffer.change('Local pending');f.buffer.receive('Other remote revision');f.advance(5000);f.buffer.dispose();
  assert.equal(f.conflicts(),1);assert.deepEqual(f.commits,['First','Second']);assert.equal(f.drafts.at(-1)?.value,'Local pending');
});
test('deleting all comment text is saved rather than confused with an absent draft',()=>{
  const f=commentTyping();f.buffer.change('');f.buffer.dispose();assert.deepEqual(f.commits,['']);assert.equal(f.drafts.at(-1)?.value,'');
});

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

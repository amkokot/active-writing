import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { workspaceFolders, openWorkspaceFolder, selectedFolder,openExplorer,projectFileLocation,revealProjectFile } from "./workspaceFolders.ts";
import {EventEmitter} from 'node:events';
import type {spawn} from 'node:child_process';
import { workspaceNote } from "../src/workspaceFolders.ts";
import { registerProject } from "./projects.ts";
import { latexPlugin } from "./latexPlugin.ts";
import { appCodeRoot } from "./appPaths.ts";
import {readOptionalTools,saveOptionalTools} from './optionalTools.ts';
test('a requested Explorer folder window is visible and keeps a spaced path as one argument',{skip:process.platform!=='win32'},async()=>{
 let call:any[]=[];const child=Object.assign(new EventEmitter(),{unref(){}});
 const launch=((...args:any[])=>{call=args;queueMicrotask(()=>child.emit('spawn'));return child;}) as unknown as typeof spawn;
 await openExplorer('C:\\Aw home\\Desktop inbox',launch);
 assert.equal(call[0],'explorer.exe');assert.deepEqual(call[1],['C:\\Aw home\\Desktop inbox']);assert.equal(call[2].windowsHide,false);
});

test('optional sync tools are off in new workspaces, preserve existing pairs, and fence settings',async()=>{
 const f=await fixture();
 assert.deepEqual(await readOptionalTools(f.workspace),{revision:'',sync:false});
 const dir=path.join(f.workspace,'.paperfocus/device-sync/auto/example');await mkdir(dir,{recursive:true});
 const config=path.join(dir,'config.json');await writeFile(config,JSON.stringify({enabled:true}));
 assert.deepEqual(await readOptionalTools(f.workspace),{revision:'',sync:true});
 const off=await saveOptionalTools(f.workspace,'',false);assert.equal(off.sync,false);
 assert.deepEqual(JSON.parse(await readFile(config,'utf8')),{enabled:true},'Hiding controls must not stop or alter a pair');
 await assert.rejects(saveOptionalTools(f.workspace,'',true),/changed/);
 await assert.rejects(saveOptionalTools(f.workspace,off.revision,'yes' as unknown as boolean),/whether/);
 assert.equal((await saveOptionalTools(f.workspace,off.revision,true)).sync,true);
});

async function fixture() {
  const base = path.resolve(".paperfocus/trials");
  await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "workspace-folders-"));
  const paper = path.join(workspace, "paper with spaces");
  await mkdir(paper);
  await writeFile(path.join(paper, "main.tex"), "\\documentclass{article}\n\\begin{document}Example.\\end{document}\n");
  const project = await registerProject(workspace, "paper with spaces", "Folder access test");
  return { workspace, paper, project };
}

test("folder information distinguishes app home from selected project without changing source", async () => {
  const f = await fixture();
  const before = await readFile(path.join(f.paper, "main.tex"), "utf8");
  const folders = await workspaceFolders(f.workspace, f.project.id);
  assert.equal(folders.home.path, await realpath(f.workspace));
  assert.equal(folders.paper?.path, await realpath(f.paper));
  assert.equal(folders.paper?.id, f.project.id);
  assert.equal(folders.data?.path, path.join(folders.home.path, ".paperfocus/project-data", f.project.id));
  assert.ok(workspaceNote(folders).includes(folders.data!.path));
  assert.match(workspaceNote(folders), /outside.*repository/);
  assert.match(folders.paper!.link, /paper%20with%20spaces\/$/);
  assert.equal(new URL(folders.home.link).protocol, "file:");
  assert.equal(folders.code?.path, appCodeRoot);
  assert.equal(folders.guidePath, path.join(appCodeRoot, "docs", "RESEARCH_WORKFLOW.md"));
  assert.ok(workspaceNote(folders).includes(appCodeRoot));
  assert.match(workspaceNote(folders), /explicit data home in --workspace/);
  assert.match(workspaceNote(folders), /Paper working folder:/);
  assert.ok(workspaceNote(folders).includes(f.paper));
  assert.equal(await readFile(path.join(f.paper, "main.tex"), "utf8"), before);
  assert.equal((await workspaceFolders(f.workspace)).paper, undefined);
  await assert.rejects(workspaceFolders(f.workspace, "not-registered"), /no longer registered/);
});

test("folder opening accepts only known home and paper targets, never arbitrary paths", async () => {
  const f = await fixture();
  const opened: string[] = [];
  const open = async (folder: string) => { opened.push(folder); };
  await openWorkspaceFolder(f.workspace, f.project.id, "paper", open);
  await openWorkspaceFolder(f.workspace, f.project.id, "home", open);
  await openWorkspaceFolder(f.workspace, f.project.id, "data", open);
  assert.deepEqual(opened, [await realpath(f.paper), await realpath(f.workspace), (await workspaceFolders(f.workspace, f.project.id)).data!.path]);
  await assert.rejects(openWorkspaceFolder(f.workspace, f.project.id, "../../outside", open), /Choose Aw home/);
  assert.equal(opened.length, 3);
  assert.throws(() => selectedFolder({ home: { path: f.workspace, link: "" }, guidePath: "", canOpen: false }, "paper"));
});

test("open-folder endpoint rejects missing and foreign origins before opening Explorer", async () => {
  const f = await fixture();
  let handler: any;
  (latexPlugin(f.workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  for (const origin of [undefined, "https://another-site.example"]) {
    const req = Object.assign(Readable.from([JSON.stringify({ projectId: f.project.id, target: "home" })]), {
      url: "/api/paperfocus/workspace-folders/open", method: "POST", headers: { host: "127.0.0.1:4173", ...(origin ? { origin } : {}) },
    });
    const res: any = { setHeader() {}, end(text: string) { res.body = JSON.parse(text); } };
    await handler(req, res, () => assert.fail("Unexpected fallthrough"));
    assert.equal(res.statusCode, 403);
  }
  const req = Object.assign(Readable.from([JSON.stringify({ projectId: f.project.id, target: "C:\\Windows", path: "C:\\Windows" })]), {
    url: "/api/paperfocus/workspace-folders/open", method: "POST", headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
  });
  const res: any = { setHeader() {}, end(text: string) { res.body = JSON.parse(text); } };
  await handler(req, res, () => assert.fail("Unexpected fallthrough"));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Choose Aw home/);
});

test('file locations reveal only existing files inside their registered paper',async()=>{
 const f=await fixture();await mkdir(path.join(f.paper,'sections'));await writeFile(path.join(f.paper,'sections/a note.tex'),'Text');
 const located=await projectFileLocation(f.workspace,f.project.id,'sections/a note.tex');assert.equal(located.path,path.join(await realpath(f.paper),'sections','a note.tex'));assert.equal(located.folder,path.dirname(located.path));
 for(const name of ['../outside.tex','C:\\Windows\\notepad.exe','missing.tex','sections'])await assert.rejects(projectFileLocation(f.workspace,f.project.id,name));
});
test('file-location endpoint copies a full path without opening anything and rejects foreign origins',async()=>{
 const f=await fixture();let handler:any;(latexPlugin(f.workspace).configureServer as Function)({middlewares:{use:(v:unknown)=>{handler=v;}}});
 for(const origin of ['http://127.0.0.1:4173','https://elsewhere.example']){
  const req=Object.assign(Readable.from([JSON.stringify({projectId:f.project.id,target:'file',file:'main.tex',copy:true})]),{url:'/api/paperfocus/workspace-folders/open',method:'POST',headers:{host:'127.0.0.1:4173',origin}});
  const res:any={setHeader(){},end(text:string){this.body=JSON.parse(text);}};await handler(req,res,()=>assert.fail('Unexpected route'));
  assert.equal(res.statusCode,origin.startsWith('http://127.')?200:403);if(res.statusCode===200)assert.equal(res.body.path,path.join(await realpath(f.paper),'main.tex'));
 }
});
test('Explorer selects a file with spaces without passing it to a shell',{skip:process.platform!=='win32'},async()=>{
 const f=await fixture();let call:any[]=[];const child=Object.assign(new EventEmitter(),{unref(){}});const launch=((...args:any[])=>{call=args;queueMicrotask(()=>child.emit('spawn'));return child;}) as unknown as typeof spawn;
 await revealProjectFile(f.workspace,f.project.id,'main.tex',launch);assert.equal(call[0],'explorer.exe');assert.deepEqual(call[1],['/select,',path.join(await realpath(f.paper),'main.tex')]);assert.equal(call[2].windowsHide,false);assert.ok(!call[2].shell);
});

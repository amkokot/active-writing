import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {developmentWatchIgnored} from './devWatch.mjs';
test('development watcher excludes uploaded books and research before opening a watcher', () => {
 const root=path.resolve('watch-fixture');
 for(const file of ['Weak Convergence (1996).pdf','dissertation.pdf','main.tex','papers','papers/project/main.tex','.paperfocus','.paperfocus/project-data/notebook.ipynb','research','research/results.json','problem-lab','node_modules','output','../other/file.ts'])
  assert.equal(developmentWatchIgnored(root,path.resolve(root,file)),true,file);
});
test('development watcher retains app roots and new app files', () => {
 const root=path.resolve('watch-fixture');
 for(const file of ['','src','src/new/Editor.tsx','src/styles.css','server','server/syncReading.ts','scripts/devWatch.mjs','public/aw.svg','index.html','vite.config.ts','tsconfig.app.json','package-lock.json'])
  assert.equal(developmentWatchIgnored(root,path.resolve(root,file)),false,file);
});

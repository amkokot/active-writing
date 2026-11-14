import path from 'node:path';
import {safeSyncId} from './syncProtocol.ts';
export function pairedSetupBrief(codeRoot:string,workspace:string,projectId:string){
 if(!safeSyncId(projectId))throw new Error('Choose a registered project.');
 return `Set up a paired desktop working copy of this Active Writing project.
Project ID: ${projectId}
Laptop data home: ${workspace}
Setup tool: ${path.join(codeRoot,'scripts/awPair.ts')}
Read docs/DEVICE_SYNC.md in the app-code folder first. Use the existing trusted SSH
host and installed desktop code if already configured; otherwise ask for those
three settings (host alias, code folder, projects parent). Never request passwords.
Use awPair.ts prepare with this exact workspace/project and the chosen host/paths,
then inspect and commit its exact plan after saving drafts. Include --auto yes only
when the human requests background saved-work synchronization. For a new project,
awPair.ts new creates research notes first; do not recreate an existing project.
Keep the complete laptop copy and all notebook/evidence IDs. Stream missing bulk
files; do not zip the entire project, raise memory limits or discard old evidence.
The receipt gives the laptop viewing link and desktop workspace. Open that project
in the normal laptop Aw app; a desktop editor server is not needed for research.
No models, experiments, pending requests, chat histories or credentials are replayed.
App installation and remote compute retain their own human scope. Do not restart
occupied services, change source structure or force conflicting/protected changes.`;
}

import { registry } from "./projects.ts";
import { readWorkbench } from "./workbenchStore.ts";
import { readNotebook } from "./notebookStore.ts";
import { notebookAttentionTasks } from "../src/notebookSync.ts";
import { projectQueueTask, type ProjectQueueCatalogue } from "../src/projectQueue.ts";

/** No manuscript parsing, jobs or task edits. Load only when All projects is used. */
export async function readProjectQueue(workspace: string, excludeProjectId?: string): Promise<ProjectQueueCatalogue> {
  const projects = (await registry(workspace)).projects;
  if (excludeProjectId && !projects.some(project => project.id === excludeProjectId)) throw new Error("This paper is no longer registered.");
  const catalogue: ProjectQueueCatalogue = { tasks: [], errors: [] };
  const others = projects.filter(project => project.id !== excludeProjectId);
  // Bound filesystem concurrency, even for a large project registry.
  for (let start = 0; start < others.length; start += 4) {
    const batch = await Promise.all(others.slice(start, start + 4).map(async project => {
      try {
        const [work, notes] = await Promise.all([readWorkbench(workspace, project.id), readNotebook(workspace, project.id)]);
        const tasks = notebookAttentionTasks(notes.entries, work.attentionTasks).map(task => {
          // The catalogue is not a prompt export. Fetch full source/replies only after opening.
          const { sourceSnapshot, packet, reply, replyDraft, ...metadata } = task;
          return projectQueueTask(project, { ...metadata, ticket: task.ticket ? { ...task.ticket, copyText: "" } : undefined }, sourceSnapshot?.nodeTitle ?? task.title);
        });
        return { tasks };
      } catch (error) { return { error: { projectId: project.id, projectName: project.name, error: error instanceof Error ? error.message : String(error) } }; }
    }));
    for (const item of batch) { if (item.tasks) catalogue.tasks.push(...item.tasks); if (item.error) catalogue.errors.push(item.error); }
  }
  return catalogue;
}

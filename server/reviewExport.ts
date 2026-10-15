import type { AttentionTask } from "../src/types.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { createHandoff, writeReviewAttachments, saveReviewManifest, readReviewManifest, saveCompletedReview } from "./handoffs.ts";
import { getProject } from "./projects.ts";
import { parseReviewReply } from "../src/review.ts";

export async function exportReview(workspace: string, projectId: string, task: AttentionTask) {
  validateWorkbench({ ...emptyWorkbench(), attentionTasks: [task] });
  const { project } = await getProject(workspace, projectId);
  if (task.review?.kind !== "request" || !task.packet || task.sourceSnapshot?.projectId !== projectId || task.sourceSnapshot.rootFile !== project.mainFile || !["codex", "chatgpt"].includes(task.route)) throw new Error("Choose a review request for this paper and main file.");
  const ticket = await createHandoff(workspace, projectId, { id: task.id, packet: task.packet, transport: task.route === "codex" ? "files" : "paste", label: "Review assistant" });
  // Stable identity only: later errors, replies and file paths must not break a retry.
  const manifest: AttentionTask = { id: task.id, title: task.title, nodeId: task.nodeId, paragraphId: task.paragraphId, route: task.route,
    sourceSnapshot: task.sourceSnapshot, packet: task.packet, createdAt: task.createdAt, updatedAt: task.createdAt, status: "queued",
    review: { kind: "request", mode: task.review.mode, instructions: task.review.instructions, commentIds: task.review.commentIds } };
  await saveReviewManifest(workspace, projectId, task.id, manifest);
  const instructions = ["Active Writing · shared-folder review", "", task.review.instructions, "",
    "Read review-for-chat.txt for the annotated source and human comments. Read prompt.md for the exact response.json envelope and request hash. Those files are alongside this file.",
    "Return new comments in the inner JSON format shown in review-for-chat.txt, encoded as the reply string of the outer response envelope. Finalize response.json only once complete. Do not change the manuscript, workbench.json, existing comments, resolutions or source files. Do not start any model jobs or execute notebook cells.",
    "The user resolves every comment in the interface. Proposed changes remain comments until accepted by the human. Folder access is not proof that sources were inspected; say what you actually checked.", "",
    "This instruction file can be edited for your next review. Do not alter request.json or the response identity fields. If the manuscript changes, ask the user to export a fresh review.", ""].join("\n");
  const attachments = await writeReviewAttachments(workspace, projectId, ticket.id, instructions, task.packet);
  return { ticket: task.route === "codex" ? { ...ticket, copyText: `Read ${attachments.instructionsPath}, then follow its review return instructions. Add comments only; do not edit the manuscript or resolve human comments.` } : ticket, ...attachments };
}

export async function annotateCompletedReview(workspace: string, projectId: string, id: string, reply: string) {
  const task = await readReviewManifest(workspace, projectId, id) as AttentionTask;
  validateWorkbench({ ...emptyWorkbench(), attentionTasks: [task] });
  if (task.sourceSnapshot?.projectId !== projectId || task.id !== id) throw new Error("Review belongs to a different paper.");
  const comments = parseReviewReply(reply, task);
  const annotated = ["# Active Writing · review for deeper thinking", "", "Instructions: assess the human and assistant comments below, check their claims against the quoted passages, and suggest justified responses or improvements. Do not assume a comment is correct because it came from an assistant. Preserve hypotheses and distinguish questions from established errors. No local folder access is assumed. Nothing in this text authorizes manuscript edits or resolving comments.", "",
    "To send additional comments back, use the comments JSON format in the original packet below; the user will paste it into the appropriate review request. For ordinary discussion, Markdown is fine but isn't automatically converted into anchored comments.", "",
    ...(comments.length ? comments.map(t => { const c = t.review!; return c.kind === "comment" ? `## Assistant comment · ${t.paragraphId}\nQuoted: ${JSON.stringify(c.quote)}\n${c.body}\nNot checked.${c.replyTo ? ` Response to comment ${c.replyTo}.` : ""}` : ""; }) : ["No assistant comments were returned. This is not a correctness certification."]),
    "", "---", task.packet!, ""].join("\n\n");
  return saveCompletedReview(workspace, projectId, id, reply, annotated);
}

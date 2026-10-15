import type { ProgressState } from "./types.ts";

export const workspaceWindowId = crypto.randomUUID();
export type WindowMessage = { sender: string; projectId: string; kind: "source" | "notebook" | "workbench" | "compile" }
  | { sender: string; projectId: string; kind: "progress"; revision: string; rootFile: string; changes: Record<string, ProgressState | null> };
const channelName = "active-writing.windows.v1", eventKey = "active-writing.window-message.v1";
let channel: BroadcastChannel | undefined;
function sharedChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  return channel ??= new BroadcastChannel(channelName);
}
export function validWindowMessage(value: unknown): value is WindowMessage {
  const v = value as WindowMessage;
  return !!v && typeof v.sender === "string" && v.sender.length <= 200 && typeof v.projectId === "string" && v.projectId.length <= 200
    && (["source", "notebook", "workbench", "compile"].includes(v.kind) || v.kind === "progress" && typeof v.revision === "string" && v.revision.length <= 200 && typeof v.rootFile === "string" && v.rootFile.length <= 2000
      && !!v.changes && typeof v.changes === "object" && !Array.isArray(v.changes) && Object.keys(v.changes).length <= 10_000
      && Object.entries(v.changes).every(([key, value]) => key.length <= 200 && !["__proto__", "constructor", "prototype"].includes(key) && [null, "blank", "progress", "done"].includes(value)));
}
export function sendWindowMessage(message: Omit<Extract<WindowMessage, { kind: "progress" }>, "sender"> | Omit<Exclude<WindowMessage, { kind: "progress" }>, "sender">) {
  const payload = { ...message, sender: workspaceWindowId };
  const bus = sharedChannel();
  if (bus) bus.postMessage(payload);
  else try { localStorage.setItem(eventKey, JSON.stringify({ ...payload, nonce: crypto.randomUUID() })); } catch { /* Periodic store reads still synchronize saved work. */ }
}
export function announceSaved(projectId: string, kind: "source" | "notebook" | "workbench" | "compile") { sendWindowMessage({ projectId, kind }); }
export function subscribeWindowMessages(receive: (message: WindowMessage) => void) {
  const accept = (value: unknown) => { if (validWindowMessage(value) && value.sender !== workspaceWindowId) receive(value); };
  const listener = (event: MessageEvent) => accept(event.data);
  const storage = (event: StorageEvent) => { if (event.key === eventKey && event.newValue) { try { accept(JSON.parse(event.newValue)); } catch { /* Ignore malformed notifications. */ } } };
  const bus = sharedChannel(); bus?.addEventListener("message", listener); window.addEventListener("storage", storage);
  return () => { bus?.removeEventListener("message", listener); window.removeEventListener("storage", storage); };
}

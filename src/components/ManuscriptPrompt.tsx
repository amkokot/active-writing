import { useState } from "react";
import { MessageSquareText, Plus, X } from "lucide-react";
import { StudyWorkspace } from "./StudyWorkspace";
import { notebookExcerpt } from "../selectionPassages";
import type { NotebookEntry, ProjectDocument, ReferenceRequest, StudyFocus, StudyTurn } from "../types";

interface Props {
  entry: NotebookEntry; document: ProjectDocument; dispatching: boolean;
  onClose: () => void; onNew: () => void;
  onPatch: (patch: Partial<NotebookEntry>) => void;
  onHandoff: (entry: NotebookEntry, packet: string, turn?: StudyTurn) => Promise<string>;
  onLocalStudy: (entry: NotebookEntry, turn: StudyTurn) => void;
  onImportReply: (id: string, reply: string) => boolean;
  onFinishWithoutImport: (id: string) => void; onReopenTask: (id: string) => void;
  onFinishTask?: (id: string) => void;
  onContinue: () => void; onReference: (request: ReferenceRequest) => void;
}

export function ManuscriptPrompt({ entry, document, dispatching, onClose, onNew, ...actions }: Props) {
  const [selection, setSelection] = useState<StudyFocus>();
  return <aside className="manuscript-prompt notebook-page" aria-label="Manuscript conversation">
    <header className="manuscript-prompt-heading"><MessageSquareText size={15} /><span title={`Ask about ${entry.source?.nodeTitle ?? "this paper"}`}>Ask · {entry.source?.nodeTitle ?? "this paper"}</span><button aria-label="Start a new manuscript question" title="New question" onClick={onNew}><Plus size={15} /></button><button aria-label="Minimize manuscript conversation" title="Minimize" onClick={onClose}><X size={15} /></button></header>
    {entry.source && <details className="prompt-context"><summary>Included {entry.source.passages ? `${entry.source.passages.length} blocks` : "passage"} · {entry.source.file}</summary><blockquote>{notebookExcerpt(entry.source)}</blockquote></details>}
    <StudyWorkspace entry={entry} document={document} dispatching={dispatching} compactReplies selection={selection} onSelection={setSelection} onClearSelection={() => setSelection(undefined)} {...actions} />
  </aside>;
}

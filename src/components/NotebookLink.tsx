import { BookOpen, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { addAnswerCues, answerCueKey } from "../answerCue";
import { notebookReplyStatus, notebookTitle } from "../notebook";
import type { NotebookEntry } from "../types";
import { ToolbarDetails } from "./ToolbarDetails";

const cueStorageKey = "aw-answer-cues";
function loadCues(): Record<string, number> {
  try {
    const value = JSON.parse(sessionStorage.getItem(cueStorageKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, expiry]) => typeof expiry === "number" && Number.isFinite(expiry))) as Record<string, number>;
  } catch { return {}; }
}

/** One quiet, context-dependent bridge. Multiple discussions get a small chooser. */
export function NotebookLink({ destination, entries, readyEntries = [], openedEntryId, onOpen }: {
  destination: "manuscript" | "notebook";
  entries: NotebookEntry[];
  readyEntries?: NotebookEntry[];
  openedEntryId?: string;
  onOpen: (entry: NotebookEntry) => void;
}) {
  const [cues, setCues] = useState(loadCues);
  const [now, setNow] = useState(Date.now);
  const extra = readyEntries.filter(entry => !entries.some(linked => linked.id === entry.id));
  const choices = [...entries, ...extra];
  useEffect(() => {
    setCues(previous => addAnswerCues(previous, choices, Date.now()));
  }, [entries, readyEntries]);
  useEffect(() => {
    if (destination !== "notebook" || !openedEntryId) return;
    const entry = choices.find(entry => entry.id === openedEntryId);
    if (!entry || notebookReplyStatus(entry) !== "answer") return;
    const key = answerCueKey(entry);
    setCues(previous => previous[key] === 0 ? previous : { ...previous, [key]: 0 });
  }, [destination, openedEntryId, entries, readyEntries]);
  useEffect(() => {
    try { sessionStorage.setItem(cueStorageKey, JSON.stringify(cues)); } catch { /* A visual cue must never block editing. */ }
    const expiry = Math.min(...Object.values(cues).filter(expiry => expiry > Date.now()));
    if (!Number.isFinite(expiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(1, expiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [cues, now]);
  const fresh = choices.some(entry => notebookReplyStatus(entry) === "answer" && (cues[answerCueKey(entry)] ?? 0) > Math.max(now, Date.now()));
  function open(entry: NotebookEntry) {
    setCues(previous => ({ ...previous, [answerCueKey(entry)]: 0 }));
    onOpen(entry);
  }
  if (destination === "notebook") return null;
  if (!choices.length) return null;
  const ready = choices.some(entry => notebookReplyStatus(entry) === "answer");
  const waiting = !ready && choices.some(entry => notebookReplyStatus(entry) === "waiting");
  const label = ready ? "Answer" : waiting ? "Waiting…" : "Notebook";
  if (choices.length === 1) return <button className={`notebook-link-button${fresh ? " has-answer" : ""}`} aria-label={ready ? "Open saved answer" : "Open linked notebook conversation"} title={`${ready ? "Answer saved" : waiting ? "Waiting for an answer" : "Conversation"} · ${notebookTitle(choices[0])}`} onClick={() => open(choices[0])}><BookOpen size={14} /><span>{label}</span>{fresh && <i className="answer-ready-dot" aria-hidden="true"/>}</button>;
  return <ToolbarDetails className={`notebook-link-choices${fresh ? " has-answer" : ""}`} summaryLabel="Open conversations linked to this passage or ready answers" summary={<><BookOpen size={14} /><span>{label}</span><small>{choices.length}</small>{fresh && <i className="answer-ready-dot" aria-hidden="true"/>}<ChevronDown size={10} /></>}>
    <div className="notebook-link-menu" aria-label="Conversations linked to this passage">{choices.map(entry => <button key={entry.id} onClick={() => open(entry)}><span>{notebookTitle(entry)}</span><small>{notebookReplyStatus(entry) === "answer" ? "Answer saved" : notebookReplyStatus(entry) === "waiting" ? "Waiting" : entry.filed ? "Filed away" : "Conversation"}{extra.some(other => other.id === entry.id) ? " · elsewhere" : ""}</small></button>)}</div>
  </ToolbarDetails>;
}

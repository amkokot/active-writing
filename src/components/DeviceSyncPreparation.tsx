import { useEffect, useRef, useState } from "react";

interface Staged { id: string; device: { id: string; label: string }; createdAt: string; parents: string[]; files: number; ready: boolean }
interface Merge { mergeId: string; changes: Array<{ path: string; kind: string }>; held: Array<{ id: string; path: string; field: string; reason: string }>; complete: boolean }
interface Status { stage: "preview-only"; device?: { id: string; label: string }; stagingSupported?: boolean; exchangeSupported?: boolean; snapshots?: Staged[];
  exchange?: { localHead?: string; commonHead?: string; received: Record<string, { head: string }> }; peers?: Array<{ id: string; host: string; deviceId: string }>; pendingSyncs?: Array<{ id: string; peerId: string; startedAt: string }> }
interface Comparison { id: string; summary: { automatic: number; conflicts: number; retainedRuns: number }; conflicts: Array<{ path: string; field: string; reason: string }>; merge?: Merge; mergeError?: string; syncId?: string; remoteMerge?: Merge }
const snapshotLabel = (item: Staged) => `${item.device.label} · ${item.parents.length ? new Date(item.createdAt).toLocaleString() : "Starting copy"} · ${item.id.slice(0, 8)}`;
export function DeviceSyncPreparation({ projectId, onSaveDrafts }: { projectId?: string; onSaveDrafts?: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [status, setStatus] = useState<Status>(), [label, setLabel] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const [localId, setLocalId] = useState(""), [remoteId, setRemoteId] = useState(""), [peerId, setPeerId] = useState(""), [comparison, setComparison] = useState<Comparison>(), [preparedFolder, setPreparedFolder] = useState(""), [savedDrafts, setSavedDrafts] = useState(false);
  const [filePreview, setFilePreview] = useState<{ path: string; before: string; after: string }>();
  const [peerForm, setPeerForm] = useState({ host: "", platform: "windows", tool: "", workspace: "", deviceId: "" }), [peerReview, setPeerReview] = useState("");
  const clearReview = () => { setComparison(undefined); setPreparedFolder(""); setSavedDrafts(false); setFilePreview(undefined); };
  async function statusRequest(signal: AbortSignal) {
    const response = await fetch(`/api/paperfocus/device-sync${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, { signal });
    const data = response.headers.get("Content-Type")?.includes("application/json") ? await response.json() : undefined;
    if (!response.ok || !data || data.stage !== "preview-only") throw new Error(data?.error ?? "Use the offline awSync tool, or update the service after saved work settles.");
    if (!signal.aborted) { setStatus(data); return data as Status; }
  }
  useEffect(() => {
    if (!open) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setError(""); setNotice(""); setBusy(false); setStatus(undefined); clearReview(); setLocalId(""); setRemoteId(""); setPeerId(""); setPeerReview("");
    void statusRequest(request.signal).then(data => { if (data?.exchange?.localHead) setLocalId(data.exchange.localHead); }).catch(reason => { if (!request.signal.aborted) setError(reason.message); });
    return () => controller.current?.abort();
  }, [open, projectId]);
  useEffect(() => () => controller.current?.abort(), []);
  async function operation(work: (signal: AbortSignal) => Promise<void>) {
    if (busy) return; controller.current?.abort(); const request = new AbortController(); controller.current = request; setBusy(true); setError(""); setNotice("");
    try { await work(request.signal); } catch (reason) { if (!request.signal.aborted) setError((reason as Error).message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  async function post(action: string, payload: object, signal: AbortSignal) {
    const response = await fetch(`/api/paperfocus/device-sync${action ? `/${action}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Exchange failed. Saved work and preparations are retained."); return data;
  }
  async function inspect(action: "stage" | "compare" | "prepare", signal: AbortSignal, file?: File) {
    if (!projectId) return;
    if (file && file.size > 7 * 1024 * 1024) throw new Error("Use awSync stage for snapshots larger than 7 MB.");
    if (action === "compare") await onSaveDrafts?.();
    const payload = action === "stage" ? { projectId, snapshot: JSON.parse(await file!.text()) } : action === "compare" ? { projectId, localId, remoteId, refreshLocal: true } : { projectId, planId: comparison?.id };
    const data = await post(action, payload, signal); if (signal.aborted) return;
    if (action === "compare") { clearReview(); setComparison(data); if (data.localId) setLocalId(data.localId); await statusRequest(signal); }
    if (action === "prepare") setPreparedFolder(data.folder);
    if (action === "stage") { clearReview(); await statusRequest(signal); }
  }
  async function exportFile(signal: AbortSignal) {
    await onSaveDrafts?.();
    const peerDevice = status?.peers?.find(peer => peer.id === peerId)?.deviceId;
    const knownPeer = peerDevice && status?.exchange?.received[peerDevice] ? peerDevice : undefined;
    const response = await fetch("/api/paperfocus/device-sync/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...(!status?.exchange?.localHead && localId ? { parent: localId } : {}), ...(knownPeer ? { peerDevice: knownPeer } : {}) }), signal });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? "Exchange could not be prepared."); }
    const blob = await response.blob(); if (signal.aborted) return;
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `aw-exchange-${projectId}.aw-sync`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    clearReview(); const head = response.headers.get("X-Aw-Head"); if (head) setLocalId(head); await statusRequest(signal); if (!signal.aborted) setNotice("Private exchange downloaded. Receiving it does not approve or apply changes.");
  }
  async function receiveFile(file: File, signal: AbortSignal) {
    if (file.size > 16 * 1024 * 1024) throw new Error("Use awSync receive for exchanges larger than 16 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    const result = await post("receive", { projectId, bytes: btoa(binary) }, signal); if (signal.aborted) return;
    clearReview(); setRemoteId(result.head); const next = await statusRequest(signal); if (next?.exchange?.localHead) setLocalId(next.exchange.localHead);
    if (!signal.aborted) setNotice("Other copy received. Compare next; your manuscript and notes have not changed.");
  }
  return <details className="device-sync-preparation" onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary>Two computers</summary>
    <small>Work locally, exchange saved changes when connected. Nothing syncs in the background.</small>
    {status?.device ? <p role="status">This computer: <strong>{status.device.label}</strong></p> : status && <form onSubmit={event => { event.preventDefault(); void operation(async signal => { await post("", { label }, signal); await statusRequest(signal); }); }}>
      <label>Name this computer<input aria-label="Sync device name" placeholder="Laptop or Desktop" maxLength={60} value={label} onChange={event => setLabel(event.target.value)} /></label>
      <button type="submit" disabled={busy || !label.trim()}>Save name</button>
    </form>}
    {projectId && status?.device && status.exchangeSupported && <div className="device-sync-actions">
      <button type="button" disabled={busy} onClick={() => void operation(exportFile)}>Download exchange</button>
      <label className="device-sync-file">Receive exchange<input aria-label="Receive exchange" type="file" accept=".aw-sync,application/gzip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void operation(signal => receiveFile(file, signal)); }} /></label>
      {!!status.peers?.length && <><select aria-label="Desktop connection" disabled={busy} value={peerId} onChange={event => setPeerId(event.target.value)}><option value="">Choose a connection</option>{status.peers.map(peer => <option key={peer.id} value={peer.id}>{peer.host}</option>)}</select>
        <button type="button" disabled={busy || !peerId} onClick={() => void operation(async signal => { await onSaveDrafts?.(); const result = await post("sync-preview", { projectId, peerId }, signal); if (signal.aborted) return; clearReview(); setLocalId(result.localHead); setRemoteId(result.remoteHead); if (!result.alreadyAligned) setComparison({ id: result.planId, merge: result.merge, syncId: result.syncId, remoteMerge: result.remoteMerge, summary: { automatic: result.merge.changes.length, conflicts: result.merge.held.length, retainedRuns: 0 }, conflicts: [] }); await statusRequest(signal); if (!signal.aborted) setNotice(result.paired ? "Both proposals agree. Review the incoming changes, then sync both saved copies." : result.note); })}>Sync now</button></>}
    </div>}
    {!!status?.pendingSyncs?.length && <details className="device-sync-inspection"><summary>Interrupted syncs ({status.pendingSyncs.length})</summary>
      <small>Their checkpoints and partial collections are retained. Resume only after saving drafts on both copies.</small>
      <label className="device-sync-confirm"><input type="checkbox" checked={savedDrafts} disabled={busy} onChange={event => setSavedDrafts(event.target.checked)} />Open drafts on both copies are saved</label>
      {status.pendingSyncs.map(item => <button key={item.id} type="button" disabled={busy || !savedDrafts} onClick={() => void operation(async signal => { await onSaveDrafts?.(); await post("sync-commit",{ projectId,reviewId:item.id,draftsSaved:true },signal); await statusRequest(signal); if (!signal.aborted) setNotice("Interrupted sync completed. Both saved copies are aligned."); })}>Resume sync · {new Date(item.startedAt).toLocaleString()}</button>)}
      <small>If newer work prevents resuming, ask an assistant to inspect sync-status; never reset either copy.</small>
    </details>}
    {projectId && status?.stagingSupported && <div className="device-sync-inspection">
      {(status.snapshots?.length ?? 0) > 1 && <>
        <label>On this computer<select aria-label="Local sync snapshot" disabled={busy} value={localId} onChange={event => { setLocalId(event.target.value); clearReview(); }}><option value="">Choose saved copy</option>{status.snapshots?.filter(item => item.ready && item.device.id === status.device?.id).map(item => <option key={item.id} value={item.id}>{snapshotLabel(item)}</option>)}</select></label>
        <label>Other computer<select aria-label="Other sync snapshot" disabled={busy} value={remoteId} onChange={event => { setRemoteId(event.target.value); clearReview(); }}><option value="">Choose received copy</option>{status.snapshots?.filter(item => item.ready && item.device.id !== status.device?.id).map(item => <option key={item.id} value={item.id}>{snapshotLabel(item)}</option>)}</select></label>
        <button type="button" disabled={busy || !localId || !remoteId} onClick={() => void operation(signal => inspect("compare", signal))}>Compare changes</button>
      </>}
      {comparison && <div className="device-sync-review" role="status">
        {comparison.merge ? <><small>{comparison.merge.changes.length} files can be collected. {comparison.merge.held.length ? `${comparison.merge.held.length} concerns remain for review.` : "No held changes in this preview."}</small>
          {comparison.syncId && <><small>{comparison.remoteMerge?.changes.length ?? 0} files will update on the other computer. Both previews agree; no experiments run.</small>
            <label className="device-sync-confirm"><input type="checkbox" checked={savedDrafts} disabled={busy} onChange={event => setSavedDrafts(event.target.checked)} />Open drafts on both copies are saved</label>
            <button type="button" disabled={busy || !savedDrafts} onClick={() => void operation(async signal => { await onSaveDrafts?.(); const result = await post("sync-commit", { projectId, reviewId: comparison.syncId, draftsSaved: true }, signal); if (signal.aborted) return; clearReview(); setRemoteId(result.head); const next = await statusRequest(signal); if (next?.exchange?.localHead) setLocalId(next.exchange.localHead); if (!signal.aborted) setNotice("Both saved copies are aligned. Their next offline changes will use this shared checkpoint."); })}>Sync safe changes on both copies</button>
          </>}
          {!!comparison.merge.changes.length && <><details><summary>Changes</summary><ul>{comparison.merge.changes.map(item => <li key={item.path}><code>{item.path}</code> {/\.(?:tex|bib|md|txt|json|ipynb)$/.test(item.path) && <button type="button" disabled={busy} onClick={() => void operation(async signal => { const file = await post("merge-file", { projectId, planId: comparison.id, path: item.path }, signal); if (!signal.aborted) setFilePreview(file); })}>Inspect</button>}</li>)}</ul></details>
            {!comparison.syncId && <><label className="device-sync-confirm"><input type="checkbox" checked={savedDrafts} disabled={busy} onChange={event => setSavedDrafts(event.target.checked)} />Open editor drafts are saved</label>
              <button type="button" disabled={busy || !savedDrafts} onClick={() => void operation(async signal => { await onSaveDrafts?.(); const result = await post("merge", { projectId, planId: comparison.id, reviewId: comparison.merge!.mergeId, draftsSaved: true }, signal); if (signal.aborted) return; clearReview(); setLocalId(result.head); await statusRequest(signal); if (!signal.aborted) setNotice(`Collected ${result.changes.length} files with a backup. ${result.held.length ? `${result.held.length} concerns remain held; no shared agreement was recorded.` : "Exchange this new copy back to update the other computer."}`); })}>Collect safe changes here</button></>}
          </>}
          {!!comparison.merge.held.length && <details><summary>Needs attention ({comparison.merge.held.length})</summary><ul>{comparison.merge.held.map(item => <li key={item.id}><code>{item.path}{item.field ? ` · ${item.field}` : ""}</code><small>{item.reason}</small></li>)}</ul><small>Use awSync merge-details and scoped proposals with a folder-aware assistant. Protected decisions keep their own workflow.</small></details>}
          {!comparison.syncId && !comparison.merge.changes.length && !comparison.merge.held.length && <button type="button" disabled={busy} onClick={() => void operation(async signal => { await onSaveDrafts?.(); await post("acknowledge", { projectId, head: remoteId }, signal); await statusRequest(signal); if (!signal.aborted) setNotice("Matching copies acknowledged. The next checkpoint uses their shared history."); })}>Mark matching copies aligned</button>}
        </> : <small>{comparison.summary.automatic} candidate files; {comparison.summary.conflicts} conflicts. {comparison.mergeError ?? "This service supports detached review only."}</small>}
        {filePreview && <details open className="device-sync-text-preview"><summary>{filePreview.path}</summary><h4>Current</h4><pre>{filePreview.before || "New file"}</pre><h4>Proposed</h4><pre>{filePreview.after}</pre></details>}
      </div>}
      <details><summary>Advanced transfer tools</summary>
        <small>Private exchanges contain research and source—not a collaborator share or an app update. Only use trusted senders.</small>
        <button type="button" disabled={busy} onClick={() => void operation(async signal => { clearReview(); const next = await statusRequest(signal); if (next?.exchange?.localHead) setLocalId(next.exchange.localHead); })}>Refresh saved copies</button>
        <label>Stage older snapshot<input aria-label="Inspect snapshot file" type="file" accept=".json,application/json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void operation(signal => inspect("stage", signal, file)); }} /></label>
        {comparison && <button type="button" disabled={busy} onClick={() => void operation(signal => inspect("prepare", signal))}>Prepare detached review copy</button>}
        {preparedFolder && <code>{preparedFolder}</code>}
        {status.exchangeSupported && <details><summary>Set up SSH connection</summary><small>First install Aw/Node, make the separate copy and verify SSH login outside Aw. No keys or passwords are stored here.</small>
          <form onSubmit={event => { event.preventDefault(); void operation(async signal => { const result = await post("pair", { projectId, options: peerForm, ...(peerReview ? { commit: true, reviewId: peerReview } : {}) }, signal); if (signal.aborted) return; if (!peerReview) { setPeerReview(result.id); setNotice("Settings checked without connecting. Save this connection when ready."); } else { setPeerReview(""); setPeerId(result.id); await statusRequest(signal); if (!signal.aborted) setNotice("Connection saved. Reconnect never starts experiments or applies edits automatically."); } }); }}>
            {([ ["host", "SSH host alias"], ["tool", "Remote scripts/awSync.ts path"], ["workspace", "Remote Aw data home"], ["deviceId", "Other device ID"] ] as const).map(([field, title]) => <label key={field}>{title}<input aria-label={title} value={peerForm[field]} onChange={event => { setPeerForm({ ...peerForm, [field]: event.target.value }); setPeerReview(""); }} /></label>)}
            <label>Remote system<select value={peerForm.platform} onChange={event => { setPeerForm({ ...peerForm, platform: event.target.value }); setPeerReview(""); }}><option value="windows">Windows</option><option value="posix">Linux / macOS</option></select></label>
            <button type="submit" disabled={busy || Object.values(peerForm).some(value => !value.trim())}>{peerReview ? "Save connection" : "Check settings"}</button>
          </form></details>}
        <code>node scripts/awSync.ts --help</code>
      </details>
    </div>}
    {busy && <small role="status">Working on saved copies… No notebook code is running.</small>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </details>;
}

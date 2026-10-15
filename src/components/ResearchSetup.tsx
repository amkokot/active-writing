import { useEffect, useRef, useState } from "react";
import type { ResearchReadiness } from "../researchReadiness";

/** Deliberate diagnostics tucked into shared-file tools; never a startup task. */
export function ResearchSetup({ projectId, entryId }: { projectId: string; entryId: string }) {
  const [report, setReport] = useState<ResearchReadiness>();
  const [checking, setChecking] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => { generation.current++; setReport(undefined); setError(""); setChecking(false); return () => { generation.current++; }; }, [projectId, entryId]);
  async function check() {
    const current = ++generation.current;
    setChecking(true); setError("");
    try {
      const response = await fetch("/api/paperfocus/research/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, entryId }), signal: AbortSignal.timeout(10_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? "Restart Aw once to enable this setup check; no experiment ran." : data.error || "Setup check could not finish; no experiment ran.");
      if (current === generation.current) setReport(data);
    } catch (reason) { if (current === generation.current) setError((reason as Error).message); }
    finally { if (current === generation.current) setChecking(false); }
  }
  return <div className="research-setup">
    <button disabled={checking} onClick={() => { void check(); }}>{checking ? "Checking setup…" : "Check research setup"}</button>
    <small>Saved-file and interpreter checks only. No notebook code runs.</small>
    {error && <p role="alert">{error}</p>}
    {report && <details open><summary>Setup · {report.python.available ? `Python ${report.python.version}` : "Python unavailable"}</summary>
      <p>Paper, conversation, notebook and editing records are readable. Up to {report.execution.maxConcurrentRuns} local Python {report.execution.maxConcurrentRuns === 1 ? "run" : "runs"} across all windows; one per notebook{report.execution.availableRuns === undefined ? report.execution.busy ? " · currently busy" : "" : ` · ${report.execution.availableRuns} slots available`}.</p>
      <p>Libraries: {Object.entries(report.python.packages).map(([name, version]) => `${name} ${version ?? "not installed"}`).join(" · ") || "not checked"}.</p>
      <ul>{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      <small>Checked {new Date(report.checkedAt).toLocaleTimeString()}. This is a snapshot, not permission to run.</small>
    </details>}
  </div>;
}

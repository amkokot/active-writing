import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

interface Props { model?: string; effort: number; onChange: (model?: string) => void }
export function localModelForEffort(model: string | undefined, effort: number) { return model ?? (effort === 0 ? "qwen3:0.6b" : "qwen3:4b-instruct"); }

export function LocalModelPicker({ model, effort, onChange }: Props) {
  const [models, setModels] = useState<Array<{ name: string; size: number }>>([]);
  const [error, setError] = useState<string>();
  const [runtimeNote, setRuntimeNote] = useState<string>();
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError(undefined);
    try {
      const response = await fetch("/api/paperfocus/local-models"); const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Local helper unavailable.");
      setModels(result.models);
      setRuntimeNote(result.runtimeRunning === false ? result.note : undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }
  async function release() {
    setLoading(true); setError(undefined);
    try { const response = await fetch("/api/paperfocus/local-unload", { method: "POST" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const selected = localModelForEffort(model, effort);
  return <div className="local-model-picker">
    <label>Model on this computer<select aria-label="Local model" value={model ?? "auto"} onChange={(event) => onChange(event.target.value === "auto" ? undefined : event.target.value)}><option value="auto">Auto · {selected}</option>{models.map((item) => <option value={item.name} key={item.name}>{item.name} · {(item.size / 1e9).toFixed(1)} GB</option>)}</select></label>
    <button aria-label="Refresh local models" disabled={loading} onClick={() => void refresh()}><RefreshCw size={13} className={loading ? "spin" : ""} /></button>
    {(loading || error || runtimeNote || !models.some((item) => item.name === selected)) && <small>{loading ? "Checking installed models…" : error ?? runtimeNote ?? "The selected model is not downloaded. Choose an installed model."}</small>}
    <details className="local-runtime-details"><summary>Memory & settings</summary><p>One request at a time. Memory is released after 30 seconds idle. Tiny uses less memory but gives weaker answers; Light uses the writing model.</p><button className="local-release-memory" disabled={loading} onClick={() => void release()}>Free memory</button></details>
  </div>;
}

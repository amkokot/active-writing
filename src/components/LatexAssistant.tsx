import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Cpu,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import type { CompileResult, LatexAssistRoute, LatexDiagnostic } from "../types";
import { thinkingLevels } from "../workspaceTools";
import { LocalModelPicker, localModelForEffort } from "./LocalModelPicker";

interface LatexAssistantProps {
  result?: CompileResult;
  focusTitle: string;
  compiling: boolean;
  onClose: () => void;
  onRecompile: () => void;
  onDispatch: (
    route: Extract<LatexAssistRoute, "chatgpt" | "codex">,
    effort: string,
    packet: string,
  ) => Promise<void>;
}

const routes: Array<{
  id: LatexAssistRoute;
  label: string;
  icon: typeof ShieldCheck;
  detail: string;
}> = [
  { id: "rules", label: "Quick check", icon: ShieldCheck, detail: "instant · offline" },
  { id: "local", label: "On this computer", icon: Cpu, detail: "installed model" },
  { id: "chatgpt", label: "Copy to chat", icon: MessageSquareText, detail: "copy / paste" },
  { id: "codex", label: "Shared folder", icon: Bot, detail: "reply file" },
];

const effortOptions: Record<LatexAssistRoute, string[]> = {
  rules: ["Instant"],
  local: ["Tiny", "Light", "Balanced", "Thorough"],
  chatgpt: thinkingLevels,
  codex: thinkingLevels,
};

function diagnosticPacket(result: CompileResult | undefined, focusTitle: string) {
  const diagnostics = result?.diagnostics ?? [];
  return `# Active Writing · LaTeX help

- Build: ${result?.mode ?? "unknown"}
- Focus: ${focusTitle}
- Result: ${result?.success ? "compiled with diagnostics" : "compile failed"}

## Task

Find the first root cause, propose the smallest Overleaf-safe correction, and preserve all existing commands, labels, citations, and document structure. Inspect project files when needed. Recompile the focused view first, then the full paper if the fix succeeds. Local builds intentionally disable shell escape and project rc execution; do not enable these as an automatic fix. A missing optional external-command feature is not necessarily a manuscript error.

## Structured diagnostics

${diagnostics.length ? diagnostics.map((item) => `- [${item.severity}] ${item.title}${item.file || item.line ? ` (${item.file ?? "file not identified"}${item.line ? `:${item.line}` : ""})` : ""}: ${item.message}`).join("\n") : "No structured diagnostic was extracted. Read the log below."}

## Compile log

\`\`\`text
${(result?.log ?? "No compile log is available.").slice(-12_000)}
\`\`\`
`;
}

function DiagnosticCard({ diagnostic }: { diagnostic: LatexDiagnostic }) {
  return (
    <article className={`latex-diagnostic is-${diagnostic.severity}`}>
      <header>
        {diagnostic.severity === "error" ? (
          <CircleAlert size={15} />
        ) : (
          <TriangleAlert size={15} />
        )}
        <div>
          <strong>{diagnostic.title}</strong>
          <small>
            {diagnostic.file ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""} · ` : diagnostic.line ? `line ${diagnostic.line} (file not identified) · ` : ""}
            {diagnostic.code.replaceAll("_", " ")}
          </small>
        </div>
      </header>
      <p>{diagnostic.message}</p>
      {diagnostic.excerpt && <code>{diagnostic.excerpt}</code>}
      <div className="fix-candidates">
        <span>Suggested checks</span>
        {diagnostic.suggestions.map((suggestion) => (
          <div key={suggestion}><ChevronRight size={12} /><p>{suggestion}</p></div>
        ))}
      </div>
    </article>
  );
}

export function LatexAssistant({
  result,
  focusTitle,
  compiling,
  onClose,
  onRecompile,
  onDispatch,
}: LatexAssistantProps) {
  const [route, setRoute] = useState<LatexAssistRoute>("rules");
  const [effortByRoute, setEffortByRoute] = useState<Record<LatexAssistRoute, number>>({
    rules: 0,
    local: 1,
    chatgpt: 1,
    codex: 1,
  });
  const [running, setRunning] = useState(false);
  const [localAnswer, setLocalAnswer] = useState<string>();
  const [localModel, setLocalModel] = useState<string>();
  const [error, setError] = useState<string>();
  const diagnostics = result?.diagnostics ?? [];
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  const notices = diagnostics.filter((item) => item.severity === "info");
  const packet = useMemo(() => diagnosticPacket(result, focusTitle), [focusTitle, result]);
  const effort = effortOptions[route][effortByRoute[route]] ?? effortOptions[route][0];

  async function runAssistant() {
    setRunning(true);
    setError(undefined);
    try {
      if (route === "chatgpt" || route === "codex") {
        await onDispatch(route, effort, `Requested effort: ${effort}. Choose any suitable model, including a lighter one, in your client. No request has been auto-submitted.\n\n${packet}`);
        return;
      }
      const response = await fetch("/api/paperfocus/latex-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route,
          effort: effort.toLocaleLowerCase(),
          diagnostics,
          log: result?.log,
          model: localModelForEffort(localModel, effortByRoute.local),
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        provider?: string;
        cached?: boolean;
        suggestions?: string[];
      };
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "The assistant did not finish.");
      setLocalAnswer(
        route === "rules"
          ? "Quick checks are listed below."
          : `${payload.provider ?? "Local model"}${payload.cached ? " · cached" : ""}\n\n${payload.suggestions?.join("\n\n") ?? "No suggestion returned."}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="latex-assistant">
      <header className="drawer-heading">
        <TriangleAlert size={17} />
        <div>
          <strong>LaTeX assistant</strong>
          <span>Help with this build</span>
        </div>
        <button aria-label="Close LaTeX assistant" onClick={onClose} type="button"><X size={15} /></button>
      </header>

      <div className="latex-assistant-scroll">
        <div className={`diagnostic-summary ${errors ? "has-errors" : ""}`}>
          {errors ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
          <div>
            <strong>{errors ? `${errors} error${errors === 1 ? "" : "s"}` : "No blocking errors"}</strong>
            <span>{warnings} warning{warnings === 1 ? "" : "s"} · {result?.mode ?? "no"} build</span>
          </div>
          <button disabled={compiling} onClick={onRecompile} type="button">
            <RefreshCw className={compiling ? "spin" : ""} size={13} /> Recheck
          </button>
        </div>

        <div className="assistant-route-grid" aria-label="Get help">
          {routes.map(({ id, label, icon: Icon, detail }) => (
            <button className={route === id ? "is-active" : ""} key={id} onClick={() => setRoute(id)} type="button">
              <Icon size={14} />
              <span><strong>{label}</strong><small>{detail}</small></span>
            </button>
          ))}
        </div>

        <div className="assistant-effort">
          <span>{route === "local" ? "Response length" : route === "rules" ? "Pass" : "Requested effort"}</span>
          <div>
            {effortOptions[route].map((option, index) => (
              <button
                className={effortByRoute[route] === index ? "is-active" : ""}
                key={option}
                onClick={() => setEffortByRoute((current) => ({ ...current, [route]: index }))}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <p className="assistant-route-note">
          {route === "rules" && "Checks common log messages. Free, without a model or network."}
          {route === "local" && "Runs on this computer. Longer advice isn't necessarily more accurate. Check fixes before applying."}
          {route === "chatgpt" && "Copy the log to another chat. Nothing is sent automatically."}
          {route === "codex" && "A coding assistant can return a reply file. Nothing starts automatically, and no file access is granted here."}
        </p>
        {route === "local" && <LocalModelPicker model={localModel} effort={effortByRoute.local} onChange={setLocalModel} />}

        <button className="assistant-run-button" disabled={running || !result} onClick={() => void runAssistant()} type="button">
          {running ? <LoaderCircle className="spin" size={15} /> : route === "rules" ? <ShieldCheck size={15} /> : route === "local" ? <Cpu size={15} /> : route === "chatgpt" ? <MessageSquareText size={15} /> : <Bot size={15} />}
          {route === "rules" ? "Check log" : route === "local" ? "Ask on this computer" : "Copy prompt & continue"}
        </button>

        {error && <p className="assistant-error">{error}</p>}
        {localAnswer && <pre className="assistant-answer">{localAnswer}</pre>}

        <div className="diagnostic-list">
          {diagnostics.length ? (
            <>
              {diagnostics.filter((item) => item.severity !== "info").map((diagnostic) => <DiagnosticCard diagnostic={diagnostic} key={diagnostic.id} />)}
              {notices.length > 0 && <details><summary>Build notices ({notices.length})</summary>{notices.map((diagnostic) => <DiagnosticCard diagnostic={diagnostic} key={diagnostic.id} />)}</details>}
            </>
          ) : (
            <div className="diagnostic-empty">
              <CheckCircle2 size={20} />
              <strong>No warning or error extracted</strong>
              <span>The full log is in the preview.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

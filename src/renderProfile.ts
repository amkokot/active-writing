import type { ProfilerOnRenderCallback } from "react";

// Opt-in development diagnostics only; no text, accounts, remote telemetry or
// production overhead. Values are React render CPU time, not paint/network time.
export const renderProfiling = import.meta.env.DEV && new URLSearchParams(window.location.search).get("profile") === "1";
export const recordRender: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  console.debug("[Active Writing render]", JSON.stringify({ id, phase, actualMs: Number(actualDuration.toFixed(3)), baseMs: Number(baseDuration.toFixed(3)) }));
};

import { Profiler, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./editingFramework.css";
import { recordRender, renderProfiling } from "./renderProfile";
import { initializeWindowRecovery } from "./windowCache";

void initializeWindowRecovery().then(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {renderProfiling ? <Profiler id="app" onRender={recordRender}><App /></Profiler> : <App />}
  </StrictMode>,
));

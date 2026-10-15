import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { latexPlugin } from "./server/latexPlugin";
import { desktopInputs, writeDesktopBuildStamp } from "./scripts/desktopBuild.mjs";

let buildInputs: Awaited<ReturnType<typeof desktopInputs>>;

export default defineConfig({
  // Open editor tabs may still lazily request the previous build's hashed
  // chunks. Keep them available; never force a reload over unsaved drafts.
  build: { emptyOutDir: false },
  // Server-side handlers are loaded with this config; restart Vite after API
  // changes before comparing browser performance against the updated backend.
  plugins: [react(), latexPlugin(process.cwd()), { name: "aw-desktop-build", async buildStart() { buildInputs = await desktopInputs(process.cwd()); }, async writeBundle(options) { await writeDesktopBuildStamp(process.cwd(), options.dir, buildInputs); } }],
  server: {
    host: "127.0.0.1",
    port: 4173,
    watch: { ignored: ["**/.paperfocus/**", "**/problem-lab/**", "**/output/**", "**/tmp/**"] },
  },
});

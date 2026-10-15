import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Use an installed browser's print engine, not a downloaded browser, personal
// profile, shell command, or notebook kernel. Each export has its own profile.
export async function sharingPdfBrowser(excluded = new Set<string>()) {
  const candidates = process.env.AW_PDF_BROWSER ? [process.env.AW_PDF_BROWSER] : process.platform === "win32" ? [
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe")] : []),
  ] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ] : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge"];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || excluded.has(candidate)) continue;
    try { await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch { /* try next installed browser */ }
  }
  throw new Error("PDF sharing needs an installed Chrome or Edge browser. Choose ZIP instead, or set AW_PDF_BROWSER on the Aw host. Nothing is downloaded automatically.");
}

export const sharingPrintCss = `
@page { size: A4; margin: 18mm 17mm; @bottom-right { content: "Page " counter(page); font: 9pt sans-serif; color: #657079; } }
@media print {
  html { scroll-behavior: auto; } body { background: white; font-size: 11pt; line-height: 1.5; }
  header, main, footer { max-width: none; padding: 0; }
  header { margin-bottom: 18pt; } h1 { font-size: 24pt; }
  h2, h3, h4, summary, figcaption { break-after: avoid; }
  nav { display: flex; margin: 0 0 18pt; padding: 8pt 0; }
  footer { display: block; margin-top: 20pt; }
  .conversation { padding: 0; margin: 20pt 0; background: white; border: none; }
  details, .conversation, .cell, .passage, pre { break-inside: auto; }
  summary { font-weight: 600; margin-top: 10pt; list-style: none; }
  summary::marker { content: ''; }
  pre { font-size: 8pt; white-space: pre-wrap; overflow-wrap: anywhere; }
  .table-scroll, .reply-table-scroll, .katex-display { overflow: visible; }
  table { width: 100%; table-layout: fixed; font-size: 8pt; overflow-wrap: anywhere; }
  td, th { padding: 4pt; } thead { display: table-header-group; } tr { break-inside: avoid; }
  figure { break-inside: auto; } img { max-height: 210mm; object-fit: contain; break-inside: avoid; }
  svg { max-height: 120mm; break-inside: avoid; } .contents { columns: 1; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}`;

export function sharingPdfHtml(html: string) {
  // CSS cannot reliably expose closed <details> in print. Expand the actual
  // elements and load all images, including later conversations/sweep frames.
  return html.replace("Manuscript formatting is a reading approximation, not a typeset PDF.", "Manuscript formatting is a reading approximation, not original LaTeX typesetting.")
    .replace("No code runs on opening this page.", "No notebook code was executed for this export.")
    .replace(/<details(?: open)?>/g, "<details open>").replace(/loading="lazy"/g, 'loading="eager"')
    .replace(/<summary>Read notes, replies &amp; experiments<\/summary>|<summary>Read notes, replies & experiments<\/summary>/g, '<summary>Notes, replies &amp; experiments</summary>')
    .replace("</style></head>", `${sharingPrintCss}</style></head>`);
}

export async function renderSharingPdf(html: Buffer) {
  if (html.length > 60_000_000) throw new Error("The reading copy is too large for PDF. Share one conversation or choose ZIP.");
  let browser = await sharingPdfBrowser();
  const folder = await mkdtemp(path.join(os.tmpdir(), "aw-sharing-pdf-")), deadline = Date.now() + 60_000, tried = new Set<string>();
  const input = path.join(folder, "reading.html");
  try {
    await writeFile(input, html);
    for (;;) {
      tried.add(browser);
      const output = path.join(folder, `reading-${tried.size}.pdf`);
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--metrics-recording-only", `--user-data-dir=${path.join(folder, `profile-${tried.size}`)}`, "--no-pdf-header-footer", "--export-tagged-pdf", "--virtual-time-budget=5000", `--print-to-pdf=${output}`, pathToFileURL(input).href], { windowsHide: true, stdio: "ignore" });
          let expired = false;
          const timer = setTimeout(() => {
            expired = true;
            if (process.platform === "win32" && child.pid) {
              // Kill only this export's process tree; never the user's browser.
              const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
              stop.on("error", () => child.kill());
            } else child.kill("SIGKILL");
            reject(new Error("PDF preparation took too long. Share one conversation or choose ZIP."));
          }, Math.max(1, deadline - Date.now()));
          child.once("error", () => { clearTimeout(timer); reject(new Error("The PDF print engine could not start. Choose ZIP or check the installed browser.")); });
          child.once("close", code => { clearTimeout(timer); if (!expired) code === 0 ? resolve() : reject(new Error("The PDF print engine could not finish. Choose ZIP or try a smaller selection.")); });
        });
        const size = await stat(output).then(info => info.size).catch(() => 0);
        if (!size) throw new Error("The print engine exited without producing a PDF. Choose ZIP or check the installed browser.");
        if (size > 100_000_000) throw new Error("The PDF exceeds 100 MB. Share one conversation or choose ZIP.");
        const pdf = await readFile(output);
        if (pdf.length < 100 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("The print engine did not produce a PDF. Choose ZIP or try again.");
        return pdf;
      } catch (error) {
        // An installed updater stub can exit successfully without doing any work.
        // Try another already-installed engine, within the same overall deadline.
        // An explicit override is never silently substituted. No user profile is used.
        if (process.env.AW_PDF_BROWSER || Date.now() >= deadline) throw error;
        try { browser = await sharingPdfBrowser(tried); } catch { throw error; }
      }
    }
  } finally {
    // The exact directory was created above, never a project or shared profile.
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => { /* Windows may briefly retain profile handles. */ });
  }
}

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, CheckCircle2, Copy, ExternalLink, FolderGit2, GitBranch, Github, Link2, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import type { CompileResult, PaperProject, ProjectDocument, RepoStatus, RepositoryAccount } from "../types";
import { prepareProjectUploads, type ProjectUpload } from "../projectFiles";
import { FilePickerButtons, ProjectFiles } from "./ProjectFiles";

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/paperfocus${url}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The operation did not finish.");
  return result as T;
}

interface Props {
  document?: ProjectDocument;
  pendingEdits: number;
  initialAction?: "pull" | "push";
  onSave: () => Promise<ProjectDocument>;
  onBeforeNavigate: () => Promise<string | undefined>;
  onOpenFile: (file: string, raw?: boolean) => void | Promise<void>;
  onSavedDrafts: () => void;
  onActivate: (document: ProjectDocument) => void;
  onCompiled: (result: CompileResult) => void;
  onClose: () => void;
}

const emptyDocument: ProjectDocument = { project: { id: "", name: "", folder: "", mainFile: "", createdAt: "" }, files: [], rootFiles: [], nodes: [], paragraphs: [], revision: "" };

export function RepositoryPanel({ document: selectedDocument, pendingEdits, initialAction, onSave, onBeforeNavigate, onOpenFile, onSavedDrafts, onActivate, onCompiled, onClose }: Props) {
  const document = selectedDocument ?? emptyDocument;
  const [tab, setTab] = useState<"project" | "add" | "publish">(selectedDocument ? "project" : "add");
  const [projects, setProjects] = useState<PaperProject[]>([]);
  const [paperQuery, setPaperQuery] = useState("");
  const [storedStatus, setStoredStatus] = useState<RepoStatus>();
  const [statusProjectId, setStatusProjectId] = useState<string>();
  const status = statusProjectId === document.project.id ? storedStatus : undefined;
  const setStatus = (next: RepoStatus | undefined) => { setStoredStatus(next); setStatusProjectId(document.project.id); };
  const [account, setAccount] = useState<RepositoryAccount>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [folder, setFolder] = useState("");
  const [token, setToken] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [message, setMessage] = useState("Revise manuscript");
  const [visibility, setVisibility] = useState("private");
  const [repos, setRepos] = useState<Array<{ nameWithOwner: string; url: string; isPrivate: boolean; description: string }>>();
  const [login, setLogin] = useState<{ id: string; code?: string; url: string; status: string; message?: string }>();
  const [diff, setDiff] = useState<string>();
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const activeProjectId = useRef(document.project.id);
  activeProjectId.current = document.project.id;
  const refreshSequence = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault(); onClose();
        window.document.querySelector<HTMLButtonElement>(".paper-files-button")?.focus();
      }
      if (event.key !== "Tab") return;
      const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary') ?? [])]
        .filter(element => element.getClientRects().length > 0);
      const edge = event.shiftKey ? controls[0] : controls.at(-1);
      if (edge && (window.document.activeElement === edge || !panelRef.current?.contains(window.document.activeElement))) {
        event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    };
    window.document.addEventListener("keydown", onKey);
    return () => window.document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function refresh() {
    setDiff(undefined);
    const projectId = document.project.id;
    const sequence = ++refreshSequence.current;
    const current = () => projectId === activeProjectId.current && sequence === refreshSequence.current;
    await Promise.allSettled([
      request<{ projects: PaperProject[] }>("/projects").then((result) => { if (current()) setProjects(result.projects); }).catch(reason => { if (current()) setError(reason.message); }),
      (selectedDocument ? request<RepoStatus>(`/git?projectId=${projectId}`).then((result) => {
        if (!current()) return;
        setStatus(result);
        setRemoteName((selected) => result.remotes.some((remote) => remote.name === selected) ? selected : result.remotes[0]?.name ?? "");
      }).catch((reason) => { if (current()) setError(reason.message); }) : Promise.resolve()),
      request<RepositoryAccount>("/github/account").then((result) => { if (current()) setAccount(result); }),
    ]);
  }
  useEffect(() => { setStatus(undefined); setDiff(undefined); setError(undefined); setIdentityName(""); setIdentityEmail(""); void refresh(); }, [document.project.id, document.project.mainFile, document.project.engine]);
  useEffect(() => {
    let live = true, sequence = 0;
    const refreshActivity = () => {
      if (busy || window.document.visibilityState !== "visible") return;
      const current = ++sequence;
      void request<{ projects: PaperProject[] }>("/projects").then(result => {
        if (live && current === sequence) setProjects(result.projects);
      }).catch(() => { /* Keep the existing list if a disk is temporarily unavailable. */ });
    };
    window.addEventListener("focus", refreshActivity);
    return () => { live = false; window.removeEventListener("focus", refreshActivity); };
  }, [busy, document.project.id]);
  useEffect(() => {
    if (!login || login.status !== "waiting") return;
    const timer = window.setInterval(() => {
      void request<typeof login>(`/github/login?id=${login.id}`).then((job) => {
        setLogin(job);
        if (job?.status === "complete") { setNotice("GitHub is connected."); void refresh(); }
      }).catch((reason) => setError(reason.message));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [login?.id, login?.status]);

  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label); setError(undefined); setNotice(undefined);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(undefined); setToken(""); }
  }
  const remote = status?.remotes.find((item) => item.name === remoteName);
  const overleafUrl = /overleaf\.com/.test(url);
  const rootFiles = [...new Set([document.project.mainFile, ...document.rootFiles])];

  async function navigate(body: unknown) {
    const kept = selectedDocument ? await onBeforeNavigate() : undefined;
    const result = await request<{ document: ProjectDocument }>("/projects", body);
    onActivate(result.document); setTab("project");
    setNotice(kept ?? "Paper opened. Choose a file below, or close this panel to write.");
  }

  async function addFiles(files: ProjectUpload[], skipped: number) {
    const saved = await onSave();
    const result = await request<{ document: ProjectDocument }>("/files", { projectId: saved.project.id, revision: saved.revision, mainFile: saved.project.mainFile, files });
    onActivate(result.document);
    setNotice(`${files.length} ${files.length === 1 ? "file added" : "files added"}.${skipped ? ` Skipped ${skipped} local cache/Git files.` : ""} Copy a LaTeX command to reference it in your paper.`);
  }

  const importFiles = (files: File[]) => { void perform("Importing paper…", async () => {
    const uploads = await prepareProjectUploads(files);
    await navigate({ action: "create", name: newName.trim() || files[0]?.webkitRelativePath?.split("/")[0] || "Imported paper", files: uploads.files });
    if (uploads.skipped) setNotice(`Paper imported. Skipped ${uploads.skipped} local cache/Git files.`);
  }); };

  async function verifyAndSave() {
    if (Boolean(identityName.trim()) !== Boolean(identityEmail.trim())) throw new Error("Provide both the commit author name and email, or leave both blank to use your existing Git configuration.");
    const saved = await onSave();
    if (identityName.trim() && identityEmail.trim()) {
      await request("/git", { action: "identity", projectId: saved.project.id, name: identityName.trim(), email: identityEmail.trim() });
    }
    setBusy("Compiling the full paper…");
    const result = await request<CompileResult>("/compile", { projectId: saved.project.id, mode: "full", revision: saved.revision });
    onCompiled(result);
    if (!result.success) throw new Error("The full paper did not compile. Open the LaTeX assistant, correct the error, then retry.");
    return saved;
  }

  async function sync(action: "fetch" | "pull" | "push") {
    if (action === "push") await verifyAndSave();
    if (action === "pull" && pendingEdits) throw new Error("Save and push your edits before pulling; your draft is kept here.");
    setBusy(action === "push" ? "Committing and pushing…" : action === "pull" ? "Pulling collaborator changes…" : "Checking remote…");
    const result = await request<{ status: RepoStatus; document: ProjectDocument }>("/git", {
      action, projectId: document.project.id, remote: remoteName, message, token: token || undefined,
    });
    setStatus(result.status);
    setDiff(undefined);
    if (action === "pull") onActivate(result.document);
    setNotice(action === "pull" ? "Collaborator changes are loaded in your editor." : action === "push" ? "The paper is committed and pushed." : "Remote status refreshed.");
  }

  return (
    <div className="repository-overlay">
      <section className="repository-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="repository-heading">
        <header className="repository-header">
          <div><FolderGit2 size={21} /><span><strong id="repository-heading">Paper & files</strong><small>Create or open a paper. Browse its files here.</small></span></div>
          <button className="icon-button" aria-label="Close Paper & files" disabled={Boolean(busy)} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="repository-layout">
          <aside className="repository-sidebar">
            <span className="repository-caption" title="Recently active first, including file edits outside Aw">1 · Choose a paper</span>
            <input className="paper-search" aria-label="Find a paper" placeholder="Find a paper…" autoFocus value={paperQuery} onChange={event => setPaperQuery(event.target.value)} />
            <button disabled={Boolean(busy)} className={tab === "add" ? "is-active" : ""} onClick={() => setTab("add")}><Plus size={15} /><span>New / open project</span></button>
            {projects.filter(project => `${project.name} ${project.folder}`.toLowerCase().includes(paperQuery.trim().toLowerCase())).map((project) => (
              <button key={project.id} aria-pressed={project.id === document.project.id && tab === "project"} disabled={Boolean(busy)} className={project.id === document.project.id && tab === "project" ? "is-active" : ""} onClick={() => void perform("Opening paper…", async () => {
                await navigate({ action: "select", projectId: project.id });
              })}>
                <FolderGit2 size={15} /><span>{project.name}<small>{project.mainFile}</small></span>
              </button>
            ))}
            <div className="repository-account">
              <Github size={18} />
              <strong>{account?.authenticated ? account.login : "GitHub account"}</strong>
              <small>{account?.authenticated ? "Connected through GitHub CLI" : account?.message ?? "Checking connection…"}</small>
              {!account?.authenticated && account?.installed && <button disabled={Boolean(busy)} onClick={() => void perform("Starting sign-in…", async () => { setLogin(await request("/github/login", {})); })}>Sign in to GitHub</button>}
              {account && !account.installed && <a href="https://cli.github.com/" target="_blank" rel="noreferrer">Get GitHub CLI <ExternalLink size={11} /></a>}
              {login?.status === "waiting" && <div className="github-device-login">
                <span>Enter this code on GitHub:</span>
                <code>{login.code ?? "Preparing code…"}</code>
                {login.code && <button onClick={() => void navigator.clipboard.writeText(login.code!)}><Copy size={12} /> Copy code</button>}
                <a href={login.url} target="_blank" rel="noreferrer">Continue sign-in <ExternalLink size={11} /></a>
              </div>}
              {login?.status === "failed" && <small>{login.message}</small>}
            </div>
          </aside>

          <main className="repository-content">
            {tab === "project" && <>
              <div className="repository-title"><div><span className="repository-caption">Current paper</span><h2>{document.project.name}</h2><p>{document.project.folder}</p></div></div>
              <div className="repository-settings"><label className="repository-label">Main LaTeX file
                <select value={document.project.mainFile} disabled={Boolean(busy)} onChange={(event) => void perform("Changing main file…", async () => {
                  await navigate({ action: "select", projectId: document.project.id, mainFile: event.target.value });
                })}>{rootFiles.map((file) => <option key={file}>{file}</option>)}</select>
              </label>
              <label className="repository-label">Compiler
                <select value={document.project.engine ?? "pdflatex"} disabled={Boolean(busy)} onChange={(event) => void perform("Changing compiler…", async () => {
                  await navigate({ action: "select", projectId: document.project.id, engine: event.target.value });
                })}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></select>
              </label></div>
              <p className="repository-hint">Use the same main file and compiler as Overleaf. These settings stay on this computer.</p>
              <ProjectFiles key={document.project.id} document={document} busy={Boolean(busy)} onOpenFile={onOpenFile} onAdd={addFiles} perform={perform} />
              <div className="repository-section-heading"><button disabled={Boolean(busy)} onClick={onSavedDrafts}>Source changes & drafts</button></div>
              <details className="repository-sync-details" open={initialAction ? true : undefined}><summary>GitHub / Overleaf sync & settings</summary>
              <div className="repo-summary"><span><GitBranch size={14} /> {status ? status.branch ?? "Local folder" : "Checking…"}</span><span>{status?.changes.length ?? 0} changed files</span><span>{pendingEdits} unsaved passages</span><span>{remote ? remote.ahead ?? "—" : status?.ahead ?? 0} ahead · {remote ? remote.behind ?? "—" : status?.behind ?? 0} behind</span></div>
              {(status?.conflicts.length ?? 0) > 0 && <div className="repository-error">Conflicts: {status?.conflicts.join(", ")}</div>}
              <div className="repository-section-heading"><h3>Connections</h3>{!status?.remotes.some((item) => item.provider === "github") && <button disabled={Boolean(busy) || !status} onClick={() => { setTab("publish"); setName(document.project.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")); }}>Publish to GitHub <ArrowUpFromLine size={13} /></button>}</div>
              {status?.remotes.length ? <>
                <div className="remote-cards">{status.remotes.map((item) => <button key={item.name} disabled={Boolean(busy)} className={remoteName === item.name ? "is-active" : ""} onClick={() => setRemoteName(item.name)}>
                  {item.provider === "github" ? <Github size={18} /> : <Link2 size={18} />}<span><strong>{item.provider === "github" ? "GitHub" : item.provider === "overleaf" ? "Overleaf" : "Git remote"} · {item.name}</strong><small>{item.url}</small></span>{remoteName === item.name && <Check size={16} />}
                </button>)}</div>
                {remote?.provider === "overleaf" && <label className="repository-label">Overleaf Git token <small>Optional if Git already has your credential. Used only for this operation.</small><input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Git authentication token" /></label>}
                <label className="repository-label">Commit message<input value={message} onChange={(event) => setMessage(event.target.value)} /></label>
                <div className="repository-sync-actions">
                  <button disabled={Boolean(busy)} className="secondary-button" onClick={() => void perform("Checking remote…", () => sync("fetch"))}><RefreshCw size={14} /> Check remote</button>
                  <button disabled={Boolean(busy)} className={initialAction === "pull" ? "primary-button" : "secondary-button"} onClick={() => void perform("Pulling…", () => sync("pull"))}><ArrowDownToLine size={14} /> Pull & reload</button>
                  <button disabled={Boolean(busy) || !message.trim()} className="primary-button" onClick={() => void perform("Saving paper…", () => sync("push"))}><ArrowUpFromLine size={14} /> Save, compile & push</button>
                </div>
                <p className="repository-hint">Push saves the source, compiles the full paper, commits your changes, and sends them to the selected remote. Pull keeps local work intact and stops if a merge is needed.</p>
              </> : <p className="repository-empty">{status ? "This paper is local. Publish it to GitHub or connect an existing remote below." : "Checking repository connections…"}</p>}
              <details className="repository-connect"><summary><Link2 size={14} /> Connect another GitHub / Overleaf remote</summary>
                <label className="repository-label">Repository or Overleaf project URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/paper or Overleaf project URL" /></label>
                <button disabled={!url.trim() || Boolean(busy)} className="secondary-button" onClick={() => void perform("Connecting remote…", async () => {
                  const result = await request<{ status: RepoStatus }>("/git", { action: "connect", projectId: document.project.id, url }); setStatus(result.status); setRemoteName(result.status.remotes.at(-1)?.name ?? ""); setNotice("Remote connected. Pull or push when ready."); setUrl("");
                })}>Connect remote</button>
              </details>
              <div className="repository-section-heading"><h3>Changes to publish</h3><button disabled={!status?.initialized} onClick={() => void perform("Loading changes…", async () => { const result = await request<{ diff: string }>(`/git/diff?projectId=${document.project.id}`); setDiff(result.diff); })}>Review changes</button></div>
              <div className="repo-file-list">{status?.changes.map((item) => <div key={item.path}><code>{item.status}</code><span>{item.path}</span></div>)}{!status?.changes.length && <p>No disk changes. Editor drafts are saved before push.</p>}</div>
              {diff !== undefined && <pre className="repository-diff">{diff || "No tracked source differences."}</pre>}
              <details className="repository-identity"><summary>Commit author (if Git has not been configured)</summary><label className="repository-label">Name<input value={identityName} onChange={(event) => setIdentityName(event.target.value)} autoComplete="name" /></label><label className="repository-label">Email<input type="email" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} autoComplete="email" /></label><p className="repository-hint">Saved only in this paper’s Git configuration.</p></details>
              <details className="repository-connect"><summary>Link this paper with Overleaf</summary><p className="repository-hint">For a GitHub-linked project, use “Import from GitHub” in Overleaf once. Overleaf’s GitHub sync is manual: after an app push, choose Pull GitHub changes in Overleaf. For direct app ↔ Overleaf sync, add the project’s Git URL above.</p><a href="https://www.overleaf.com/project" target="_blank" rel="noreferrer">Open Overleaf <ExternalLink size={12} /></a><p className="repository-hint">Overleaf Git/GitHub integration requires Overleaf premium access. Git moves source files; comments and tracked changes are managed in Overleaf.</p></details>
              </details>
            </>}

            {tab === "add" && <>
              <h2>New / open project</h2>
              <label className="repository-label">New paper name<input value={newName} onChange={event => setNewName(event.target.value)} placeholder="My paper" maxLength={100} /></label>
              <div className="project-import-actions"><button className="primary-button" disabled={Boolean(busy)} onClick={() => void perform("Creating paper…", async () => { await navigate({ action: "create", name: newName.trim() || "Untitled paper" }); })}><Plus size={15} />New project</button><FilePickerButtons disabled={Boolean(busy)} onPick={importFiles} fileLabel="Import files" folderLabel="Import folder" /></div>
              <p className="repository-hint">New project starts with main.tex. Import copies a whole paper, including figures and subfolders, into this workspace. Nothing is uploaded.</p>
              <div className="repository-divider">or copy from GitHub / Overleaf</div>
              <label className="repository-label">Repository URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="owner/paper or https://github.com/owner/paper" /></label>
              <label className="repository-label">Paper name <small>Optional</small><input value={name} onChange={(event) => setName(event.target.value)} placeholder="My paper" /></label>
              {overleafUrl && <label className="repository-label">Overleaf Git token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /><small>Token from Overleaf Account Settings. It is cleared after this operation.</small></label>}
              <button className="primary-button" disabled={!url.trim() || Boolean(busy)} onClick={() => void perform("Copying and opening paper…", async () => {
                await navigate({ action: "clone", url, name, token: token || undefined }); setUrl("");
              })}><FolderGit2 size={15} /> Copy & open paper</button>
              <div className="repository-divider">or choose from your GitHub account</div>
              <button className="secondary-button" disabled={!account?.authenticated || Boolean(busy)} onClick={() => void perform("Loading GitHub repositories…", async () => { setRepos(await request("/github/repos")); })}><Github size={15} /> Browse my repositories</button>
              {repos && <div className="github-repo-list">{repos.map((repo) => <button key={repo.nameWithOwner} onClick={() => { setUrl(repo.url); setName(repo.nameWithOwner.split("/").at(-1) ?? ""); }}><strong>{repo.nameWithOwner}<small>{repo.isPrivate ? "Private" : "Public"}</small></strong><span>{repo.description}</span></button>)}{!repos.length && <p>No repositories returned for this account.</p>}</div>}
              <div className="repository-divider">or open an existing local paper</div>
              <label className="repository-label">Folder inside this workspace<input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="papers/my-manuscript" /></label>
              <button className="secondary-button" disabled={!folder.trim() || Boolean(busy)} onClick={() => void perform("Opening local paper…", async () => {
                await navigate({ action: "open", folder });
              })}><FolderGit2 size={15} /> Open folder</button>
            </>}

            {tab === "publish" && <>
              <span className="repository-caption">This computer → GitHub</span><h2>Publish {document.project.name}</h2><p className="repository-intro">Create a repository from this local paper and connect it for future sync. Private is selected by default.</p>
              <label className="repository-label">GitHub repository name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="my-paper or organization/my-paper" /></label>
              <label className="repository-label">Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">Private · only invited collaborators</option><option value="public">Public · anyone can read the paper</option></select></label>
              <label className="repository-label">First commit message<input value={message} onChange={(event) => setMessage(event.target.value)} /></label>
              <details className="repository-connect"><summary>Review the paper folder before publishing ({document.files.length} files)</summary><p className="repository-hint">Git publishes the paper folder, including already tracked files. Local build/cache files are excluded. Check that it contains no credentials or private notes you do not want to share.</p><div className="repo-file-list">{document.files.map((file) => <div key={file}><span>{file}</span></div>)}</div></details>
              <details className="repository-identity"><summary>Commit author (if Git has not been configured)</summary><label className="repository-label">Name<input value={identityName} onChange={(event) => setIdentityName(event.target.value)} autoComplete="name" /></label><label className="repository-label">Email<input type="email" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} autoComplete="email" /></label><p className="repository-hint">Saved only in this paper’s Git configuration.</p></details>
              <div className="publish-review"><CheckCircle2 size={18} /><span>The app will save and compile the paper, commit its source files, create <strong>{name || "your repository"}</strong> as <strong>{visibility}</strong>, and push the first revision.</span></div>
              <button className="primary-button" disabled={!name.trim() || !account?.authenticated || Boolean(busy)} onClick={() => void perform("Preparing paper…", async () => {
                const saved = await verifyAndSave(); setBusy("Creating GitHub repository…");
                const result = await request<{ status: RepoStatus }>("/github/publish", { projectId: saved.project.id, name, visibility, message }); setStatus(result.status); setRemoteName(result.status.remotes.find((item) => item.provider === "github")?.name ?? ""); setTab("project"); setNotice("GitHub repository created and paper published.");
              })}><Github size={15} /> Create {visibility} repository & push</button>
              {!account?.authenticated && <p className="repository-hint">Sign in using the GitHub account control on the left first.</p>}
            </>}

            {busy && <div className="repository-progress" role="status"><LoaderCircle className="spin" size={16} /> {busy}</div>}
            {error && <div className="repository-error" role="alert">{error}</div>}
            {notice && <div className="repository-notice" role="status"><CheckCircle2 size={16} /> {notice}</div>}
          </main>
        </div>
      </section>
    </div>
  );
}

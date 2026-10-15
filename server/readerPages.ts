import { createHash } from "node:crypto";

export type ReaderFile = { name: string; data: Buffer };
const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
export function repositoryLink(value?: string) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) throw new Error("Use a GitHub repository URL without credentials, query or fragment.");
  return url.href.replace(/\/$/, "");
}
/** Generated links never send a collaborator to localhost or the author's files. */
export function portableReaderLinks(html: string, localFiles = false, resolve?: (url: string) => string | undefined) {
  return html.replace(/<a\b([^>]*?)href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (all, before, href, after, text) => {
    const decoded = href.replaceAll("&amp;", "&");
    const resolved = localFiles ? resolve?.(decoded) : undefined;
    if (resolved) return `<a${before.replace(/\s+target="[^"]*"/g, "")}href="${escape(resolved)}"${after.replace(/\s+target="[^"]*"/g, "")}>${text}</a>`;
    if (decoded.startsWith("#")) return all;
    if (localFiles && /^(?:notebooks\/[\w.-]+\.ipynb|figures\/[\w.-]+\.png|notes\/note-\d+\.html|(?:index|reading)\.html|overview\.pdf|reader\.zip|(?:manuscript|notebook)\.md)(?:#[\w.-]+)?$/.test(decoded)) return all;
    try {
      const url = new URL(decoded);
      if (url.protocol === "https:" && !url.username && !url.password && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.searchParams.has("awProject")) return `<a${before}href="${escape(url.href)}"${after} rel="noreferrer">${text}</a>`;
    } catch { /* relative project, file and Aw links become ordinary readable text */ }
    return `<span>${text}</span>`;
  });
}
/** Editable reading companions must not retain localhost/private Aw URLs either. */
export function portableReadingMarkdown(text: string) {
  const remote = (href: string) => {
    try { const url = new URL(href); return url.protocol === "https:" && !url.username && !url.password && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.searchParams.has("awProject"); } catch { return false; }
  };
  return text.replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, (_, href, label) => remote(href) ? `[${label}](${href})` : label)
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (all, label, href) => remote(href) || href.startsWith("#") ? all : label)
    .replace(/(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])[^\s<>"}]*|file:\/\/[^\s<>"}]*|https?:\/\/[^\s<>"}]*[?&]awProject=[^\s<>"}]*)/g, "[local reference omitted]");
}
export function overviewBody(title: string, summary: string, resources: Array<{ title: string; href?: string; detail: string }>, repo?: string) {
  return `<header><span class="brand">Aw · project overview</span><h1>${escape(title)}</h1><p class="muted">Selected reading material. Saved snapshot, not a live workspace.</p></header><main><section>${summary || "<p>No overview selected. The material below is ready for review.</p>"}</section><section><h2>Read further</h2><ul>${resources.map(r => `<li>${r.href ? `<a href="${escape(r.href)}">${escape(r.title)}</a>` : `<strong>${escape(r.title)}</strong>`}<p class="muted">${escape(r.detail)}</p></li>`).join("")}</ul>${repo ? `<p><a href="${escape(repo)}" rel="noreferrer">Collaborate in the repository</a> · repository access may be required.</p>` : ""}</section></main><footer>Research notes and numerical results may be provisional. This copy contains no editable Aw session and runs no notebook code.</footer>`;
}
/** Share one stylesheet/font/image set instead of multiplying base64 assets in Overleaf. */
export function compactReaderFiles(pages: ReaderFile[]) {
  const assets = new Map<string, ReaderFile>();
  const externalize = (html: string, prefix: string) => html.replace(/data:(image\/(?:png|jpeg|webp|gif)|font\/(?:woff2?|ttf));base64,([A-Za-z0-9+/=]+)/g, (_, mime, encoded) => {
    const bytes = Buffer.from(encoded, "base64"), ext = mime.split("/")[1], name = `assets/${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${ext}`;
    assets.set(name, { name, data: bytes }); return `${prefix}${name}`;
  });
  const files = pages.map(file => {
    if (!file.name.endsWith(".html")) return file;
    const prefix = file.name.startsWith("notes/") ? "../" : "";
    // Modern browsers use woff2; redundant fallback fonts only add repo weight.
    let html = file.data.toString().replace(/,url\(data:font\/(?:woff|ttf);base64,[A-Za-z0-9+/=]+\) format\("(?:woff|truetype)"\)/g, "");
    html = externalize(html, prefix).replace(/font-src data:/g, "font-src 'self' data:").replace(/img-src data:/g, "img-src 'self' data:");
    return { name: file.name, data: Buffer.from(html) };
  });
  return [...files, ...assets.values()];
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { markdownMath, ReplyMarkdown, replyLink } from "../src/replyMarkdown.ts";
import { latexReading, readingReferences } from "../src/latexReading.ts";
import { latexHeadings, latexStructure, manuscriptContents } from "../src/latexStructure.ts";
import { mathParts } from "../src/mathText.ts";
import type { ManuscriptNode, Paragraph } from "../src/types.ts";
import { latexEvidenceLink, compactAwReference } from "../src/researchLinks.ts";
import { referenceTokens } from "../src/references.ts";
import { readingFigures, type ReadingFigureContext } from "../src/readingFigures.ts";

const render = (text: string) => renderToStaticMarkup(createElement(ReplyMarkdown, { text }));

test("equation environments render locally, retain tags, remove display labels and never guess numbering", () => {
  for (const environment of ["equation", "equation*", "align", "align*", "alignat", "gather", "gather*", "multline", "eqnarray", "flalign", "displaymath", "math", "aligned", "gathered", "split", "cases", "pmatrix", "array"]) {
    const body = environment === "alignat" ? String.raw`{2}x&=1&y&=2` : environment === "array" ? String.raw`{rr}1&2\\3&4` : ["align", "align*", "eqnarray", "flalign", "aligned", "split", "cases"].includes(environment) ? String.raw`x&=1\\y&=2` : String.raw`x=\frac{1}{2}`;
    const text = `Before.\n\n\\begin{${environment}}${body}\\label{eq:test}\\end{${environment}}\n\nAfter.`;
    const html = render(text);
    assert.match(html, /class="katex"/, environment); assert.doesNotMatch(html, /katex-error|reading-math-source|eqn-num|\\label/, environment);
    assert.match(html, /Before\./); assert.match(html, /After\./);
    const part = mathParts(text).find(p => p.math)!; assert.equal(text.slice(part.start, part.end), `\\begin{${environment}}${body}\\label{eq:test}\\end{${environment}}`);
    assert.equal(Boolean(part.display), environment !== "math");
  }
  const tagged = render(String.raw`\begin{equation}x=1\tag{A}\end{equation}`);
  assert.match(tagged, /class="katex-tag"/); assert.match(tagged, /<mtext>\(A\)<\/mtext>/);
  assert.doesNotMatch(render(String.raw`\[\begin{cases}x&x>0\\0&x\le0\end{cases}\label{eq:c}\]`), /reading-math-source/);
});

test("unfinished and unsupported snippets cannot break neighboring equations or activate code/comments", () => {
  const incomplete = String.raw`\begin{equation}x=1`;
  assert.equal(markdownMath(incomplete), incomplete);
  const code = "```tex\n\\begin{equation}x=1\\end{equation}\n\\newpage\n```";
  assert.equal(markdownMath(code), code); assert.equal(latexStructure(code), code);
  const html = render(String.raw`\begin{equation}\unknownmacro{x}\end{equation}`+"\n\nGood $y=2$.\n\n"+code);
  assert.match(html, /reading-math-source/); assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
  const commented = "\\begin{equation}x=1 % \\end{equation}\n+y\\end{equation}";
  assert.equal(mathParts(commented).filter(p => p.math).length, 1); assert.match(markdownMath(commented), /x=1 \n\+y/);
  assert.equal(latexHeadings("% \\part{Ignored}\n`\\chapter{Code}`\n$\\text{\\section{Math}}$").length, 0);
});

test("structural commands make headings, contents, page separators and ordinary lists readable", () => {
  const text = String.raw`\tableofcontents
\part[Short]{Foundations}
Some prose.
\newpage
\chapter{Setup}
\section{Main result}
\subsection{Details}
\pagebreak[3]
\begin{enumerate}
\item First $x=1$.
\item Second.
\end{enumerate}
\begin{itemize}
\item[Note] Important.
\end{itemize}
\begin{quote}A qualification.\end{quote}
\clearpage
More prose.`;
  const html = render(text);
  for (const match of [/<h1>Foundations<\/h1>/, /<h2>Setup<\/h2>/, /<h3>Main result<\/h3>/, /<h4>Details<\/h4>/, /Contents/, /<ol>/, /<ul>/, /<strong>Note<\/strong>/, /A qualification\./]) assert.match(html, match);
  assert.equal((html.match(/<hr\/>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /\\tableofcontents|\\newpage|\\part|\\chapter|\\pagebreak|\\item|\\begin/);
  assert.equal(latexStructure(String.raw`Still typing \part{Unclosed`), String.raw`Still typing \part{Unclosed`);
  assert.equal(latexStructure(String.raw`\begin{custom}Not guessed.\end{custom}`), String.raw`\begin{custom}Not guessed.\end{custom}`);
});

test("manuscript contents use all document headings and exact navigation IDs, not just a focused subset", () => {
  const nodes: ManuscriptNode[] = [
    { id: "document", title: "Document", kind: "section", depth: 0, paragraphIds: ["toc", "part"] },
    { id: "s", title: "Result", kind: "section", depth: 0, paragraphIds: ["body"], sourceOpening: { file: "main.tex", start: 0, end: 16, text: String.raw`\section{Result}` } },
    { id: "star", title: "Acknowledgments", kind: "section", depth: 0, paragraphIds: ["thanks"], sourceOpening: { file: "main.tex", start: 20, end: 48, text: String.raw`\section*{Acknowledgments}` } },
  ];
  const paragraphs: Paragraph[] = [{ id: "toc", nodeId: "document", text: String.raw`\tableofcontents` }, { id: "part", nodeId: "document", text: String.raw`\part{Foundations}` }, { id: "body", nodeId: "s", text: "Result text." }, { id: "thanks", nodeId: "star", text: "Thanks." }];
  const contents = manuscriptContents(nodes, paragraphs, {});
  assert.deepEqual(contents.map(h => [h.title, h.paragraphId]), [["Foundations", "part"], ["Result", "body"]]);
  const html = renderToStaticMarkup(createElement(ReplyMarkdown, { text: String.raw`\tableofcontents`, contents, onHeading: () => {} }));
  assert.match(html, /href="#aw-reading-heading-s"/); assert.match(html, /href="#aw-reading-heading-part%3A0"/);
  assert.doesNotMatch(html, /Acknowledgments|No headings/);
  assert.equal(manuscriptContents(nodes, paragraphs, { part: String.raw`\part{New wording}` })[0].title, "New wording");
});

test("reading references retain exact original tokens and leave code, URLs and math alone", () => {
  const text = String.raw`See \eqref{eq:one}, \ref{sec:two}, \cite[Theorem 3]{paper} and \hyperref[sec:two]{this section}. $\ref{math}$ and `+"`\\ref{code}`";
  const adapted = readingReferences(text);
  assert.equal(adapted.references.size, 4);
  for (const token of adapted.references.values()) assert.equal(text.slice(token.start, token.end), token.raw);
  assert.match(adapted.text, /\$\\ref\{math\}\$/); assert.match(adapted.text, /`\\ref\{code\}`/);
  const html = renderToStaticMarkup(createElement(ReplyMarkdown, { text, onReference: () => {} }));
  assert.match(html, /href="#aw-reading-reference-0"/); assert.match(html, /this section/);
});

test("LaTeX prose links render nested labels, escapes and formatting without altering source", () => {
  const text = String.raw`See \href{https://example.org/a_(b)?x=1\&y=2\#part}{\textbf{Read this} and $x_1$} or \url{https://example.org/a_(b)}. \emph{A caveat} and \texttt{a_b}.`;
  const html = render(text);
  assert.match(html, /href="https:\/\/example.org\/a_\(b\)\?x=1&amp;y=2#part"/);
  assert.match(html, /<strong>Read this<\/strong>/); assert.match(html, /class="katex"/);
  assert.match(html, /<em>A caveat<\/em>/); assert.match(html, /<code>a_b<\/code>/);
  assert.doesNotMatch(html, /\\href|\\url|\\textbf|\\emph|\\texttt/);
  assert.ok(text.includes(String.raw`\&y=2`));
});

test("link/format adapters leave code and math literal and refuse unsafe destinations", () => {
  const code = String.raw`\href{https://example.org}{unchanged}`;
  assert.equal(latexReading("```tex\n"+code+"\n```"), "```tex\n"+code+"\n```");
  assert.equal(latexReading("`"+code+"`"), "`"+code+"`");
  assert.equal(latexReading("$"+code+"$"), "$"+code+"$");
  const html = render(String.raw`\href{javascript:alert(1)}{No execution} \href{file:///private}{No file} \href{https://user:pass@example.org}{No credentials} \href{https://example.org}{<script>alert(1)</script>}`);
  assert.doesNotMatch(html, /href="javascript:|href="file:|href="https:\/\/user:|<script>/);
  assert.match(html, /No execution/); assert.match(html, /No file/);
  assert.equal(latexReading(String.raw`An incomplete \href{https://example.org}{still typing`), String.raw`An incomplete \href{https://example.org}{still typing`);
});

test("Aw link folding is a display label only, preserves offsets, and exported LaTeX stays standard", () => {
  const url = "http://127.0.0.1:4173/?awProject=paper&awPanel=notebook&awNotebook=conversation&awCell=cell&awEvidence="+"a".repeat(64)+"&awFormat=reading";
  const source = latexEvidenceLink(url, "Evidence & checks"), token = referenceTokens(source)[0];
  assert.equal(compactAwReference(token), String.raw`\href{[Aw notebook]}{Evidence \& checks}`);
  assert.equal(token.raw, source); assert.equal(token.end, source.length);
  assert.match(render(source), /href="http:\/\/127.0.0.1:4173\/\?awProject=paper&amp;awPanel=notebook/);
  assert.doesNotMatch(render(source), /\\href|\\&/);
  assert.match(source, /^\\href\{/); assert.doesNotMatch(source, /\\aw|\[Aw notebook\]/);
  for (const value of [source.replace("127.0.0.1", "example.org"), String.raw`\href{javascript:alert(1)}{No}`, String.raw`\ref{label}`]) assert.equal(compactAwReference(referenceTokens(value)[0]), undefined);
});

test("chat Copy-button Markdown renders headings, emphasis, lists, tables, quotes and fenced code", () => {
  const copied = "## **Result**\r\n\r\nA **useful** bound and *caveat*, with `literal $x$`.\r\n\r\n- First\r\n- Second\r\n\r\n1. Check\r\n2. Compare\r\n\r\n> Unverified.\r\n\r\n| Case | Error |\r\n| --- | --- |\r\n| A | 0.01 |\r\n\r\n```python\r\nprint('$not_math$')\r\n```\r\n";
  const html = render(copied);
  for (const markup of ["<h2><strong>Result</strong></h2>", "<strong>useful</strong>", "<em>caveat</em>", "<ul>", "<ol>", "<blockquote>", "<table>", "<th>Case</th>", "language-python", "<code>literal $x$</code>"]) assert.ok(html.includes(markup), markup);
  assert.ok(!html.includes('class="katex"'), "code keeps literal dollars");
  assert.ok(copied.endsWith("\r\n"), "display does not mutate exact source");
});

test("both common web-chat TeX delimiters and dollar math render without interpreting fenced/inline code", () => {
  const copied = "Inline \\(x_1\\) and $y^2$.\n\n\\[\nc_\\varepsilon = \\frac{4ab}{\\sqrt{\\varepsilon^2+16ab}+\\varepsilon}\n\\]\n\n$$z=2$$\n\n`\\(literal\\)`\n\n```tex\n\\[not math\\]\n```";
  const adapted = markdownMath(copied); const html = render(copied);
  assert.match(adapted, /\$x_1\$/); assert.ok(adapted.includes("`\\(literal\\)`"));
  assert.ok(adapted.includes("```tex\n\\[not math\\]\n```"));
  assert.equal((html.match(/class="katex"/g) ?? []).length, 4);
  assert.equal((html.match(/class="study-math-display"/g) ?? []).length, 2);
  assert.match(html, /data-latex="\$x_1\$"/); assert.match(html, /language-tex/);
});

test("pasted HTML, executable links, images and dangerous math cannot activate untrusted content", () => {
  const html = render('<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>\n\n[bad](javascript:alert%281%29) ![remote](https://example.com/pixel.png)\n\n$\\href{javascript:alert(1)}{click}$');
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<iframe")); assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:')); assert.match(html, /Image not loaded: remote/);
  for (const url of ["javascript:alert(1)", "data:text/html,evil", "file:///secret", "https://user:pass@example.com"]) assert.equal(replyLink(url), "");
  assert.equal(replyLink("https://arxiv.org/abs/2006.02572"), "https://arxiv.org/abs/2006.02572");
  assert.equal(replyLink("#result"), "#result");
  assert.match(render("[paper](https://arxiv.org/abs/2006.02572)"), /rel="noopener noreferrer"/);
});

const figureContext: ReadingFigureContext = { projectId: "paper & one", revision: "saved-revision", files: ["main.tex", "figures/plot.png", "figures/two panels.jpg", "figures/vector.pdf"] };
const renderFigure = (text: string) => renderToStaticMarkup(createElement(ReplyMarkdown, { text, figureContext }));

test("reported LaTeX figure renders a scoped image and readable caption without changing source", () => {
  const text = String.raw`Before.
\begin{figure}[htbp]
\centering
\includegraphics[width=\linewidth]{figures/plot.png}
\caption[Short]{Saved \textbf{comparison}, with $x=1$ and \href{https://example.org}{evidence}.}
\label{fig:plot}
\end{figure}
After.`;
  const html = renderFigure(text);
  assert.match(html, /<img src="\/api\/paperfocus\/files\/content\?projectId=paper\+%26\+one&amp;file=figures%2Fplot.png&amp;revision=saved-revision"/);
  assert.match(html, /style="width:100%"/); assert.match(html, /loading="lazy"/);
  assert.match(html, /<strong>comparison<\/strong>/); assert.match(html, /class="katex"/); assert.match(html, /href="https:\/\/example.org\/"/);
  assert.match(html, /Before\./); assert.match(html, /After\./);
  assert.doesNotMatch(html, /\\begin\{figure\}|\\includegraphics|\\caption|\\centering|\\label|\\end\{figure\}/);
  assert.ok(text.includes(String.raw`\includegraphics[width=\linewidth]{figures/plot.png}`));
  assert.ok(!render(text).includes("<img"), "ordinary imported replies have no project image capability");
});

test("literal extensionless and spaced figures resolve only within the given project catalogue", () => {
  const html = renderFigure(String.raw`\includegraphics*[width=.5\textwidth]{./figures/plot} \includegraphics{figures/two panels.jpg}`);
  assert.equal((html.match(/<img /g) ?? []).length, 2);
  assert.match(html, /style="width:50%"/); assert.match(html, /file=figures%2Ftwo\+panels.jpg/);
  assert.match(renderFigure(String.raw`\includegraphics{figures/vector.pdf}`), /Open PDF figure: figures\/vector.pdf/);
  assert.match(renderFigure(String.raw`\includegraphics{plot.png}`), /Figure unavailable/);
  assert.ok(!renderFigure(String.raw`\includegraphics{missing.png}`).includes("<img"));
});

test("figure adaptation never executes macros, traversal, remote images, code, comments or math", () => {
  for (const path of ["https://example.org/pixel.png", "//example.org/pixel.png", "../figures/plot.png", "C:/secret.png", String.raw`\figuremacro`, "figures/../plot.png", "data:image/png,abc", "figures/vector.svg"]) {
    const html = renderFigure(`\\includegraphics{${path}}`);
    assert.doesNotMatch(html, /<img |src="https:|href="file:|src="data:/); assert.match(html, /Figure unavailable/);
  }
  for (const text of ["`\\includegraphics{figures/plot.png}`", "```tex\n\\includegraphics{figures/plot.png}\n```", "$\\text{\\includegraphics{figures/plot.png}}$", "% \\includegraphics{figures/plot.png}", String.raw`\\includegraphics{figures/plot.png}`]) {
    assert.equal(readingFigures(text, figureContext).text, text); assert.equal(readingFigures(text, figureContext).figures.size, 0);
  }
  assert.doesNotMatch(renderFigure('![remote](https://example.org/pixel.png)\n\n<img src="https://example.org/pixel.png">'), /<img /);
  assert.equal(readingFigures(String.raw`\includegraphics[width=unfinished`, figureContext).text, String.raw`\includegraphics[width=unfinished`);
  assert.doesNotMatch(renderFigure(String.raw`\includegraphics[width=url(evil)]{figures/plot.png}`), /style=/);
});

test("full reading mode supports cross-section reference links and footnotes, with plain text preserved", () => {
  const html = render("## Result\nSee [the paper][paper] and note.[^1]\n\n## References\n[paper]: https://arxiv.org/abs/2006.02572\n[^1]: Not verified.\n");
  assert.match(html, /href="https:\/\/arxiv.org\/abs\/2006.02572"/);
  assert.match(html, /data-footnotes/); assert.match(html, /Not verified/);
  assert.match(render("Unformatted answer.\n\nSecond paragraph."), /<p>Second paragraph\.<\/p>/);
});
test("full long replies adapt every TeX equation while later code fences remain literal", () => {
  const copied = Array.from({ length: 280 }, (_, i) => `Equation \\(x_${i}\\).\n\n\\[y_${i}=x_${i}^2\\]\n\n`).join("") + "```tex\n\\(keep_literal\\)\n```";
  const html = render(copied); assert.equal((html.match(/class="katex"/g) ?? []).length, 560);
  assert.ok(markdownMath(copied).endsWith("```tex\n\\(keep_literal\\)\n```"));
});

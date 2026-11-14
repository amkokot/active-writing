// Shared reading typography; ordinary Overleaf LaTeX on the source side.
export const corpusTypography=String.raw`% Aw corpus typography
\usepackage[T1]{fontenc}
\usepackage{tgpagella}
\usepackage{microtype}
\usepackage{titlesec}
\usepackage{multicol}
\usepackage{environ}
\geometry{a4paper,margin=18mm}
\setlength{\columnsep}{8mm}
\setlength{\parindent}{0pt}
\setlength{\emergencystretch}{1em}
\titleformat{\paragraph}[runin]{\normalfont\normalsize\bfseries}{}{0pt}{}[.\enspace]
\titlespacing*{\paragraph}{0pt}{1.45\baselineskip}{0pt}
\hypersetup{urlcolor=[rgb]{0.14,0.38,0.55}}
\newsavebox{\awcorpusbox}
\newcount\awprojectcount
\newif\ifawmeasuring
\newcommand{\awcountproject}{\ifawmeasuring\global\advance\awprojectcount by1\relax\fi}
\newif\ifawtwocolumn
\NewEnviron{researchlist}{\begingroup\global\awprojectcount=0\awmeasuringtrue\setbox\awcorpusbox=\vbox{\hsize=\textwidth\linewidth=\textwidth\columnwidth=\textwidth\BODY}\awmeasuringfalse\awtwocolumnfalse\ifnum\awprojectcount>4\relax\awtwocolumntrue\fi\ifdim\dimexpr\ht\awcorpusbox+\dp\awcorpusbox\relax>\textheight\awtwocolumntrue\fi\ifawtwocolumn\begin{multicols}{2}\raggedcolumns\BODY\end{multicols}\else\BODY\fi\endgroup}
% End Aw corpus typography
`;

export const corpusReadingCss=String.raw`
body{font-family:'Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif;color:#263139;background:#fff}
main{max-width:1080px;padding:32px;margin:auto;column-count:2;column-gap:34px}
main.corpus-single{column-count:1;max-width:760px}
main>.passage{break-inside:avoid;margin:0 0 1.65em;line-height:1.52}
main>.passage p{margin:0;text-align:left;hyphens:auto;overflow-wrap:break-word}
main>.passage p>strong:first-child{font-weight:700;color:#182c36}
main>.passage p>strong:first-child::after{content:'.\00a0'}
a{color:#244c5d;text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
main>.passage p>strong:first-child a,main>.passage p>strong:first-child a:visited{color:#24628d}
@media(max-width:760px){main{column-count:1;max-width:650px;padding:24px}}
@media print{body{font-size:10.5pt;line-height:1.5}main{column-count:2;column-gap:22pt;padding:0;max-width:none}main>.passage{margin:0 0 17pt}nav,footer{display:none}}
@media print{main.corpus-single{column-count:1;max-width:none}}
`;

/** Page trees from the controlled Chromium print renderer; unknown formats
 * conservatively fall back to the two-column copy, never a guessed fit. */
export function printedCorpusPages(pdf:Buffer){
 const counts=[...pdf.toString('latin1').matchAll(/\/Type\s*\/Pages\b[^<>]{0,500}?\/Count\s+([1-9]\d*)\b/g)].map(m=>Number(m[1]));
 return counts.length&&counts.every(n=>Number.isSafeInteger(n)&&n<=10000)?Math.max(...counts):undefined;
}
export async function renderCorpusPdf(html:(columns:1|2)=>Buffer,renderer:(html:Buffer)=>Promise<Buffer>,visibleProjects=0){
 if(!Number.isInteger(visibleProjects)||visibleProjects<0||visibleProjects>100)throw Error('Invalid visible project count.');
 if(visibleProjects>4)return {pdf:await renderer(html(2)),columns:2 as const};
 const single=await renderer(html(1));
 if(printedCorpusPages(single)===1)return {pdf:single,columns:1 as const};
 return {pdf:await renderer(html(2)),columns:2 as const};
}

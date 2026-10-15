import { memo, useMemo, useState } from "react";
import { replyOutline } from "../replyOutline";
import { ReplyMarkdown } from "../replyMarkdown";
import { LazyDisclosure } from "../lazyDisclosure";
import "katex/dist/katex.min.css";

export const FindingsReader = memo(function FindingsReader({ text }: { text: string }) {
  const outline = useMemo(() => replyOutline(text), [text]);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNotice("Original reply text copied."); }
    catch { setNotice("Clipboard unavailable. Select the original text below to copy it."); }
  }
  return <section className="findings-reader" aria-label="Reply outline">
    {outline.sections.length > 0 && <div className="findings-reader-toolbar"><small>{outline.sections.length} sections · original reply</small><button className="secondary-button" onClick={() => setExpanded(!expanded)}>{expanded ? "Compact view" : "Expand all"}</button></div>}
    {expanded ? <ReplyMarkdown text={text} /> : <>{outline.intro.trim() && <ReplyMarkdown text={outline.intro} />}
      {outline.sections.map((section, index) => <LazyDisclosure className="findings-section" key={`${section.start}:compact`} initialOpen={index === 0 || section.reviewCue} summary={<ReplyMarkdown text={section.title} />}>
        <ReplyMarkdown text={section.text} />
      </LazyDisclosure>)}</>}
    <LazyDisclosure className="findings-exact" summary="Exact reply text"><small>Folding only changes the view. The full reply is kept.</small><button className="secondary-button" onClick={() => void copy()}>Copy reply text</button>{notice && <p role="status">{notice}</p>}<pre>{text}</pre></LazyDisclosure>
  </section>;
});

import type { LocalSecondLook } from "../localReview";
import { fingerprint } from "../rewrite";
import { ReplyMarkdown } from "../replyMarkdown";
import { LazyDisclosure } from "../lazyDisclosure";

export function SecondLook({ review, reply, revision }: { review: LocalSecondLook; reply: string; revision: string }) {
  const older = review.draftFingerprint !== fingerprint(reply) || review.sourceRevision !== revision;
  return <LazyDisclosure className="study-more second-look" summary={review.status === "failed" ? "Second look unavailable · original reply kept" : `Second look · ${review.observations.length} ${review.observations.length === 1 ? "note" : "notes"} · not checked`}>
    <p>{older ? "This review used an older reply or saved paper version. It hasn't checked your later changes." : "A separate review pass using the same local model. It can share the original answer's mistakes; agreement is not verification."}</p>
    {review.error && <p>{review.error}</p>}
    {review.summary && <ReplyMarkdown text={review.summary} />}
    {review.observations.map((item, index) => <article key={index}><ReplyMarkdown text={item.observation} /><blockquote>{item.quote}</blockquote><small>Quoted source: {item.sourceId}</small><ReplyMarkdown text={`Next check: ${item.nextCheck}`} /></article>)}
    <details><summary>Sources & read-only tool steps</summary><p>{review.model} · saved paper {review.sourceRevision.slice(0, 12)} · {(review.durationMs / 1000).toFixed(1)} s. No code ran or source changed.</p>{review.tools.map((tool, index) => <details key={index}><summary>{tool.name} · {tool.requestedBy === "fallback" ? "automatic search fallback" : "requested by reviewer"}</summary><pre>{tool.arguments}</pre><pre>{tool.result}</pre></details>)}{review.rawReply && <details><summary>Original review text</summary><pre>{review.rawReply}</pre></details>}</details>
  </LazyDisclosure>;
}

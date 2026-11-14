# Learning the user's writing preferences

Collect useful examples during an already requested editing pass. Do not train a
model, generate a synthetic corpus, scan old projects or start a separate review
pass just to collect data. The aim is a future optional weak critic of exposition,
not a proof checker or an automatic author. No new annotation form is required.

## Instructional writing target

The reader's explicit preference is for instructional, worked explanations rather
than compressed reference writing, without bloat. For an unfamiliar central step,
show how the construction is chosen and the calculation that makes it work.
Expansion should remove an identifiable inference the reader would otherwise have
to reconstruct; repeated interpretations and generic commentary do not count.
Reference-style compression can be appropriate for a reminder, summary or familiar
subsidiary step. Assess that role and the intended reader before requesting detail.
Keep instructional/reference mode separate from good/bad labels. A preferred book
can contain compressed passages, and a disfavored book can contain useful worked
examples. Book-level preferences do not establish passage-level training labels.

Judge the explanatory work, not omission markers such as "left as an exercise."
An underexplained proof can contain no such phrase; a useful textbook can place
practice or a completed solution elsewhere. Identify the actual inference the
reader cannot reconstruct, after checking the relevant context. Exposition has
equal standing with proof: motivation, concrete meaning, model justification,
notation introduced at a usable pace, the flow of an algorithm, and interpretation
of a result all matter. Extra formulas alone do not fix a dense or poorly ordered
explanation. Match textbook examples to specific saved human feedback, including
requests to remove repeated paraphrases, rather than using an omission phrase,
book reputation or passage length as a substitute for that feedback.

## What to keep

- An explicit preference, a passage the human praises or rejects, or a before/after
  pair where the human actually chooses the revision. Keep the relevant wording
  and short surrounding context, not a complete document or conversation.
- The criterion when known: explanation, missing calculation, notation, structure,
  repetition, tone, or another literal description from the feedback. Keep target
  audience and document purpose; a good overview can be a poor proof explanation.
- Specific rejected passages from unsuccessful agent notes. A failed note is not
  uniformly negative, and the agent's next attempt is not automatically positive.
- Existing authored/published excerpts may be candidate exemplars, but authorship
  is not an explicit positive label. Preserve this weaker provenance separately.

Use `human-explicit` or `human-choice` only when the human supplied that signal.
Keep the exact feedback and a recoverable reference (saved comment/reply ID,
writing-round decision, or chat reference and date). Attribution is reported
provenance, not cryptographic proof or publication approval. Agent judgments,
outside-critic comments and inferred preferences must remain `agent-proposed` or
`unlabelled`. Scientific corrections alone do not establish a writing preference.
An untouched passage, a closed task, successful compilation, or accepting a
mathematical claim is not a style label.

## Where and how

Stay in the owning Aw project and conversation. Use the current offline research
tools to obtain its data folder and verify scope; do not guess a paper-local
`.paperfocus` directory. Under that returned data folder, save bounded immutable
JSON files in `research/writing-preferences/`, outside the manuscript checkout.
Use a new UUID filename and exclusive creation (`wx`/`x`); never append to a shared
JSON array or overwrite a prior record. Several examples from one feedback event
may share one file, with a practical cap of ten short examples per file.

Once per substantive pass, link the new file(s) from a short cell in the owning
notebook using `awResearch.ts put/batch --offline` and the current revision. Update
an existing collection cell if appropriate; do not create a conversation, phase,
queue item or permanent pin per example. Preserve prior cells and other agents'
work. If a notebook save conflicts, keep the immutable examples and retry only
the guarded link, without recapturing the same feedback. If no owning notebook is
established, retain one scoped pending collection and link it when ownership is
confirmed; do not invent an experiment owner.

Collect a small batch when a clear signal arises, rather than write on each
keystroke or capture every rejected candidate. Reuse the signal reference and
excerpt hashes to recognize duplicates. Do not store credentials, whole chats or
unrelated research. Personal examples are not app fixtures, public demo content
or part of the collaborator's source ZIP. They are not automatically uploaded,
copied to another device or included in a public app release. Desktop editing
collects on the desktop; reuse existing scoped transfer tools if later aggregation
is requested. This guidance does not change sync policy or authorize code execution.

## Record format

The template in `docs/templates/writing-preference.example.json` is a schema
example, not a labelled training item. Real records use actual owner IDs, exact
snapshots and references. Omit an unavailable current-file hash rather than
invent one; indicate whether the excerpt is historical. Compute SHA-256 over the
exact stored UTF-8 excerpt(s) when capturing. A `familyId` groups an original
passage, its revisions and all later synthetic variants. Preserve that identity
when an example is reused in a later phase or version.

For corrections to a label, save a new record with `supersedes` pointing to the
old example. Retain the old snapshot; do not silently relabel history. Capture
does not edit source, unlock text, resolve comments or validate mathematics.

## Before training

First count independent human-labelled passages and feedback events, not just
the number of files or excerpt variants. A few thousand snippets from a handful
of papers are not a few thousand independent preferences. Inspect label coverage,
contradictions, purpose/audience and duplicates before choosing a model.

Compare a simple classifier and example retrieval with the existing local model
before investing in language-model fine-tuning. Keep a held-out, human-labelled
evaluation set, grouped by manuscript and passage family; near-duplicates and
synthetic siblings must never cross that split. Use later human decisions as an
additional prospective test. Synthetic examples, if separately requested, stay
training-only with generator/version, parent/family ID and an explicit synthetic
label. Model-made labels never count as human evaluation evidence.

Judge usefulness by held-out agreement, precision of actionable flags, abstention,
and how many distracting flags the reader receives. Check length/notation/topic
shortcuts and swapped ordering for pairs. Preserve uncertainty and disagreements.
Neither model scores nor generated explanations certify correctness. Do not launch
training or mass synthesis automatically when an arbitrary count is reached.

## Readiness audit, 9 November 2026

A read-only metadata audit of existing desktop preference folders found 130 JSON
files containing 192 entries across five projects. Of these, 181 carry recorded
`human-explicit`/`human-choice` signals, covering 143 distinct family IDs; this
is reported provenance, not independent validation of every label. Many entries
are editorial instructions or unlabelled passages, not binary training labels.
There are two nonempty preferred/rejected pairs, four explicit `positive` passage
labels, 51 `unlabelled` passage labels and no entries marked synthetic. Different
negative-label spellings and 15 repeated excerpt-hash occurrences need normalization
and deduplication. Counts are a snapshot, not a live training manifest.

Start with exact-criterion retrieval: retrieve a few relevant explicit human
preferences by purpose/audience and ask a bounded local model for at most three
actionable findings with quoted locations and example references. Distinguish
style concerns, missing explanations and possible mathematical errors. A missing
algebra step can be flagged, but critic output is never proof verification.
No automatic source rewrite, review resolution, wording lock or user annotation
requirement follows from a score. Run during requested reading/editing passes,
not on every keystroke or every exploratory note.

First normalize copied datasets into a private versioned build, preserving the
immutable originals, signal quote/reference, family, manuscript, criterion and
supersession. Instructions become retrieval rules; unlabelled passages remain
unlabelled. Do not turn an inferred correction into a preferred passage. Current
positive coverage is too sparse for a meaningful broad good/bad classifier or
pairwise reward-model evaluation. Capture naturally occurring explicit acceptances
and before/after choices without adding routine annotation chores.

Compare retrieval-only and a simple regularized classifier before fine-tuning.
SetFit is a candidate for a later few-shot classifier, not evidence that a few
positive labels suffice for this writing domain. If explanations need improvement,
evaluate a text-only small-model adapter (roughly 2–4B) trained on faithful feedback
records, keeping generated rationales separate from human evidence. Pairwise
reward training needs real preferred/rejected pairs; current data is not ready.
Do not use DPO to train an author merely to obtain a critic.

Partition original manuscript/passage families and near-duplicate groups BEFORE
retrieval evaluation, augmentation or training. Keep held-out explicit human
examples and later prospective decisions separate. Synthetic variants, if later
authorized, stay with their parent in the training split, carry generator/version
and an unverified synthetic label, and never count as independent human evidence.
Use specific edits (e.g. omitted calculation or vague antecedent), not unrelated
good/bad snippets whose topic or length reveals the class. Do not synthesize a
large corpus before an initial held-out comparison demonstrates useful signal.

Evaluate precision of useful flags, missed known issues, flags per page, ranking
agreement where real pairs exist, abstention and extra human work. Check topic,
notation, passage length and pair-order shortcuts. Choose thresholds on validation
data; report uncertainty on the untouched test families. Enable only categories
that help the reader; allow silence rather than mandatory criticism.

Training needs an isolated CUDA-capable environment, not an upgrade to the shared
CPU-only research interpreter. Published Qwen3.5 bf16 LoRA figures list about
10 GB for 4B and 22 GB for 9B under the publisher's recipe; actual use depends on
sequence length, batch size, adapters and kernels. A 12 GB card makes a small
2–4B pilot plausible, not a guaranteed 9B training budget. QLoRA can reduce weight
memory but does not eliminate activation/optimizer overhead. Smoke-test the
RTX 5070 build and measure memory first, then train only in a coordinated idle
window with explicit scope. Keep inference and training budgets separate.

References:
- https://huggingface.co/docs/setfit/index
- https://huggingface.co/docs/trl/reward_trainer
- https://huggingface.co/docs/peft/developer_guides/quantization
- https://unsloth.ai/docs/models/qwen3.5/fine-tune

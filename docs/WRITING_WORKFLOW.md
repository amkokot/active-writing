# Publication writing and research notes

For a **publication draft**, Aw is a wrangling device for a human author, not a whole-manuscript generator. The useful unit is **one idea and one to three connected paragraphs**. The idea may touch distant sections: the introduction can state a motivation, a results paragraph can make its precise promise, and the discussion can explain its limit. Broad context does not enlarge the size of the publication writing step.

For **research notes**, a full first-pass explanation, derivation, literature digest or synthesis is welcome when the human requests it. Choose **Switch manuscript → Writing purpose → Research notes** (new informative-notes roots use this automatically). There is no publication paragraph cap or mandatory word-by-word approval for ordinary notes. Use **Ask** or **Writing → Ask for a full research note**; the latter carries your instruction into a saved conversation without submitting it. A folder-aware assistant may write the indicated notes root only within the user's explicit source-writing scope; a web chat can return a full note for optional paste. Existing practical storage/model limits still apply.

The purpose is per independent TeX root, kept outside its repository and inherited by new versions. Unmarked roots default to research notes; choosing the Paper scaffold or Publication draft explicitly enables publication guardrails; filenames do not decide policy. Agents must not change purpose to evade review. Switching purpose does not approve proposals, clear comments or unlock settled wording. Small reviewed writing rounds remain available for notes, and choosing one retains its existing review gates. Full research notes do not authorize one-shot publication drafts, arbitrary source restructuring, experiments or unrelated file edits. Converting notes into publication prose starts incremental work; it does not certify already written notes as reviewed.

This workflow keeps human direction, settled wording and unresolved work separate. It does not connect to a cloud account, launch assistants or certify mathematical correctness.

## Human loop

1. Choose the intended manuscript, section or theme. **Tools → Write a small step** opens the writing panel. Describe the idea, the intended reader, the change you want and what must survive. Original phrasing, an example, a limitation or a sketch in your own words is useful input; there is no compulsory template.
2. Include the active paragraph, its section, a manually adjustable theme collection, or bounded paper-wide context. Prepare instructions for a folder-aware assistant or any web chat. The prompt and request are saved outside the manuscript repository. Nothing is sent automatically.
3. While waiting, use **Work elsewhere while waiting** or the priority queue's **Next**. A folder response or guarded direct submission offers Return; it does not move your view or approve prose. A web chat uses optional paste and its ordinary Copy button; Aw cannot detect its completion itself.
4. Inspect the connection between the proposed paragraphs. **See passages together** uses the normal theme editor, preserving each original `.tex` file. The round's paragraph list and Previous/Next guide a local review without hiding the wider idea.
5. Edit a proposal if needed, then **Place draft in manuscript**. This saves ordinary LaTeX into the current manuscript, not a separate notes document. Replacements and additions before/after a paragraph are supported; included files are never flattened. The draft remains in the queue, and a small **Review draft text** link stays beside the source paragraph.
6. Read the original, the current wording and the rendered approximation. Edit the current text directly. Check every changed word, notation, quantifier, hypothesis and citation. Mark **I reviewed every word and checked the claim**, then **Approve this paragraph**. There is no bulk approval; a source change invalidates the exact-text confirmation. Queue ✓ opens this review instead of approving it. Scrolling, Turbo progress, incoming replies and compilation do not approve wording or resolve comments.
7. Approval locks the current wording against future writing proposals. **Unlock for another pass** is the deliberate human reopening path. Locked text still supplies context, but assistants cannot target it through this workflow. If later source changes alter or obscure locked wording, its review reopens instead of retaining a misleading approval. Source editing outside this workflow is not blocked by a filesystem access control.
8. Set aside unused proposals, or **Undo draft** when its exact inserted wording is still recoverable. Undo refuses to erase later edits; preserve them and edit manually instead. Originals, exact replies and decisions remain in history. Optional **Guidance for the next pass** records why an idea was rejected or what should be preserved, without adding a routine approval form.
9. After this round's paragraphs have each been reviewed or set aside, inspect the transitions and finish the round. Continue with one next idea. The next brief retains the prior decisions and human guidance; it is not a request to rewrite the entire section again.

Locks concern exact reviewed wording, not the correctness of a theorem. A person can affirm that they read every word; Aw cannot measure their attention. The actual compiled PDF remains the typography/reference check. Focus/reading rendering is an approximation.

## Agent loop

Read `AGENTS.md` and the [agent guide](AGENT_GUIDE.md) first. Confirm Aw home, project ID, paper root, manuscript root and writing-round ID. This is a **writing request**, owned by the assistance store, not an experiment conversation. Do not invent a notebook/conversation owner. Research evidence stays in its existing notebooks; a writing request alone does not authorize new runs, agents or source restructuring.

The short command client runs directly in Node, without dependency downloads:

```powershell
node scripts/awWriting.ts --help
node scripts/awWriting.ts inspect --workspace 'CONFIRMED_AW_HOME' --project PROJECT_ID --task ROUND_ID
```

Inspect reads the current guarded assistance store, saved prompt, captured source revision, current locks and previous human decisions. It does not change the selected project. A wrong manuscript root stops the command rather than switching all windows. The captured excerpt may include unsaved human draft text; current disk source is not automatically a superior version.

An efficient pass has four roles, normally handled by one assistant in one bounded turn:

- **Locate:** identify the two or three places where the human's idea belongs. Use section/theme context and exact paragraph IDs. Do not reread a whole notebook or published paper if the relevant evidence is already linked and inspected.
- **Connect:** state each paragraph's distinct job and how the motivation, precise claim and interpretation reinforce one another. Identify an essential human choice or missing fact before drafting around it.
- **Propose:** write only the next small step, preserving human phrasing and settled decisions. A short explanation without proposed prose is appropriate if a technical question remains open.
- **Check:** compare claims with the supplied evidence; preserve notation, citations, qualifications, theorem/proof boundaries and original source files. Flag any substantive change in the rationale. Do not declare an unproved claim established to improve the prose.

Never edit manuscript files directly for an Aw writing-round request, mark paragraphs accepted, unlock wording or repeatedly rewrite approved text. A pending wording proposal does not justify resolving its associated comment. During an authorized revision pass, straightforward comments may be resolved only after checking the completed saved fix; substantive questions, partial attempts and choices needing human assessment stay open. Add anchored replies explaining the attempt where useful. Comment resolution does not bypass this writing round's approval requirements or an explicitly read-only review brief. If a locked passage becomes inconsistent with new evidence, explain the conflict and ask for a deliberate reopening. Parallel workers require separate human authorization and one coordinator; they should reason or review, not independently overwrite the same drafts.

Prepare a UTF-8 JSON reply with this shape. Paragraph IDs must come from the request, and each target appears at most once per round:

```json
{
  "version": 1,
  "connection": "Introduce the limitation, then echo it in the discussion.",
  "nextStep": "Clarify the transition to the main result.",
  "proposals": [
    {
      "id": "motivation",
      "paragraphId": "ID_FROM_PACKET",
      "action": "replace",
      "purpose": "Separate a guarantee from numerical evidence",
      "rationale": "Keep the hypotheses explicit. Check that the example illustrates, rather than proves, the claim.",
      "text": "One proposed LaTeX paragraph."
    }
  ]
}
```

Actions are `replace`, `before`, `after`. No approval, resolution, status or source-edit fields are accepted. A reply contains zero to three paragraphs, no blank-line paragraph bundles, at most 350 whitespace-delimited words per paragraph, 900 words total and 6,000 characters per paragraph. Section/file commands and common theorem/proof wrappers are rejected; this is not a structural editing interface. Custom macros still need source review. Hypotheses and references are checked by the human, not a token-based mathematical verifier.

Save the proposal JSON in the returned Aw data/request folder, not the paper checkout. Then preview and submit once:

```powershell
node scripts/awWriting.ts submit --workspace 'CONFIRMED_AW_HOME' --project PROJECT_ID --task ROUND_ID --revision WORKBENCH_REVISION --file PROPOSALS.json
# Review the preview, then repeat with --commit for one guarded assistance-store save.
```

The preview writes nothing. `--commit` preserves unrelated tasks, comments, rewrite drafts and unknown record fields; it imports queued proposals only, with no manuscript writes or approval. A stale revision, new lock or already answered round stops submission. Inspect conflicts and reconcile; do not automatically retry protected writes. A repeated submission cannot replace human-edited proposals. The ordinary shared-folder `response.json` envelope remains an alternative finalization path; follow the saved ticket/hash and do not use both paths for the same round.

For the next turn, reuse chat history and the short saved human feedback. State precisely which idea is next, which wording is locked and which question remains open. Do not rebuild the manuscript to demonstrate progress. Aim for fewer unresolved choices, not a larger draft.

## Storage and boundaries

Writing rounds, paragraph drafts, originals, decisions and locks persist through Aw's revision-guarded project assistance store under the returned external Aw data folder. Request files use the existing provider-neutral handoff. They are not copied into ordinary source ZIP exports. Placed text is normal manuscript LaTeX and will appear for Overleaf users without Aw. Pending/reviewed markers are Aw records, not custom TeX commands.

Exact source snapshots and confirmed own-save offsets keep additions linked after paragraph splitting. Unknown external edits, duplicate text, another manuscript root or overlapping edits are not fuzzy-matched. Keep the old proposal/quote and ask for a fresh round when identity is uncertain. Locks apply to proposals delivered through this workflow; they cannot constrain an assistant that bypasses the app and writes raw files. An explicit user source-edit task outside writing rounds remains governed by its own narrower scope.

This first implementation provides paragraph-level approval, not a word-by-word acceptance diff or a general tracked-changes engine. The human sees the complete current paragraph and original side of the comparison, and explicitly confirms the exact text. Further polishing should refine that comparison without adding bulk acceptance or another task system.

## Short human trial

Use a disposable manuscript on an isolated Aw origin, never a working paper currently edited elsewhere. Include an introduction and an included discussion file.

1. Prepare one section/theme request. Submit two connected paragraphs through `awWriting.ts`, or paste the same JSON as a web reply. Confirm that the source is unchanged, a Return notice appears, and both paragraphs are queued.
2. Place one draft, close Writing, and reopen it from its small source link or Queue Next. Refresh the trial tab. Confirm that the original, current draft and pending state survive.
3. Compare both passages using **See passages together**. Edit one draft in the real source editor, then return to review. Confirm that the checkbox cannot approve an older displayed version.
4. Approve exactly one paragraph. Confirm that the other remains queued, the first is locked, and a new reply targeting the locked paragraph is rejected. Deliberately unlock it and confirm that a fresh round may propose an edit.
5. Set aside the second paragraph and add a short optional reason. Confirm the next brief includes that reason. Try undoing a placed draft after changing its words; it must refuse to erase those later edits.

Automated regressions cover these data transitions and real multi-file saves. A visual interaction trial is still needed to judge spacing, focus and perceived friction; passing data tests is not a substitute for that observation.

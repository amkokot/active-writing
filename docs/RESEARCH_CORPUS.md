# Research overview and audience selections

A research-list project is an ordinary Overview manuscript. `main.tex` includes
one short `projects/KEY.tex` file per research problem: a run-in `\paragraph`
name (taken from its research note), followed by about two sentences. Put the
hosted Overview URL inside that name using `\paragraph{\href{URL}{Name}}`.
The list has no document heading, introduction or separate link rows. The source remains editable in
Aw and usable in Overleaf. Project overviews should link onward to their current
research notes; never guess private-link tokens or use localhost links for sharing.

Open **Show / hide** in the main editing toolbar. Check the projects to include,
or hide entries in source. The `researchlist` wrapper measures the visible text:
standard LaTeX uses one column only for at most four visible projects that fit a
page, otherwise two. PDF sharing skips directly to two columns for five or more;
for at most four it checks the single-column page fit before falling back. It does
not shrink type to force a fit. Small HTML-only lists start in one column, while
hosted reader indexes follow their measured PDF and narrow screens use one column.
Linked paragraph names use blue; unlinked names stay dark.

Use **New audience** to copy a selection for a different collaborator. Audience
choices save automatically. The private editor retains the complete master.
For source-level visibility, put `\hideproject{KEY}` or `\showproject{KEY}` in the
preamble. The last command for a key wins; these affect the reading view, exports
and ordinary LaTeX compilation, including Overleaf. The `\researchproject{KEY}`
entries keep each editable paragraph in its own file. Audience selections are an
additional filter and do not insert commands into source. Regular Compile and
its PDF download use the current audience too, through a private compiler entry
file that reads the unchanged master. Recompile after changing the selection;
an older audience's PDF is refused rather than downloaded by mistake. The source
editor and source ZIP retain every entry. Overleaf uses source-level visibility;
private Aw audience metadata is not written into its checkout.
Download PDF, HTML or Reader ZIP from that menu. A Reader ZIP can use the existing
code-protected hosting workflow; preparing it does not publish anything.

Hidden entries are removed before rendering any sharing page or PDF, including
the reader's Markdown companions. Hidden titles, text and links are not sent as
collapsed content or client-side data. Notebooks, raw source and extra roots are
excluded from this project type's sharing exports. The ordinary **source ZIP** is
the complete editable master and is not an audience-filtered sharing copy.
Downloads require the exact audience revision displayed by the menu, and recheck
it after rendering. A stale second window cannot silently export another audience.
Selections affect new exports only. They do not revoke existing links/downloads
or update a previously deployed site. Use a separate inspected snapshot/link per
audience; never publish the private master list and rely on browser hiding.

Agents can operate without a server:

```text
node scripts/awCorpus.ts list --workspace HOME --project ID
node scripts/awCorpus.ts audience --workspace HOME --project ID --key collaborator --name "A collaborator"
node scripts/awCorpus.ts hide --workspace HOME --project ID --key cil
node scripts/awCorpus.ts show --workspace HOME --project ID --key cil
node scripts/awCorpus.ts export --workspace HOME --project ID --format pdf --output NEW.pdf
node scripts/awCorpus.ts export --workspace HOME --project ID --format web --output NEW.zip
```

`create --workspace HOME --file SEED.json` creates a new project, registered and
pinned as Overview. The seed is `{name, entries:[{key,title,summary,overviewUrl?}]}`;
optional projectId records provenance and optional hidden omits an entry initially.
Names are stable lower-case keys with hyphens. Audience changes are revision-
guarded, private Aw metadata in returned project-data `corpus.json`, outside the
checkout. New audiences copy the current selection and remain independent.
Keep summaries grounded in current reading copies; do not turn research aims into
claimed results. For changes to the list itself, use a scoped guarded metadata
save and ordinary source creation; do not replace unrelated project registries.

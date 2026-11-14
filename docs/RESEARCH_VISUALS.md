# Research graphics and animations in Aw

Use saved notebook outputs, not a separate website or a long-running Python
server. The same helpers work in fresh offline runs and deliberate shared runs.
Playback reads saved data only. It never reruns a model or requests compute.

## Choose for the question, not for decoration

During ordinary exploration, use the smallest useful display and spend the time
on reasoning. A table or one static plot is often enough. Do not open Aw, build a
dashboard or rerun an experiment merely to make scratch work attractive.

When the human says they are reviewing the notebook carefully, preparing to read
it, or asking for a walkthrough, consider a richer display where interaction
actually helps: compare the same trials across several variables, inspect tails
and failed cases, move through saved stages, or examine a matrix cell. State what
to try and what it can establish in a short note above the display. Pin a few
useful displays, not the entire history. Keep the initial view informative without
requiring a tour of controls. This is not an instruction to generate every type.

The notebook is the place for linked views and exploration; the manuscript holds
the fixed figures and exposition chosen for a reader. Reuse saved raw evidence,
retain its generating cell/run/input links, and make projection, missing-data,
normalization and sampling choices explicit. Presentation-only imports do not
create an execution record. New computations still need the human's permission.

| Question | Built-in tool | Useful interaction |
| --- | --- | --- |
| Which trials trade accuracy for time, cost or memory? | `display_explorer` | Brush scatter rows; compare distributions and other dimensions |
| How do groups differ, including outliers and failures? | `display_explorer` | Group color, exact row search, selected counts, subset export |
| How does a quantity evolve, with uncertainty? | `display_plot` with `band` | Toggle series, zoom, inspect exact bounds |
| How does behavior change across a parameter? | `display_sweep` | Saved parameter frames with fixed full-range axes |
| Where does a matrix/grid have large or small values? | `display_heatmap` | Inspect exact cells; grids are samples, not fitted surfaces |
| How do particles, embeddings or an optimizer move? | `display_geometry` | Saved coordinates, shared camera, ID-linked point inspection |
| Which graph/transport links or metric directions matter? | `display_geometry` | Supplied edges, anchors, weights and ellipse axes |
| Existing figures or a specialized view? | `display_animation` / `display_html` | Scrub PNG frames / explicitly open isolated HTML |

These are general-purpose tools, not tied to a particular topic or any other project.
Graph layouts, embeddings, interval estimates and geometry must be supplied by
the experiment; Aw does not infer them. The graph viewer draws undirected lines,
not directed arrows, and colors alone are not a guarantee of category identity.

## Discover and insert an example

```powershell
node scripts/awResearch.ts visuals
node scripts/awResearch.ts visuals --recipe explorer
```

These commands return the catalogue or complete small Python source without a
workspace, service, notebook write or execution. Recipes include `explorer`,
`intervals`, `trajectory`, `matrix` and `graph`. Use the normal guarded `put` or
`batch` command to save adapted source in the confirmed owning notebook; run only
with compute permission. Humans have the same examples under **Experiments →
Visual examples**. Inserting one creates an editable code cell but does not run it.
All recipe data are explicitly synthetic. `scripts/examples/research_visuals.py`
is a runnable gallery; do not mistake it for evidence from the user's project.

## Agent quick loop

Reload Aw to load the rebuilt interface. Fresh/offline Python runs immediately use
the new helpers. A shared Python session created before this update needs a
deliberate restart after its work is saved; never restart another owner's session.

1. Follow the ordinary scoped `awResearch.ts inspect --offline` / `put` / `run`
   workflow. Keep displays in their owning conversation and use returned revisions.
2. Use `display_explorer` for general tabular experiment data; use
   `display_geometry` for point clouds, learned metric ellipses, pooling
   weights, graph edges and multiple linked panels. Arrays can be Python lists,
   tuples or NumPy arrays. Supply actual saved trajectories; label illustrative
   frames as illustrative. Never interpolate a scientific result silently.
3. Use `display_animation` for existing Matplotlib figures or PNG frames. No
   ffmpeg, Plotly installation, video encoder or notebook widget server is needed.
4. Use `display_html(path=...)` for a custom self-contained dashboard. Inline
   JavaScript and data; CDN scripts and fetches will be blocked. Raw `text/html`
   from imported Jupyter notebooks remains inert. The human opens each custom
   display explicitly; two sandbox frames and restrictive CSP isolate it from Aw.
5. Read the exact saved `output --cell ID --output INDEX` before drawing numerical
   conclusions. It includes every frame, not just the current slider position.
   Imported displays are artifacts, not newly executed experiments.

To attach an already created visual without running Python:

```powershell
node scripts/awResearch.ts visual --offline --workspace AW_HOME --project PROJECT_ID --entry ENTRY_ID --cell CELL_ID --revision REV --file visual.html --title 'Normal pooling'
```

This appends one display to an existing code cell with a revision-guarded save.
It does not replace source, earlier outputs, run provenance or task status. It
records the original file path/hash and import time separately; it does not claim
the cell generated that display. A `.json` file can instead contain a complete
explorer, geometry, PNG animation or HTML visual object with `version: 1` below.
Use `put` to create the cell first if needed. Keep the generating code/data linked
through ordinary declared inputs and cell notes. Do not import whole notebooks
merely to attach one graphic.

## Linked data explorer

```python
display_explorer(
    'Accuracy and computation',
    {'seconds': times, 'error': errors, 'variance': variances, 'method': methods},
    x='seconds', y='error', color='method',
    dimensions=['seconds', 'error', 'variance'],
    ids=trial_ids, labels={'seconds': 'Run time (s)'},
    description='Saved repeated trials; select outliers to inspect their other measurements.',
)
```

`data` may be a dictionary of equally sized arrays, a list of record dictionaries,
or an already available pandas DataFrame. No pandas installation is needed for
lists/dictionaries. Columns contain **numbers or strings**, plus `None` for missing
values. Convert NaN explicitly to `None`; invalid/nonfinite values are rejected,
not silently dropped. There must be two numeric columns, at most 32 columns and
10,000 rows, within the ordinary 1.5 MB visual budget. Optional `ids` are unique
nonempty strings; omitted IDs are the saved zero-based row indices. Supply actual
trial/sample IDs when they are useful for tracing evidence.

Drag a rectangle or click a dot to select rows; Shift adds. Histogram bins are
keyboard-accessible and select the same rows. The table checkboxes are a second
keyboard route. Clear selection restores the unselected view; an empty selection
is deliberately different from no selection. Changing axes preserves row identity.
Pan/zoom only changes the scatter view. Log axes explicitly omit nonpositive and
missing coordinates; other views and exact tables keep the original values.

**Compare dimensions** opens parallel coordinates on 2–8 chosen numeric columns;
each uses its own full-data linear range. Missing values break line segments.
These connecting lines compare variables, not time trajectories. **Exact rows**
is paginated and searchable. Search/Selected only filter the table, not the saved
dataset or downloads. JSON subset downloads preserve exact values and IDs; CSV
guards text against spreadsheet formulas. A subset is a view, not an independent
sample or a newly executed result. Bins and numeric color ranges stay fixed when
selecting rows. Histograms show counts, not an inferred density or uncertainty.
**Save rows → Copy row IDs** copies up to 200 selected identities for a question;
pair it with the cell's existing **Copy evidence link** so an agent can locate the
exact dataset. Larger selections can be downloaded as JSON. No prompt is sent,
and clipboard failure leaves selectable text instead of losing the selection.

Explorer JSON: `{version:1,title,description,ids,columns,x,y,color?,dimensions}`;
columns are `{key,label,values:[number|string|null,...]}`, one homogeneous non-null
type per column. `x/y` are distinct numeric column keys, `color` any column key,
and `dimensions` 2–8 distinct numeric keys. The Python helper chooses initial axes
and up to six dimensions when omitted. Native displays do not execute scripts.

## Lines and uncertainty

```python
display_plot('Repeated-trial error', [{
    'name': 'Estimator A', 'points': list(zip(budgets, means)),
    'band': {'lower': q10, 'upper': q90, 'label': '10–90% empirical trial quantiles'},
}], x_label='Samples', y_label='Error', x_scale='log')
```

Bands are optional, aligned to the series points, with finite ordered bounds and
strictly increasing x. Their label must explain the interval: SD, empirical
quantiles, confidence interval under stated assumptions, deterministic bounds,
etc. The viewer never computes a confidence interval. Log y requires positive
bounds. Axis fitting includes the bounds, including the full saved sweep range.
Zoom, hiding series and point inspection retain exact matching intervals. Lines
between measured samples are visual guides, not extra observations. Sharing
copies retain the bands, their labels and original bounds.

## Linked geometry plots

```python
display_geometry(
    'Measured diffusion trajectory',
    panels=[
        {'title': 'Observed labels', 'points': X, 'values': y, 'anchors': [3, 41]},
        {'title': 'Query pooling', 'points': X, 'anchors': [3, 41]},
        {'title': 'Fitted function', 'points': X},
    ],
    frames=[
        {'label': 'Isotropic start', 'panels': [{}, {'weights': w0, 'edges': edges0}, {'values': f0}]},
        {'label': 'Update 1', 'panels': [{}, {'weights': w1, 'edges': edges1, 'ellipses': ellipses1}, {'values': f1}]},
    ],
    description='Actual saved fits; weights are positive query-pooling mass, not signed regression influence.',
    color_range=[-2, 2], fps=4, initial=0,
)
```

Each panel has 2D or 3D coordinates; all frames share its point count/order.
Frame layers may supply `points` for actual saved motion/embedding stages. Camera
bounds cover the complete saved trajectory, so moving dots cannot rescale the
axes from frame to frame. There is no tweening or numerical interpolation.
`values` color the points. The fixed color range is shared across panels/time;
when omitted it is computed from all saved values, not each frame separately.
`weights` are nonnegative and control relative dot size/opacity within a frame.
`edges` are `[source_index, target_index, optional_weight]`; draw a documented
subset for large graphs. `anchors` are point indices, highlighted A/B/C. Selecting
one filters incident edges/highlights only; it does not invent per-anchor weights.
For distinct anchor-specific weights use separate named panels or saved frames.

`ellipses` contain `{center: [x,y,...], axes: [[...],[...],...]}`. Axes are world
coordinate **semi-axis vectors**, already scaled in data units. They are not raw
metric or precision matrices. For covariance C use its eigendecomposition and
`sqrt(eigenvalue) * eigenvector`; state any display-only scale in the description.
Three-dimensional ellipsoids render as three projected great ellipses. Camera
rotation/tilt is shared across all 3D panels; it never changes the saved data.
Pointer hover reveals exact point values and weights. Save exact data exports
the full JSON; Save frame PNG exports one panel view. Expand uses browser fullscreen.
Click a point to inspect it, or use the keyboard-friendly **Inspect point** panel.
`pointIds` link the same identity across panels even when their point orders
differ; unrelated panels without explicit IDs are not linked by index. Optional
`pointLabels` explain individual samples; `axisLabels` name the coordinates.
Drag 3D panels to rotate; zoom and Reset view affect only the camera. Coordinate
names in a rotated 3D view are not unrotated screen axes.

Geometry JSON: `version,title,description,panels,frames,initial,fps,colorRange?`.
Default description is empty, initial is 0, fps is 6 in the Python helper; explicit
JSON must include those fields. Frames are `{label,panels:[layer,...]}`; layers
override the corresponding panel's points/values/weights/edges/ellipses. An empty layer
retains static panel fields. Use an empty `edges`/`ellipses` array to clear them.
No inferred normal, manifold, smoothing or fitting is performed by the viewer.

## Existing plotting code

```python
# figs: already computed Matplotlib Figure objects, or PNG paths/bytes.
display_animation(figs, title='Estimator refinement', labels=stage_names,
                  description='Independent saved fitting stages.', fps=5)
# Close figures after saving to avoid the runner also capturing static PNGs.
import matplotlib.pyplot as plt
plt.close('all')

display_html(path='results/diagnostic.html', title='Detailed diagnostics', height=850)
# Or display_html('<canvas ...>...</canvas><script>...</script>', title='...')
```

HTML JSON: `{version:1,title,description,html,height}`. PNG animation JSON:
`{version:1,title,description,initial:0,fps:6,frames:[{label,png:BASE64},...]}`.
Custom HTML can use Canvas/SVG, inline libraries, sliders and compressed inline
data. It has no file, app, network, form, popup or worker access. No parent-message
bridge is installed. It closes offscreen/when the tab hides to stop arbitrary
animation; reopening resets its local state. Native displays pause and retain
their current frame while mounted. Navigation/remount resets to the saved initial
frame. Controls are viewing state, not evidence mutations or Python commands.

## Budgets and verification

Up to 6 geometry panels, 20,000 total points (12,000 per panel), 120 frames,
24 anchors/ellipses and 1,500 edges per panel/frame, 1–24 fps. Visual JSON is at most
1.5 MB; custom HTML at most 1 MB. Existing 2 MB run-output and 4 MB notebook limits
still apply. PNG frames usually need fewer frames/smaller resolution; geometry
stores coordinates once and is usually cheaper. Helpers fail visibly on NaNs,
bad dimensions, unmatched arrays or oversized output; no silent point dropping.

The built-in figures are dependency-free and work without network access. Large
row/geometry views draw to Canvas rather than thousands of DOM nodes; tables
paginate. Animation pauses when hidden, and offscreen canvases avoid redraws. HTML
must also bundle its libraries; Aw does not download dependencies automatically.
External media is not fetched on the agent's behalf. Existing displays and raw
Jupyter outputs are preserved. `scripts/examples/research_visuals.py` is a small
synthetic starter for general experiment views, not evidence of algorithm performance.

"""Dependency-free saved visual helpers, installed into trusted Aw Python cells.

No execution callbacks are retained. NumPy arrays/scalars convert via tolist/item.
"""
import base64
import io
import json
import math
from pathlib import Path


def plain(v):
    if hasattr(v, "tolist"):
        return plain(v.tolist())
    if isinstance(v, dict):
        return {k: plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    return v


def install(namespace, display_data):
    def emit(mime, value, fallback):
        value = plain(value)
        encoded = json.dumps(value, allow_nan=False)
        if len(encoded) > 1_500_000:
            raise ValueError("Visual exceeds 1.5 MB; sample points or save fewer/smaller frames")
        display_data({mime: value, "text/plain": fallback})

    def display_explorer(title, data, *, x=None, y=None, color=None, dimensions=None, ids=None, labels=None, description=""):
        """Linked scatter, histograms, parallel coordinates and exact-row inspection.

        data: dict of equal-length columns, records, or a pandas DataFrame.
        Each column is numbers OR strings (plus None). Missing values stay missing.
        ids: unique stable row IDs; defaults to saved zero-based row numbers.
        All controls operate on saved rows; selection never runs Python.
        """
        if hasattr(data, "to_dict") and not isinstance(data, dict):
            data = data.to_dict(orient="list")
        data = plain(data)
        if isinstance(data, list) and data and all(isinstance(row, dict) for row in data):
            keys = list(dict.fromkeys(k for row in data for k in row))
            data = {key: [row.get(key) for row in data] for key in keys}
        if not isinstance(data, dict) or not 2 <= len(data) <= 32:
            raise ValueError("Explorer needs 2–32 columns: a dict of arrays, records, or DataFrame")
        if not isinstance(title, str) or not 0 < len(title) <= 300 or not isinstance(description, str) or len(description) > 2000:
            raise ValueError("Use a nonempty title up to 300 characters and description up to 2000")
        labels = {} if labels is None else labels
        if not isinstance(labels, dict):
            raise ValueError("labels must map column keys to readable labels")
        columns, numeric, size = [], [], None
        for key, values in data.items():
            label = labels.get(key, key)
            if not isinstance(key, str) or not 0 < len(key) <= 80 or not isinstance(label, str) or not 0 < len(label) <= 160 or not isinstance(values, list) or not 1 <= len(values) <= 10000:
                raise ValueError("Use short string keys/labels and 1–10000 rows per column")
            size = len(values) if size is None else size
            if len(values) != size:
                raise ValueError("Explorer columns must have the same row count")
            kinds = set()
            for v in values:
                if v is None:
                    continue
                if type(v) in (int, float) and math.isfinite(v) and abs(v) <= 1e100:
                    kinds.add("number")
                elif isinstance(v, str) and len(v) <= 300:
                    kinds.add("string")
                else:
                    raise ValueError("Use finite numbers, short strings or None; convert NaN/missing data to None explicitly")
            if len(kinds) > 1:
                raise ValueError("Each column must contain only numbers OR strings, plus None")
            if kinds == {"number"}:
                numeric.append(key)
            columns.append(dict(key=key, label=label, values=values))
        if len(numeric) < 2:
            raise ValueError("Explorer needs at least two numeric columns")
        x = numeric[0] if x is None else x
        y = next((key for key in numeric if key != x), None) if y is None else y
        dimensions = numeric[:6] if dimensions is None else plain(dimensions)
        if x not in numeric or y not in numeric or x == y or color is not None and color not in data:
            raise ValueError("Choose two different numeric axes and an existing color column")
        if not isinstance(dimensions, list) or not 2 <= len(dimensions) <= 8 or any(key not in numeric for key in dimensions) or len(set(dimensions)) != len(dimensions):
            raise ValueError("Choose 2–8 different numeric dimensions")
        ids = [str(i) for i in range(size)] if ids is None else plain(ids)
        if not isinstance(ids, list) or len(ids) != size or any(not isinstance(v, str) or not 0 < len(v) <= 160 for v in ids) or len(set(ids)) != size:
            raise ValueError("Supply one unique short string ID per row")
        value = dict(version=1, title=title, description=description, columns=columns, ids=ids, x=x, y=y, dimensions=dimensions)
        if color is not None:
            value["color"] = color
        emit("application/vnd.aw.explorer+json", value, f"{title}: linked data explorer; {size} saved rows, {len(columns)} columns. Scatter, distributions, parallel coordinates and exact table share row IDs. No rerun. {description}")

    def display_geometry(title, panels, frames=None, *, description="", fps=6, initial=0, color_range=None):
        """Linked 2D/3D panels with saved values, pooling weights, edges and ellipses.

        panels=[{title,points,pointIds?,pointLabels?,axisLabels?,values?,anchors?,weights?,edges?,ellipses?}]
        frames=[{label,panels:[{points?,values?,weights?,edges?,ellipses?},...]}]
        Ellipse axes are world-coordinate semi-axis vectors, not a precision matrix.
        Stable explicit IDs link point inspection across panels, not array order.
        Frames preserve row count/order; bounds cover all saved coordinate stages.
        All panels use one timeline and color range. No interpolation or model rerun.
        """
        panels = plain(panels)
        frames = plain(frames) if frames is not None else [{"label": "Saved view", "panels": [{} for _ in panels]}]
        if not isinstance(title, str) or len(title) > 300 or not isinstance(description, str) or len(description) > 2000:
            raise ValueError("Use short visual title/description")
        if not isinstance(panels, list) or not 1 <= len(panels) <= 6 or not isinstance(frames, list) or not 1 <= len(frames) <= 120:
            raise ValueError("Use 1–6 panels and 1–120 saved frames")
        if type(initial) is not int or not 0 <= initial < len(frames) or type(fps) is not int or not 1 <= fps <= 24:
            raise ValueError("Use a valid initial index and 1–24 integer fps")
        finite = lambda x: type(x) in (int, float) and math.isfinite(x) and abs(x) <= 1e100
        vec = lambda x, d: isinstance(x, list) and len(x) == d and all(finite(t) for t in x)
        total = 0
        for p in panels:
            if not isinstance(p, dict) or not isinstance(p.get("title"), str) or len(p["title"]) > 300 or not isinstance(p.get("points"), list) or not 1 <= len(p["points"]) <= 12000:
                raise ValueError("Each panel needs a title and 1–12000 coordinate points")
            d, n = len(p["points"][0]), len(p["points"])
            if d not in (2, 3) or not all(vec(x, d) for x in p["points"]):
                raise ValueError("Use finite consistent 2D/3D points")
            total += n
            if "anchors" in p and (not isinstance(p["anchors"], list) or len(p["anchors"]) > 24 or any(type(i) is not int or not 0 <= i < n for i in p["anchors"])):
                raise ValueError("Use at most 24 valid anchor indices")
            for key, limit in (("pointIds", 160), ("pointLabels", 300), ("axisLabels", 80)):
                if key in p and (not isinstance(p[key], list) or len(p[key]) != (d if key == "axisLabels" else n) or any(not isinstance(s, str) or len(s) > limit or key == "pointIds" and not s for s in p[key])):
                    raise ValueError("pointIds/pointLabels must match rows; axisLabels must match dimension")
            if "pointIds" in p and len(set(p["pointIds"])) != n:
                raise ValueError("Use unique pointIds within each panel; matching IDs link panels")
        if total > 20000:
            raise ValueError("Use at most 20000 total displayed points")
        for f in frames:
            if not isinstance(f, dict) or not isinstance(f.get("label"), str) or len(f["label"]) > 300 or not isinstance(f.get("panels"), list) or len(f["panels"]) != len(panels):
                raise ValueError("Each frame needs a label and one layer per panel")
        for i, p in enumerate(panels):
            n, d = len(p["points"]), len(p["points"][0])
            for l in [p] + [f["panels"][i] for f in frames]:
                if not isinstance(l, dict):
                    raise ValueError("Frame layers must be dictionaries")
                if "points" in l and (not isinstance(l["points"], list) or len(l["points"]) != n or not all(vec(point, d) for point in l["points"])):
                    raise ValueError("Frame points must preserve point count, order and dimension")
                for key in ("values", "weights"):
                    if key in l and (not isinstance(l[key], list) or len(l[key]) != n or any(not finite(x) or key == "weights" and x < 0 for x in l[key])):
                        raise ValueError("values/weights must match points; weights must be nonnegative")
                if "edges" in l and (not isinstance(l["edges"], list) or len(l["edges"]) > 1500 or any(not isinstance(e, list) or len(e) not in (2, 3) or any(type(j) is not int or not 0 <= j < n for j in e[:2]) or len(e) == 3 and (not finite(e[2]) or e[2] < 0) for e in l["edges"])):
                    raise ValueError("Use at most 1500 [source,target,nonnegative_weight?] edges")
                if "ellipses" in l and (not isinstance(l["ellipses"], list) or len(l["ellipses"]) > 24 or any(not isinstance(e, dict) or not vec(e.get("center"), d) or not isinstance(e.get("axes"), list) or len(e["axes"]) != d or not all(vec(a, d) for a in e["axes"]) for e in l["ellipses"])):
                    raise ValueError("Ellipses need a center and 2/3 world-coordinate semi-axis vectors")
        value = dict(version=1, title=title, description=description, panels=panels, frames=frames, fps=fps, initial=initial)
        if color_range is not None:
            color_range = plain(color_range)
            if not vec(color_range, 2) or color_range[0] > color_range[1]:
                raise ValueError("Use finite increasing color_range=[low,high]")
            value["colorRange"] = color_range
        emit("application/vnd.aw.geometry+json", value, f"{title}: {len(panels)} geometry panels; {len(frames)} saved frames. Exact points, values, weights, edges and ellipse axes retained. Playback does not execute Python.")

    def display_animation(images, *, title="Animation", labels=None, description="", fps=6, initial=0):
        """Save PNG paths/bytes or Matplotlib Figures as a scrub-able animation.

        Prefer display_geometry for large point clouds: it stores coordinates once.
        No ffmpeg, video encoder, package download or external viewer needed.
        """
        if not isinstance(images, (list, tuple)) or not 1 <= len(images) <= 120:
            raise ValueError("Use 1–120 precomputed PNG frames")
        if not isinstance(title, str) or len(title) > 300 or not isinstance(description, str) or len(description) > 2000 or type(fps) is not int or not 1 <= fps <= 24 or type(initial) is not int or not 0 <= initial < len(images):
            raise ValueError("Invalid animation title/description/fps/initial")
        labels = [str(i) for i in range(len(images))] if labels is None else labels
        if len(labels) != len(images) or any(not isinstance(s, str) or len(s) > 300 for s in labels):
            raise ValueError("Use one short text label per frame")
        frames, size = [], 0
        for label, image in zip(labels, images):
            if hasattr(image, "savefig"):
                buffer = io.BytesIO()
                image.savefig(buffer, format="png", dpi=90)
                raw = buffer.getvalue()
            else:
                raw = Path(image).read_bytes() if isinstance(image, (str, Path)) else bytes(image)
            if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("Animation frames must be PNG images or Matplotlib Figures")
            size += len(raw)
            if size > 1_100_000:
                raise ValueError("Animation too large; reduce resolution/frame count or use display_geometry")
            frames.append({"label": label, "png": base64.b64encode(raw).decode("ascii")})
        emit("application/vnd.aw.animation+json", dict(version=1, title=title, description=description, frames=frames, fps=fps, initial=initial), f"{title}: {len(frames)} saved PNG frames; no rerun.")

    def display_html(html=None, *, path=None, title="Interactive visual", description="", height=700):
        """Save self-contained HTML/JS for explicit sandboxed opening in Aw.

        Inline all libraries and data. Network, parent app access, forms, popups,
        workers and downloads are blocked. No arbitrary text/html auto-execution.
        Path is read now, never retained as a live browser file reference.
        """
        if (html is None) == (path is None):
            raise ValueError("Supply exactly one of html or path")
        if path is not None:
            if Path(path).stat().st_size > 1_000_000:
                raise ValueError("HTML exceeds 1 MB; embed smaller data")
            html = Path(path).read_text(encoding="utf-8")
        if not isinstance(html, str) or not 0 < len(html) <= 1_000_000 or not isinstance(title, str) or len(title) > 300 or not isinstance(description, str) or len(description) > 2000 or type(height) is not int or not 200 <= height <= 1600:
            raise ValueError("Use bounded HTML, short title/description and height 200–1600")
        emit("application/vnd.aw.html+json", dict(version=1, title=title, description=description, html=html, height=height), f"{title}: saved HTML visual; opens explicitly in an isolated, network-blocked viewer. {description}")

    namespace.update(display_explorer=display_explorer, display_geometry=display_geometry, display_animation=display_animation, display_html=display_html)

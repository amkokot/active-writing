"""Explicit execution of trusted Python cells, fresh or in a shared session.
This is NOT a security sandbox. Imports/files/network have normal user access.
"""
import contextlib
import io
import json
import math
import os
import sys
import time
import traceback

# The host validates this Aw-owned folder. -I still excludes PYTHONPATH and user
# site packages; adding the directory does not execute its .pth startup files.
package_folder = os.environ.get("AW_PYTHON_PACKAGES")
if package_folder:
    sys.path.insert(0, package_folder)


def runtime_record():
    from importlib.metadata import version, PackageNotFoundError
    packages = {}
    for module, distribution in [("numpy", "numpy"), ("pandas", "pandas"), ("scipy", "scipy"),
                                 ("matplotlib", "matplotlib"), ("sympy", "sympy"), ("mpmath", "mpmath"),
                                 ("networkx", "networkx"), ("sklearn", "scikit-learn"), ("statsmodels", "statsmodels"),
                                 ("cvxpy", "cvxpy"), ("ot", "POT"), ("nbformat", "nbformat"), ("psutil", "psutil")]:
        if module in sys.modules:
            try:
                packages[distribution] = version(distribution)
            except PackageNotFoundError:
                packages[distribution] = "unknown"
    return {"executable": sys.executable, "python": sys.version, "packageFolder": package_folder, "packages": packages}


class BoundedText(io.StringIO):
    def write(self, value):
        remaining = 60000 - self.tell()
        if remaining > 0:
            super().write(value[:remaining])
        return len(value)


def execute_cell(request, namespace):
    outputs = []
    stdout, stderr = BoundedText(), BoundedText()

    def display_data(data):
        if len(outputs) >= 20:
            raise ValueError("At most 20 rich displays per cell")
        json.dumps(data, allow_nan=False)
        outputs.append({"output_type": "display_data", "data": data, "metadata": {}})

    def display_plot(title, series, x_label="x", y_label="y", *, x_scale="linear", y_scale="linear"):
        if x_scale not in ("linear", "log") or y_scale not in ("linear", "log"):
            raise ValueError("Plot scales must be linear or log")
        if any((x_scale == "log" and p[0] <= 0) or (y_scale == "log" and p[1] <= 0)
               for s in series for p in s["points"]):
            raise ValueError("Log axes need strictly positive values; do not silently drop points")
        display_data({"application/vnd.paperfocus.plot+json": {
            "title": title, "series": series, "xLabel": x_label, "yLabel": y_label,
            "xScale": x_scale, "yScale": y_scale},
            "text/plain": str(title) + " (Active Writing plot; series: " + ", ".join(s["name"] for s in series) + ")"})

    def display_table(rows):
        display_data({"application/json": rows})

    def display_sweep(title, parameter, frames, x_label="x", y_label="y", *, x_scale="linear", y_scale="linear", initial=0):
        """A slider over precomputed data, never a callback or implicit rerun."""
        if not isinstance(title, str) or len(title) > 300 or not isinstance(parameter, str) or not parameter or len(parameter) > 100:
            raise ValueError("Use a short sweep title and parameter name")
        if not isinstance(frames, list) or not 2 <= len(frames) <= 41 or type(initial) is not int or not 0 <= initial < len(frames):
            raise ValueError("Use 2 to 41 saved frames and a valid initial index")
        if x_scale not in ("linear", "log") or y_scale not in ("linear", "log") or not isinstance(x_label, str) or not isinstance(y_label, str):
            raise ValueError("Use text axis labels and linear or log scales")
        saved, fallback, count, names = [], [], 0, None
        previous = None
        finite = lambda n: type(n) in (int, float) and math.isfinite(n)
        for frame in frames:
            if not isinstance(frame, dict) or not finite(frame.get("value")) or previous is not None and frame["value"] <= previous:
                raise ValueError("Parameter values must be finite and strictly increasing")
            previous = frame["value"]
            series = frame.get("series")
            if not isinstance(series, list) or not 1 <= len(series) <= 8:
                raise ValueError("Use 1 to 8 named series per frame")
            current_names, summaries, frame_count = [], [], 0
            for s in series:
                if not isinstance(s, dict) or not isinstance(s.get("name"), str) or not isinstance(s.get("points"), list) or len(s["points"]) > 2000:
                    raise ValueError("Use named series with at most 2000 points each")
                current_names.append(s["name"])
                for p in s["points"]:
                    if not isinstance(p, (list, tuple)) or len(p) != 2 or not all(finite(n) for n in p):
                        raise ValueError("Sweep points must be finite numeric [x,y] pairs")
                    if x_scale == "log" and p[0] <= 0 or y_scale == "log" and p[1] <= 0:
                        raise ValueError("Log axes need strictly positive values")
                frame_count += len(s["points"])
                summaries.append(s["name"] + ": " + str(len(s["points"])) + " points; first=" + repr(s["points"][:1]) + "; last=" + repr(s["points"][-1:]))
            count += frame_count
            if not frame_count or count > 40000 or names is not None and current_names != names:
                raise ValueError("Keep matching series across frames and at most 40000 total points")
            names = current_names
            saved.append({"value": frame["value"], "plot": {"title": title, "series": series, "xLabel": x_label, "yLabel": y_label, "xScale": x_scale, "yScale": y_scale}})
            fallback.append(parameter + "=" + str(frame["value"]) + ": " + "; ".join(summaries))
        display_data({"application/vnd.paperfocus.sweep+json": {"title": title, "parameter": parameter, "frames": saved, "initial": initial},
                      "text/plain": title + " (saved parameter sweep; no rerun)\n" + "\n".join(fallback)})

    def display_heatmap(title, x, y, values, x_label="x", y_label="y", *, color_scale="linear"):
        """Saved numeric tiles; selecting samples never executes Python."""
        finite = lambda n: type(n) in (int, float) and math.isfinite(n)
        axis = lambda a: isinstance(a, list) and 1 <= len(a) <= 60 and all(finite(n) and (i == 0 or n > a[i-1]) for i, n in enumerate(a))
        if not isinstance(title, str) or len(title) > 300 or any(not isinstance(s, str) or len(s) > 100 for s in (x_label, y_label)):
            raise ValueError("Use short text grid labels")
        if not axis(x) or not axis(y) or color_scale not in ("linear", "log"):
            raise ValueError("Use 1 to 60 finite strictly increasing samples per axis and linear or log color")
        if not isinstance(values, list) or len(values) != len(y) or any(not isinstance(row, list) or len(row) != len(x) or any(not finite(n) or color_scale == "log" and n <= 0 for n in row) for row in values):
            raise ValueError("Use a finite y-by-x matrix; log color requires positive values")
        fallback = title + " (saved sample grid; equal-size tiles; no interpolation or rerun)\n" + x_label + "=" + repr(x) + "\n"
        fallback += "\n".join(y_label + "=" + repr(v) + ": " + repr(row) for v, row in zip(y, values))
        display_data({"application/vnd.paperfocus.heatmap+json": {"title": title, "x": x, "y": y, "values": values, "xLabel": x_label, "yLabel": y_label, "colorScale": color_scale}, "text/plain": fallback})

    start = time.monotonic()
    error = None
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            namespace.update({"__name__": "__main__", "display_data": display_data,
                              "display_plot": display_plot, "display_table": display_table, "display_sweep": display_sweep, "display_heatmap": display_heatmap})
            exec(compile(request["source"], "<experiment-cell>", "exec"), namespace)
            # Matplotlib is optional. If user code imported it, retain its PNGs.
            if "matplotlib.pyplot" in sys.modules:
                import base64
                plt = sys.modules["matplotlib.pyplot"]
                for number in plt.get_fignums()[:4]:
                    image = io.BytesIO()
                    plt.figure(number).savefig(image, format="png", dpi=100)
                    display_data({"image/png": base64.b64encode(image.getvalue()).decode("ascii")})
                plt.close("all")
        except BaseException as exc:
            error = str(exc)
            outputs.append({"output_type": "error", "ename": type(exc).__name__,
                            "evalue": str(exc), "traceback": traceback.format_exc().splitlines()[-20:]})
    for name, stream in [("stdout", stdout), ("stderr", stderr)]:
        if stream.getvalue():
            outputs.insert(0, {"output_type": "stream", "name": name, "text": stream.getvalue()})
    result = {"outputs": outputs, "durationMs": round((time.monotonic() - start) * 1000), "error": error, "runtime": runtime_record()}
    encoded = json.dumps(result, allow_nan=False)
    if len(encoded) > 2000000:
        encoded = json.dumps({"outputs": [], "error": "Output exceeds 2 MB; reduce the display.", "durationMs": result["durationMs"], "runtime": result["runtime"]})
    return json.loads(encoded)


def main():
    if "--session" not in sys.argv:
        sys.__stdout__.write(json.dumps(execute_cell(json.load(sys.stdin), {}), allow_nan=False))
        return
    namespace = {}
    # JSON-lines protocol is private to the local server. No cell runs on startup.
    for line in sys.__stdin__:
        request = json.loads(line)
        result = execute_cell(request, namespace)
        result["requestId"] = request["requestId"]
        sys.__stdout__.write(json.dumps(result, allow_nan=False) + "\n")
        sys.__stdout__.flush()
        # A failed cell may have partially mutated state. Never reuse it.
        if result.get("error") is not None:
            break


if __name__ == "__main__":
    main()

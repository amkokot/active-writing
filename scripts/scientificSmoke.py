"""Bounded installation check for Aw's CPU scientific tools; not a proof."""
import numpy as np
import pandas as pd
import scipy.linalg
import sympy as sp
import networkx as nx
from sklearn.linear_model import LinearRegression
import statsmodels.api as sm
import cvxpy as cp
import ot
import nbformat
import psutil
import matplotlib.pyplot as plt

np.random.seed(7)
x = np.array([[0.], [1.], [2.], [3.]])
y = 2 * x[:, 0] + 1
assert np.allclose(scipy.linalg.solve(np.eye(2), [1., 2.]), [1., 2.])
assert abs(LinearRegression().fit(x, y).coef_[0] - 2) < 1e-9
assert np.allclose(sm.OLS(y, sm.add_constant(x)).fit().params, [1., 2.])
t = sp.symbols("t")
assert sp.diff(t**3, t) == 3*t**2
assert nx.shortest_path_length(nx.path_graph(4), 0, 3) == 3
variable = cp.Variable(2)
problem = cp.Problem(cp.Minimize(cp.sum_squares(variable - [1., 2.])), [variable >= 0])
problem.solve(solver="CLARABEL")
assert problem.status == "optimal" and np.allclose(variable.value, [1., 2.], atol=1e-5)
mass = np.array([.5, .5])
coupling = ot.sinkhorn(mass, mass, np.array([[0., 1.], [1., 0.]]), .2)
assert np.allclose(coupling.sum(axis=0), mass, atol=1e-9)
assert np.allclose(coupling.sum(axis=1), mass, atol=1e-9)
notebook = nbformat.v4.new_notebook(cells=[nbformat.v4.new_markdown_cell("Install check")])
nbformat.validate(notebook)
assert psutil.cpu_count() >= 1
display_table(pd.DataFrame({"tool": ["linear regression", "convex optimization", "Sinkhorn"],
                            "error": [float(abs(LinearRegression().fit(x, y).coef_[0] - 2)),
                                      float(np.max(abs(variable.value - [1., 2.]))),
                                      float(np.max(abs(coupling.sum(axis=0) - mass)))]}).to_dict("records"))
display_plot("Exact linear control", [{"name": "samples", "points": np.column_stack([x[:, 0], y]).tolist()}])
plt.plot(x[:, 0], y)
plt.title("Scientific installation check")
print("All scientific import and numerical checks passed; these are installation controls, not research results.")

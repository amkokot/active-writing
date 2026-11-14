/** Small runnable examples shared by the human menu and offline agent catalogue. */
export const visualRecipes = [
  { id: "explorer", title: "Linked experiment rows", use: "Compare trials, parameters, errors, cost and groups; brush the same rows across views.", source: `# Synthetic example, not a scientific result. Replace with saved experiment rows.
display_explorer('Trial trade-offs', {
    'cost': [1, 2, 4, 8, 1, 2, 4, 8],
    'error': [.6, .35, .18, .12, .7, .4, .22, .16],
    'variance': [.2, .12, .08, .04, .25, .17, .09, .06],
    'method': ['A'] * 4 + ['B'] * 4,
}, x='cost', y='error', color='method',
   ids=[f'trial-{i}' for i in range(8)],
   description='Synthetic cost/error comparison. Select rows to inspect the same trials in each view.')` },
  { id: "intervals", title: "Lines with uncertainty bands", use: "Show convergence, repeated-trial summaries or time series with explicitly defined intervals.", source: `# Synthetic bounds. Replace with saved, justified estimates/quantiles.
display_plot('Convergence with trial spread', [{
    'name': 'Method A', 'points': [[1,.6],[2,.35],[4,.18],[8,.12]],
    'band': {'lower': [.5,.27,.13,.08], 'upper': [.7,.43,.23,.16],
             'label': 'Illustrative trial range, not a confidence interval'},
}], x_label='Budget', y_label='Error', x_scale='log')` },
  { id: "trajectory", title: "Saved 2D / 3D trajectories", use: "Scrub actual optimization stages, particle motion or evolving embeddings without recomputing.", source: `# Analytic toy motion, not a fitted dynamical system.
display_geometry('Toy particle stages', [
    {'title': 'Position', 'points': [[-1,0],[1,0]], 'pointIds': ['a','b'], 'axisLabels':['x','y']},
    {'title': 'Comparison', 'points': [[-1,1],[1,-1]], 'pointIds': ['a','b']},
], frames=[{'label': f'Saved step {i}', 'panels': [
    {'points': [[-1+i/5, i/10],[1-i/5, -i/10]], 'values':[i,5-i]}, {}
]} for i in range(6)], description='Synthetic saved coordinates; no interpolation between frames.', fps=3)` },
  { id: "matrix", title: "Matrix / parameter grid", use: "Inspect exact grid values for phase diagrams, costs, covariance matrices or parameter sweeps.", source: `# Synthetic sample grid; cells do not imply continuous interpolation.
display_heatmap('Sampled error grid', [0.1, 0.3, 1.0], [16, 32, 64],
                [[.5,.3,.8],[.3,.15,.7],[.2,.1,.6]],
                x_label='Regularization', y_label='Sample size')` },
  { id: "graph", title: "Network / transport edges", use: "Inspect supplied graph layouts, affinities or transport plans; no layout or weights are inferred.", source: `# Toy network: supplied positions and edge masses, not an estimated graph.
display_geometry('Toy transport links', [{'title':'Given layout',
    'points': [[0,0],[0,1],[1,.2],[1,.8]], 'pointIds':['s0','s1','t0','t1'],
    'pointLabels':['Source 0','Source 1','Target 0','Target 1'],
    'anchors':[0,1], 'edges':[[0,2,.7],[0,3,.3],[1,2,.2],[1,3,.8]],
}], description='Edge opacity uses the supplied nonnegative mass. Not a directed-arrow diagram.')` },
] as const;

"""Small synthetic notebook starter; not an actual learned diffusion trajectory.
Save this as a trusted Aw code cell and run once (fresh/offline also works).
"""
import math

# General tabular trials: linked scatter / histogram / parallel coordinates.
# Use existing saved arrays/DataFrames in real work; do not rerun a fit for styling.
display_explorer('Synthetic trial trade-offs', {
    'seconds': [1, 2, 4, 8, 1, 2, 4, 8],
    'error': [.6, .35, .18, .12, .7, .4, .22, .16],
    'variance': [.2, .12, .08, .04, .25, .17, .09, None],
    'method': ['A'] * 4 + ['B'] * 4,
}, x='seconds', y='error', color='method',
   ids=[f'trial-{i}' for i in range(8)],
   labels={'seconds': 'Run time (s)'},
   description='Synthetic numbers. Brush costly trials to compare their errors and variance; None stays missing.')

# Uncertainty must be computed and justified by the experiment, not the viewer.
display_plot('Synthetic convergence and spread', [{
    'name': 'Toy method', 'points': [[1,.6],[2,.35],[4,.18],[8,.12]],
    'band': {'lower':[.5,.27,.13,.08], 'upper':[.7,.43,.23,.16],
             'label':'Illustrative trial range, not a confidence interval'},
}], x_label='Budget', y_label='Error', x_scale='log')

# Matrices / phase diagrams: exact sampled cells, no interpolated surface.
display_heatmap('Synthetic parameter grid', [.1,.3,1], [16,32,64],
                [[.5,.3,.8],[.3,.15,.7],[.2,.1,.6]],
                x_label='Regularization', y_label='Sample size')

# Supplied graph edges and stable identities; no inferred graph layout.
display_geometry('Synthetic network', [{'title':'Supplied layout',
    'points':[[0,0],[0,1],[1,.2],[1,.8]],
    'pointIds':['s0','s1','t0','t1'], 'pointLabels':['Source 0','Source 1','Target 0','Target 1'],
    'anchors':[0,1], 'edges':[[0,2,.7],[0,3,.3],[1,2,.2],[1,3,.8]],
}], description='Given nonnegative edge mass, shown as undirected lines, not arrows.')

display_geometry('Synthetic saved motion', [
    {'title':'Position', 'points':[[-1,0],[1,0]], 'pointIds':['a','b'], 'axisLabels':['x','y']},
    {'title':'Comparison', 'points':[[-1,1],[1,-1]], 'pointIds':['a','b']},
], frames=[{'label':f'Saved step {i}', 'panels':[
    {'points':[[-1+i/5,i/10],[1-i/5,-i/10]], 'values':[i,5-i]}, {}
]} for i in range(6)], description='Analytic toy stages, not fitted dynamics; bounds cover every saved frame.', fps=3)

points = [[r * math.cos(i * math.tau / 80), r * math.sin(i * math.tau / 80)]
          for r in (.8, 1., 1.2) for i in range(80)]
labels = [math.sin(2 * math.atan2(y, x)) for x, y in points]
frames = []
for step in range(10):
    radial_width = .03 + step * .025
    weights = [math.exp(-((math.hypot(x,y) - 1) / radial_width)**2 / 2
                        - (math.atan2(y,x) / .13)**2 / 2) for x,y in points]
    frames.append({'label': f'Illustrative radial spread {step}', 'panels': [
        {}, {'weights': weights, 'ellipses': [{'center': [1,0], 'axes': [[radial_width,0],[0,.13]]}]}]})
display_geometry('Synthetic radial pooling illustration', [
    {'title': 'Known synthetic values', 'points': points, 'values': labels, 'anchors': [80], 'pointIds': [f'p{i}' for i in range(len(points))]},
    {'title': 'Illustrative weights, not learned', 'points': points, 'values': labels, 'anchors': [80], 'pointIds': [f'p{i}' for i in range(len(points))]},
], frames, description='Analytic illustration of radial pooling, not output from a fitted learner.', fps=5)
display_html('<button onclick="this.textContent=\'Controls work\'">Test a local control</button>',
             title='Self-contained HTML control', height=240)
# For Matplotlib: display_animation(figures, labels=stage_names, title='Saved fits')

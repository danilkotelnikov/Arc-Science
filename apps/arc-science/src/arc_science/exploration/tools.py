"""Small trusted, deterministic numerical tools. Never execute model-supplied code."""
from __future__ import annotations
import math
import random
from .models import Point
from .catalog import NUMERICAL_CATALOG, validate_arguments

TOOL_VERSION = 'arc-numeric-2'
CATALOG = NUMERICAL_CATALOG

def synthetic_data(seed: int) -> tuple[Point, ...]:
    rng = random.Random(seed)
    return tuple(Point(x=(i-31.5)/16, y=2+.5*((i-31.5)/16)+1.2*((i-31.5)/16)**2+rng.gauss(0,.04))
                 for i in range(64))

def _solve(matrix, values):
    n=len(values); a=[list(row)+[values[i]] for i,row in enumerate(matrix)]
    for j in range(n):
        k=max(range(j,n), key=lambda i: abs(a[i][j]))
        a[j],a[k]=a[k],a[j]
        pivot=a[j][j]
        if abs(pivot) < 1e-14: raise ValueError('Singular design')
        a[j]=[v/pivot for v in a[j]]
        for i in range(n):
            if i!=j:
                factor=a[i][j]
                a[i]=[v-factor*w for v,w in zip(a[i],a[j])]
    return [row[-1] for row in a]

def _fit(points,degree):
    train=[p for i,p in enumerate(points) if i%4!=0]
    valid=[p for i,p in enumerate(points) if i%4==0]
    # Fit normalized coordinates to avoid avoidable scale-related instability.
    center=math.fsum(p.x for p in train)/len(train)
    scale=max(abs(p.x-center) for p in train)
    if not scale: raise ValueError('Constant x is not identifiable')
    rows=[[((p.x-center)/scale)**j for j in range(degree+1)] for p in train]
    matrix=[[math.fsum(r[i]*r[j] for r in rows) for j in range(degree+1)] for i in range(degree+1)]
    values=[math.fsum(r[j]*p.y for r,p in zip(rows,train)) for j in range(degree+1)]
    normalized=_solve(matrix,values)
    coef=[math.fsum(normalized[j]*math.comb(j,k)*(-center)**(j-k)/scale**j
                    for j in range(k,degree+1)) for k in range(degree+1)]
    def predict(x): return math.fsum(c*((x-center)/scale)**j for j,c in enumerate(normalized))
    mse=lambda rows: math.fsum((p.y-predict(p.x))**2 for p in rows)/len(rows)
    return {'degree':degree,'coefficients':coef,
            'normalized_center':center,'normalized_scale':scale,'normalized_coefficients':normalized,
            'training_mse':mse(train),'validation_mse':mse(valid),
            'n_train':len(train),'n_validation':len(valid),'split':'index_mod_4_zero_validation',
            'scope':'exploratory_model_comparison; repeated use is not confirmatory validation',
            'predictions':[{'x':p.x,'observed':p.y,'predicted':predict(p.x)} for p in points[:80]]}

def execute_numeric(tool: str, arguments: dict, points: tuple[Point,...]) -> dict:
    validate_arguments(tool, arguments, CATALOG)
    if len(points)<8: raise ValueError('At least eight input measurements are required')
    if tool=='describe_data':
        return {'n':len(points),'x_min':min(p.x for p in points),'x_max':max(p.x for p in points),
                'y_mean':math.fsum(p.y for p in points)/len(points)}
    if tool=='polynomial_fit':
        return _fit(points, arguments['degree'])
    rng=random.Random(90210)
    scores=[]
    for _ in range(arguments['permutations']):
        ys=[p.y for p in points];rng.shuffle(ys)
        shuffled=tuple(Point(x=p.x,y=y) for p,y in zip(points,ys))
        scores.append(_fit(shuffled,2)['validation_mse'])
    return {'permutations':len(scores),'seed':90210,'mean_shuffled_validation_mse':math.fsum(scores)/len(scores),
            'minimum_shuffled_validation_mse':min(scores),'scope':'descriptive_negative_control_not_a_p_value'}

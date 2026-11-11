"""Load the complete, optimized CC BY 4.0 winner_77 pedestal bust."""
from pathlib import Path
import json
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
ART=ROOT/'artwork/wyvern-trophies/models'


def make_head(factory):
    data=np.load(ART/'winner77-head.npz')
    m=factory('head')
    m.texture_prefix='mm_wyvern_head'
    m.source=json.loads((ART/'winner77-head-source.json').read_text(encoding='utf8'))
    m.p=data['p'].tolist();m.n=data['n'].tolist();m.uv=data['uv'].tolist()
    m.faces=data['f'].tolist();m.materials=['hide']*len(m.faces)
    m.source['exportedTriangles']=len(m.faces)
    return m

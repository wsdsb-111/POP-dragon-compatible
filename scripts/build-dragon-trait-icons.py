"""Encode the original ImageGen sources as alpha-preserving CK3 trait icons."""
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
for name,module in [
    ('bathed_blood','wyvern-capture'),
    ('half_dragon','wyvern-bloodline'),
    ('dragon_tail','wyvern-human-form'),
    ('dragon_horns','wyvern-human-form'),
    ('dragon_pupils','wyvern-human-form'),
    ('dragon_scales','wyvern-human-form'),
    ('lineage_1','wyvern-bloodline'),
    ('lineage_2','wyvern-bloodline'),
    ('lineage_3','wyvern-bloodline'),
    ('lineage_4','wyvern-bloodline'),
    ('black_blood','wyvern-bloodline'),
]:
    prefix='mm_'+name if name.startswith('dragon_') else 'mm_dragon_'+name
    output=ROOT/'patches'/module/'mod/gfx/interface/icons/traits'/f'{prefix}.dds'
    output.parent.mkdir(parents=True,exist_ok=True)
    image=Image.open(ROOT/'artwork/dragon-lineage'/f'{name}.png').convert('RGBA')
    image.resize((128,128),Image.Resampling.LANCZOS).save(output,pixel_format='DXT5')

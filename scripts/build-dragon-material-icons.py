"""Preserve cutout alpha so native CK3 rarity cloth stays visible behind icons."""
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
ART=ROOT/'artwork/wyvern-trophies'
GAME=ROOT/'patches/wyvern-capture/mod/gfx/interface/icons/artifact'
image=Image.open(ART/'material-icons-v118-transparent.png').convert('RGBA')
for index,kind in enumerate(['claw','horn']):
    cell=image.crop((image.width*index//2,0,image.width*(index+1)//2,image.height))
    cell.save(ART/('material-'+kind+'.png'))
    cell.resize((240,240),Image.Resampling.LANCZOS).save(GAME/('mm_wyvern_material_'+kind+'.dds'),pixel_format='DXT5')

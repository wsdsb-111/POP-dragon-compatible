"""Convert the two generated transparent source images into CK3 inventory DDS icons."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'patches/wyvern-capture/mod/gfx/interface/icons/artifact'
OUTPUT.mkdir(parents=True, exist_ok=True)
for name in ('draxel', 'serind'):
    image = Image.open(ROOT / f'artwork/dragon-weapons/{name}.png').convert('RGBA')
    image.resize((240, 240), Image.Resampling.LANCZOS).save(
        OUTPUT / f'mm_dragon_{name}.dds', pixel_format='DXT5')

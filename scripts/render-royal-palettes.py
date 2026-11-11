"""Offline native bind-pose comparison using the existing software renderer.

This reads the original vertices/UV/normals and original material maps. It does
not export a new mesh or simulate CK3's portrait animation/lighting pipeline.
"""
from pathlib import Path
import importlib.util
from types import SimpleNamespace

import numpy as np
from PIL import Image, ImageDraw

import dragon_materials

ROOT = Path(__file__).resolve().parent.parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


palette = load('royal_palette_build', 'build-royal-palettes.py')
renderer = load('native_trophy_preview', 'build-wyvern-trophy-models.py')
renderer.ART = palette.ART


class NativePaletteTextures(dragon_materials.PreviewTextures):
    def __init__(self, folder, prefix):
        self.maps = []
        images = [Image.open(Path(folder) / f'{prefix}-albedo.png').convert('RGBA')]
        for name in ['properties', 'normal']:
            data = (palette.NATIVE / palette.MODEL / f'myv_wyvern_{name}.dds').read_bytes()
            images.append(Image.frombytes('RGBA', (2048, 2048), data[128:], 'raw', 'BGRA'))
        for image in images:
            levels = []
            while True:
                levels.append(np.asarray(image))
                if image.width == 1:
                    break
                image = image.resize((max(1, image.width // 2), max(1, image.height // 2)), Image.Resampling.BOX)
            self.maps.append(levels)


dragon_materials.PreviewTextures = NativePaletteTextures
mesh, _, _ = palette.parse_native_mesh()
model = SimpleNamespace(p=mesh['p'].reshape(-1, 3), n=mesh['n'].reshape(-1, 3),
                        uv=mesh['u0'].reshape(-1, 2), faces=mesh['tri'].reshape(-1, 3))
sheet = Image.new('RGB', (1800, 1040), '#22261f')
draw = ImageDraw.Draw(sheet)
for index, family in enumerate(palette.FAMILIES):
    model.texture_prefix = family
    image = renderer.render(model, 600, 480, view=(.65, .72, -1.6))
    image.save(palette.ART / f'{family}-native-bind-preview.png')
    x, y = (index % 3) * 600, (index // 3) * 520
    sheet.paste(image.convert('RGB'), (x, y + 32))
    draw.text((x + 12, y + 9), f'{family} | ORIGINAL MESH / OFFLINE BIND POSE', fill='white')
sheet.save(palette.ART / 'native-bind-comparison.png')
print('Six native bind-pose previews saved; CK3 lighting/animation NOT_VERIFIED')

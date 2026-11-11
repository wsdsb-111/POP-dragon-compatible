"""Fit approved user cutouts to native CK3 UI canvases and encode BC3 alpha."""
from pathlib import Path
import hashlib
import json

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'artwork/dragon-doctrine-illustrations/manifest.json'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


manifest = json.loads(MANIFEST.read_text(encoding='utf8'))
for asset in manifest['assets']:
    for source in [asset['original'], asset['prepared']]:
        assert sha(ROOT / source['file']) == source['sha256'], source['file']
    if asset['kind'] != 'tenet':
        assert sha(ROOT / asset['dds']['file']) == asset['dds']['sha256']
        continue
    with Image.open(ROOT / asset['prepared']['file']) as source:
        image = source.convert('RGBA')
    alpha = image.getchannel('A')
    low, high = alpha.getextrema()
    assert low == 0 and high >= 200 and alpha.getbbox(), asset['name']
    # Trim empty alpha margins only; retain every visible source pixel.
    image = image.crop(alpha.getbbox())
    width, height = (260, 400)
    box = (200, 224)
    scale = min(box[0] / image.width, box[1] / image.height)
    fitted = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (width, height))
    x = 30 + (box[0] - fitted.width) // 2
    y = 108 + (box[1] - fitted.height) // 2
    canvas.paste(fitted, (x, y))
    output = ROOT / asset['dds']['file']
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, pixel_format='DXT5')
    asset['dds'].update(width=width, height=height, sha256=sha(output))
    asset['layout'] = {'fit': 'contain', 'safeBox': [30, 108, 200, 224], 'sourceAlphaBBox': list(alpha.getbbox()), 'placedRect': [x, y, fitted.width, fitted.height], 'sourceAspectPreserved': True, 'cardScale': 0.5, 'cardIconOffset': [0, -10], 'reservedTitleArea': [0, 336, 260, 400]}
    with Image.open(output) as decoded:
        assert decoded.size == (width, height) and decoded.getchannel('A').getextrema()[0] == 0

# Composite the actual native banner with the actual GUI -10px icon offset.
# This is an offline geometry preview; font rasterization still needs game review.
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 36)
banner_path = Path('D:/SteamLibrary/steamapps/common/Crusader Kings III/game/gfx/interface/icons/faith_tenets/tenet_banner_known_core.dds')
with Image.open(banner_path) as source:
    banner = source.convert('RGBA')
assets = [a for a in manifest['assets'] if a['kind'] == 'tenet']
cols, cell = 6, (280, 420)
sheet = Image.new('RGB', (cols * cell[0], 3 * cell[1]), '#202b2d')
for i, asset in enumerate(assets):
    with Image.open(ROOT / asset['dds']['file']) as texture:
        rgba = texture.convert('RGBA')
    rgba.putalpha(rgba.getchannel('A').point(lambda a: round(a * 0.85)))
    for bg, label in [('#202b2d', 'dark'), ('#ddd2bc', 'light')]:
        preview = Image.new('RGBA', (260, 400), bg)
        preview.alpha_composite(banner)
        preview.alpha_composite(rgba, (0, -20))
        draw = ImageDraw.Draw(preview)
        draw.text((130, 348), asset['name'], font=font, fill='#f1e4cb', anchor='mm', stroke_width=1, stroke_fill='#202521')
        out = ROOT / f'artwork/dragon-doctrine-illustrations/v1319/{asset["id"]}-{label}.png'
        out.parent.mkdir(parents=True, exist_ok=True)
        preview.convert('RGB').save(out)
        if label == 'dark':
            sheet.paste(preview.convert('RGB'), ((i % cols) * cell[0] + 10, (i // cols) * cell[1]))
sheet.save(ROOT / 'artwork/dragon-doctrine-illustrations/v1319/tenet-contact-sheet.png')

manifest['version'] = '1.3.19'
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print('18 tenets fitted inside native banners; 6 doctrine textures preserved')

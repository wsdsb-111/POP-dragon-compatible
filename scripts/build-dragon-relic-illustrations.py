"""Pack reviewed imagegen cutouts into native CK3 four-frame inventory sprites.

Background removal is performed by imagegen, not this format-conversion script.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artwork/dragon-relics/illustrations'
MOD = ROOT / 'patches/dragon-relics/mod'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
jobs = json.loads((ART / 'inputs.json').read_text(encoding='utf-8'))
assets = []
sheet = Image.new('RGB', (960, 600), '#252b34')
for i, job in enumerate(jobs):
    source = ROOT / job['cutout']
    image = Image.open(source).convert('RGBA')
    alpha = image.getchannel('A')
    assert alpha.getextrema() == (0, 255), source
    bbox = alpha.getbbox()
    assert bbox and all(alpha.getpixel(p) <= 1 for p in [(0, 0), (image.width-1, 0), (0, image.height-1), (image.width-1, image.height-1)])
    # Fit the complete alpha bounds, not the original opaque JPG canvas.
    subject = ImageOps.contain(image.crop(bbox), (216, 216), Image.Resampling.LANCZOS)
    frame = Image.new('RGBA', (240, 240))
    position = ((240-subject.width)//2, (240-subject.height)//2)
    frame.paste(subject, position)
    output = MOD / ('gfx/interface/icons/artifact/mm_v1322_relic_' + job['id'] + '.dds')
    sprite = Image.new('RGBA', (960, 240))
    for n in range(4): sprite.paste(frame, (n*240, 0))
    sprite.save(output, pixel_format='DXT5')
    # Verify the actual compressed DDS, including every rarity frame.
    decoded = Image.open(output).convert('RGBA')
    decoded_frame = decoded.crop((0, 0, 240, 240))
    assert decoded.size == (960, 240)
    assert all(decoded.crop((n*240, 0, (n+1)*240, 240)).tobytes() == decoded_frame.tobytes() for n in range(4))
    assert decoded_frame.getchannel('A').getextrema() == (0, 255)
    preview = ART / ('frames/' + job['id'] + '.png')
    preview.parent.mkdir(parents=True, exist_ok=True)
    decoded_frame.save(preview)
    x, y = (i % 4)*240, (i // 4)*300
    sheet.paste(decoded_frame, (x, y+20), decoded_frame)
    ImageDraw.Draw(sheet).text((x+12, y+270), job['id'], fill='white')
    assets.append({**job, 'originalSha256': sha(ROOT/job['original']), 'cutoutSha256': sha(source), 'sourceSize': list(image.size), 'sourceAlphaBounds': list(bbox), 'fittedSize': list(subject.size), 'position': list(position), 'gameFile': output.relative_to(ROOT).as_posix(), 'gameSha256': sha(output), 'framePreview': preview.relative_to(ROOT).as_posix(), 'previewSha256': sha(preview)})
sheet.save(ART / 'contact-sheet.png')
manifest = {'version': '1.3.22', 'method': 'builtin_imagegen_background_only_edit', 'packing': 'DXT5 RGBA 960x240; four identical 240x240 rarity frames; 12px minimum padding', 'courtModels': 'unchanged; custom 3D bound only to court visuals', 'assets': assets}
(ART/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
print(json.dumps({'assets': len(assets), 'manifest': str(ART/'manifest.json')}, ensure_ascii=False))

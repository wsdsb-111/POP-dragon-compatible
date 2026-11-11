"""Encode the user's six finished emblems as CK3 DXT5 trait textures."""
from pathlib import Path
import hashlib
import json

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'artwork/dragon-kings/user-icons/manifest.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


manifest = json.loads(MANIFEST.read_text(encoding='utf8'))
for asset in manifest['assets']:
    original = ROOT / asset['original']['file']
    source = ROOT / asset['processed']['file']
    assert sha(original) == asset['original']['sha256'], 'Original artwork changed'
    assert sha(source) == asset['processed']['sha256'], 'Prepared artwork changed'
    image = Image.open(source).convert('RGBA')
    assert image.getchannel('A').getextrema() == (0, 255), 'Real transparency required'
    output = ROOT / asset['dds']['file']
    output.parent.mkdir(parents=True, exist_ok=True)
    image.resize((128, 128), Image.Resampling.LANCZOS).save(output, pixel_format='DXT5')
    asset['dds']['sha256'] = sha(output)
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print('Six user royal emblems encoded as alpha-preserving 128px DXT5')

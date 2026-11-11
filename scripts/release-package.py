"""Create a fresh install ZIP without retaining old release archives."""
from pathlib import Path
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
result = subprocess.run(['node', '--max-old-space-size=384', str(root/'scripts/build-package.js')], cwd=root, check=True, text=True, capture_output=True)
build = json.loads(result.stdout)
package = Path(build['packageRoot'])
metadata = json.loads((root/'package.json').read_text(encoding='utf-8'))
out = root/'dist'
out.mkdir(exist_ok=True)
archive = out/(metadata['name']+'-'+metadata['version']+'.zip')
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as stream:
    for item in sorted(package.rglob('*')):
        if item.is_file():
            stream.write(item, item.relative_to(package).as_posix())
print(json.dumps({'archive':str(archive),'packageRoot':str(package),'files':build['files'],'CK3Runtime':'NOT_RUN'},ensure_ascii=False))

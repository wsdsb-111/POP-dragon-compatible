"""Merge the render interfaces lost when PoD loads after Wyvern."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
GAME = Path("D:/SteamLibrary/steamapps/common/Crusader Kings III/game")
WORKSHOP = Path("D:/SteamLibrary/steamapps/workshop/content/1158310")
SOURCES = {"game": GAME, "pod": WORKSHOP / "2216659254", "wyvern": WORKSHOP / "3811316052"}
FILES = [
    "gfx/models/portraits/male_body/male_body.asset",
    "gfx/models/portraits/female_body/female_body.asset",
    "gfx/models/portraits/male_head/male_head.asset",
    "gfx/models/portraits/female_head/female_head.asset",
    "gui/hud_outliner.gui",
    "gui/shared/cooltip.gui",
]


def normalized(data):
    return data.decode("utf-8-sig").replace("\r\n", "\n")


inputs, outputs, merged = [], [], {}
with tempfile.TemporaryDirectory(prefix="wyvern-pod-render-") as temporary:
    for relative in FILES:
        paths = {}
        for name, source in SOURCES.items():
            data = (source / relative).read_bytes()
            inputs.append({"root": name, "path": relative, "sha256": hashlib.sha256(data).hexdigest()})
            paths[name] = Path(temporary) / name
            paths[name].write_bytes(normalized(data).encode("utf-8"))
        result = subprocess.run(
            ["git", "merge-file", "-p", str(paths["pod"]), str(paths["game"]), str(paths["wyvern"])],
            capture_output=True, check=False,
        )
        if result.returncode:
            conflict = ROOT / ".build" / "pod-render-merge-conflicts" / relative
            conflict.parent.mkdir(parents=True, exist_ok=True)
            conflict.write_bytes(result.stdout)
            raise RuntimeError(f"Manual review required for {relative}; conflict saved at {conflict}")
        text = result.stdout.decode("utf-8")
        assert not any(line.startswith(("<<<<<<<", "=======", ">>>>>>>")) for line in text.splitlines())
        merged[relative] = b"\xef\xbb\xbf" + text.replace("\n", "\r\n").encode("utf-8")

# Write only after all six three-way merges succeed.
for relative, data in merged.items():
    destination = ROOT / "patches/wyvern-pod/mod" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    outputs.append({"path": relative, "sha256": hashlib.sha256(data).hexdigest()})

receipt = {
    "schemaVersion": 1,
    "created": "2026-11-03",
    "sourceFiles": inputs,
    "outputs": outputs,
    "method": "LF-normalized git merge-file: PoD + Wyvern with current game as common ancestor; output UTF-8 BOM/CRLF.",
    "evidence": "2026-11-02 23:28 crash logs: body entities missing myv_wyvern_origin; compact portraits missing myv_wyvern_outliner_cooltip. The unsymbolicated C0000005 stack alone cannot prove the crash cause.",
    "CK3Runtime": "NOT_RUN",
}
(ROOT / "patches/wyvern-pod/rendering-sources.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(f"Merged {len(outputs)} render/GUI interfaces; {len(inputs)} pinned inputs")

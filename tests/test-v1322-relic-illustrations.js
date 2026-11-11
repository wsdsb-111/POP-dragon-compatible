"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createHarness } = require("./wyvern-v1311-finite-helper");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p));
const sha = p => crypto.createHash("sha256").update(read(p)).digest("hex");
const manifest = JSON.parse(read("artwork/dragon-relics/illustrations/manifest.json"));
const baseline = JSON.parse(read("artwork/dragon-relics/v1321-presentation.json"));
const h = createHarness(["dragon-relics"]);
const visuals = h.parsePdx(read("patches/dragon-relics/mod/common/artifacts/visuals/mm_dragon_relics.txt").toString());
assert.equal(manifest.assets.length, 7);
assert.deepEqual(manifest.assets.map(a => a.id).sort(), Object.keys(baseline.placeholders).sort());
for (const item of manifest.assets) {
  assert.equal(sha(item.original), item.originalSha256, "archived user original");
  assert.equal(sha(item.cutout), item.cutoutSha256, "reviewed transparent cutout");
  assert.equal(sha(item.framePreview), item.previewSha256);
  assert.equal(sha(item.gameFile), item.gameSha256);
  const dds = read(item.gameFile);
  assert.equal(dds.toString("ascii", 0, 4), "DDS ");
  assert.equal(dds.toString("ascii", 84, 88), "DXT5");
  assert.equal(dds.readUInt32LE(12), 240);
  assert.equal(dds.readUInt32LE(16), 960);
  assert.equal(dds.length, 128 + 960*240);
  let empty = 0, opaque = 0, feathered = 0;
  for (let row = 0; row < 60; row++) {
    const offset = 128 + row*3840;
    const first = dds.subarray(offset, offset+960);
    for (let frame = 1; frame < 4; frame++) assert.deepEqual(dds.subarray(offset+frame*960, offset+(frame+1)*960), first, "all rarity frames contain complete identical artwork");
    for (let column = 0; column < 60; column++) {
      const block = first.subarray(column*16, (column+1)*16);
      const a = block[0], b = block[1];
      const palette = [a, b];
      if (a > b) for (let n = 1; n <= 6; n++) palette.push(((7-n)*a+n*b)/7);
      else { for (let n = 1; n <= 4; n++) palette.push(((5-n)*a+n*b)/5); palette.push(0, 255); }
      let indices = 0n;
      for (let byte = 0; byte < 6; byte++) indices |= BigInt(block[byte+2]) << BigInt(byte*8);
      for (let pixel = 0; pixel < 16; pixel++) {
        const alpha = palette[Number((indices >> BigInt(pixel*3)) & 7n)];
        const x = column*4 + pixel%4, y = row*4 + Math.floor(pixel/4);
        if (x < 12 || x >= 228 || y < 12 || y >= 228) assert.equal(alpha, 0, "clear safe margin without baked frame/background");
        if (alpha === 0) empty++;
        else if (alpha === 255) opaque++;
        else feathered++;
      }
    }
  }
  assert.ok(empty > 10000 && opaque > 100 && feathered > 10, "real transparency with visible subject and antialiased edges");
  for (const kind of ["inventory", "court"]) {
    const visual = visuals.find(n => n.key === "mm_relic_"+item.id+"_"+kind+"_visual").value;
    assert.equal(visual.find(n => n.key === "icon").value, path.basename(item.gameFile));
    assert.equal(visual.find(n => n.key === "asset").value, kind === "inventory" ? baseline.placeholders[item.id].nativeAsset : "mm_relic_"+item.id+"_entity");
  }
}
console.log("v1.3.22 seven user illustrations, transparent BC3 alpha, safe margins, four rarity frames and visual bindings PASS; game display pending");

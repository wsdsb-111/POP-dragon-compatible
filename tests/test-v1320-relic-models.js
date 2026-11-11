"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const dds = require("./wyvern-dxt5-test-helper");
const root = path.resolve(__dirname, "..");
const art = path.join(root, "artwork/dragon-relics/models");
const models = path.join(root, "patches/dragon-relics/mod/gfx/models/artifacts/mm_dragon_relics");
const manifest = JSON.parse(fs.readFileSync(path.join(art, "manifest.json"), "utf8"));
const baseline = fs.readFileSync(path.join(__dirname, "test-wyvern-v116-court-weapons.js"), "utf8");
const start = baseline.indexOf("function requireBytes(");
const end = baseline.indexOf("function assertMesh(");
assert.ok(start > 0 && end > start);
const context = { assert, Buffer };
vm.createContext(context);
vm.runInContext(baseline.slice(start, end) + "globalThis.parseMesh = parsePdxMesh; globalThis.nodes = walkNodes; globalThis.winding = assertOutwardWinding;", context);
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const asset = fs.readFileSync(path.join(models, "mm_dragon_relics.asset"), "utf8");
assert.equal(hash(path.join(models, "mm_dragon_relics.asset")), manifest.assetDefinition.sha256);
assert.equal(Object.keys(manifest.models).length, 7);
for (const [id, info] of Object.entries(manifest.models)) {
  const file = path.join(models, info.meshFile);
  assert.equal(hash(file), info.meshSha256);
  const decoded = context.parseMesh(fs.readFileSync(file), id);
  const parts = context.nodes(decoded).filter(n => n.name === "mesh");
  assert.equal(parts.length, info.submeshes.length);
  let triangles = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].props;
    const count = part.p.length / 3;
    assert.ok(count <= 60000, "draw parts fit the native 16-bit index boundary");
    assert.equal(count, info.submeshes[i].vertices);
    assert.equal(part.n.length, count * 3);
    assert.equal(part.ta.length, count * 4);
    assert.equal(part.u0.length, count * 2);
    assert.equal(part.tri.length / 3, info.submeshes[i].triangles);
    for (const data of [part.p, part.n, part.ta, part.u0]) assert.ok(data.every(Number.isFinite));
    for (const index of part.tri) assert.ok(Number.isInteger(index) && index >= 0 && index < count);
    context.winding(part.p, part.n, part.tri, id + " submesh " + i);
    triangles += part.tri.length / 3;
  }
  assert.equal(triangles, info.triangles);
  assert.ok(triangles >= 200000 && triangles <= 500000, "requested detailed geometry range");
  assert.ok(asset.includes('name = "' + id + '_entity"'));
  assert.equal(hash(path.join(root, info.inventoryIcon.file)), info.inventoryIcon.sha256);
  const icon = fs.readFileSync(path.join(root, info.inventoryIcon.file));
  assert.equal(icon.toString("ascii", 0, 4), "DDS ");
  assert.equal(icon.readUInt32LE(12), 512);
  assert.equal(icon.readUInt32LE(16), 512);
  let transparent = false;
  let opaque = false;
  for (let offset = 128; offset < icon.length; offset += 16) {
    transparent ||= icon[offset] === 0 || icon[offset + 1] === 0;
    opaque ||= icon[offset] >= 200 || icon[offset + 1] >= 200;
  }
  assert.ok(transparent && opaque, "icon contains both transparent background and visible model");
  for (const entry of Object.values(info.editableFiles)) assert.equal(hash(path.join(art, entry.file)), entry.sha256);
  for (const entry of Object.values(info.previews)) assert.equal(hash(path.join(art, entry.file)), entry.sha256);
}
const profile = { width: 2048, height: 2048, mipLevels: 12, propertiesGreenGlobalMax: 75, propertiesGreenNonGemTileMax: 32, gemTiles: [6, 7, 12, 13] };
dds.validateNormal(fs.readFileSync(path.join(models, "mm_dragon_relics_normal.dds")), profile, "relic tangent normal");
const properties = dds.validateProperties(fs.readFileSync(path.join(models, "mm_dragon_relics_properties.dds")), profile, "relic PBR properties", { columns: 4, rows: 4 });
assert.equal(properties.channels.r.max, 0, "metal and stone do not scatter like skin");
for (const info of Object.values(manifest.sharedTextures)) {
  assert.equal(hash(path.join(models, info.dds)), info.ddsSha256);
  assert.equal(hash(path.join(art, info.png)), info.pngSha256);
  const bytes = fs.readFileSync(path.join(models, info.dds));
  assert.equal(bytes.readUInt32LE(12), 2048);
  assert.equal(bytes.readUInt32LE(16), 2048);
  assert.equal(bytes.toString("ascii", 84, 88), "DXT5");
  assert.ok(bytes.readUInt32LE(28) > 1, "mip chain is present");
}
assert.equal(hash(path.join(art, manifest.contactSheet.file)), manifest.contactSheet.sha256);
assert.equal(manifest.contactSheet.offline, true);
console.log("v1.3.20 seven native meshes, winding, split indices, editable sources and material hashes PASS; in-game lighting pending");

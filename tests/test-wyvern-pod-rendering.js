"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const overlay = path.join(root, "patches/wyvern-pod/mod");
const read = file => fs.readFileSync(path.join(overlay, file), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const assetFiles = [
  "gfx/models/portraits/male_body/male_body.asset",
  "gfx/models/portraits/female_body/female_body.asset",
  "gfx/models/portraits/male_head/male_head.asset",
  "gfx/models/portraits/female_head/female_head.asset"
];
for (const file of assetFiles) {
  assert(fs.existsSync(path.join(overlay, file)), "PoD must not replace the Wyvern render interface: " + file);
  const text = read(file);
  assert(!/^(<<<<<<<|=======|>>>>>>>)/m.test(text), "unresolved asset merge: " + file);
  if (file.includes("_body/")) {
    assert(/locator\s*=\s*\{\s*name\s*=\s*"myv_wyvern_origin"/.test(text), "missing dragon attachment: " + file);
    assert(text.includes('name = "myv_human_offscreen"'), "missing body state: " + file);
  } else {
    assert(text.includes('name = "myv_rider_kneeling_head"'), "missing head state: " + file);
  }
}
// Female and child entities use the shared animation sets declared by male assets.
const maleBody = read(assetFiles[0]);
const maleHead = read(assetFiles[2]);
for (const tier of ["hatchling", ...Array.from({ length: 10 }, (_, n) => "tier_" + String(n + 1).padStart(2, "0"))]) {
  assert(maleBody.includes('id = "myv_rider_kneeling_' + tier + '"'), "shared body animation missing: " + tier);
  assert(maleHead.includes('id = "myv_rider_kneeling_head_' + tier + '"'), "shared head animation missing: " + tier);
}
assert(maleBody.includes('id = "myv_human_offscreen"'), "shared offscreen animation missing");
const hud = read("gui/hud_outliner.gui");
assert(/type\s+myv_wyvern_outliner_cooltip\s*=\s*widget/.test(hud), "compact dragon portraits require the actual tooltip type, not just calls");
assert(read("gui/shared/cooltip.gui").includes("myv_wyvern_outliner_cooltip"), "character links retain the creature tooltip branch");
const receipt = JSON.parse(fs.readFileSync(path.join(root, "patches/wyvern-pod/rendering-sources.json"), "utf8"));
assert.equal(receipt.outputs.length, 6);
for (const file of receipt.outputs) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(overlay, file.path))).digest("hex");
  assert.equal(hash, file.sha256, "render output drift: " + file.path);
}
console.log("PoD/Wyvern render attachments, inherited animations and tooltip closure: PASS (static; CK3 runtime not exercised)");

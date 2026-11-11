"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const relative = "common/domiciles/buildings/zzzz_multi_mod_chinese_estate_buildings.txt";
const source = fs.readFileSync(path.join(root, "patches/current-playset-ui/mod", relative), "utf8");
const originalHash = "38e6c6342299859e8d30541c66b8439b047dfcadcf40cd8dc2efb32300f611ea";
function validate(text) {
  const permissions = [...text.matchAll(/allowed_domicile_types = \{ ([^}]+) \}/g)];
  assert.equal(permissions.length, 545, "retain all current large-estate building levels");
  for (const [, types] of permissions) {
    assert.deepEqual(types.trim().split(/\s+/), ["east_asian_estate", "nhe72_palace_estate"]);
  }
  const restored = text.replaceAll("allowed_domicile_types = { east_asian_estate nhe72_palace_estate }", "allowed_domicile_types = { east_asian_estate }");
  assert.equal(crypto.createHash("sha256").update(restored).digest("hex"), originalHash,
    "preserve every upstream building cost, slot, effect, prerequisite and art byte");
}
validate(source);
assert.throws(() => validate(source.replace("east_asian_estate nhe72_palace_estate", "east_asian_estate")));
assert.throws(() => validate(source.replace("construction_time =", "changed_cost =")), /preserve every/);
const modules = JSON.parse(fs.readFileSync(path.join(root, "modules.json"), "utf8"));
const palaceModule = modules.find(entry => entry.id === "palace-estate");
assert(palaceModule.files.includes(relative), "the distributable must contain the building repair");
for (const language of ["simp_chinese", "english"]) {
  const loc = fs.readFileSync(path.join(root, "patches/current-playset-ui/mod/localization", language, "multi_mod_palace_l_" + language + ".yml"), "utf8");
  assert(loc.startsWith("\ufeffl_" + language + ":"));
  for (const type of ["nhe19_estate", "nhe72_palace_estate"]) {
    assert(loc.includes(type + '_domicile_type:0 "$' + type + '$"'));
    assert(loc.includes(type + '_domicile_type_tooltip:0 "$ESTATE$"'));
  }
}
console.log("Palace buildings: PASS (545 levels, original effects preserved, distributable and localization)");

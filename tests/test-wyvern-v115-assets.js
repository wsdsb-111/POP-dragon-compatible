"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const mod = path.join(root, "patches/wyvern-capture/mod");
const art = path.join(root, "artwork/dragon-weapons");
const metadata = JSON.parse(fs.readFileSync(path.join(art, "prompts.json"), "utf8"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
assert.equal(metadata.mode, "built-in image_gen");
assert.equal(metadata.transparentBackground, true);
assert.equal(metadata.assets.length, 2);
for (const entry of metadata.assets) {
  const png = fs.readFileSync(path.join(art, entry.source));
  assert.equal(hash(png), entry.sourceSha256);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
  assert.equal(png[25], 6, "generated source must retain RGBA");
  const dds = fs.readFileSync(path.join(mod, "gfx/interface/icons/artifact", entry.icon));
  assert.equal(hash(dds), entry.iconSha256);
  assert.equal(dds.subarray(0, 4).toString(), "DDS ");
  assert.equal(dds.readUInt32LE(12), 240);
  assert.equal(dds.readUInt32LE(16), 240);
  assert.equal(dds.subarray(84, 88).toString(), "DXT5");
  assert.equal(dds.length, 128 + 60 * 60 * 16);
}
const locales = new Map();
for (const language of ["english", "simp_chinese"]) {
  const bytes = fs.readFileSync(path.join(mod, "localization", language, "mm_wyvern_dragon_forging_l_" + language + ".yml"));
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
  const text = bytes.toString("utf8");
  assert.ok(text.startsWith("\ufeffl_" + language + ":\n"));
  const entries = new Map();
  for (const line of text.split("\n").slice(1).filter(Boolean)) {
    const match = /^ ([\w.]+):0 "(?:[^"\\]|\\.)*"$/.exec(line);
    assert.ok(match, "invalid localization line: " + line);
    assert.ok(!entries.has(match[1]), "duplicate localization: " + match[1]);
    entries.set(match[1], line);
    assert.ok(!line.includes("\\\\n"), "line breaks must use one escape");
  }
  locales.set(language, entries);
}
assert.deepEqual([...locales.get("english").keys()].sort(), [...locales.get("simp_chinese").keys()].sort());
for (const file of ["common/decisions/mm_wyvern_dragon_forging.txt", "events/mm_wyvern_dragon_forging_events.txt", "common/scripted_effects/mm_wyvern_dragon_forging.txt"]) {
  const source = fs.readFileSync(path.join(mod, file), "utf8");
  for (const variant of [source.replaceAll("$TYPE$", "sword"), source.replaceAll("$TYPE$", "bow")]) {
    for (const match of variant.matchAll(/\b(?:name|description|desc|title|selection_tooltip|text|custom_tooltip)\s*=\s*(mm_wyvern_[\w.]+)/g)) {
      // set_variable.name is an internal key, not localization.
      if (["mm_wyvern_weapon_kind"].includes(match[1])) continue;
      for (const [language, entries] of locales) assert.ok(entries.has(match[1]), language + " missing " + match[1]);
    }
  }
}
const materialSource = fs.readFileSync(path.join(mod, "common/scripted_effects/mm_wyvern_trophies.txt"), "utf8");
assert.ok(materialSource.includes("name = mm_wyvern_material_kind value = flag:$KIND$"),
  "personal material creation must persist its concrete kind parameter");
for (const kind of ["fang", "scale", "claw", "horn", "blood"]) {
  assert.match(materialSource, new RegExp("KIND = " + kind + "(?: |\\n)"), "missing material creation parameter " + kind);
}
assert.ok(materialSource.includes("name = mm_wyvern_material_kind value = flag:head"));
assert.ok(!materialSource.includes("name = mm_wyvern_material_kind value = flag:eye"), "no new eye may be created");
for (const language of ["english", "simp_chinese"]) {
  const source = fs.readFileSync(path.join(mod, "localization", language, "mm_wyvern_personal_materials_l_" + language + ".yml"), "utf8");
  assert.ok(source.startsWith("\ufeffl_" + language + ":"), "new personal materials must retain the language header and BOM");
  for (const kind of ["claw", "horn"]) {
    for (const suffix of ["name", "desc"]) {
      const line = source.split(/\r?\n/).find(value => value.startsWith(" mm_wyvern_material_" + kind + "_" + suffix + ":0 "));
      assert.ok(line && line.includes("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]"), "personal material text must identify its source");
    }
    const dds = fs.readFileSync(path.join(mod, "gfx/interface/icons/artifact/mm_wyvern_material_" + kind + ".dds"));
    assert.equal(dds.toString("ascii", 0, 4), "DDS ");
    assert.equal(dds.readUInt32LE(12), 240);
    assert.equal(dds.readUInt32LE(16), 240);
    assert.equal(dds.toString("ascii", 84, 88), "DXT5");
    assert.equal(dds.length, 128 + 60 * 60 * 16);
  }
}
const visuals = fs.readFileSync(path.join(mod, "common/artifacts/visuals/mm_wyvern_dragon_weapons.txt"), "utf8");
assert.ok(visuals.includes("ep1_western_sword_04_a_entity"));
assert.ok(visuals.includes("ep2_steppe_bow_01_a_portrait_entity"));
console.log("Wyvern assets/localization: PASS (weapon and personal-material icons, bilingual keys, typed creation, no new eyes)");

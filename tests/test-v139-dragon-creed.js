"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mod = path.resolve(__dirname, "../patches/dragon-creed/mod");
const read = p => fs.readFileSync(path.join(mod, p), "utf8");
function block(text, key) {
  const match = new RegExp("(?:^|\\n)\\s*" + key + "\\s*=\\s*\\{").exec(text);
  assert.ok(match, `missing ${key}`);
  const start = match.index + match[0].lastIndexOf("{");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(start + 1, i);
  }
  throw new Error(`unclosed ${key}`);
}
const faiths = read("common/religion/faith_types/mm_dragon_creed.txt");
const rites = read("common/religion/rite_types/mm_dragon_creed.txt");
const tenets = read("common/religion/tenet_types/mm_dragon_creed.txt");
const sites = read("common/religion/holy_site_types/mm_dragon_creed.txt");
const religion = read("common/religion/religion_types/mm_dragon_creed.txt");
const triggers = read("common/scripted_triggers/mm_dragon_creed_triggers.txt");
const expected = { fire:["chengdu","jingzhao","baghdad"], earth:["tbilisi","qus","baghdad"], sea:["malta","chandax","baghdad"], sky:["sogn","faereyar","baghdad"], black:["baghdad"], white:["sagami"] };
for (const [branch, counties] of Object.entries(expected)) {
  const id = `mm_dragon_${branch}`;
  const rite = block(rites, id);
  assert.doesNotMatch(faiths, new RegExp(`(?:^|\\n)${id} = \\{`));
  assert.match(rite, /faith = mm_dragon_creed\b/);
  const expectedTenets = [`mm_tenet_${branch}`, `mm_tenet_${branch}_second`, `mm_tenet_${branch}_third`];
  assert.deepEqual(block(rite, "tenets").trim().split(/\s+/), expectedTenets);
  for (const county of counties) {
    assert.match(block(sites, `mm_dragon_site_${county}`), new RegExp(`county = c_${county}\\b`));
    const t = block(triggers, `mm_creed_controls_${county}_holy_site_trigger`);
    assert.ok(t.includes(`exists = title:c_${county}.holder`));
    assert.ok(t.includes(`title:c_${county}.holder = { OR = { this = prev target_is_liege_or_above = prev } }`));
  }
  for (const name of expectedTenets) {
    const icon = /icon\s*=\s*(\w+)/.exec(block(tenets, name));
    assert.ok(icon, `${name} has a texture reference`);
    assert.ok(fs.existsSync(path.join(mod, "gfx/interface/icons/faith_tenets", icon[1] + ".dds")), `${name} resolves to its packaged texture`);
  }
}
const sharedFaith = block(faiths, "mm_dragon_creed");
assert.match(sharedFaith, /main_rite = mm_dragon_black/);
assert.deepEqual(new Set(block(sharedFaith, "eminent_holy_sites").trim().split(/\s+/)), new Set(Object.values(expected).flat().map(x => `mm_dragon_site_${x}`)));
const migration = read("common/on_action/mm_dragon_creed_migration.txt");
assert.match(migration, /on_game_start_after_lobby/);
assert.match(migration, /mm_dragon_creed_repair_v1311/);
assert.match(migration, /every_living_character = \{ mm_dragon_route_creed_effect = yes/);
assert.match(block(triggers, "mm_creed_is_dragon_faith_trigger"), /faith\.religion = religion:mm_dragon_creed_religion/);
assert.match(religion, /doctrine = doctrine_consanguinity_unrestricted/);
assert.doesNotMatch(block(religion, "localization"), /\bakom_/);
for (const lang of ["english", "simp_chinese"]) {
  const loc = fs.readdirSync(path.join(mod, "localization", lang)).filter(f => f.endsWith(".yml")).map(f => read(`localization/${lang}/${f}`)).join("\n");
  const keys = new Set([...loc.matchAll(/^\s*(\w+):\d+\s+"/gm)].map(m => m[1]));
  for (const branch of Object.keys(expected)) {
    for (const suffix of ["", "_adj", "_adherent", "_adherent_plural", "_desc"]) assert.ok(keys.has(`mm_dragon_${branch}${suffix}`));
    for (const suffix of ["_name", "_desc"]) assert.ok(keys.has(`mm_tenet_${branch}${suffix}`));
  }
  for (const ref of block(religion, "localization").match(/\bmm_creed_\w+/g) || []) assert.ok(keys.has(ref), `missing ${lang} ${ref}`);
  for (const county of new Set(Object.values(expected).flat())) assert.ok(keys.has(`holy_site_mm_dragon_site_${county}_name`));
  for (const name of ["blood_purification", "death_servant_punishment"]) for (const suffix of ["_name", "_desc"]) assert.ok(keys.has(`mm_tenet_${name}${suffix}`));
}
console.log("v1.3.9 dragon creed static checks passed (engine behavior not tested)");
const iconDirectory = path.join(mod, "gfx/interface/icons/faith");
for (const name of ["creed", ...Object.keys(expected)]) {
  const bytes = fs.readFileSync(path.join(iconDirectory, `mm_dragon_${name}.dds`));
  assert.equal(bytes.toString("ascii", 0, 4), "DDS ");
  assert.equal(bytes.readUInt32LE(12), 100);
  assert.equal(bytes.readUInt32LE(16), 100);
  if (name !== "creed") {
    assert.match(block(rites, `mm_dragon_${name}`), new RegExp(`icon = mm_dragon_${name}\\b`));
  }
}
assert.match(religion, /doctrine = doctrine_kinslaying_accepted/);
// Current ancestry migration and membership registration are executed by test-v1311-lineage.js.

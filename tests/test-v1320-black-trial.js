"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v1311-finite-helper");
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension", "dragon-death-servants"]);
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function fixture() {
  const mother = h.character("actual-human-mother");
  const father = h.character("actual-human-father");
  const old = h.character("old-source", { traits: ["mm_royal_dragon_king"], vars: { mm_royal_throne: 3 } });
  const emperor = h.character("99001309", { traits: ["mm_royal_black_emperor"] });
  const person = h.character("same-person", { age: 30, traits: ["mm_dragon_black_blood"], mother, father, realFather: father,
    variableLists: { mm_dragon_origins: [old] }, vars: { mm_dragon_origin_1: old, mm_dragon_origin_count: 1, mm_dragon_bio_sea: true }, house: "original-house" });
  person.artifacts = [1, 2, 3, 4].map(throne => {
    const source = h.character("slain-ordinary-" + throne, { alive: false, traits: ["myv_wyvern"], vars: { mm_royal_creation_throne: throne } });
    const item = h.character("material-" + throne, { vars: { mm_wyvern_material_kind: "flag:blood", myv_wyvern_blood_material: 1, mm_wyvern_trophy_source: source } });
    item.kind = "artifact";
    item.artifactType = "miscellaneous";
    item.owner = person;
    return item;
  });
  const env = h.environment({ root: person, year: 1066, stubs: ["mm_dragon_route_creed_hook_effect", "depose", "set_player_character"] });
  env.characters.set("99001309", emperor);
  return { person, env, mother, father, old, emperor };
}

for (const missing of [0, 1, 2, 3]) {
  const s = fixture();
  s.person.artifacts.splice(missing, 1);
  h.run("mm_asc_begin_black_trial_effect", s.person, s.env);
  assert.ok(!s.person.flags.has("mm_asc_black_trial"));
  assert.ok(s.person.artifacts.every(a => !a.destroyed), "missing blood consumes nothing");
}
for (const invalid of ["royal", "unknown-source", "scale", "reforged"]) {
  const s = fixture();
  const item = s.person.artifacts[0];
  if (invalid === "royal") item.vars.get("mm_wyvern_trophy_source").traits.add("mm_royal_dragon_king");
  if (invalid === "unknown-source") item.vars.delete("mm_wyvern_trophy_source");
  if (invalid === "scale") item.vars.set("mm_wyvern_material_kind", "flag:scale");
  if (invalid === "reforged") item.artifactType = "sword";
  assert.equal(h.trigger("mm_asc_black_trial_can_start_trigger", s.person, s.env), false, invalid);
}
{
  const s = fixture();
  assert.equal(h.trigger("mm_asc_black_trial_can_start_trigger", s.person, s.env), true);
  h.run("mm_asc_begin_black_trial_effect", s.person, s.env);
  assert.ok(s.person.artifacts.every(a => a.destroyed));
  assert.ok(s.person.flags.has("mm_asc_black_trial"));
  assert.equal(s.person.xp.get("mm_asc_erosion"), 0);
  h.run("mm_asc_perform_ritual_effect", s.person, s.env);
  assert.deepEqual([s.person.gold, s.person.piety, s.person.prestige], [4750, 4750, 4900]);
  h.run("mm_asc_perform_ritual_effect", s.person, s.env);
  assert.equal(s.person.xp.get("mm_asc_fusion"), 20, "no double charge in one year");
  for (let year = 1067; year <= 1070; year++) {
    s.env.year = year;
    s.env.randomChoices = [{ type: "chance", success: false }];
    h.run("mm_asc_yearly_effect", s.person, s.env);
    h.run("mm_asc_perform_ritual_effect", s.person, s.env);
  }
  assert.ok(s.person.traits.has("mm_dragon_half"), "first generation uses mm_dragon_half, not S trait");
  assert.ok(!s.person.traits.has("mm_dragon_black_blood"));
  assert.equal(s.person.vars.get("mm_dragon_lineage_generation"), 0);
  assert.deepEqual(Array.from(s.person.variableLists.get("mm_dragon_origins")), [s.emperor]);
  assert.equal(s.person.vars.get("mm_dragon_origin_1"), s.emperor);
  assert.equal(s.person.vars.get("mm_dragon_origin_count"), 1);
  assert.equal(s.person.vars.get("mm_dragon_bio_sea"), undefined);
  assert.equal(s.person.vars.get("mm_dragon_bio_black"), true);
  assert.equal(s.person.mother, s.mother);
  assert.equal(s.person.father, s.father);
  assert.equal(s.person.house, "original-house");
  assert.equal(s.person.name, "same-person");
  assert.ok(!s.person.traits.has("mm_royal_black_emperor"));
  assert.ok(!s.person.traits.has("mm_asc_dragon_body"));
  assert.ok(!s.person.traits.has("mm_asc_usurper_blood"));
  assert.equal((s.env.globalLists.get("mm_asc_candidates") || []).length, 0);
  assert.equal(s.person.vars.get("mm_asc_black_trial_outcome"), "flag:success");
}
for (const fusion of [0, 100]) {
  const s = fixture();
  h.run("mm_asc_begin_black_trial_effect", s.person, s.env);
  assert.equal(h.trigger("mm_ds_susceptible_trigger", s.person, s.env), false, "ordinary black blood keeps stress immunity");
  s.person.xp.set("mm_asc_erosion", 100);
  s.person.xp.set("mm_asc_fusion", fusion);
  h.run("mm_asc_resolve_effect", s.person, s.env);
  assert.ok(s.person.traits.has("mm_dragon_death_servant"), "trial failure forces actual death-servant endpoint");
  assert.ok(s.person.flags.has("mm_ds_lost_mind"));
  assert.ok(s.env.globalLists.get("mm_ds_living_servants").includes(s.person));
  assert.equal(s.person.vars.get("mm_asc_black_trial_outcome"), "flag:failed");
  assert.deepEqual(Array.from(s.person.variableLists.get("mm_dragon_origins")), [s.old], "failure does not grant black ancestry");
  assert.ok(!s.person.traits.has("mm_royal_black_emperor"));
}

const breeding = read("patches/wyvern-kings/mod/common/scripted_triggers/zzzzzzzzzz_mm_lineage_breeding_compat.txt");
for (const role of ["mother", "pair"]) assert.match(breeding, new RegExp(`mm_dragon_stable_${role}_valid_trigger = \\{[^\\n]*mm_dragon_is_royal_parent_trigger = no`));
assert.doesNotMatch(breeding.match(/mm_dragon_human_pair_valid_trigger = [^\n]+/)[0], /mm_dragon_is_royal_parent_trigger = no/);
const catalog = read("patches/wyvern-kings/mod/common/scripted_effects/zzzzzzzzzz_mm_lineage_initialization_compat.txt");
assert.ok(catalog.includes("character:99001310"));
assert.ok(!catalog.includes("character:99001309"));
const loc = read("patches/wyvern-bloodline/mod/localization/simp_chinese/mm_dragon_bloodline_l_simp_chinese.yml");
assert.match(loc, /圣骸之血的研究.*制造怪物.*人类怀上怪物的孩子/);
assert.match(loc, /并非白皇与人类直接生育的自然后裔/);
console.log("v1.3.20 black-blood trial finite scenarios PASS; CK3 runtime not tested");

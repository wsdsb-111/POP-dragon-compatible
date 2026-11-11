"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const { preparePodScript } = require("../scripts/prepare-pod-script");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "");
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-pod"]);
// Isolate rank/species logic from geography; origin and map scopes are checked separately.
h.scriptedEffects.set("mm_pod_seed_source_effect", []);
const tierTraits = ["mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4"];
for (const [realAge, tier] of [[0,4],[49,4],[50,3],[99,3],[100,2],[199,2],[200,1],[999,1],[1000,0],[11230,0]]) {
  h.scriptValues.set("true_age", h.parsePdx("value = " + realAge, "age-fixture"));
  const c = h.character("mokole_" + realAge, { age: 20, traits: ["mokole"], name: "Original name", culture: "han", faith: "original_faith" });
  const env = h.environment({ root: c });
  h.run("mm_pod_seed_mokole_effect", c, env);
  assert.equal(c.vars.get("mm_dragon_lineage_generation"), tier, "PoD true age " + realAge);
  assert.deepEqual(tierTraits.filter(t => c.traits.has(t)), [tierTraits[tier]]);
  assert(c.traits.has("mokole") && c.traits.has("mm_pod_mokole_gifts_0"));
  assert.equal(c.name, "Original name"); assert.equal(c.culture, "han"); assert.equal(c.faith, "original_faith");
  c.traits.delete(tierTraits[tier]); c.traits.add("mm_dragon_lineage_1"); c.vars.set("mm_dragon_lineage_generation", 1);
  h.run("mm_pod_seed_mokole_effect", c, env);
  assert(c.traits.has("mm_dragon_lineage_1"), "later promotion is not age-reset");
  assert.equal(c.vars.get("mm_dragon_lineage_generation"), 1);
}
for (const traits of [["mm_dragon_lineage_2","mokole"], ["mm_dragon_black_blood","mokole"]]) {
  h.scriptValues.set("true_age", h.parsePdx("value = 20", "old-save-age"));
  const c = h.character("preserve_" + traits[0], { traits });
  h.run("mm_pod_seed_mokole_effect", c, h.environment({ root:c }));
  assert(c.traits.has(traits[0]), "old-save blood result preserved");
}
for (const [traits, expectRace, expectGifts, expectMortal] of [
  [["myv_wyvern","mortal"],true,true,false],
  [["mm_royal_dragon_king","myv_wyvern_legendary","mortal"],true,true,false],
  [["mokole"],false,true,false],
  [["mortal","mm_dragon_lineage_4"],false,true,true],
  [["vampire"],false,false,false],
  [["mortal"],false,false,true]
]) {
  const c = h.character("species_" + traits.join("_"), { traits });
  h.run("mm_pod_integrate_species_effect", c, h.environment({ root:c }));
  assert.equal(c.traits.has("mm_pod_dragon_race"), expectRace);
  assert.equal(c.traits.has("mm_pod_dragon_gifts") || [0,40,60].some(x=>c.traits.has("mm_pod_mokole_gifts_"+x)), expectGifts);
  assert.equal(c.traits.has("mortal"), expectMortal);
  for (const keep of traits.filter(t=>t!=="mortal")) assert(c.traits.has(keep));
}
const legacy = h.character("legacy_sleep", { traits:["myv_wyvern_legendary","mm_royal_torpor"] });
h.run("mm_pod_migrate_legacy_torpor_effect", legacy, h.environment({ root:legacy }));
assert(legacy.traits.has("torpor") && !legacy.traits.has("mm_royal_torpor"));
assert.equal(preparePodScript("oriental", "common/test.txt", Buffer.from("has_trait = mm_royal_torpor")).toString(), "has_trait = mm_royal_torpor");
assert.equal(preparePodScript("wyvern-pod", "common/test.txt", Buffer.from("has_trait = mm_royal_torpor")).toString(), "has_trait = torpor");
assert.equal(preparePodScript("wyvern-pod", "common/traits/a.txt", Buffer.from("mm_royal_torpor = { birth = 0 }")).toString(), "mm_royal_torpor = { birth = 0 }");
assert.equal(preparePodScript("wyvern-pod", "common/scripted_effects/mm_pod_legacy_torpor.txt", Buffer.from("remove_trait = mm_royal_torpor")).toString(), "remove_trait = mm_royal_torpor");
const effects = read("patches/wyvern-pod/mod/common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_identity.txt");
assert(effects.includes("culture = culture:han culture = culture:tai"));
assert(effects.includes("culture = culture:ancient_egyptian"));
assert(effects.includes("squared_distance(province:"));
assert(!/\b(?:set_culture|set_father|set_mother|create_character|create_dynasty)\s*=/.test(effects));
assert(effects.includes("has_character_flag = mm_pod_initial_founder has_trait = mm_dragon_half exists = scope:mm_pod_chosen_source NOT = { has_character_flag = mm_pod_founder_rite_assigned }"));
const traits = read("patches/wyvern-pod/mod/common/traits/mm_pod_species.txt");
for (const flag of ["regeneration","fera_trait_healing","can_become_ancestor_spirit"]) assert(traits.includes("flag = " + flag));
for (const modifier of ["POD_terrain_umbra_aptitude_advantage = 0.5","POD_terrain_umbra_sense_advantage = 0.05","POD_terrain_umbra_spirit_wilds_access_cancel_negative_supply = yes","POD_terrain_umbra_deep_umbra_access_cancel_negative_supply = yes","POD_terrain_can_damage_spirit_cancel_negative_supply = yes"]) assert(traits.includes(modifier));
const gui = read("patches/wyvern-pod/mod/gui/custom_gui/myv_wyvern_character_window.gui");
assert(!gui.includes("Character.Custom('mm_wyvern_mass_display')"));
assert(gui.includes('text = "mm_wyvern_mass_kilograms_text"') && gui.includes('text = "mm_wyvern_mass_tonnes_text"'));
for (const language of ["simp_chinese","english"]) {
  const loc = read(`patches/wyvern-pod/mod/localization/replace/${language}/zzzzzzzzzzzzzz_mm_pod_identity_l_${language}.yml`);
  assert(!loc.includes("GetCharacterById"));
  assert(loc.includes("GetScriptedCharacterByHistoryID('99001309').GetName"));
  assert(loc.includes("myv_wyvern_panel_age:0 \"[Character.Custom('PODCharacterAge')]\""));
  assert(!loc.includes("之系"));
}
const absorption = read("patches/wyvern-pod/mod/common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_absorption.txt");
assert(absorption.includes("mm_dragon_blood_rank <= scope:mm_dragon_absorption_victim.mm_dragon_blood_rank"));
assert(read("patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_absorption.txt").includes("mm_dragon_blood_rank <= scope:recipient.mm_dragon_blood_rank"));
// Execute the five founder paths without stubbing the biological-origin API.
const f = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-pod"]);
f.scriptValues.set("true_age", f.parsePdx("value = 2000", "founder-age"));
const receipt = JSON.parse(read("patches/wyvern-pod/identity-sources.json"));
assert.deepEqual(receipt.founders.map(x=>x.branch).sort(), ["earth","earth","earth","fire","sea"]);
assert(!receipt.founders.some(x=>x.source===99001309));
for (const mapping of receipt.founders) {
  const c = f.character(String(mapping.id), { traits:["mokole"], culture:"original_culture", faith:"original_faith" });
  c.flags.add("mm_pod_initial_cohort_candidate");
  const env = f.environment({ root:c });
  for (const r of [...receipt.lairs.flatMap(p=>p.ids),99001309,99001310]) {
    env.characters.set(String(r),f.character(String(r), { traits:["myv_wyvern_legendary","mm_royal_dragon_king"] }));
  }
  env.characters.set(c.id,c);
  f.run("mm_pod_seed_mokole_effect",c,env);
  assert(c.traits.has("mm_dragon_half"));
  assert(c.flags.has("mm_pod_initial_founder"));
  assert.equal(c.faith,"faith:mm_dragon_creed");
  assert.equal(c.rite,"rite:mm_dragon_"+mapping.branch);
  assert.equal(c.culture,"original_culture");
  assert.deepEqual(Array.from(c.variableLists.get("mm_dragon_origins") || [],x=>Number(x.id)),[mapping.source]);
  c.faith="player_changed_faith";
  f.run("mm_pod_seed_mokole_effect",c,env);
  assert.equal(c.faith,"player_changed_faith","founder conversion never repeats");
}
for(const [id,oldId,oldRite] of [[795209,99001304,"sky"],[795210,99001310,"white"]]){
  const earth=f.character("99001306",{traits:["mm_royal_dragon_king"],vars:{mm_royal_throne:2}});
  const old=f.character(String(oldId),{traits:[oldRite==="white"?"mm_royal_white_empress":"mm_royal_dragon_king"],vars:{mm_royal_throne:4}});
  const extra=f.character("99001305",{traits:["mm_royal_dragon_king"],vars:{mm_royal_throne:1}});
  const mother=f.character("real-mother"),father=f.character("real-father");
  const c=f.character(String(id),{traits:["mokole","mm_dragon_half"],flags:["mm_pod_initial_founder"],faith:"faith:mm_dragon_creed",rite:"rite:mm_dragon_"+oldRite,mother,father,realFather:father,
    vars:{mm_dragon_origin_count:2,mm_dragon_origin_1:old,mm_dragon_origin_2:extra,mm_dragon_bio_sky:true,mm_dragon_bio_white:true,mm_dragon_absorbed_sky:true,mm_dragon_absorbed_source_count:7},
    variableLists:{mm_dragon_origins:[old,extra],mm_dragon_absorbed_origins:[old]}});
  const env=f.environment({root:c});for(const r of [c,earth,old,extra])env.characters.set(r.id,r);
  f.run("mm_pod_revise_egyptian_founders_effect",c,env);
  assert.deepEqual(Array.from(c.variableLists.get("mm_dragon_origins"),r=>r.id),[extra.id,earth.id]);
  assert.equal(c.vars.get("mm_dragon_origin_count"),2);
  assert.equal(c.vars.get("mm_dragon_origin_1"),extra);assert.equal(c.vars.get("mm_dragon_origin_2"),earth);
  assert(c.vars.has("mm_dragon_bio_earth")&&c.vars.has("mm_dragon_bio_fire"));
  assert(!c.vars.has("mm_dragon_bio_sky")&&!c.vars.has("mm_dragon_bio_white"));
  assert.equal(c.vars.get("mm_dragon_absorbed_source_count"),7);assert(c.vars.has("mm_dragon_absorbed_sky"));
  assert.equal(c.variableLists.get("mm_dragon_absorbed_origins")[0],old);
  assert.equal(c.mother,mother);assert.equal(c.father,father);assert.equal(c.rite,"rite:mm_dragon_earth");
  c.rite="player_changed_rite";f.run("mm_pod_revise_egyptian_founders_effect",c,env);assert.equal(c.rite,"player_changed_rite");
}
{
  const old=f.character("99001310",{traits:["mm_royal_white_empress"]});
  const earth=f.character("99001306",{traits:["mm_royal_dragon_king"],vars:{mm_royal_throne:2}}),unknown=f.character("unclassified-legacy-source");
  const c=f.character("795210",{traits:["mokole","mm_dragon_half"],flags:["mm_pod_initial_founder"],
    vars:{mm_dragon_origin_count:2,mm_dragon_origin_1:old,mm_dragon_origin_2:unknown,mm_dragon_bio_fire:true,mm_dragon_absorbed_sea:true},variableLists:{mm_dragon_origins:[old,unknown]}});
  const env=f.environment({root:c});for(const r of [c,old,earth,unknown])env.characters.set(r.id,r);
  f.run("mm_pod_revise_egyptian_founders_effect",c,env);
  assert.deepEqual(Array.from(c.variableLists.get("mm_dragon_origins"),r=>r.id),[unknown.id,earth.id]);
  assert(c.vars.has("mm_dragon_bio_fire")&&c.vars.has("mm_dragon_bio_earth"),"unknown legacy branches remain protected by the native projection guard");
  assert(c.vars.has("mm_dragon_absorbed_sea"));
}
console.log("PoD identity/rank boundaries, idempotent promotion, species, migration and display: PASS (finite/static; no CK3 runtime)");

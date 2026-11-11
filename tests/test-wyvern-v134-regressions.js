"use strict";
// Independent finite script checks; they do not emulate CK3 fertility or rendering.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v134-finite-helper");
const root = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v134/contract.json"), "utf8"));
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension", "dragon-culture"]);
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const parse = p => h.parsePdx(read(p), p);
const one = (nodes, key) => { const found = nodes.filter(n => n.key === key); assert.equal(found.length, 1, key); return found[0].value; };
const walk = (nodes, key) => nodes.flatMap(n => [...(n.key === key ? [n] : []), ...(Array.isArray(n.value) ? walk(n.value, key) : [])]);
const species = parse("patches/wyvern-capture/mod/common/traits/zzzzz_mm_wyvern_species_health.txt");
for (const name of fixture.species) {
  const trait = one(species, name);
  assert.equal(one(trait, "fertility"), "-1000", name);
  assert.equal(one(trait, "can_have_children"), "no", name);
}
// Execute the actual accepting effect for both sexes, ordinary and royal bodies.
const interaction = one(parse("patches/wyvern-bloodline/mod/common/character_interactions/mm_dragon_breeding.txt"), "mm_dragon_request_half_dragon_interaction");
h.scriptedEffects.set("qa_v134_accept", one(interaction, "on_accept"));
for (const traits of [["myv_wyvern_tamed"], ["myv_wyvern_legendary", "mm_royal_dragon_king"]]) {
  for (const female of [false, true]) {
    const dragon = h.character("dragon", { female, traits, flags: ["mm_wyvern_human_form"], vars: { mm_dragon_feature_count: 0 } });
    Object.assign(dragon, { fertility: -1000, can_have_children: false, is_fertile: false });
    const human = h.character("human", { female: !female });
    dragon.bondedCharacter = human;
    const env = h.environment({ root: human, scopes: { actor: human, recipient: dragon }, stubs: ["mm_dragon_initialize_features_effect"] });
    assert.ok(h.trigger("mm_dragon_consent_pair_valid_trigger", human, env));
    h.run("qa_v134_accept", human, env);
    assert.equal(env.createdEggs.length, 1);
    const egg = env.createdEggs[0];
    assert.equal(egg.vars.get("myv_wyvern_egg_mother"), female ? dragon : human);
    assert.equal(egg.vars.get("myv_wyvern_egg_father"), female ? human : dragon);
    assert.ok(dragon.flags.has("mm_dragon_half_breeding_cooldown"));
    assert.ok(!h.trigger("mm_dragon_consent_pair_valid_trigger", human, env));
    h.run("mm_dragon_hatch_half_egg_effect", egg, env);
    assert.equal(env.createdCharacters.length, 1);
    assert.equal(env.createdCharacters[0].mother, female ? dragon : human);
    assert.equal(env.createdCharacters[0].father, female ? human : dragon);
    assert.equal(env.createdCharacters[0].realFather, female ? human : dragon);
  }
}
// Test actual egg creation with exact references and fertility-disabled parents.
for (const trait of fixture.species) {
  const mother = h.character("mother", { female: true, traits: [trait] });
  const father = h.character("father", { female: false, traits: [trait] });
  Object.assign(mother, { fertility: -1000, can_have_children: false, is_fertile: false });
  Object.assign(father, { fertility: -1000, can_have_children: false, is_fertile: false });
  const owner = h.character("owner");
  const env = h.environment({ root: owner, scopes: { myv_wyvern_egg_mother: mother, myv_wyvern_egg_father: father, myv_wyvern_egg_creator: mother, myv_wyvern_egg_location: { id: "location" } } });
  h.run("myv_create_stable_bred_wyvern_egg_artifact_effect", owner, env);
  assert.equal(env.scopes.myv_wyvern_egg.vars.get("myv_wyvern_egg_mother"), mother);
  assert.equal(env.scopes.myv_wyvern_egg.vars.get("myv_wyvern_egg_father"), father);
}
const guardNames = ["mm_dragon_human_pair_base_trigger", "mm_dragon_human_pair_valid_trigger", "mm_dragon_stable_mother_base_trigger", "mm_dragon_stable_mother_valid_trigger", "mm_dragon_stable_pair_base_trigger", "mm_dragon_stable_pair_valid_trigger", "mm_dragon_breeding_dragon_available_trigger", "mm_dragon_consent_pair_valid_trigger"];
for (const name of guardNames) for (const forbidden of ["fertility", "is_fertile", "can_have_children", "cannot_have_children"]) assert.equal(walk(h.scriptedTriggers.get(name), forbidden).length, 0, name + " does not consult " + forbidden);
const annual = h.scriptedEffects.get("myv_wyvern_stable_yearly_breeding_effect");
for (const forbidden of ["fertility", "is_fertile", "can_have_children", "cannot_have_children"]) assert.equal(walk(annual, forbidden).length, 0);
assert.ok(walk(annual, "myv_create_stable_bred_wyvern_egg_artifact_effect").length >= 3);
assert.ok(!JSON.stringify(annual).includes("mm_dragon_forced_breeding_cooldown"), "annual breeding is independent of manual cooldown");

// Execute the real forced-interaction guard and acceptance, including cooldown.
{
  const keeper = h.character("keeper");
  const county = { kind: "county", id: "stable-county", holder: keeper, provinces: [{ kind: "province", id: "stable-province", buildings: h.character("stable-buildings", { traits: ["myv_wyvern_stable_01"] }).traits }] };
  const mother = h.character("stable-mother", { female: true, traits: ["myv_wyvern_tamed"], flags: ["myv_wyvern_in_stable"], vars: { myv_wyvern_stable_county: county } });
  const father = h.character("stable-father", { traits: ["myv_wyvern_tamed"], flags: ["myv_wyvern_in_stable"], vars: { myv_wyvern_stable_county: county } });
  Object.assign(mother, { fertility: -1000, can_have_children: false, is_fertile: false });
  Object.assign(father, { fertility: -1000, can_have_children: false, is_fertile: false });
  keeper.vars.set("mm_dragon_selected_mother", mother);
  const env = h.environment({ root: keeper, scopes: { actor: keeper, recipient: father } });
  for (const node of h.scriptedTriggers.get("mm_dragon_stable_mother_base_trigger")) {
    h.scriptedTriggers.set("qa_v134_mother_clause", [node]);

    if (node.key === "var:myv_wyvern_stable_county") {
      for (const inner of node.value) {
        h.scriptedTriggers.set("qa_v134_county_clause", [inner]);
        assert.ok(h.trigger("qa_v134_county_clause", county, env, { KEEPER: keeper }), "county clause: " + inner.key);
      }
    }
    assert.ok(h.trigger("qa_v134_mother_clause", mother, env, { KEEPER: keeper }), "mother clause: " + node.key);
  }
  for (const name of ["mm_dragon_stable_mother_base_trigger", "mm_dragon_stable_mother_valid_trigger"]) {
    assert.ok(h.trigger(name, mother, env, { KEEPER: keeper }), name + " fixture");
  }
  for (const node of h.scriptedTriggers.get("mm_dragon_stable_pair_base_trigger")) {
    h.scriptedTriggers.set("qa_v134_pair_clause", [node]);
    assert.ok(h.trigger("qa_v134_pair_clause", father, env, { MOTHER: mother, KEEPER: keeper }), "pair clause: " + node.key);
  }
  assert.ok(h.trigger("mm_dragon_stable_pair_valid_trigger", father, env, { MOTHER: mother, KEEPER: keeper }));
  const interactions = parse("patches/wyvern-bloodline/mod/common/character_interactions/mm_dragon_breeding.txt");
  h.scriptedEffects.set("qa_v134_forced", one(one(interactions, "mm_dragon_force_stable_breeding_interaction"), "on_accept"));
  h.run("qa_v134_forced", keeper, env);
  assert.equal(env.createdEggs.length, 1);
  assert.equal(env.createdEggs[0].vars.get("myv_wyvern_egg_mother"), mother);
  assert.equal(env.createdEggs[0].vars.get("myv_wyvern_egg_father"), father);
  assert.ok(mother.flags.has("mm_dragon_forced_breeding_cooldown"));
  assert.ok(!keeper.vars.has("mm_dragon_selected_mother"));
  assert.ok(!h.trigger("mm_dragon_stable_pair_valid_trigger", father, env, { MOTHER: mother, KEEPER: keeper }));
}
// Execute the actual true-dragon hatch, with only native creation stubbed.
for (const trait of fixture.species) {
  const mother = h.character("hatch-mother", { female: true, traits: [trait] });
  const father = h.character("hatch-father", { traits: [trait] });
  Object.assign(mother, { fertility: -1000, can_have_children: false, is_fertile: false });
  Object.assign(father, { fertility: -1000, can_have_children: false, is_fertile: false });
  const owner = h.character("hatch-owner");
  const egg = h.character("egg", { vars: { myv_wyvern_egg_mother: mother, myv_wyvern_egg_father: father, myv_wyvern_egg_color: 2 } });
  egg.owner = owner;
  const baby = h.character("created-dragon");
  const env = h.environment({ root: egg, scopes: { myv_new_wyvern: baby }, stubs: ["myv_create_tamed_wyvern_effect", "mm_dragon_register_true_dragon_origins_effect", "mm_dragon_assign_regional_identity_effect"] });
  h.run("myv_hatch_wyvern_egg_effect", egg, env);
  assert.equal(baby.mother, mother);
  assert.equal(baby.father, father);
  assert.ok(egg.destroyed);
}
// Shared native eye gene must not be redefined; custom eye assets must not return.
for (const module of ["wyvern-human-form", "wyvern-bloodline", "wyvern-kings", "wyvern-ascension", "wyvern-capture"]) {
  const mod = path.join(root, "patches", module, "mod");
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(txt|asset|gfx)$/i.test(entry.name)) {
        const source = fs.readFileSync(file, "utf8").replace(/#.*$/gm, "");
        assert.ok(!/\bmm_dragon_vertical_eyes\b|\bmm_dragon_eye(?:s|_texture|_accessory)\b/i.test(source), file + " custom eye reference");
        if (file.includes(path.join("common", "genes"))) assert.ok(!/\beye_accessory\s*=\s*\{/.test(source), file + " overrides shared native eye gene");
      }
    }
  }
  scan(mod);
}
for (const [file, group, option] of [
  ["patches/wyvern-bloodline/mod/gfx/portraits/portrait_modifiers/mm_dragon_lineage_golden_eyes.txt", "mm_dragon_lineage_golden_eyes", "dragon_blood_eyes"],
  ["patches/wyvern-human-form/mod/gfx/portraits/portrait_modifiers/mm_dragon_decor.txt", "mm_dragon_pupils_portrait", "dragon_pupils"]
]) {
  const body = one(one(parse(file), group), option);
  const dna = one(body, "dna_modifiers");
  assert.equal(walk(dna, "accessory").length, 0);
  const color = one(dna, "color");
  assert.equal(one(color, "gene"), "eye_color");
  assert.equal(one(color, "mode"), "replace");
  const weight = one(body, "weight");
  assert.equal(one(weight, "base"), "0");
  const rule = one(weight, "modifier").filter(n => n.key !== "add");
  h.scriptedTriggers.set("qa_v134_eye_weight", rule);
  for (const injuries of [[], ["blind"], ["one_eyed"]]) {
    const ordinary = h.character("ordinary", { traits: injuries });
    assert.equal(h.trigger("qa_v134_eye_weight", ordinary, h.environment({ root: ordinary })), false, "ordinary eye/injury DNA unchanged");
  }
  const traits = group === "mm_dragon_lineage_golden_eyes" ? fixture.bloodTraits : ["mm_dragon_pupils"];
  for (const trait of traits) {
    const human = h.character("blood", { traits: [trait] });
    assert.equal(h.trigger("qa_v134_eye_weight", human, h.environment({ root: human })), true, trait);
    for (const dragon of fixture.species) {
      const bodyDragon = h.character("dragon-body", { traits: [trait, dragon] });
      assert.equal(h.trigger("qa_v134_eye_weight", bodyDragon, h.environment({ root: bodyDragon })), false);
    }
  }
}
const nativeGene = fs.readFileSync(process.env.CK3_EYE_GENES || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/genes/02_genes_accessories_misc.txt", "utf8");
assert.match(nativeGene, /\beye_accessory\s*=\s*\{/);
assert.match(nativeGene, /\bnormal_eyes\s*=\s*\{/);


// Seed entry uses a separate roll on each loop, and does not run on old saves.
const seed = h.scriptedEffects.get("mm_royal_seed_initial_population_effect");
const seedCalls = walk(seed, "mm_royal_seed_group_effect");
assert.deepEqual(Array.from(seedCalls, n => [Number(one(n.value, "THRONE")), one(n.value, "CREATOR")]), fixture.thrones.map(([n, id]) => [n, "character:" + id]));
for (let outcome = 0; outcome < 6; outcome++) {
  const creator = h.character("seed-creator");
  const newest = h.character("seed-created");
  const env = h.environment({ root: creator, scopes: { myv_new_wyvern: newest }, randomChoices: [{ type: "list", index: outcome }], stubs: ["mm_royal_create_seed_wyvern_effect"] });
  h.run("mm_royal_seed_group_effect", creator, env, { THRONE: 2, CREATOR: creator });
  assert.equal(env.calls.filter(x => x.effect === "mm_royal_create_seed_wyvern_effect").length, 5 + outcome);
}
{
  const caller = h.character("old-save");
  const env = h.environment({ root: caller, stubs: ["mm_royal_bootstrap_effect", "mm_royal_seed_group_effect", "myv_enforce_wyvern_population_game_rule_effect"] });
  h.run("mm_royal_seed_initial_population_effect", caller, env);
  assert.equal(env.calls.length, 0);
  env.globalVars.set("mm_royal_seed_new_campaign_pending", true);
  h.run("mm_royal_seed_initial_population_effect", caller, env);
  assert.equal(env.calls.filter(c => c.effect === "mm_royal_seed_group_effect").length, 4);
  const count = env.calls.length;
  h.run("mm_royal_seed_initial_population_effect", caller, env);
  assert.equal(env.calls.length, count);
}
const creator = h.scriptedEffects.get("mm_royal_create_seed_wyvern_effect");
const creation = walk(creator, "create_character");
assert.equal(creation.length, 1);
assert.deepEqual(Array.from(one(creation[0].value, "age"), n => n.key), ["12", "150"]);
const after = one(creation[0].value, "after_creation");
assert.equal(walk(after, "myv_roll_wyvern_coordination_effect").length, 1);
assert.equal(walk(after, "myv_refresh_wyvern_prowess_effect").length, 1);
assert.equal(walk(after, "myv_apply_wyvern_identity_effect").length, 1);
assert.equal(walk(after, "mm_dragon_register_true_dragon_origins_effect").length, 1);
assert.ok(JSON.stringify(after).includes("myv_wyvern_expected_size_from_age"));
assert.ok(JSON.stringify(after).includes("myv_wyvern_sanitized_size"));
assert.ok(JSON.stringify(after).includes("myv_wyvern_growth_physique_multiplier"));
assert.ok(JSON.stringify(after).includes("mm_seed_growth_factor"));
// Pure dragons and transformed royal/ascended human forms receive native color only.
for (const [file, group, option, traits] of [
  ["patches/wyvern-human-form/mod/gfx/portraits/portrait_modifiers/mm_dragon_decor.txt", "mm_wyvern_human_golden_eyes", "golden_eyes", fixture.species],
  ["patches/wyvern-kings/mod/gfx/portraits/portrait_modifiers/mm_royal_human_golden_eyes.txt", "mm_royal_human_golden_eyes", "golden_eyes", ["mm_royal_dragon_king", "mm_royal_black_emperor", "mm_royal_white_empress", "mm_royal_complete"]],
  ["patches/wyvern-ascension/mod/gfx/portraits/portrait_modifiers/mm_asc_human_golden_eyes.txt", "mm_asc_human_golden_eyes", "golden_eyes", ["mm_asc_dragon_body"]]
]) {
  const body = one(one(parse(file), group), option);
  const dna = one(body, "dna_modifiers");
  assert.equal(walk(dna, "accessory").length, 0);
  assert.equal(one(one(dna, "color"), "gene"), "eye_color");
  const weight = one(body, "weight");
  assert.equal(one(weight, "base"), "0");
  h.scriptedTriggers.set("qa_v134_form_weight", one(weight, "modifier").filter(n => n.key !== "add"));
  for (const trait of traits) {
    const c = h.character("transformed", { traits: [trait], flags: ["mm_wyvern_human_form"] });
    assert.equal(h.trigger("qa_v134_form_weight", c, h.environment({ root: c })), true, trait);
    c.flags.delete("mm_wyvern_human_form");
    assert.equal(h.trigger("qa_v134_form_weight", c, h.environment({ root: c })), false, trait + " dragon body");
    c.flags.add("mm_wyvern_human_form"); c.flags.add("mm_asc_dragon_form");
    assert.equal(h.trigger("qa_v134_form_weight", c, h.environment({ root: c })), false, trait + " ascension body");
  }
}

// Execute the real seed creator and native value definitions with independent
// fixed cases. The harness chooses only the engine random outcome and age.
{
  const nativeRoot = process.env.CK3_WYVERN_MOD_DIR || "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
  const values = h.parsePdx(fs.readFileSync(path.join(nativeRoot, "common/script_values/myv_wyvern_values.txt"), "utf8"), "native wyvern values");
  for (const name of ["myv_wyvern_expected_size_from_age", "myv_wyvern_growth_physique_multiplier", "myv_wyvern_sanitized_size", "myv_wyvern_size_min"]) h.scriptValues.set(name, one(values, name));
  const effects = h.parsePdx(fs.readFileSync(path.join(nativeRoot, "common/scripted_effects/myv_wyvern_effects.txt"), "utf8"), "native wyvern effects");
  h.scriptedEffects.set("myv_roll_wyvern_coordination_effect", one(effects, "myv_roll_wyvern_coordination_effect"));
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v134/seed-cases.json"), "utf8"));
  for (const sample of cases) {
    const host = h.character("seed-host");
    const env = h.environment({ root: host, randomChoices: sample.rolls.map(index => ({ type: "list", index })), stubs: ["myv_roll_wyvern_color_effect", "mm_dragon_register_true_dragon_origins_effect", "mm_dragon_assign_regional_identity_effect", "myv_apply_wyvern_identity_effect", "myv_refresh_wyvern_prowess_effect", "myv_enforce_wyvern_population_game_rule_effect"] });
    const localProvince = { id: "fire-birthplace", culture: { id: "han", pillars: ["heritage_chinese"] }, regions: ["world_asia_east"] };
    env.provinces = [{ id: "wrong-region", culture: { id: "norse", pillars: ["heritage_north_germanic"] }, regions: ["world_europe_north"] }, localProvince];
    env.globalVars.set("mm_royal_seed_throne", 1);
    env.creationAge = sample.age;
    h.run("mm_royal_create_seed_wyvern_effect", host, env);
    assert.equal(env.createdCharacters.length, 1);
    const newborn = env.createdCharacters[0];
    assert.equal(newborn.age, sample.age);
    assert.equal(newborn.location, localProvince);
    assert.equal(newborn.culture, localProvince.culture);
    assert.equal(newborn.genderFemaleChance, 50);
    assert.ok(newborn.traits.has(sample.physique));
    assert.ok(newborn.traits.has(sample.coordination));
    assert.ok(Math.abs(newborn.vars.get("myv_wyvern_size") - sample.size) < 1e-8, "native age/physique/growth size for " + sample.age);
    assert.ok(!newborn.vars.has("mm_seed_growth_factor"));
    assert.deepEqual(Array.from(env.calls, x => x.effect), ["myv_roll_wyvern_color_effect", "mm_dragon_register_true_dragon_origins_effect", "mm_dragon_assign_regional_identity_effect", "myv_apply_wyvern_identity_effect", "myv_refresh_wyvern_prowess_effect", "myv_enforce_wyvern_population_game_rule_effect"]);
  }
}
console.log("V134 finite independent regression passed; CK3 runtime and rendering remain unverified.");

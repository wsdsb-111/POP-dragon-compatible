"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const requirements = require("./fixtures/v132/independent-requirements.json");
const contract = requirements.naturalBirth;
const h = createHarness(["wyvern-bloodline"]);
const root = path.resolve(__dirname, "..");
const activeBlood = [...contract.eligibleParentTraits, "mm_dragon_black_blood"];

{
  const person = h.character("native-global-list-member");
  const env = h.environment({ root: person });
  env.globalLists.set("qa_members", [person]);
  h.scriptedTriggers.set("qa_native_global_list", h.parsePdx("qa = { any_in_global_list = { variable = qa_members always = yes } }", "native list")[0].value);
  assert.ok(h.trigger("qa_native_global_list", person, env));
  h.scriptedTriggers.set("qa_invalid_global_list", h.parsePdx("qa = { any_in_list = { global_variable = qa_members always = yes } }", "invalid list")[0].value);
  assert.throws(() => h.trigger("qa_invalid_global_list", person, env), /do not accept a global_variable selector/);
}

function parent(id, trait, origins = []) {
  return h.character(id, { traits: [trait], variableLists: { mm_dragon_origins: origins } });
}
function birth(mother, realFather, success = false) {
  const child = h.character("child");
  const env = h.environment({ root: child, scopes: { mother, real_father: realFather }, randomChoices: [success] });
  h.run("mm_dragon_inherit_natural_blood_effect", child, env);
  return { child, env };
}
function origins(character) { return Array.from(character.variableLists.get("mm_dragon_origins") || []); }

assert.equal(Number(h.scriptValues.get("mm_dragon_black_mutation_chance")), contract.blackChance);
{
  const dragonMother = h.character("pure-dragon-mother-with-old-tier", { traits: ["myv_wyvern_tamed", "mm_dragon_lineage_1"] });
  const dragonFather = h.character("pure-dragon-father-with-old-tier", { traits: ["myv_wyvern_legendary", "mm_dragon_half"] });
  const child = h.character("pure-dragon-newborn", { traits: ["myv_wyvern"] });
  const env = h.environment({ root: child, scopes: { mother: dragonMother, real_father: dragonFather } });
  h.run("mm_dragon_inherit_natural_blood_effect", child, env);
  assert.equal(env.randomRolls.length, 0, "residual mixed tier on true dragons never seeds a black-blood roll");
  assert.ok(!child.traits.has("mm_dragon_black_blood"));
}
for (const [index, trait] of contract.eligibleParentTraits.entries()) {
  for (const role of ["mother", "real_father"]) {
    for (const success of [false, true]) {
      const source = h.character("exact-" + trait + "-" + role);
      const p = parent("qualifying-parent", trait, [source]);
      const other = h.character("ordinary-other");
      const { child, env } = birth(role === "mother" ? p : other, role === "real_father" ? p : other, success);
      assert.equal(env.randomRolls.length, 1, trait + "/" + role + " has one mutation trial");
      assert.equal(env.randomRolls[0].chance, contract.blackChance);
      const expected = success ? "mm_dragon_black_blood" : contract.failureChildTraits[index];
      assert.deepEqual(activeBlood.filter(value => child.traits.has(value)), expected ? [expected] : []);
      assert.deepEqual(origins(child), expected ? [source] : []);
      const before = JSON.stringify({ traits: Array.from(child.traits), vars: Array.from(child.vars), flags: Array.from(child.flags) }, (key, value) => key === "variableLists" ? undefined : value);
      env.randomChoices.push(!success);
      h.run("mm_dragon_inherit_natural_blood_effect", child, env);
      assert.equal(env.randomRolls.length, 1, "repeat birth hook cannot re-roll " + trait);
      assert.equal(JSON.stringify({ traits: Array.from(child.traits), vars: Array.from(child.vars), flags: Array.from(child.flags) }, (key, value) => key === "variableLists" ? undefined : value), before);
    }
  }
}

// Every ordered pairing of first-generation/S/A/B/C uses the stronger
// biological parent's tier minus one; black mutation is a separate single roll.
for (const [motherIndex, motherTrait] of contract.eligibleParentTraits.entries()) {
  for (const [fatherIndex, fatherTrait] of contract.eligibleParentTraits.entries()) {
    for (const success of [false, true]) {
      const motherOrigin = h.character("matrix-maternal-source");
      const fatherOrigin = h.character("matrix-paternal-source");
      const mother = parent("matrix-mother", motherTrait, [motherOrigin]);
      const father = parent("matrix-father", fatherTrait, [fatherOrigin]);
      const { child, env } = birth(mother, father, success);
      const baseTrait = contract.failureChildTraits[Math.min(motherIndex, fatherIndex)];
      const expected = success ? "mm_dragon_black_blood" : baseTrait;
      assert.deepEqual(activeBlood.filter(trait => child.traits.has(trait)), expected ? [expected] : [], motherTrait + " / " + fatherTrait);
      assert.equal(env.randomRolls.length, 1, "two mixed parents do not double the black mutation trial");
      assert.equal(env.randomRolls[0].chance, contract.blackChance);
      assert.deepEqual(origins(child), expected ? [motherOrigin, fatherOrigin] : [], "tier selection preserves both biological sources while blood remains active");
    }
  }
}

for (const success of [false, true]) {
  const distantSource = h.character("distant-source", { name: "Same displayed name" });
  const closeSource = h.character("closer-source", { name: "Same displayed name" });
  const mother = parent("weaker-mother", "mm_dragon_lineage_4", [distantSource]);
  const father = parent("stronger-father", "mm_dragon_half", [closeSource]);
  const { child, env } = birth(mother, father, success);
  assert.deepEqual(origins(child), [distantSource, closeSource], "grade selection cannot erase weaker or same-name exact ancestry");
  assert.ok(child.traits.has(success ? "mm_dragon_black_blood" : "mm_dragon_lineage_1"));
  assert.equal(env.randomRolls.length, 1, "two eligible parents still produce one trial");
}

{
  const exact = Array.from({ length: contract.ancestryStressCount }, (_, index) => h.character("origin-" + index, { name: "Identical name" }));
  const mother = parent("mother", "mm_dragon_half", exact.slice(0, 17));
  const father = parent("father", "mm_dragon_lineage_2", exact.slice(15));
  const { child } = birth(mother, father);
  assert.deepEqual(origins(child), exact, "the authoritative multi-source list never truncates at sixteen");
  assert.equal(new Set(origins(child)).size, contract.ancestryStressCount);
  assert.equal(child.vars.get("mm_dragon_origin_16"), exact[15], "legacy sixteen-slot UI projection stays compatible");
  assert.deepEqual(origins(mother), exact.slice(0, 17), "parent ancestry is not mutated during merge");
}

{
  const bio = h.character("biological-fire", { vars: { mm_dragon_bio_fire: true } });
  const absorbed = h.character("absorbed-sea", { vars: { mm_dragon_bio_sea: true } });
  const p = parent("parent-with-acquired-power", "mm_dragon_half", [bio]);
  const appendEnv = h.environment({ root: absorbed });
  h.run("mm_dragon_append_absorbed_origin_effect", absorbed, appendEnv, { TARGET: p });
  assert.deepEqual(origins(p), [bio], "absorption cannot rewrite biological ancestry");
  assert.deepEqual(Array.from(p.variableLists.get("mm_dragon_absorbed_sources")), [absorbed]);
  assert.ok(p.traits.has("mm_dragon_branch_sea"), "acquired power is visible on its recipient");
  const { child } = birth(p, h.character("ordinary-father"));
  assert.deepEqual(origins(child), [bio]);
  assert.ok(!child.traits.has("mm_dragon_branch_sea"), "acquired sea branch cannot become inherited biology");
}

{
  const source = h.character("black-only-origin");
  const rebel = parent("black-parent", "mm_dragon_black_blood", [source]);
  for (const mutation of [false, true]) {
    const { child, env } = birth(rebel, h.character("ordinary-human"), mutation);
    assert.deepEqual(activeBlood.filter(value => child.traits.has(value)), [mutation ? "mm_dragon_black_blood" : "mm_dragon_lineage_4"]);
    assert.deepEqual(origins(child), [source]);
    assert.equal(env.randomRolls.length, 1, "single black parent receives the ordinary mutation roll");
    assert.equal(env.randomRolls[0].chance, 10);
  }
  const normalSource = h.character("normal-branch");
  const mixed = birth(rebel, parent("normal-A", "mm_dragon_lineage_2", [normalSource]));
  assert.ok(mixed.child.traits.has("mm_dragon_lineage_3"), "black + A has B as its ordinary baseline");
  assert.deepEqual(new Set(origins(mixed.child)), new Set([source, normalSource]));
  const other = parent("second-black-parent", "mm_dragon_black_blood", [normalSource]);
  const dual = birth(rebel, other);
  assert.ok(dual.child.traits.has("mm_dragon_black_blood"));
  assert.equal(dual.env.randomRolls.length, 0, "double black parentage is deterministic");
  assert.deepEqual(new Set(origins(dual.child)), new Set([source, normalSource]));
}

{
  const old = h.character("legacy-exact-origin");
  const added = h.character("new-exact-origin");
  const target = h.character("old-slot-only-person", { vars: { mm_dragon_origin_1: old } });
  const env = h.environment({ root: added });
  h.run("mm_dragon_append_biological_origin_effect", added, env, { CHILD: target });
  assert.deepEqual(origins(target), [old, added], "slot-only old save is prepared before a new source is appended");
  assert.equal(target.vars.get("mm_dragon_origin_1"), old);
  assert.equal(target.vars.get("mm_dragon_origin_count"), 2);
}

const traits = h.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-bloodline/mod/common/traits/mm_dragon_bloodline.txt"), "utf8"), "bloodline traits");
const black = traits.find(node => node.key === "mm_dragon_black_blood").value;
for (const [key, expected] of Object.entries(contract.blackPersonal)) assert.equal(Number(h.scalar(black, key, "black blood")), expected);
assert.ok(!black.some(node => /commander|army|advantage|knight|levy|men_at_arms/.test(node.key)), "black blood grants no army/commander buff");

for (const [index, trait] of ["mm_dragon_lineage_4", "mm_dragon_lineage_3", "mm_dragon_lineage_2"].entries()) {
  const threshold = requirements.absorption.thresholds[index];
  const promoted = ["mm_dragon_lineage_3", "mm_dragon_lineage_2", "mm_dragon_lineage_1"][index];
  const key = ["mm_dragon_absorption_c_to_b", "mm_dragon_absorption_b_to_a", "mm_dragon_absorption_a_to_s"][index];
  assert.equal(Number(h.scriptValues.get(key)), threshold);
  const hunter = parent("threshold-hunter", trait);
  const env = h.environment({ root: hunter });
  hunter.vars.set("mm_dragon_absorption_points", threshold - 1);
  h.run("mm_dragon_apply_absorption_upgrade_effect", hunter, env);
  assert.ok(hunter.traits.has(trait), "one below threshold cannot promote");
  hunter.vars.set("mm_dragon_absorption_points", threshold + 1000);
  h.run("mm_dragon_apply_absorption_upgrade_effect", hunter, env);
  assert.ok(hunter.traits.has(promoted), "one call promotes exactly one grade even with huge surplus");
  assert.equal(hunter.vars.get("mm_dragon_absorption_points"), 1000);
  assert.ok(!hunter.traits.has("mm_dragon_half"), "absorption never manufactures initial generation");
}
for (const trait of ["mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_black_blood"]) {
  const hunter = parent("capped-hunter", trait);
  hunter.vars.set("mm_dragon_absorption_points", 99999);
  h.run("mm_dragon_apply_absorption_upgrade_effect", hunter, h.environment({ root: hunter }));
  assert.deepEqual(activeBlood.filter(value => hunter.traits.has(value)), [trait], trait + " cannot promote by absorption");
}
for (const valid of [true, false]) {
  const hunter = parent("hunter", "mm_dragon_lineage_4");
  const prey = h.character("actual-victim", { alive: false, traits: ["mm_dragon_lineage_1"], deathReason: "death_duel" });
  prey.vars.set("mm_dragon_blood_hunt_opponent", hunter);
  hunter.vars.set("mm_dragon_blood_hunt_opponent", valid ? prey : h.character("other-hunt"));
  const env = h.environment({ root: prey, scopes: { killer: hunter } });
  h.run("mm_dragon_absorb_death_effect", prey, env);
  assert.equal(hunter.vars.get("mm_dragon_absorption_points") || 0, valid ? 3 : 0, "killer must be bound to this exact duel victim");
  h.run("mm_dragon_absorb_death_effect", prey, env);
  assert.equal(hunter.vars.get("mm_dragon_absorption_points") || 0, valid ? 3 : 0, "duplicate death callback never grants twice");
}
for (const reason of ["death_murder", "death_execution", "death_old_age", "death_mm_royal_devoured"]) {
  const hunter = parent("hunter", "mm_dragon_lineage_4");
  const prey = h.character("non-hunt-victim", { alive: false, traits: ["mm_dragon_lineage_1"], deathReason: reason });
  prey.vars.set("mm_dragon_blood_hunt_opponent", hunter); hunter.vars.set("mm_dragon_blood_hunt_opponent", prey);
  h.run("mm_dragon_absorb_death_effect", prey, h.environment({ root: prey, scopes: { killer: hunter } }));
  assert.ok(!hunter.vars.has("mm_dragon_absorption_points"), reason + " is not a blood hunt");
}

for (const validCount of requirements.families.validCountyCounts) {
  const cultures = requirements.families.sea.map(id => "culture:" + id);
  const host = h.character("living-host");
  const source = h.character("exact-seed-source");
  const people = cultures.slice(0, validCount).flatMap((culture, c) => Array.from({ length: 5 }, (_, i) => {
    const person = h.character("existing-" + c + "-" + i, { age: 50, culture });
    person.house = { id: "house-" + c + "-" + i, dynasty: "dynasty-" + c + "-" + i };
    person.dynasty = person.house.dynasty;
    return person;
  }));
  const before = people.map(person => [person.name, person.house, person.dynasty]);
  const env = h.environment({ root: host, scopes: { mm_dragon_seed_origin_a: source } });
  env.globalLists.set("mm_dragon_seed_people", people);
  for (const culture of cultures) h.run("mm_dragon_seed_add_culture_effect", host, env, { CULTURE: culture });
  h.run("mm_dragon_seed_run_group_effect", host, env);
  const founders = people.filter(person => person.flags.has("mm_dragon_seed_family_founder"));
  const distribution = cultures.slice(0, validCount).map(culture => founders.filter(person => person.culture === culture).length).sort((a, b) => a - b);
  assert.deepEqual(Array.from(distribution), requirements.families.expectedDistributions[validCount], "available cultures distribute five existing founders evenly");
  assert.equal(env.createdCharacters.length, 0, "no new people or independent dynasties");
  assert.deepEqual(people.map(person => [person.name, person.house, person.dynasty]), before);
  assert.equal(founders.filter(person => person.traits.has("mm_dragon_lineage_1")).length, validCount ? 1 : 0);
}

{
  const host = h.character("sparse-host");
  const source = h.character("sparse-source");
  const sharedHouse = { id: "shared", dynasty: "shared" };
  const people = ["a", "b"].flatMap(culture => Array.from({ length: culture === "a" ? 3 : 4 }, (_, i) => {
    const person = h.character(culture + i, { age: 50, culture: "culture:" + culture });
    person.house = culture === "a" ? sharedHouse : { id: culture + i, dynasty: culture + i };
    return person;
  }));
  const env = h.environment({ root: host, scopes: { mm_dragon_seed_origin_a: source } });
  env.globalLists.set("mm_dragon_seed_people", people);
  for (const culture of ["a", "b"]) h.run("mm_dragon_seed_add_culture_effect", host, env, { CULTURE: "culture:" + culture });
  h.run("mm_dragon_seed_run_group_effect", host, env);
  const founders = people.filter(person => person.flags.has("mm_dragon_seed_family_founder"));
  assert.equal(founders.length, 5, "exhausted cultures do not consume the remaining eligible slots");
  assert.equal(founders.filter(person => person.house === sharedHouse).length, 1, "only one founder per existing House");
  assert.equal(env.createdCharacters.length, 0);
}

{
  const seed = createHarness(["wyvern-bloodline"]);
  const host = seed.character("empty-round-host");
  const source = seed.character("empty-round-source");
  const culture = "culture:single";
  const people = ["first", "second"].map(id => {
    const person = seed.character(id, { age: 50, culture });
    person.house = { id, dynasty: id };
    return person;
  });
  const env = seed.environment({ root: host, scopes: { mm_dragon_seed_origin_a: source } });
  env.globalLists.set("mm_dragon_seed_people", people);
  env.globalLists.set("mm_dragon_seed_cultures", [culture]);
  env.globalLists.set("mm_dragon_seed_round", [culture]);
  env.globalVars.set("mm_dragon_seed_family_index", 0);

  seed.run("mm_dragon_seed_next_family_effect", host, env);
  assert.ok(env.globalLists.has("mm_dragon_seed_round"));
  assert.equal(env.globalLists.get("mm_dragon_seed_round").length, 0, "removing the only round entry leaves an existing empty list");
  seed.run("mm_dragon_seed_next_family_effect", host, env);

  const founders = people.filter(person => person.flags.has("mm_dragon_seed_family_founder"));
  assert.equal(founders.length, 2, "an existing empty round is refilled for the next family");
  assert.equal(new Set(founders.map(person => person.house)).size, 2, "refilling still skips an already used House");
  assert.equal(env.createdCharacters.length, 0, "empty-list recovery reuses existing people");
}

{
  const mother = h.character("seed-mother", { age: 40 });
  const father = h.character("seed-father", { age: 40 });
  mother.house = { id: "maternal", dynasty: "maternal" };
  father.house = { id: "paternal", dynasty: "paternal" };
  const child = h.character("two-source-seed-child", { age: 10, mother, realFather: father });
  const fire = h.character("seed-fire-source", { vars: { mm_dragon_bio_fire: true } });
  const sea = h.character("seed-sea-source", { vars: { mm_dragon_bio_sea: true } });
  const env = h.environment({ root: mother, scopes: { mm_dragon_seed_founder: mother, mm_dragon_seed_origin: fire } });
  env.globalLists.set("mm_dragon_seed_people", [mother, father, child]);
  env.globalVars.set("mm_dragon_seed_family_index", 0);
  h.run("mm_dragon_seed_create_family_effect", mother, env);
  env.scopes.mm_dragon_seed_founder = father;
  env.scopes.mm_dragon_seed_origin = sea;
  h.run("mm_dragon_seed_create_family_effect", father, env);
  assert.deepEqual(origins(child), [fire, sea], "cross-House biological sources merge rather than overwrite");
  assert.equal(child.vars.get("mm_dragon_lineage_generation"), 2, "multi-source child retains the stronger inherited tier");
  assert.equal(child.realFather, father);
  assert.equal(child.mother, mother);
}

for (const startMode of ["new", "repair"]) {
  const seed = createHarness(["wyvern-bloodline", "wyvern-kings"]);
  const actions = seed.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-bloodline/mod/common/on_action/mm_dragon_lineage_initialization.txt"), "utf8"), "seed on_actions");
  seed.scriptedEffects.set("qa_campaign_initialization", seed.first(actions.find(node => node.key === "mm_dragon_seed_initialize_campaign").value, "effect").value);
  const host = seed.character("host");
  const cultures = [...new Set(["fire", "sea", "sky", "earth", "white"].flatMap(group => requirements.families[group]))];
  const people = cultures.flatMap(culture => Array.from({ length: 5 }, (_, i) => {
    const person = seed.character(culture + "-" + i, { age: 50, culture: "culture:" + culture });
    person.house = { id: person.id, dynasty: person.id };
    return person;
  }));
  const env = seed.environment({ root: host, stubs: ["mm_royal_bootstrap_effect"] });
  env.globalVars.set("mm_royal_catalog_initialized", true);
  for (const person of people) env.characters.set(person.id, person);
  for (const id of requirements.ascension.seatIds) env.characters.set(id, seed.character(id, { traits: [id === "99001310" ? "mm_royal_white_empress" : id === "99001309" ? "mm_royal_black_emperor" : "mm_royal_dragon_king"] }));
  seed.run("qa_campaign_initialization", host, env);
  assert.ok(people.every(person => !person.flags.has("mm_dragon_seed_family_founder")), "unmarked old saves are not seeded");
  const decisions = seed.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-bloodline/mod/common/decisions/mm_dragon_recovery_decisions.txt"), "utf8"), "seed recovery decision");
  const repair = decisions.find(node => node.key === "mm_dragon_repair_seed_families_decision").value;
  seed.scriptedTriggers.set("qa_seed_repair_shown", seed.first(repair, "is_shown").value);
  seed.scriptedEffects.set("qa_seed_repair", seed.first(repair, "effect").value);
  if (startMode === "repair") {
    env.globalVars.set("mm_lineage_families_initialized_v132", true);
    env.globalVars.set("mm_dragon_seed_families_repaired_v1322", true);
    assert.ok(seed.trigger("qa_seed_repair_shown", host, env), "the old consumed attempt flag does not block a failed save from retrying");
    for (const person of people) env.characters.delete(person.id);
    seed.run("qa_seed_repair", host, env);
    assert.equal(seed.scalar(env.events.at(-1), "on_action", "repair callback"), "mm_dragon_seed_initialize_campaign");
    seed.run("qa_campaign_initialization", host, env);
    assert.equal(env.globalVars.get("mm_dragon_seed_assigned_founders"), 0);
    assert.ok(!env.globalVars.has("mm_dragon_seed_families_confirmed_v1322"), "zero candidates never mark success");
    assert.ok(seed.trigger("qa_seed_repair_shown", host, env), "failed allocation remains retryable");
    for (const person of people) env.characters.set(person.id, person);
    seed.run("qa_seed_repair", host, env);
  } else {
    env.globalVars.set("mm_dragon_seed_new_campaign_pending", true);
  }
  seed.run("qa_campaign_initialization", host, env);
  const founders = people.filter(person => person.flags.has("mm_dragon_seed_family_founder"));
  assert.equal(founders.length, 25);
  assert.equal(env.globalVars.get("mm_dragon_seed_assigned_founders"), 25);
  assert.ok(env.globalVars.has("mm_dragon_seed_families_confirmed_v1322"));
  assert.ok(!seed.trigger("qa_seed_repair_shown", host, env), "a successful allocation cannot be repeated");
  assert.equal(env.createdCharacters.length, 0);
  const allowedSources = new Set(["99001001", "99001305", "99001003", "99001307", "99001304", "99001308", "99001002", "99001306", "99001310"]);
  assert.ok(founders.every(person => allowedSources.has(origins(person)[0]?.id)), "black emperor never seeds an initial family");
  assert.equal(founders.filter(person => person.traits.has("mm_dragon_lineage_1")).length, 5);
  assert.equal(Array.from(env.globalLists.get("mm_dragon_seed_people")).length, 0);
  assert.equal(Array.from(env.globalLists.get("mm_dragon_seed_houses")).length, 0);
  assert.ok(people.every(person => !person.flags.has("mm_dragon_seed_existing_carrier")));
  const state = people.map(person => [...person.traits]);
  seed.run("qa_campaign_initialization", host, env);
  assert.deepEqual(people.map(person => [...person.traits]), state, "reload cannot seed another cohort");
}

{
  const full = createHarness(["wyvern-bloodline", "wyvern-kings"]);
  for (const femaleHuman of [true, false]) {
    for (const royal of [true, false]) {
      const human = full.character("consenting-human", { female: femaleHuman });
      const dragon = full.character("consenting-dragon", {
        female: !femaleHuman,
        traits: royal ? ["myv_wyvern_legendary", "mm_royal_dragon_king"] : ["myv_wyvern_tamed"],
        flags: ["mm_wyvern_human_form"], vars: { mm_dragon_feature_count: 0 },
      });
      dragon.bondedCharacter = human;
      const env = full.environment({ root: human, scopes: { mm_dragon_half_dragon_parent: dragon } });
      assert.ok(full.trigger("mm_dragon_human_pair_valid_trigger", dragon, env, { FATHER: human }), "unbathed consenting adults of either sex are eligible");
      full.run("mm_dragon_create_half_egg_effect", human, env);
      assert.equal(env.createdEggs.length, 1);
      const egg = env.createdEggs[0];
      assert.equal(egg.vars.get("myv_wyvern_egg_mother"), femaleHuman ? human : dragon);
      assert.equal(egg.vars.get("myv_wyvern_egg_father"), femaleHuman ? dragon : human);
      assert.equal(egg.vars.get("mm_dragon_frozen_birth_generation"), royal ? 0 : 1, "only actual royal parent produces first generation; ordinary dragon produces S");
      assert.equal(env.randomRolls.length, 0, "ordinary human plus true dragon does not get a mixed-parent mutation trial");
    }
  }
  const interaction = full.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-bloodline/mod/common/character_interactions/mm_dragon_breeding.txt"), "utf8"), "human/dragon consent interaction")
    .find(node => node.key === "mm_dragon_request_half_dragon_interaction").value;
  assert.equal(full.scalar(interaction, "auto_accept", "consent interaction"), "no");
  assert.ok(!full.first(interaction, "on_send"), "sending alone cannot create a child");
  assert.ok(!full.first(interaction, "on_decline"), "declining cannot create a child");
  full.scriptedEffects.set("qa_accept_pair", full.first(interaction, "on_accept").value);
  for (const femaleDragon of [true, false]) {
    const dragon = full.character("player-dragon", { female: femaleDragon, traits: ["mm_royal_dragon_king"], flags: ["mm_wyvern_human_form"] });
    const human = full.character("human-consenting-recipient", { female: !femaleDragon });
    dragon.bondedCharacter = human;
    const env = full.environment({ root: dragon, scopes: { actor: dragon, recipient: human }, stubs: ["mm_dragon_initialize_features_effect"] });
    full.run("qa_accept_pair", dragon, env);
    assert.equal(env.createdEggs.length, 1, "a player royal dragon can personally propose the permitted pairing");
    assert.equal(env.createdEggs[0].owner, dragon, "actor owns the new egg without becoming a biological parent substitute");
    assert.equal(env.createdEggs[0].vars.get("myv_wyvern_egg_mother"), femaleDragon ? dragon : human);
    assert.equal(env.createdEggs[0].vars.get("myv_wyvern_egg_father"), femaleDragon ? human : dragon);
    assert.equal(env.createdEggs[0].vars.get("mm_dragon_frozen_birth_generation"), 0);
  }
}
{
  const current = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"]);
  function sovereign(id, female) {
    const dragon = current.character(id, { female, traits: ["mm_asc_dragon_body", "mm_royal_dragon_king", "mm_dragon_lineage_4"], flags: ["mm_wyvern_human_form"], vars: { mm_asc_outcome: "flag:dragon", mm_royal_throne: 1 } });
    const anchor = current.character("original-seat-" + id, { alive: false });
    anchor.vars.set("mm_asc_current_incarnation", dragon); dragon.vars.set("mm_asc_seat_anchor", anchor);
    return dragon;
  }
  for (const relation of ["spouse", "lover", "soulmate"]) {
    for (const femaleDragon of [true, false]) {
      const dragon = sovereign("independent-royal-" + relation + femaleDragon, femaleDragon);
      const human = current.character("human-partner", { female: !femaleDragon });
      dragon.relations.set(relation, new Set([human]));
      const env = current.environment({ root: dragon, scopes: { actor: dragon, recipient: human } });
      assert.ok(current.trigger("mm_dragon_is_independent_royal_parent_trigger", dragon, env));
      assert.ok(current.trigger("mm_dragon_consent_pair_valid_trigger", dragon, env), relation + " permits an independent royal's explicitly consenting pair");
      const reverse = current.environment({ root: human, scopes: { actor: human, recipient: dragon } });
      assert.ok(current.trigger("mm_dragon_consent_pair_valid_trigger", human, reverse), "either partner may propose");
      dragon.flags.add("mm_dragon_half_breeding_cooldown");
      assert.ok(!current.trigger("mm_dragon_consent_pair_valid_trigger", dragon, env), "independent relationship cannot bypass cooldown");
      dragon.flags.delete("mm_dragon_half_breeding_cooldown");
      human.age = 17;
      assert.ok(!current.trigger("mm_dragon_consent_pair_valid_trigger", dragon, env), "independent relationship cannot bypass adulthood");
      human.age = 30; dragon.closeFamilyIds.add(human.id);
      assert.ok(!current.trigger("mm_dragon_consent_pair_valid_trigger", dragon, env), "independent relationship cannot bypass close-family exclusion");
    }
  }
  const human = current.character("lover-human", { female: true });
  for (const traits of [["myv_wyvern_tamed"], ["myv_wyvern_legendary", "mm_royal_dragon_king"], ["mm_asc_dragon_body", "mm_wyvern_bathed_in_dragon_blood"]]) {
    const dragon = current.character("not-independent", { traits, flags: ["mm_wyvern_human_form"], vars: { mm_asc_outcome: "flag:fusion" } });
    dragon.relations.set("lover", new Set([human]));
    const env = current.environment({ root: dragon });
    assert.ok(!current.trigger("mm_dragon_is_independent_royal_parent_trigger", dragon, env));
    assert.ok(!current.trigger("mm_dragon_human_pair_valid_trigger", dragon, env, { FATHER: human }), "native/tamed and fusion-only bodies cannot replace a required MYV bond with a lover relation");
  }
  for (const royal of [true, false]) {
    for (const dragonIsMother of [true, false]) {
      for (const humanTrait of [null, ...contract.eligibleParentTraits]) {
        for (const success of [false, true]) {
          const dragon = royal ? sovereign("actual-royal-parent", dragonIsMother) : current.character("actual-ordinary-dragon", { female: dragonIsMother, traits: ["myv_wyvern_tamed"] });
          const humanOrigin = current.character("human-side-exact-origin");
          const human = current.character("actual-human-parent", { female: !dragonIsMother, traits: humanTrait ? [humanTrait] : [], variableLists: { mm_dragon_origins: humanTrait ? [humanOrigin] : [] } });
          const child = current.character("natural-genesis-newborn");
          const env = current.environment({ root: child, scopes: { mother: dragonIsMother ? dragon : human, real_father: dragonIsMother ? human : dragon }, randomChoices: [success] });
          current.run("mm_dragon_inherit_natural_blood_effect", child, env);
          assert.ok(child.traits.has(royal ? "mm_dragon_half" : "mm_dragon_lineage_1"), "direct dragon parentage fixes the royal/ordinary grade");
          assert.equal(env.randomRolls.length, 0, "human mixed blood never rerolls a direct dragon birth");
          assert.ok(origins(child).includes(dragon), "the exact dragon parent remains a biological source");
          if (humanTrait) assert.ok(origins(child).includes(humanOrigin), "the human parent's legitimate ancestry is retained");
          current.run("mm_dragon_inherit_natural_blood_effect", child, env);
          assert.equal(env.randomRolls.length, 0, "natural genesis is once-only and cannot reroll a direct dragon birth");
        }
      }
    }
  }
  const fusion = current.character("fusion-borrowed-shape", { traits: ["mm_asc_dragon_body", "mm_wyvern_bathed_in_dragon_blood"], vars: { mm_asc_outcome: "flag:fusion" } });
  const child = current.character("no-third-path-child");
  const env = current.environment({ root: child, scopes: { mother: fusion, real_father: current.character("ordinary-human") } });
  current.run("mm_dragon_inherit_natural_blood_effect", child, env);
  assert.deepEqual(activeBlood.filter(trait => child.traits.has(trait)), [], "borrowing dragon appearance never creates a third blood-family path");
  assert.equal(env.randomRolls.length, 0);
}

function forceHatchFixture(normalCreation = true) {
  const seed = createHarness(["wyvern-bloodline"]);
  const decisions = seed.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-bloodline/mod/common/decisions/mm_dragon_recovery_decisions.txt"), "utf8"), "dragon recovery decisions");
  const decision = decisions.find(node => node.key === "mm_dragon_force_hatch_decision").value;
  seed.scriptedTriggers.set("qa_force_hatch_shown", seed.first(decision, "is_shown").value);
  seed.scriptedTriggers.set("qa_force_hatch_valid", seed.first(decision, "is_valid").value);
  const noOpEffects = [
    "mm_dragon_apply_egg_features_effect",
    "mm_dragon_append_biological_origin_effect",
    "mm_dragon_copy_biological_origins_effect",
    "mm_dragon_register_true_dragon_origins_effect",
    "mm_dragon_assign_regional_identity_effect",
  ];
  for (const name of noOpEffects) seed.scriptedEffects.set(name, []);
  if (normalCreation) {
    seed.scriptedEffects.set("myv_create_tamed_wyvern_effect", seed.parsePdx(`
      myv_create_tamed_wyvern_effect = {
        create_character = { age = 0 after_creation = { save_scope_as = myv_new_wyvern } }
      }
    `, "normal hatch creation stub")[0].value);
  } else seed.scriptedEffects.set("myv_create_tamed_wyvern_effect", []);
  return seed;
}

function addOwnedEgg(owner, id, { half = false, mother, father, equipped = false, hatchedChild } = {}) {
  const vars = new owner.vars.constructor([["myv_wyvern_egg_color", 2]]);
  if (half) vars.set("mm_dragon_half_egg", true);
  if (mother) vars.set("myv_wyvern_egg_mother", mother);
  if (father) vars.set("myv_wyvern_egg_father", father);
  if (hatchedChild) vars.set("mm_dragon_hatched_child", hatchedChild);
  const egg = { kind: "artifact", id, vars, variableLists: new owner.variableLists.constructor(), owner, location: owner.location, destroyed: false, is_equipped: equipped };
  owner.artifacts.push(egg);
  return egg;
}

{
  const force = forceHatchFixture();
  const owner = force.character("equipped-egg-owner", { gold: 100, piety: 250 });
  const mother = force.character("normal-egg-mother", { female: true });
  const father = force.character("normal-egg-father", { female: false });
  const inventoryEgg = addOwnedEgg(owner, "inventory-normal-egg", { mother, father });
  const equippedEgg = addOwnedEgg(owner, "equipped-normal-egg", { mother, father, equipped: true });
  const env = force.environment({ root: owner });
  assert.ok(force.trigger("qa_force_hatch_shown", owner, env));
  assert.ok(force.trigger("qa_force_hatch_valid", owner, env), "exactly sufficient gold and piety permit hatching");

  force.run("mm_dragon_force_hatch_effect", owner, env);

  assert.equal(env.createdCharacters.length, 1, "one decision hatches only one eligible egg");
  assert.equal(env.createdCharacters[0].mother, mother, "normal hatch preserves the egg's exact recorded mother");
  assert.equal(env.createdCharacters[0].father, father, "normal hatch preserves the egg's exact recorded father");
  assert.equal(equippedEgg.destroyed, true, "an eligible equipped egg takes priority over inventory eggs");
  assert.equal(inventoryEgg.destroyed, false);
  assert.equal(owner.gold, 0);
  assert.equal(owner.piety, 0);
  assert.deepEqual(Array.from(env.payments, payment => [payment.resource, payment.amount]), [["gold", -100], ["piety", -250]]);
  assert.equal(env.randomRolls.length, 0, "force hatch does not roll a hatch chance");
}

{
  const force = forceHatchFixture();
  const owner = force.character("inventory-egg-owner", { gold: 400, piety: 600 });
  const mother = force.character("half-egg-mother", { female: true });
  const father = force.character("half-egg-father", { female: false });
  const ordinaryEgg = addOwnedEgg(owner, "ordinary-inventory-egg", { mother, father });
  const halfEgg = addOwnedEgg(owner, "half-inventory-egg", { half: true, mother, father });
  const env = force.environment({ root: owner, randomChoices: [1] });
  assert.ok(force.trigger("qa_force_hatch_valid", owner, env));

  force.run("mm_dragon_force_hatch_effect", owner, env);

  const child = env.createdCharacters[0];
  assert.equal(env.createdCharacters.length, 1, "inventory selection hatches only one egg");
  assert.equal(child.mother, mother);
  assert.equal(child.father, father);
  assert.equal(child.realFather, father, "half-egg hatch preserves the exact biological father");
  assert.equal(halfEgg.vars.get("mm_dragon_hatched_child"), child);
  assert.equal(halfEgg.vars.has("mm_dragon_hatch_started"), true, "successful hatch remains locked against duplicate callbacks");
  assert.equal(halfEgg.destroyed, true);
  assert.equal(ordinaryEgg.destroyed, false, "without equipped eggs, a random eligible inventory egg is selected");
  assert.equal(owner.gold, 300);
  assert.equal(owner.piety, 350);
  assert.deepEqual(Array.from(env.payments, payment => [payment.resource, payment.amount]), [["gold", -100], ["piety", -250]]);
}

{
  const force = forceHatchFixture();
  const owner = force.character("non-owner", { gold: 500, piety: 500 });
  const other = force.character("actual-egg-owner");
  addOwnedEgg(other, "another-characters-egg");
  const env = force.environment({ root: owner });
  assert.equal(force.trigger("qa_force_hatch_shown", owner, env), false, "another character's egg is not shown as owned");
  assert.equal(force.trigger("qa_force_hatch_valid", owner, env), false);
  force.run("mm_dragon_force_hatch_effect", owner, env);
  assert.equal(env.createdCharacters.length, 0);
  assert.equal(env.payments.length, 0);
}

for (const funds of [{ gold: 99, piety: 250 }, { gold: 100, piety: 249 }]) {
  const force = forceHatchFixture();
  const owner = force.character("underfunded-owner", funds);
  const egg = addOwnedEgg(owner, "underfunded-egg");
  const env = force.environment({ root: owner });
  assert.equal(force.trigger("qa_force_hatch_valid", owner, env), false, "each resource minimum is checked independently");
  force.run("mm_dragon_force_hatch_effect", owner, env);
  assert.equal(egg.destroyed, false);
  assert.equal(env.createdCharacters.length, 0);
  assert.equal(env.payments.length, 0);
}

for (const invalid of ["wrong-sex-parents", "already-hatched"]) {
  const force = forceHatchFixture();
  const owner = force.character("invalid-egg-owner", { gold: 500, piety: 500 });
  const mother = force.character("stored-mother", { female: invalid !== "wrong-sex-parents" });
  const father = force.character("stored-father", { female: invalid === "wrong-sex-parents" });
  const priorChild = force.character("recorded-hatched-child");
  const egg = addOwnedEgg(owner, "invalid-half-egg", { half: true, mother, father, hatchedChild: invalid === "already-hatched" ? priorChild : undefined });
  const env = force.environment({ root: owner });
  assert.ok(force.trigger("qa_force_hatch_shown", owner, env), "an owned colored egg remains visible for recovery");
  assert.equal(force.trigger("qa_force_hatch_valid", owner, env), false, invalid + " is ineligible");
  force.run("mm_dragon_force_hatch_effect", owner, env);
  assert.equal(egg.destroyed, false);
  assert.equal(env.createdCharacters.length, 0, "invalid or already hatched eggs cannot duplicate a child");
  assert.equal(env.payments.length, 0);
  if (invalid === "already-hatched") assert.equal(egg.vars.get("mm_dragon_hatched_child"), priorChild);
}

{
  const force = forceHatchFixture(false);
  const owner = force.character("failed-hatch-owner", { gold: 500, piety: 500 });
  const egg = addOwnedEgg(owner, "failed-normal-egg");
  const staleChild = force.character("stale-saved-child");
  const env = force.environment({ root: owner, scopes: { mm_dragon_new_child: staleChild, myv_new_wyvern: staleChild } });
  assert.ok(force.trigger("qa_force_hatch_valid", owner, env));

  force.run("mm_dragon_force_hatch_effect", owner, env);

  assert.equal(env.createdCharacters.length, 0);
  assert.equal(egg.destroyed, false, "an egg is retained if creation did not return a child");
  assert.equal(owner.gold, 500);
  assert.equal(owner.piety, 500);
  assert.equal(env.payments.length, 0, "failed creation incurs no cost, even with stale child scopes preloaded");
}

console.log("Wyvern v1.3.2 independent lineage finite fixtures passed; culture initialization and hunt callback runtime require separate CK3 verification.");

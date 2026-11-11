"use strict";

// Independent expected roster and game data, not generated from the implementation.
// This finite inspection cannot substitute for a new-game CK3 acceptance run.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v133/royal-hotfix-contract.json"), "utf8"));
const root = path.resolve(__dirname, "..");
const kings = path.join(root, "patches/wyvern-kings/mod");
const gameTitles = process.env.CK3_LANDED_TITLES || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/landed_titles";
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"]);
const parse = file => h.parsePdx(fs.readFileSync(file, "utf8"), file);
const all = (nodes, key) => nodes.filter(node => node.key === key);
function walk(nodes, key) {
  return nodes.flatMap(node => [ ...(node.key === key ? [node] : []), ...(Array.isArray(node.value) ? walk(node.value, key) : []) ]);
}
function only(nodes, key, label) {
  const found = all(nodes, key);
  assert.equal(found.length, 1, label + " must have exactly one " + key);
  return found[0].value;
}
const history = parse(path.join(kings, "history/characters/myv_historical_wyverns.txt"));
const bootstrap = h.scriptedEffects.get("mm_royal_bootstrap_effect");
assert.ok(bootstrap, "production royal bootstrap exists");
assert.equal(new Set(fixture.characters.map(c => c.id)).size, 10);
assert.equal(fixture.characters.filter(c => c.awake).length, 4);
// The full native titles file uses constructs outside the finite parser. Extract
// one top-level county block while respecting quoted strings and comments.
function countyBlock(source, county) {
  const matches = [...source.matchAll(new RegExp("^[\\t ]*" + county + "[\\t ]*=[\\t ]*\\{", "gm"))];
  assert.equal(matches.length, 1, county + " occurs once in native titles");
  const start = matches[0].index;
  const open = source.indexOf("{", start);
  let depth = 0;
  let quoted = false;
  let comment = false;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (comment) { if (ch === "\n") comment = false; continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === "#") { comment = true; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(county + " native title block is unclosed");
}
const titleCache = new Map();
for (const spec of fixture.characters) {
  const state = only(history, spec.id, spec.id + " history");
  assert.equal(only(state, "name", spec.id), spec.name);
  assert.equal(all(state, "trait").some(t => t.value === "mm_royal_torpor"), true, spec.id + " v1310 initial torpor");
  assert.equal(all(state, "father")[0]?.value, spec.twin ? fixture.father : undefined, spec.id + " father");
  assert.equal(all(state, "mother")[0]?.value, spec.twin ? fixture.mother : undefined, spec.id + " mother");
  const identities = walk(bootstrap, "character:" + spec.id).filter(node => all(node.value, "set_location").length);
  assert.equal(identities.length, 1, spec.id + " has one initial location");
  assert.equal(only(identities[0].value, "set_location", spec.id), "province:" + spec.province);
  const lairs = all(identities[0].value, "set_variable").filter(node => all(node.value, "name").some(n => n.value === "myv_wyvern_lair_barony"));
  assert.equal(lairs.length, 1, spec.id + " has one lair");
  assert.equal(only(lairs[0].value, "value", spec.id + " lair"), "province:" + spec.province + ".barony");
  if (!titleCache.has(spec.titleFile)) titleCache.set(spec.titleFile, fs.readFileSync(path.join(gameTitles, spec.titleFile), "utf8"));
  const counties = h.parsePdx(countyBlock(titleCache.get(spec.titleFile), spec.county), spec.county);
  assert.equal(counties.length, 1, spec.county + " occurs once in native titles");
  const county = counties[0].value;
  const baronies = county.filter(node => node.key.startsWith("b_") && Array.isArray(node.value));
  const explicitCapital = all(county, "capital");
  assert.ok(explicitCapital.length <= 1, spec.county + " has at most one capital override");
  assert.equal(explicitCapital[0]?.value || baronies[0]?.key, spec.barony, spec.county + " capital barony");
  const barony = only(county, spec.barony, spec.county);
  assert.equal(only(barony, "province", spec.barony), String(spec.province), spec.barony + " native province");
}

// Exercise production trimming with independent ordinary and protected seed fixtures.
for (const cap of [0, 5, 10]) {
  const actor = h.character("cap-caller");
  const seeded = Array.from({ length: 20 }, (_, i) => h.character("seed-" + i, {
    age: 1000 + i, traits: ["myv_wyvern"], flags: ["mm_royal_initial_descendant"]
  }));
  const ordinary = Array.from({ length: 12 }, (_, i) => h.character("ordinary-" + i, {
    age: 100 + i, traits: ["myv_wyvern"]
  }));
  const env = h.environment({ root: actor });
  env.globalLists.set("myv_living_wyverns", [...seeded, ...ordinary]);
  env.globalVars.set("myv_wyvern_population_count", seeded.length + ordinary.length);
  h.run("myv_trim_wyvern_population_to_effect", actor, env, { CAP: cap });
  assert.ok(seeded.every(c => c.alive), "seeded descendants survive native population trimming");
  assert.equal(ordinary.filter(c => c.alive).length, cap, "native cap still trims other ordinary dragons");
  assert.equal(env.globalVars.get("myv_wyvern_population_count"), seeded.length + cap);
  const deathCount = env.deaths.length;
  h.run("myv_trim_wyvern_population_to_effect", actor, env, { CAP: cap });
  assert.equal(env.deaths.length, deathCount, "repeat trimming is idempotent");
}

// No source may be invented when an unmarked old dragon has no parent or seed context.
{
  const old = h.character("legacy-unknown", { traits: ["myv_wyvern"] });
  const env = h.environment({ root: old });
  env.globalVars.set("mm_royal_catalog_initialized", true);
  h.run("mm_royal_assign_creation_effect", old, env);
  assert.ok(!old.vars.has("mm_royal_creation_throne"), "unknown old dragon never gets a random creation source");
  assert.equal(old.relations.size, 0);
}
for (const [throne, branch] of [[1, "fire"], [2, "earth"], [3, "sea"], [4, "sky"]]) {
  for (const trait of ["myv_wyvern", "mm_dragon_half"]) {
    const character = h.character("branch-" + throne + "-" + trait, {
      traits: [trait], vars: { mm_royal_creation_throne: throne }
    });
    h.run("mm_dragon_refresh_branch_traits_effect", character, h.environment({ root: character }));
    const actual = ["fire", "earth", "sea", "sky"].filter(name => character.traits.has("mm_dragon_branch_" + name));
    assert.deepEqual(actual, [branch], "ordinary and mixed descendants display the recorded source branch");
  }
  const royal = h.character("royal-" + throne, {
    traits: ["myv_wyvern_legendary", "mm_royal_dragon_king", "mm_dragon_branch_" + branch],
    vars: { mm_royal_creation_throne: throne, ["mm_dragon_bio_" + branch]: true }
  });
  h.run("mm_dragon_refresh_branch_traits_effect", royal, h.environment({ root: royal }));
  assert.ok(!royal.traits.has("mm_dragon_branch_" + branch), "true royalty has no branch trait");
  assert.equal(royal.vars.get("mm_dragon_bio_" + branch), true, "royal biological source survives trait cleanup");
}


// Execute the real guard and group loops, stubbing only engine creation/bootstrap.
{
  const caller = h.character("new-campaign");
  const env = h.environment({ root: caller, stubs: ["mm_royal_bootstrap_effect", "mm_royal_seed_group_effect", "myv_enforce_wyvern_population_game_rule_effect"] });
  h.run("mm_royal_seed_initial_population_effect", caller, env);
  assert.equal(env.calls.length, 0, "existing saves without the new-campaign marker do not seed");
  env.globalVars.set("mm_royal_seed_new_campaign_pending", true);
  h.run("mm_royal_seed_initial_population_effect", caller, env);
  assert.equal(env.calls.filter(call => call.effect === "mm_royal_seed_group_effect").length, 4, "one new campaign runs exactly four groups");
  assert.ok(env.globalVars.has("mm_royal_seed_population_initialized"));
  assert.ok(!env.globalVars.has("mm_royal_seed_new_campaign_pending"));
  const calls = env.calls.length;
  h.run("mm_royal_seed_initial_population_effect", caller, env);
  assert.equal(env.calls.length, calls, "repeat initialization cannot create a second cohort");
}
for (let outcome = 0; outcome < 6; outcome++) {
  const creator = h.character("seed-creator");
  const newWyvern = h.character("mock-engine-created-wyvern");
  const env = h.environment({ root: creator, scopes: { myv_new_wyvern: newWyvern }, randomChoices: [{ type: "list", index: outcome }], stubs: ["mm_royal_create_seed_wyvern_effect"] });
  h.run("mm_royal_seed_group_effect", creator, env, { THRONE: 2, CREATOR: creator });
  assert.equal(env.calls.filter(call => call.effect === "mm_royal_create_seed_wyvern_effect").length, outcome + 5, "each of six group outcomes creates its exact requested count");
  assert.equal(env.globalVars.get("mm_royal_seed_throne"), 2);
  assert.ok(newWyvern.flags.has("mm_royal_initial_descendant"));
}
const groupCalls = all(h.scriptedEffects.get("mm_royal_seed_initial_population_effect")[0].value, "mm_royal_seed_group_effect");
assert.deepEqual(Array.from(groupCalls, call => [only(call.value, "THRONE", "group"), only(call.value, "CREATOR", "group")]), [
  ["1", "character:99001305"], ["2", "character:99001306"], ["3", "character:99001003"], ["4", "character:99001308"]
], "each creation group uses its awake royal and correct throne");

const onActions = parse(path.join(kings, "common/on_action/zzzzzzzz_mm_royal_seed_population.txt"));
assert.ok(walk(onActions, "set_global_variable").some(node => all(node.value, "name").some(name => name.value === "mm_royal_seed_new_campaign_pending")), "new game marks a pending cohort");
assert.ok(walk(onActions, "mm_royal_seed_initial_population_effect").length === 1, "after-lobby action calls the seed entry once");
for (const [throne, expectedParents] of [[1, ["99001001", "99001305"]], [2, ["99001002", "99001306"]], [3, ["99001003", "99001307"]], [4, ["99001304", "99001308"]]]) {
  const dragon = h.character("seed-source-" + throne, { traits: ["myv_wyvern"] });
  const env = h.environment({ root: dragon });
  env.globalVars.set("mm_royal_catalog_initialized", true);
  env.globalVars.set("mm_royal_seed_throne", throne);
  for (const id of expectedParents) env.characters.set(id, h.character(id));
  h.run("mm_royal_assign_creation_effect", dragon, env);
  assert.equal(dragon.vars.get("mm_royal_creation_throne"), throne, "seed source is assigned before any random choice");
  assert.deepEqual(Array.from(dragon.relations.get("mm_dragon_creator") || [], c => c.id).sort(), expectedParents.slice().sort());
}

// The initial native wild spawn is a separate engine backend. Execute the
// actual on_action wrapper and registration; stub only that backend's result.
{
  const monthly = parse(path.join(kings, "common/on_action/zzzzzzzz_mm_royal_monthly.txt"));
  const wrapper = only(monthly, "myv_initial_random_wild_wyvern_spawn", "initial wild on_action");
  const body = only(wrapper, "effect", "initial wild on_action");
  h.scriptedEffects.set("qa_initial_wild_wrapper", body);
  const backend = "myv_spawn_initial_random_wild_wyvern_effect";
  const savedBackend = h.scriptedEffects.get(backend);
  function fakeBackend(outcome) {
    const successFlag = outcome === "success" || outcome === "flag-only";
    const successScope = outcome === "success" || outcome === "scope-only";
    const code = "qa_backend = { change_global_variable = { name = qa_backend_calls add = 1 } " +
      (successFlag ? "set_global_variable = { name = myv_initial_random_wild_wyvern_spawned value = yes } " : "") +
      (successScope ? "scope:qa_new_wyvern = { save_scope_as = myv_new_wyvern } " : "") + "}";
    h.scriptedEffects.set(backend, h.parsePdx(code, "QA native creation stub")[0].value);
  }
  for (const outcome of ["success", "failure", "flag-only", "scope-only", "already-spawned"]) {
    const caller = h.character("wild-spawn-caller");
    const wild = h.character("wild-new", { traits: ["myv_wyvern"] });
    const env = h.environment({ root: caller, scopes: { qa_new_wyvern: wild }, randomChoices: [{ type: "list", index: 0 }] });
    env.globalVars.set("mm_royal_catalog_initialized", true);
    for (const id of ["99001001", "99001305", "99001002", "99001306", "99001003", "99001307", "99001304", "99001308"]) {
      env.characters.set(id, h.character(id));
    }
    fakeBackend(outcome);
    if (outcome === "already-spawned") env.globalVars.set("myv_initial_random_wild_wyvern_spawned", true);
    h.run("qa_initial_wild_wrapper", caller, env);
    assert.equal(env.globalVars.get("qa_backend_calls") || 0, outcome === "already-spawned" ? 0 : 1, outcome + " backend calls");
    assert.ok(!wild.flags.has("mm_royal_newly_created"), outcome + " clears the temporary creation marker");
    if (outcome === "success") {
      assert.equal(wild.vars.get("mm_royal_creation_throne"), 1, "successful fresh wild creation registers its selected source");
      assert.ok(wild.variableLists.get("mm_dragon_origins")?.includes(wild), "actual registration records the new wild dragon source");
      const relationCount = wild.relations.get("mm_dragon_creator")?.size;
      h.run("qa_initial_wild_wrapper", caller, env);
      assert.equal(env.globalVars.get("qa_backend_calls"), 1, "repeated successful spawn never invokes the backend twice");
      assert.equal(wild.relations.get("mm_dragon_creator")?.size, relationCount, "repeat leaves registered provenance unchanged");
    } else {
      assert.ok(!wild.vars.has("mm_royal_creation_throne"), outcome + " does not invent a creation source");
      assert.ok(!wild.variableLists.has("mm_dragon_origins"), outcome + " does not register a wild dragon");
      h.run("qa_initial_wild_wrapper", caller, env);
      const expectedCalls = outcome === "already-spawned" ? 0 : outcome === "flag-only" ? 1 : 2;
      assert.equal(env.globalVars.get("qa_backend_calls") || 0, expectedCalls, outcome + " repeats only while unmarked");
      assert.ok(!wild.vars.has("mm_royal_creation_throne"), outcome + " repeat does not invent a source");
    }
  }
  if (savedBackend) h.scriptedEffects.set(backend, savedBackend);
  else h.scriptedEffects.delete(backend);
  h.scriptedEffects.delete("qa_initial_wild_wrapper");
}

// Evaluate the real portrait weight predicates for seeded bloodline humans,
// without fabricating the optional pupils trait or relying on portrait rendering.
{
  const bloodFile = path.join(root, "patches/wyvern-bloodline/mod/gfx/portraits/portrait_modifiers/mm_dragon_lineage_golden_eyes.txt");
  const pupilFile = path.join(root, "patches/wyvern-human-form/mod/gfx/portraits/portrait_modifiers/mm_dragon_decor.txt");
  const blood = only(parse(bloodFile), "mm_dragon_lineage_golden_eyes", "blood eyes");
  const pupils = only(parse(pupilFile), "mm_dragon_pupils_portrait", "pupil eyes");
  assert.ok(Number(only(blood, "priority", "blood eyes")) > Number(only(pupils, "priority", "pupil eyes")));
  function weight(modifier, group) {
    const body = only(modifier, group, group);
    const dna = only(body, "dna_modifiers", group);
    const accessory = only(dna, "color", group);
    assert.equal(only(accessory, "mode", group), "replace");
    assert.equal(only(accessory, "gene", group), "eye_color");
    assert.equal(all(dna, "accessory").length, 0, "native eye mesh remains intact");
    const weights = only(body, "weight", group);
    assert.equal(only(weights, "base", group), "0");
    const rules = only(weights, "modifier", group);
    assert.ok(Number(only(rules, "add", group)) > 0);
    return rules;
  }
  function matches(nodes, traits, flags) {
    return nodes.every(node => {
      if (node.key === "add") return true;
      if (node.key === "portrait_has_trait_trigger") return traits.has(only(node.value, "TRAIT", "portrait trait"));
      if (node.key === "has_character_flag") return flags.has(node.value);
      if (node.key === "OR") return node.value.some(child => matches([child], traits, flags));
      if (node.key === "NOR") return !node.value.some(child => matches([child], traits, flags));
      if (node.key === "AND") return matches(node.value, traits, flags);
      if (node.key === "NOT") return !matches(node.value, traits, flags);
      throw new Error("unsupported portrait predicate " + node.key);
    });
  }
  const bloodWeight = weight(blood, "dragon_blood_eyes");
  const pupilWeight = weight(pupils, "dragon_pupils");
  const bloodTraits = ["mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4", "mm_dragon_black_blood"];
  for (const trait of bloodTraits) {
    assert.equal(matches(bloodWeight, new Set([trait]), new Set()), true, trait + " grants human golden eyes without pupils");
    assert.equal(matches(bloodWeight, new Set([trait]), new Set(["mm_asc_dragon_form"])), false, trait + " ascension dragon form is excluded");
    for (const dragon of ["myv_wyvern", "myv_wyvern_tamed", "myv_wyvern_legendary"]) {
      assert.equal(matches(bloodWeight, new Set([trait, dragon]), new Set()), false, trait + " excludes " + dragon + " dragon body");
      assert.equal(matches(bloodWeight, new Set([trait, dragon]), new Set(["mm_wyvern_human_form"])), true, trait + " allows " + dragon + " human form");
    }
    assert.equal(matches(bloodWeight, new Set([trait]), new Set(["mm_asc_dragon_form", "mm_wyvern_human_form"])), false, "ascended dragon form excludes human eye color");
  }
  assert.equal(matches(bloodWeight, new Set(), new Set()), false, "ordinary non-blood human has no bloodline override");
  assert.equal(matches(pupilWeight, new Set(["mm_dragon_pupils"]), new Set()), true, "ordinary pupil baseline still selects vertical eyes");
  assert.equal(matches(pupilWeight, new Set(), new Set()), false, "ordinary human without pupils has no pupil override");
}

console.log("V133 independent roster, source and population fixtures passed; CK3 runtime remains unverified.");

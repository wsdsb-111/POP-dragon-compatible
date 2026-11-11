"use strict";
// Independent wild-breeding contract; finite checks are not an engine emulator.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v134-finite-helper");
const root = path.resolve(__dirname, "..");
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v134/wild-breeding-contract.json"), "utf8"));
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"]);
const parse = file => h.parsePdx(fs.readFileSync(path.join(root, file), "utf8"), file);
function only(nodes, key) {
  const found = nodes.filter(node => node.key === key);
  assert.equal(found.length, 1, key + " must be unique");
  return found[0].value;
}
function walk(nodes, key) {
  return nodes.flatMap(node => [...(node.key === key ? [node] : []), ...(Array.isArray(node.value) ? walk(node.value, key) : [])]);
}
const hooks = parse("patches/wyvern-bloodline/mod/common/on_action/zzzzz_mm_dragon_wild_breeding_hooks.txt");
const yearly = only(only(only(hooks, "myv_wyvern_egg_yearly_pulse"), "effect"), "every_artifact");
const annualLimit = only(yearly, "limit");
assert.equal(only(annualLimit, "mm_dragon_native_egg_may_hatch_trigger"), "yes", "annual native scheduler excludes wild-managed eggs");
const delayed = only(only(hooks, "myv_wyvern_egg_scheduled_hatch"), "effect");
assert.equal(walk(delayed, "mm_dragon_native_egg_may_hatch_trigger").length, 1, "delayed callback rechecks egg ownership");
assert.equal(walk(delayed, "myv_hatch_wyvern_egg_effect").length, 1, "eligible transferred eggs return to native hatch");
for (const [file, label] of [
  ["patches/wyvern-bloodline/mod/common/on_action/zzzzz_mm_dragon_wild_breeding_hooks.txt", "bloodline"],
  ["patches/wyvern-kings/mod/common/on_action/zzzzzzzz_mm_royal_monthly.txt", "kings"]
]) {
  const effect = only(only(parse(file), "myv_wyvern_monthly_pulse"), "effect");
  const keys = effect.map(node => node.key);
  assert.equal(keys.filter(key => key === "mm_dragon_wild_monthly_effect").length, 1, label + " monthly hook");
  assert.ok(keys.indexOf("mm_dragon_wild_monthly_effect") > keys.indexOf("myv_wyvern_ai_monthly_mount_pulse_effect"), label + " follows native care/roaming");
  assert.ok(keys.indexOf("mm_dragon_wild_monthly_effect") < keys.indexOf("trigger_event"), label + " precedes reschedule");
}
assert.deepEqual(contract.movementMonths, [[2, false], [3, true], [5, true], [6, false]]);
const nativeRoot = process.env.CK3_WYVERN_MOD_DIR || "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
const nativeTriggers = h.parsePdx(fs.readFileSync(path.join(nativeRoot, "common/scripted_triggers/myv_wyvern_triggers.txt"), "utf8"), "native MYV triggers");
h.scriptedTriggers.set("myv_is_living_wyvern", only(nativeTriggers, "myv_is_living_wyvern"));
function caseWorld(spec = {}) {
  const same = { id: "county-a", neighbors: [] };
  const adjacent = { id: "county-b", neighbors: [same] };
  const distant = { id: "county-c", neighbors: [] };
  same.neighbors = [adjacent];
  const motherCounty = same;
  const fatherCounty = spec.relation === "adjacent" ? adjacent : spec.relation === "distant" ? distant : same;
  const lair = { id: "mother-lair", province: { id: "lair-province", county: same } };
  const mother = h.character("wild-mother", { female: true, age: spec.motherAge ?? 30,
    traits: [spec.motherTamed ? "myv_wyvern_tamed" : spec.motherRoyal ? "myv_wyvern_legendary" : "myv_wyvern", ...(spec.motherTorpor ? ["mm_royal_torpor"] : []), ...(spec.motherAsc ? ["mm_asc_dragon_body"] : [])],
    flags: spec.cooldown ? ["mm_dragon_wild_breeding_cooldown"] : [],
    vars: { myv_wyvern_hunger: spec.motherHunger ?? 60, myv_wyvern_lair_barony: lair, ...(spec.motherCaptured ? { mm_wyvern_captor: "captor" } : {}) } });
  const father = h.character("wild-father", { female: false,
    traits: [spec.fatherTamed ? "myv_wyvern_tamed" : (spec.fatherRoyal || spec.fatherLegendary) ? "myv_wyvern_legendary" : "myv_wyvern", ...(spec.fatherTorpor ? ["mm_royal_torpor"] : [])],
    vars: { myv_wyvern_hunger: spec.fatherHunger ?? 60, myv_wyvern_lair_barony: { id: "father-lair" }, ...(spec.fatherCaptured ? { mm_wyvern_captor: "captor" } : {}) } });
  mother.location = { id: "mother-province", county: motherCounty };
  father.location = { id: "father-province", county: fatherCounty };
  if (spec.closeFamily) { mother.closeFamilyIds.add(father.id); father.closeFamilyIds.add(mother.id); }
  if (spec.twin) { mother.relations.set("mm_dragon_twin", new Set([father])); father.relations.set("mm_dragon_twin", new Set([mother])); }
  const env = h.environment({ root: mother, year: 1066, month: 4, gameRules: ["myv_max_wyverns_10"], stubs: ["mm_dragon_assign_regional_identity_effect"] });
  env.globalLists.set("myv_living_wyverns", [mother, father]);
  father.vars.set("mm_dragon_wild_courtship_target", mother);
  father.vars.set("mm_dragon_wild_courtship_year", 1066);
  return { mother, father, env, same, adjacent, distant, lair };
}
for (const spec of contract.eligibility) {
  const { mother, father, env } = caseWorld(spec);
  const actual = h.trigger("mm_dragon_wild_same_county_pair_trigger", father, env, { FEMALE: mother });
  assert.equal(actual, spec.expected, spec.case + " same-county eligible");
}
for (const [month, expected] of contract.movementMonths) {
  const { mother, father, env } = caseWorld({ relation: "adjacent" });
  env.month = month;
  const oldLocation = father.location;
  const oldLair = father.vars.get("myv_wyvern_lair_barony");
  h.run("mm_dragon_wild_courtship_effect", father, env);
  assert.equal(father.location === mother.location, expected, "courtship movement month " + month);
  assert.equal(father.vars.get("myv_wyvern_lair_barony"), oldLair, "courtship never changes home lair");
  if (!expected) assert.equal(father.location, oldLocation);
  if (expected) assert.ok(h.trigger("mm_dragon_wild_same_county_pair_trigger", father, env, { FEMALE: mother }), "adjacent courtship becomes same-county only after movement");
}
for (const sameBlood of [true, false]) {
  const { mother, father, env, adjacent } = caseWorld({ relation: "adjacent" });
  const other = h.character("second-wild-female", { female: true, traits: ["myv_wyvern"], vars: { myv_wyvern_hunger: 60, myv_wyvern_lair_barony: { id: "second-lair" }, mm_royal_creation_throne: 2 } });
  other.location = { id: "second-province", county: adjacent };
  father.vars.set("mm_royal_creation_throne", 2);
  mother.vars.set("mm_royal_creation_throne", 1);
  if (!sameBlood) other.vars.set("mm_royal_creation_throne", 1);
  env.globalLists.set("myv_living_wyverns", [mother, other, father]);
  env.randomChoices = [{ type: "list", index: 0 }];
  h.run("mm_dragon_wild_courtship_effect", father, env);
  assert.equal(father.vars.get("mm_dragon_wild_courtship_target"), sameBlood ? other : mother, sameBlood ? "same blood wins despite other candidate" : "without matching blood, ordinary candidate fallback");
}
const cooldown = walk(h.scriptedEffects.get("mm_dragon_wild_try_lay_effect"), "add_character_flag").filter(node => only(node.value, "flag") === "mm_dragon_wild_breeding_cooldown");
assert.equal(cooldown.length, 1);
assert.equal(Number(only(cooldown[0].value, "years")), contract.cooldownYears);
for (const outcome of ["success", "random-failure", "creation-failure"]) {
  const { mother, father, env, lair } = caseWorld();
  env.randomChoices = [{ type: "list", index: 0 }, { type: "chance", success: outcome !== "random-failure" }, { type: "list", index: 0 }];
  if (outcome === "creation-failure") env.stubs.add("myv_create_stable_bred_wyvern_egg_artifact_effect");
  h.run("mm_dragon_wild_try_lay_effect", mother, env);
  assert.equal(mother.vars.get("mm_dragon_wild_attempt_year"), env.year, outcome + " consumes the annual trial");
  assert.equal(env.randomRolls[0].chance, contract.chance, "annual probability follows the independent contract");
  assert.equal(env.createdEggs.length, outcome === "success" ? 1 : 0);
  assert.equal(mother.flags.has("mm_dragon_wild_breeding_cooldown"), outcome === "success", outcome + " cooldown only after successful creation");
  if (outcome === "success") {
    const egg = env.createdEggs[0];
    assert.equal(egg.owner, mother);
    assert.equal(egg.vars.get("myv_wyvern_egg_mother"), mother);
    assert.equal(egg.vars.get("myv_wyvern_egg_father"), father);
    assert.equal(egg.vars.get("mm_dragon_wild_egg_lair"), lair);
    assert.equal(egg.vars.get("mm_dragon_wild_hatch_year"), env.year + 1);
    assert.equal(egg.vars.get("mm_dragon_wild_hatch_month"), env.month);
    assert.equal(mother.vars.get("mm_dragon_wild_current_egg"), egg);
  }
  h.run("mm_dragon_wild_try_lay_effect", mother, env);
  assert.equal(env.createdEggs.length, outcome === "success" ? 1 : 0, "same mother cannot reroll during same year");
}
for (const variant of ["room", "full", "human-owner", "early", "dead-father", "protected-population", "royal-population"]) {
  const { mother, father, env, lair } = caseWorld();
  const egg = h.character("wild-egg", { vars: { mm_dragon_wild_egg: true, mm_dragon_wild_egg_lair: lair, myv_wyvern_egg_mother: mother, myv_wyvern_egg_father: father, myv_wyvern_egg_color: 2, mm_dragon_wild_hatch_year: 1067, mm_dragon_wild_hatch_month: 4 } });
  egg.kind = "artifact"; egg.owner = mother; mother.vars.set("mm_dragon_wild_current_egg", egg);
  env.root = egg; env.year = 1067; env.month = variant === "early" ? 3 : 4;
  env.stubs = new Set(["myv_roll_wyvern_coordination_effect", "mm_dragon_register_true_dragon_origins_effect", "mm_dragon_assign_regional_identity_effect", "myv_apply_wyvern_identity_effect", "myv_refresh_wyvern_prowess_effect"]);
  if (variant === "dead-father") father.alive = false;
  if (variant === "human-owner") egg.owner = h.character("human-holder");
  if (variant === "full") for (let i = 0; i < 8; i++) env.globalLists.get("myv_living_wyverns").push(h.character("ordinary-" + i, { traits: ["myv_wyvern"] }));
  if (variant === "protected-population") for (let i = 0; i < 12; i++) env.globalLists.get("myv_living_wyverns").push(h.character("protected-" + i, { traits: ["myv_wyvern"], flags: ["mm_royal_initial_descendant"] }));
  if (variant === "royal-population") for (let i = 0; i < 12; i++) env.globalLists.get("myv_living_wyverns").push(h.character("royal-" + i, { traits: ["myv_wyvern_legendary", "mm_royal_dragon_king"] }));
  assert.equal(h.trigger("mm_dragon_native_egg_may_hatch_trigger", egg, env), variant === "human-owner", variant + " native custody gate");
  h.run("mm_dragon_wild_hatch_effect", egg, env);
  const succeeds = ["room", "dead-father", "protected-population", "royal-population"].includes(variant);
  assert.equal(env.createdCharacters.length, succeeds ? 1 : 0, variant + " hatch count");
  if (succeeds) {
    const baby = env.createdCharacters[0];
    assert.equal(baby.mother, mother); assert.equal(baby.father, father); assert.equal(baby.realFather, father);
    assert.ok(baby.traits.has("myv_wyvern") && !baby.traits.has("myv_wyvern_tamed"), "offspring remains wild");
    assert.ok(baby.flags.has("mm_dragon_wild_hatchling"));
    assert.ok(egg.destroyed); assert.ok(!mother.vars.has("mm_dragon_wild_current_egg"));
    h.run("mm_dragon_wild_hatch_effect", egg, env);
    assert.equal(env.createdCharacters.length, 1, "hatch-start lock prevents duplicate birth");
  } else assert.ok(!egg.destroyed, "ineligible egg is preserved");
  if (variant === "full") {
    env.globalLists.set("myv_living_wyverns", [mother, father]);
    h.run("mm_dragon_wild_hatch_effect", egg, env);
    assert.equal(env.createdCharacters.length, 1, "full egg hatches when room returns");
  }
}
{
  const { mother, father, env } = caseWorld();
  const host = h.character("monthly-caller"); env.root = host;
  for (const name of ["mm_dragon_wild_courtship_effect", "mm_dragon_wild_try_lay_effect", "mm_dragon_wild_hatch_effect"]) env.stubs.add(name);
  h.run("mm_dragon_wild_monthly_effect", host, env);
  assert.equal(env.calls.filter(c => c.effect === "mm_dragon_wild_courtship_effect").length, 1);
  assert.equal(env.calls.filter(c => c.effect === "mm_dragon_wild_try_lay_effect").length, 1);
  const calls = env.calls.length;
  h.run("mm_dragon_wild_monthly_effect", host, env);
  assert.equal(env.calls.length, calls, "duplicate month does not repeat any breeding work");
  env.month = 5;
  h.run("mm_dragon_wild_monthly_effect", host, env);
  assert.equal(env.calls.filter(c => c.effect === "mm_dragon_wild_courtship_effect").length, 2);
  assert.equal(env.calls.filter(c => c.effect === "mm_dragon_wild_try_lay_effect").length, 2);
}
{
  const { mother, father, env, lair } = caseWorld();
  const egg = h.character("transferred-egg", { vars: { mm_dragon_wild_egg: true, mm_dragon_wild_egg_lair: lair, myv_wyvern_egg_mother: mother, myv_wyvern_egg_father: father, myv_wyvern_egg_color: 2, mm_dragon_wild_hatch_year: 1067, mm_dragon_wild_hatch_month: 4 } });
  egg.kind = "artifact"; egg.owner = h.character("human-egg-owner");
  mother.vars.set("mm_dragon_wild_current_egg", egg);
  env.globalLists.set("mm_dragon_wild_eggs", [egg]); env.year = 1067; env.month = 6;
  const host = h.character("monthly-host"); env.root = host;
  h.run("mm_dragon_wild_monthly_effect", host, env);
  assert.equal(env.createdCharacters.length, 0, "transferred egg is not automatically hatched wild");
  assert.ok(!egg.destroyed && !egg.vars.has("mm_dragon_wild_hatch_started"));
  assert.ok(!mother.vars.has("mm_dragon_wild_current_egg"), "transferred egg releases mother pending reference");
  assert.ok(h.trigger("mm_dragon_native_egg_may_hatch_trigger", egg, env), "transferred egg returns to native scheduling");
  h.run("mm_dragon_wild_monthly_effect", host, env);
  assert.equal(env.createdCharacters.length, 0, "repeated monthly invocation cannot create a wild child");
}
console.log("V134 independent wild finite regression passed; engine time, movement, artifact survival and rendering remain unverified.");

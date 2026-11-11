"use strict";

// Finite script execution with deterministic mutation outcomes; this is not a CK3 engine test.
const assert = require("node:assert/strict");
const { createHarness } = require("./wyvern-v1311-finite-helper");
const h = createHarness(["wyvern-bloodline", "wyvern-kings"]);
const grades = ["mm_dragon_black_blood", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4"];
const allGrades = ["mm_dragon_half", ...grades];
const origins = c => Array.from(c.variableLists.get("mm_dragon_origins") || []);
const active = c => allGrades.filter(t => c.traits.has(t));
function assertOrigins(child, expected) {
  const actual = origins(child);
  assert.equal(actual.length, new Set(actual).size, "origin identities are unique");
  assert.deepEqual(new Set(actual), new Set(expected), "all exact source identities survive");
}
function human(id, trait, sources = [], female = false) {
  return h.character(id, { female, traits: trait ? [trait] : [], variableLists: { mm_dragon_origins: sources } });
}
function birth(mother, father, mutationSucceeds = false) {
  const child = h.character("child");
  const env = h.environment({ root: child, scopes: { mother, real_father: father }, randomChoices: [{ type: "chance", success: Boolean(mutationSucceeds) }] });
  h.run("mm_dragon_inherit_natural_blood_effect", child, env);
  return { child, env };
}
for (const blackRole of ["mother", "father"]) {
  for (const otherCase of [
    { name: "ordinary", trait: null, failureTrait: "mm_dragon_lineage_4" },
    { name: "A", trait: "mm_dragon_lineage_2", failureTrait: "mm_dragon_lineage_3" }
  ]) {
    for (const mutationSucceeds of [false, true]) {
      const suffix = `${blackRole}-${otherCase.name}-${mutationSucceeds}`;
      const fire = h.character(`${suffix}-fire-source`, { vars: { mm_dragon_bio_fire: true } });
      const sea = h.character(`${suffix}-sea-source`, { vars: { mm_dragon_bio_sea: true } });
      const black = human(`${suffix}-black-parent`, "mm_dragon_black_blood", [fire], blackRole === "mother");
      const other = human(`${suffix}-other-parent`, otherCase.trait, otherCase.name === "ordinary" ? [sea] : [fire, sea], blackRole === "father");
      const [mother, father] = blackRole === "mother" ? [black, other] : [other, black];
      const { child, env } = birth(mother, father, mutationSucceeds);
      const expectedTrait = mutationSucceeds ? "mm_dragon_black_blood" : otherCase.failureTrait;
      assert.deepEqual(active(child), expectedTrait ? [expectedTrait] : [], `${suffix} uses the other parent's downgraded baseline or mutates black`);
      assert.deepEqual(Array.from(env.randomRolls, roll => roll.chance), [10], `${suffix} has one 10 percent mutation roll`);
      assert.equal(env.listRolls, 0, `${suffix} does not use the retired five-result roll`);
      assertOrigins(child, otherCase.name === "ordinary" ? [fire] : [fire, sea]);
      assert.ok(!child.vars.has("mm_dragon_bio_black"), "black blood does not invent black-emperor ancestry");
      assert.ok(!child.traits.has("mm_dragon_branch_black"));

      const beforeTraits = active(child);
      const beforeRollCount = env.randomRolls.length;
      env.randomChoices.push({ type: "chance", success: !mutationSucceeds });
      h.run("mm_dragon_inherit_natural_blood_effect", child, env);
      assert.equal(env.randomRolls.length, beforeRollCount, `${suffix} cooldown prevents a second mutation roll`);
      assert.deepEqual(active(child), beforeTraits);
      assertOrigins(child, otherCase.name === "ordinary" ? [fire] : [fire, sea]);
    }
  }
}

{
  const fire = h.character("double-black-fire-source", { vars: { mm_dragon_bio_fire: true } });
  const sea = h.character("double-black-sea-source", { vars: { mm_dragon_bio_sea: true } });
  const mother = human("double-black-mother", "mm_dragon_black_blood", [fire], true);
  const father = human("double-black-father", "mm_dragon_black_blood", [fire, sea]);
  const { child, env } = birth(mother, father, true);
  assert.deepEqual(active(child), ["mm_dragon_black_blood"], "two black parents always produce black blood");
  assert.equal(env.randomRolls.length, 0, "double black does not roll mutation or tier-up");
  assertOrigins(child, [fire, sea]);
  assert.ok(!child.vars.has("mm_dragon_bio_black"), "two black parents still do not invent black-emperor ancestry");
  assert.ok(!child.traits.has("mm_dragon_branch_black"));

  env.randomChoices.push({ type: "chance", success: false });
  h.run("mm_dragon_inherit_natural_blood_effect", child, env);
  assert.equal(env.randomRolls.length, 0, "repeated double-black hook does not reroll");
  assert.deepEqual(active(child), ["mm_dragon_black_blood"]);
  assertOrigins(child, [fire, sea]);
}

for (const royal of [false, true]) {
  for (const dragonIsMother of [false, true]) {
    const source = h.character("black-human-fire-source", { vars: { mm_dragon_bio_fire: true } });
    const black = human("black-human", "mm_dragon_black_blood", [source], !dragonIsMother);
    const dragon = h.character("dragon", { female: dragonIsMother, traits: royal ? ["myv_wyvern_legendary", "mm_royal_dragon_king"] : ["myv_wyvern_tamed"], vars: { mm_royal_throne: 1, mm_dragon_feature_count: 0 } });
    const { child, env } = birth(dragonIsMother ? dragon : black, dragonIsMother ? black : dragon, 0);
    assert.deepEqual(active(child), [royal ? "mm_dragon_half" : "mm_dragon_lineage_1"]);
    assert.equal(env.listRolls, 0);
    assert.equal(env.randomRolls.length, 0);
    assert.ok(origins(child).includes(dragon) && origins(child).includes(source), "both actual sources survive dragon priority");
    assert.ok(!child.vars.has("mm_dragon_bio_black"));

    const eggEnv = h.environment({ root: black, scopes: { mm_dragon_half_dragon_parent: dragon }, randomChoices: [{ type: "list", index: 0 }] });
    h.run("mm_dragon_create_half_egg_effect", black, eggEnv);
    assert.equal(eggEnv.createdEggs.length, 1);
    const egg = eggEnv.createdEggs[0];
    assert.equal(egg.vars.get("mm_dragon_frozen_birth_generation"), royal ? 0 : 1);
    assert.equal(eggEnv.randomRolls.length, 0, "egg creation never applies human 10 percent mutation");
    h.run("mm_dragon_hatch_half_egg_effect", egg, eggEnv);
    const hatchling = egg.vars.get("mm_dragon_hatched_child");
    assert.ok(hatchling, "egg hatches exactly one child");
    assert.deepEqual(active(hatchling), [royal ? "mm_dragon_half" : "mm_dragon_lineage_1"]);
    assert.ok(origins(hatchling).includes(dragon) && origins(hatchling).includes(source));
    assert.ok(!hatchling.vars.has("mm_dragon_bio_black"));
    h.run("mm_dragon_hatch_half_egg_effect", egg, eggEnv);
    assert.equal(egg.vars.get("mm_dragon_hatched_child"), hatchling, "repeat hatch cannot redraw or replace child");
  }
}
console.log("v1.3.8 black inheritance independent finite regression passed");

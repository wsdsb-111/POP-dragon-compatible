"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v135-finite-helper");
const h = createHarness(["wyvern-kings"]);
const base = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(base, p), "utf8");
const agility = h.parsePdx(read("patches/wyvern-kings/mod/common/script_values/zzzzzzzzzzz_mm_wyvern_mass_combat.txt"));
const value = agility.find(x => x.key === "myv_wyvern_agility").value;
const bonus = value.find(x => x.key === "if" && JSON.stringify(x.value).includes("rite:mm_dragon_sky"));
assert.ok(bonus, "sky rite has an agility bonus");
assert.equal(h.first(bonus.value, "multiply").value, "1.1");
assert.ok(value.indexOf(bonus) > value.findIndex(x => x.key === "multiply" && x.value === "mm_wyvern_mass_agility_multiplier"));
assert.ok(value.indexOf(bonus) < value.findIndex(x => x.key === "round"));
const text = read("patches/wyvern-kings/mod/common/on_action/mm_dragon_creed_combat.txt");
const nodes = h.parsePdx(text);
assert.ok(nodes.find(x => x.key === "on_death"));
const effect = h.first(nodes.find(x => x.key === "mm_creed_combat_death_reward").value, "effect").value;
assert.equal(effect.filter(x => x.key === "if").length, 2);
const [battle, execution] = effect.filter(x => x.key === "if").map(x => JSON.stringify(x.value));
for (const token of ["death_battle", "scope:killer", "is_alive", "rite:mm_dragon_sky", "change_spiritual_fulfillment"]) assert.ok(battle.includes(token), token);
for (const token of ["death_execution", "scope:killer", "is_alive", "rite:mm_dragon_black", "rite:mm_dragon_fire", "rite:mm_dragon_earth", "rite:mm_dragon_sea", "rite:mm_dragon_sky", "rite:mm_dragon_white", "change_spiritual_fulfillment"]) assert.ok(execution.includes(token), token);
assert.ok(!execution.includes("rite:mm_dragon_legacy"));
console.log("v1311 combat wiring checks passed");
const combatText = read("patches/wyvern-kings/mod/common/scripted_effects/zzzzzzzz_mm_royal_combat_effects.txt");
const combat = h.parsePdx(combatText);
for (const name of ["myv_apply_aerial_wyvern_wound_effect", "myv_slay_apply_targeted_wound_effect", "myv_apply_wyvern_random_battle_injury_effect"]) {
  const wrapper = combat.find(x => x.key === name).value;
  const branch = h.first(wrapper, "if").value;
  assert.ok(JSON.stringify(h.first(branch, "limit").value).includes("rite:mm_dragon_sky"));
  const roll = h.first(branch, "random_list").value;
  assert.ok(h.first(roll, "20"));
  assert.ok(JSON.stringify(h.first(roll, "80").value).includes(name + "_after_storm_effect"));
  assert.ok(combat.find(x => x.key === name + "_after_storm_effect"));
}
const recovery = read("patches/dragon-recovery/mod/common/scripted_effects/zzzzzzzzzzzz_mm_dragon_recovery.txt");
const rec = h.parsePdx(recovery);
for (const [name, increment, calls] of [["mm_royal_native_recovery_effect", 1, 10], ["mm_dragon_ordinary_monthly_recovery_effect", 5, 2]]) {
  const block = JSON.stringify(rec.find(x => x.key === name).value);
  assert.ok(block.includes("mm_creed_recovery_remainder"));
  assert.ok(block.includes('"value":"' + increment + '"'));
  let remainder = 0, extra = 0;
  for (let i = 0; i < calls; i++) { remainder += increment; if (remainder >= 10) { remainder -= 10; extra++; } }
  assert.equal(extra, 1); assert.equal(remainder, 0);
}
const values = h.parsePdx(read("patches/wyvern-capture/mod/common/script_values/zzzzzz_mm_wyvern_combat_values.txt"));
for (const name of ["myv_slay_hunter_combat_tier", "myv_slay_wyvern_combat_tier", "myv_aerial_duel_player_power_tier", "myv_aerial_duel_enemy_power_tier"]) {
  const block = JSON.stringify(values.find(x => x.key === name).value);
  for (const token of ["mm_creed_is_founder_trigger", "mm_creed_is_death_servant_trigger", '"value":"0.8"', '"value":"1.3"']) assert.ok(block.includes(token), name + " " + token);
}
const events = h.parsePdx(read("patches/wyvern-capture/mod/events/myv_wyvern_events.txt"));
const victory = events.find(x => x.key === "myv_wyvern.0201").value;
const immediate = h.first(victory, "immediate").value;
assert.equal(h.first(immediate, "mm_creed_award_dragon_victory_effect").value, "yes");
const creedReward = h.parsePdx(read("patches/dragon-creed/mod/common/scripted_effects/zzzzzz_mm_creed_combat_overrides.txt"));
const reward = creedReward.find(x => x.key === "mm_creed_award_dragon_victory_effect");
for (const token of ["mm_creed_is_founder_trigger", "scope:myv_slay_wyvern_target", "myv_is_living_wild_wyvern", '"value":"5"']) assert.ok(JSON.stringify(reward.value).includes(token), token);
const baseline = h.parsePdx(read("patches/wyvern-capture/mod/common/scripted_triggers/mm_dragon_creed_combat.txt"));
for (const name of ["mm_creed_is_founder_trigger", "mm_creed_is_death_servant_trigger", "mm_creed_has_biological_blood_trigger", "mm_creed_earth_return_eligible_trigger"]) {
  assert.equal(h.first(baseline.find(x => x.key === name).value, "always").value, "no", name);
}
const founderOverrides = read("patches/dragon-creed/mod/common/scripted_triggers/zzzzzz_mm_creed_combat_overrides.txt");
for (const token of ["rite:mm_dragon_black", "mm_dragon_has_inheritable_blood_trigger", "rite:mm_dragon_earth", "mm_creed_controls_qus_holy_site_trigger"]) assert.ok(founderOverrides.includes(token));
assert.ok(read("patches/dragon-creed/mod/common/scripted_triggers/zzzzzz_mm_creed_death_servant_override.txt").includes("has_trait = mm_dragon_death_servant"));
assert.equal(victory.filter(x => x.key === "option").length, 3);
const combatHarness = createHarness(["wyvern-capture"]);
// Capture-only package must never activate any creed mechanic or require its typed keys.
{
  const isolated = combatHarness.character("capture-only");
  const env = combatHarness.environment({ root: isolated });
  for (const name of ["mm_creed_is_founder_trigger", "mm_creed_is_death_servant_trigger", "mm_creed_has_biological_blood_trigger", "mm_creed_earth_return_eligible_trigger"]) {
    assert.equal(combatHarness.trigger(name, isolated, env), false, name);
  }
  assert.equal(combatHarness.scriptedEffects.get("mm_creed_award_dragon_victory_effect").length, 0);
  const captureCombat = [
    "patches/wyvern-capture/mod/common/script_values/zzzzzz_mm_wyvern_combat_values.txt",
    "patches/wyvern-capture/mod/common/scripted_triggers/mm_dragon_creed_combat.txt",
    "patches/wyvern-capture/mod/common/scripted_effects/mm_dragon_creed_combat.txt",
    "patches/wyvern-capture/mod/events/myv_wyvern_events.txt"
  ].map(read).join("\n");
  for (const forbidden of ["rite:mm_dragon", "mm_dragon_death_servant", "mm_dragon_has_inheritable_blood_trigger", "mm_creed_controls_qus_holy_site_trigger"]) assert.ok(!captureCombat.includes(forbidden), forbidden);
}
const returnTrigger = founderOverrides;
assert.ok(returnTrigger.includes("rite:mm_dragon_earth"));
assert.ok(returnTrigger.includes("mm_creed_controls_qus_holy_site_trigger"));
combatHarness.scriptedTriggers.set("myv_is_living_wyvern", combatHarness.parsePdx("x = { always = no }")[0].value);
const returnEffect = combatHarness.scriptedEffects.get("mm_creed_earth_wyvern_return_roll_effect");
assert.ok(returnEffect);
const event203 = combatHarness.parsePdx(read("patches/wyvern-capture/mod/events/myv_wyvern_events.txt")).find(x => x.key === "myv_wyvern.0203").value;
combatHarness.scriptedEffects.set("test_earth_return_immediate", combatHarness.first(event203, "immediate").value);
combatHarness.scriptedEffects.set("test_earth_return_option", combatHarness.first(event203, "option").value.filter(x => x.key !== "name"));
for (const [eligible, alive, success] of [[true,true,true], [true,true,false], [false,true,true], [true,false,true]]) {
  combatHarness.scriptedTriggers.set("mm_creed_earth_return_eligible_trigger", combatHarness.parsePdx("x = { " + (eligible ? "is_alive = yes" : "always = no") + " }")[0].value);
  const victim = combatHarness.character("victim", { alive });
  const enemy = combatHarness.character("dragon");
  const env = combatHarness.environment({ root: victim, scopes: { myv_slay_wyvern_target: enemy }, randomChoices: [{ type: "chance", success }], stubs: ["myv_slay_reset_state_effect"] });
  combatHarness.run("test_earth_return_immediate", victim, env);
  assert.equal(env.randomRolls.length, eligible && alive ? 1 : 0);
  if (eligible && alive) assert.equal(env.randomRolls[0].chance, 15);
  assert.equal(victim.modifiers.has("mm_creed_earth_wyvern_return"), eligible && alive && success);
  if (alive) {
    combatHarness.run("test_earth_return_option", victim, env);
    assert.equal(victim.alive, eligible && success);
    assert.equal(env.deaths.length, eligible && success ? 0 : 1);
    assert.equal(victim.flags.has("mm_creed_earth_wyvern_returned"), false);
  }
}
const returnModifier = h.parsePdx(read("patches/wyvern-capture/mod/common/modifiers/mm_dragon_creed_combat.txt"))[0].value;
assert.equal(h.first(returnModifier, "prowess").value, "5");
assert.equal(h.first(returnModifier, "martial").value, "3");
assert.ok(JSON.stringify(returnEffect).includes('"value":"1095"'));
for (const name of ["myv_wyvern.0273", "myv_wyvern.0274", "myv_wyvern.0275"]) {
  const event = events.find(x => x.key === name).value;
  const immediate = JSON.stringify(h.first(event, "immediate").value);
  assert.ok(immediate.includes("mm_creed_earth_wyvern_return_roll_effect"), name);
  assert.ok(immediate.includes("mm_creed_earth_wyvern_returned"), name);
}
const absorptionHarness = createHarness(["wyvern-bloodline"]);
for (const [grade, threshold] of [["c_to_b", 12], ["b_to_a", 30], ["a_to_s", 60]]) {
  const actor = absorptionHarness.character("hunter");
  const env = absorptionHarness.environment({ root: actor });
  assert.equal(absorptionHarness.value("mm_dragon_absorption_eligible_" + grade, actor, env), threshold);
  actor.flags.add("mm_creed_absorption_heresy_discount");
  assert.ok(Math.abs(absorptionHarness.value("mm_dragon_absorption_eligible_" + grade, actor, env) - threshold * 0.7) < 0.000001);
}
for (const [discount, points, upgraded] of [[false, 8.4, false], [true, 8.4, true], [true, 8.3, false], [false, 12, true]]) {
  const actor = absorptionHarness.character("hunter", { traits: ["mm_dragon_lineage_4"], vars: { mm_dragon_absorption_points: points }, flags: discount ? ["mm_creed_absorption_heresy_discount"] : [] });
  absorptionHarness.run("mm_dragon_apply_absorption_upgrade_effect", actor, absorptionHarness.environment({ root: actor }));
  assert.equal(actor.traits.has("mm_dragon_lineage_3"), upgraded);
}
const absorptionSource = read("patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_absorption.txt");
for (const token of ["rite = rite:mm_dragon_black", "faith = scope:mm_dragon_absorption_victim.faith", "NOT = { rite = scope:mm_dragon_absorption_victim.rite }"]) assert.ok(absorptionSource.includes(token));
{
  combatHarness.scriptedTriggers.set("mm_creed_earth_return_eligible_trigger", combatHarness.parsePdx("x = { is_alive = yes }")[0].value);
  combatHarness.scriptedTriggers.set("myv_is_living_wyvern", combatHarness.parsePdx("x = { always = yes }")[0].value);
  const dragon = combatHarness.character("dragon", { traits: ["myv_wyvern_wing_injuries"], xp: { myv_wyvern_wound_left_wing: 100, myv_wyvern_wound_right_wing: 75 } });
  const env = combatHarness.environment({ root: dragon, randomChoices: [{ type: "chance", success: true }], stubs: ["myv_refresh_wyvern_prowess_effect"] });
  combatHarness.run("mm_creed_earth_wyvern_return_roll_effect", dragon, env);
  assert.equal(dragon.xp.get("myv_wyvern_wound_left_wing"), 99);
  assert.equal(dragon.xp.get("myv_wyvern_wound_right_wing"), 75);
  assert.equal(env.randomRolls.length, 1);
}

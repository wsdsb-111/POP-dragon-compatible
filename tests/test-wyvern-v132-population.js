"use strict";

const assert = require("node:assert/strict");
const { createHarness } = require("./wyvern-v132-finite-helper");
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"]);

for (const ordinaryCount of [0, 7, 35]) {
  for (const cap of [0, 10, 30]) {
    const royal = Array.from({ length: 10 }, (_, index) => h.character("royal-" + index, {
      age: 10000 + index,
      traits: ["myv_wyvern_legendary", index === 8 ? "mm_royal_black_emperor" : index === 9 ? "mm_royal_white_empress" : "mm_royal_dragon_king", "wounded_3", "scarred"],
      vars: { mm_royal_throne: index % 4 + 1, original_marker: 47 },
      modifiers: ["third_party_old_injury"],
    }));
    const ordinary = Array.from({ length: ordinaryCount }, (_, index) => h.character("ordinary-" + index, {
      age: 100 + index,
      traits: ["myv_wyvern", "wounded_2", "scarred"], modifiers: ["third_party_old_injury"],
      vars: { old_state: index },
    }));
    const deadRoyal = h.character("already-dead-royal", { alive: false, age: 99999, traits: ["myv_wyvern_legendary", "mm_royal_black_emperor"] });
    const deadOrdinary = h.character("already-dead-ordinary", { alive: false, age: 99998, traits: ["myv_wyvern"] });
    const actor = h.character("non-dragon-caller");
    const env = h.environment({ root: actor });
    env.globalLists.set("myv_living_wyverns", [...royal, deadRoyal, ...ordinary, deadOrdinary]);
    env.globalVars.set("myv_wyvern_population_count", royal.length + ordinary.length);
    h.run("myv_trim_wyvern_population_to_effect", actor, env, { CAP: cap });
    const killed = Math.max(0, ordinaryCount - cap);
    assert.equal(env.deaths.length, killed, "cap " + cap + " kills only the excess ordinary dragons");
    assert.deepEqual(Array.from(env.deaths, character => character.id), ordinary.slice().reverse().slice(0, killed).map(character => character.id), "ordinary pruning retains the native oldest-first order");
    assert.ok(royal.every(character => character.alive), "all ten oldest unique kings/emperors survive even at cap zero");
    assert.ok(royal.every(character => character.traits.has("wounded_3") && character.modifiers.has("third_party_old_injury") && character.vars.get("original_marker") === 47), "royal protection never heals or rewrites preexisting state");
    assert.ok(ordinary.every(character => character.traits.has("wounded_2") && character.modifiers.has("third_party_old_injury")), "ordinary trimming never cleans injury or trait state");
    assert.ok(!deadRoyal.alive && !deadOrdinary.alive, "dead registry entries never revive");
    assert.equal(env.globalVars.get("myv_wyvern_population_count"), 10 + Math.min(ordinaryCount, cap), "the global count still counts every living dragon, including protected royalty");
    assert.equal([...royal, ...ordinary].filter(character => character.alive).length, env.globalVars.get("myv_wyvern_population_count"));
    assert.ok(!env.globalVars.has("mm_royal_population_trim_count"), "temporary trim budget is always removed");
    const deathCount = env.deaths.length;
    h.run("myv_trim_wyvern_population_to_effect", actor, env, { CAP: cap });
    assert.equal(env.deaths.length, deathCount, "repeated pruning at the reached budget does not kill another dragon");
  }
}
console.log("Wyvern v1.3.2 independent population finite fixtures passed; native on_death scheduling remains a separate CK3 gate.");

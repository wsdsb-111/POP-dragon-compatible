"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v135-finite-helper");
const root = path.resolve(__dirname, "..");
const game = "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
const workshop = "D:/SteamLibrary/steamapps/workshop/content/1158310";
const overlay = path.join(root, "patches/character-preservation/mod");
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension", "character-preservation"]);
const clean = text => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const read = file => clean(fs.readFileSync(file, "utf8"));
const guarded = [
  [path.join(workshop, "3740401066/common/scripted_triggers/BoTL_scripted_triggers.txt"), "common/scripted_triggers/zzzzzzzzzzzz_mm_BoTL_cleanup.txt", "\tNOT = { mm_cleanup_is_protected = yes }\n"],
  [path.join(game, "events/courtier_guest_management_events/courtier_guest_management_events.txt"), "events/courtier_guest_management_events/courtier_guest_management_events.txt", "\t\t\t\t\tNOT = { mm_cleanup_is_protected = yes }\n"],
  [path.join(workshop, "3684849062/common/scripted_effects/07_dlc_ep3_scripted_effects.txt"), "common/scripted_effects/07_dlc_ep3_scripted_effects.txt", "\t\t\t\t\t\tNOT = { mm_cleanup_is_protected = yes }\n"]
];
for (const [original, relative, insertion] of guarded) {
  const text = read(path.join(overlay, relative));
  assert.equal(text.split(insertion).length, 2, "exactly one local cleanup guard");
  assert.equal(text.replace(insertion, ""), read(original), "all upstream content outside the one guard is preserved");
}
assert.ok(!fs.existsSync(path.join(overlay, "common/scripted_triggers/00_courtier_guest_management_triggers.txt")), "shared pruneability and adventurer selection are not overridden");

// Derive immortality and flags from real installed trait definitions, including
// immortal-only and flag-only traits. Never give mixed descendants immortality.
const traits = new Map();
for (const directory of [path.join(game, "common/traits"), ...["2506311074", "2939268227", "3743938774", "3605494923", "3780779762"].map(id => path.join(workshop, id, "common/traits")), ...["wyvern-capture", "wyvern-bloodline", "wyvern-kings", "wyvern-ascension"].map(id => path.join(root, "patches", id, "mod/common/traits"))]) {
  if (!fs.existsSync(directory)) continue;
  for (const file of fs.readdirSync(directory).filter(n => n.endsWith(".txt")).sort()) for (const node of h.parsePdx(read(path.join(directory, file)), file)) traits.set(node.key, node.value);
}
function subject(trait, age) {
  assert.ok(traits.has(trait), "protected trait actually exists: " + trait);
  const c = h.character(trait + "-" + age, { traits: [trait, "wounded_2"], age });
  c.immortal = h.first(traits.get(trait), "immortal")?.value === "yes";
  c.traitFlags = new Set(traits.get(trait).filter(n => n.key === "flag").map(n => n.value));
  c.is_pool_character = true;
  c.vars.set("preserve_marker", 43);
  return c;
}
const protectedTraits = ["immortal", "immortality", "zg_buxiu", "zhuge_test_trait_01", "woc_immortal", "bloodline_god_3", "xing_nu_cong_shen", "myv_wyvern", "myv_wyvern_tamed", "myv_wyvern_legendary", "mm_royal_dragon_king", "mm_royal_complete", "mm_royal_black_emperor", "mm_royal_white_empress", "mm_royal_torpor", "mm_wyvern_legendary_origin", "mm_wyvern_bathed_in_dragon_blood", "mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4", "mm_dragon_black_blood", "mm_asc_dragon_body"];
const ordinary = h.character("ordinary", { age: 91 });
ordinary.is_pool_character = true;
ordinary.councilPositions = new Set(["councillor_court_chaplain"]);
for (const trait of protectedTraits) for (const age of [20, 64, 65, 150, 1000]) {
  const c = subject(trait, age);
  const env = h.environment({ root: c });
  assert.equal(h.trigger("mm_cleanup_is_protected", c, env), true, trait);
  assert.equal(h.trigger("is_needed_to_be_cleaned_up", c, env), false, "both BoTL entry points reject " + trait);
  assert.equal(c.vars.get("preserve_marker"), 43);
  assert.ok(c.traits.has("wounded_2"));
  if (trait.startsWith("mm_dragon_")) assert.equal(c.immortal, false, "population protection never grants immortal lifespan");
}
assert.equal(h.trigger("mm_cleanup_is_protected", ordinary, h.environment({ root: ordinary })), false);
assert.equal(h.trigger("is_needed_to_be_cleaned_up", ordinary, h.environment({ root: ordinary })), true, "an ordinary orphan remains eligible under default BoTL settings");
ordinary.isRuler = true;
assert.equal(h.trigger("is_needed_to_be_cleaned_up", ordinary, h.environment({ root: ordinary })), false);
ordinary.isRuler = false;

// Execute only the actual pruning conditional from the original pool event.
// Its upstream eligibility is isolated; it remains unchanged byte-for-byte.
const poolText = read(path.join(overlay, guarded[1][1])).match(/^courtier_guest_management\.2001\s*=\s*\{[\s\S]*?^}/m);
assert.ok(poolText, "the one native pool event is explicitly bounded");
const events = h.parsePdx(poolText[0], "pool event");
const event = events.find(n => n.key === "courtier_guest_management.2001");
const immediate = h.first(event.value, "immediate").value;
const poolBranch = immediate.find(n => n.key === "if" && h.first(h.first(n.value, "limit").value, "NOT")?.value.some(x => x.key === "exists" && x.value === "var:last_visited_ruler"));
assert.ok(poolBranch);
h.scriptedEffects.set("v137_pool_pruning", [poolBranch]);
h.scriptedTriggers.set("pool_character_is_pruneable_trigger", h.parsePdx("always = yes", "isolated eligibility"));
for (const trait of [...protectedTraits, null]) for (const age of [20, 1000]) {
  const c = trait ? subject(trait, age) : h.character("unprotected", { age });
  const env = h.environment({ root: c, stubs: ["fallback_move_to_pool_effect"] });
  h.run("v137_pool_pruning", c, env);
  assert.equal(c.alive, trait !== null, "pool cleanup age " + age + " " + trait);
  if (trait) assert.equal(env.calls.filter(n => n.effect === "fallback_move_to_pool_effect").length, 1, "protected characters retain fallback movement");
  else assert.equal(c.deathReason, age < 65 ? "death_accident" : "death_old_age");
}

function walk(nodes, key) { return nodes.flatMap(n => [...(n.key === key ? [n] : []), ...(Array.isArray(n.value) ? walk(n.value, key) : [])]); }
const adventure = h.scriptedEffects.get("create_landless_adventurer_title_effect");
const council = walk(adventure, "every_councillor").find(n => walk(n.value, "death").some(d => h.first(d.value, "death_reason")?.value === "death_vanished"));
assert.ok(council);
h.scriptedEffects.set("v137_adventurer_cleanup", council.value);
for (const name of ["is_close_or_extended_family_of", "is_consort_of"]) h.scriptedTriggers.set(name, h.parsePdx("always = no", "isolated non-family"));
for (const trait of [...protectedTraits, null]) {
  const c = trait ? subject(trait, 999) : ordinary;
  c.councilPositions = new Set(["councillor_court_chaplain"]);
  const env = h.environment({ root: c, scopes: { new_landless_adventurer: h.character("new-ruler") } });
  h.run("v137_adventurer_cleanup", c, env);
  assert.equal(c.alive, trait !== null, "administrative council cleanup " + trait);
}

const nativeRules = h.parsePdx(read(path.join(workshop, "3811316052/common/scripted_effects/myv_wyvern_game_rule_effects.txt")), "native game rules");
h.scriptedEffects.set("myv_refresh_wyvern_population_count_effect", nativeRules.find(n => n.key === "myv_refresh_wyvern_population_count_effect").value);
const dragons = Array.from({ length: 70 }, (_, i) => h.character("dragon-" + i, { age: 1000 + i, traits: ["myv_wyvern"] }));
const env = h.environment({ root: dragons[0] });
env.globalLists.set("myv_living_wyverns", dragons);
h.scriptedTriggers.set("myv_is_living_wyvern", h.parsePdx("is_alive = yes has_trait = myv_wyvern", "isolated living ordinary identity"));
h.run("myv_enforce_wyvern_population_game_rule_effect", dragons[0], env);
for (const cap of [0, 10, 30, 50]) h.run("myv_trim_wyvern_population_to_effect", dragons[0], env, { CAP: cap });
env.globalVars.delete("myv_wyvern_population_count");
h.run("myv_trim_wyvern_population_to_effect", dragons[0], env, { CAP: 100 });
assert.equal(env.globalVars.get("myv_wyvern_population_count"), 70, "direct legacy calls repair missing or stale-low counts too");
assert.equal(env.deaths.length, 0);
assert.ok(dragons.every(c => c.alive));
assert.equal(env.globalVars.get("myv_wyvern_population_count"), 70, "counts are not falsified to simulate trimming");
const nonlethal = read(path.join(overlay, "common/scripted_effects/zzzzzzzzzzzz_mm_dragon_nonlethal_population.txt"));
assert.doesNotMatch(nonlethal, /death\s*=|while\s*=|subtract\s*=/);
assert.ok(!fs.existsSync(path.join(overlay, "common/scripted_triggers/myv_wyvern_natural_spawn_triggers.txt")), "native pre-spawn caps are retained");
let dynastyCreations = 0;
function checkNames(nodes) {
  nodes.forEach((node, index) => {
    if (node.key === "create_dynasty") {
      dynastyCreations++;
      const guard = nodes.slice(0, index).find(n => n.key === "set_variable" && h.first(n.value, "name")?.value === "block_dynamic_dynasty_naming");
      assert.equal(h.first(guard?.value || [], "days")?.value, "1");
      assert.ok(nodes.slice(index + 1).some(n => n.key === "house" && h.first(n.value, "set_house_name_from_dynasty")?.value === "dynasty"), "both initial and lowborn egg families copy their stable dynasty name");
    }
    if (Array.isArray(node.value)) checkNames(node.value);
  });
}
for (const file of ["mm_dragon_lineage_initialization.txt", "mm_dragon_half_eggs.txt"]) checkNames(h.parsePdx(read(path.join(root, "patches/wyvern-bloodline/mod/common/scripted_effects", file)), file));
assert.equal(dynastyCreations, 2);
const modules = JSON.parse(read(path.join(root, "modules.json")));
assert.equal(modules.at(-1).id, "character-preservation", "protection definitions follow the royal population override");
assert.deepEqual(modules.at(-1).requires, ["wyvern-ascension", "chinese-core"], "all typed traits are available in this module combination");
console.log("V137 population preservation: upstream-byte guards, 24 trait families across ages, pool/adventurer cleanup and truthful nonlethal dragon counts passed. Runtime remains unverified.");

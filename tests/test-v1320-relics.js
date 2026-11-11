"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createHarness } = require("./wyvern-v1311-finite-helper");
const root = path.resolve(__dirname, "..");
const mod = "patches/dragon-relics/mod/";
const read = p => fs.readFileSync(path.join(root, p), "utf8").replace(/^\uFEFF/, "");
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "dragon-creed", "dragon-death-servants", "dragon-relics"]);
const parse = p => h.parsePdx(read(p), p);
const one = (nodes, key) => { const list = nodes.filter(n => n.key === key); assert.equal(list.length, 1, key); return list[0].value; };
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const items = [["black_crown", "black"], ["black_regalia", "black"], ["white_book", "white"], ["fire_ring", "fire"], ["earth_sarcophagus", "earth"], ["sea_armor", "sea"], ["sky_spear", "sky"]];
const spec = JSON.parse(read("artwork/dragon-relics/specification.json"));
assert.equal(hash(path.join(root, "tests/fixtures/v1320-relics-source.txt")), spec.sourceSha256);
const types = parse(mod + "common/artifacts/types/mm_dragon_relics.txt");
const templates = parse(mod + "common/artifacts/templates/mm_dragon_relics.txt");
const blueprints = parse(mod + "common/artifacts/blueprints/mm_dragon_relics.txt");
const stats = parse(mod + "common/modifiers/mm_dragon_relics.txt");
for (const item of spec.items) assert.deepEqual(Object.fromEntries(one(stats, item.id + "_stats").map(n => [n.key, Number(n.value)])), item.stats, item.id + " passive numbers");
for (const [item, branch] of items) {
  const id = "mm_relic_" + item;
  assert.equal(one(one(types, id + "_court"), "slot"), "pedestal");
  assert.equal(one(one(types, id + "_inventory"), "can_reforge"), "no", "relic reforging waits for approved models");
  assert.equal(one(one(types, id + "_court"), "can_reforge"), "no");
  assert.equal(one(one(one(templates, id + "_template"), "can_reforge"), "always"), "no");
  assert.equal(one(one(one(templates, id + "_template"), "can_repair"), "always"), "yes", "repair remains available");
  assert.equal(one(one(blueprints, id + "_to_court"), "template"), id + "_template");
  assert.equal(one(one(blueprints, id + "_to_court"), "out_type"), id + "_court");
  assert.equal(one(one(templates, id + "_template"), "unique"), "yes");
  const p = h.character(item + "-holder", { traits: [] });
  p.faith = "faith:mm_dragon_creed";
  p.rite = { id: "mm_dragon_" + branch };
  p.vars.set("mm_dragon_bio_" + branch, true);
  const artifact = h.character(item + "-artifact", { vars: { [id + "_identity"]: true } });
  artifact.equipped = true;
  p.artifacts = [artifact];
  const env = h.environment({ root: p });
  assert.ok(h.trigger(id + "_equipped_trigger", p, env));
  if (item !== "sky_spear") assert.ok(h.trigger(id + "_ready_trigger", p, env));
  artifact.vars.set("mm_relic_cooldown", true);
  assert.equal(h.trigger(id + "_ready_trigger", p, env), false, "cooldown blocks reactivation");
  artifact.vars.delete("mm_relic_cooldown");
  artifact.equipped = false;
  assert.equal(h.trigger(id + "_equipped_trigger", p, env), false, "owning without equipping grants no power");
  artifact.equipped = true;
  p.rite = { id: "unrelated" };
  assert.equal(h.trigger(id + "_ready_trigger", p, env), false);
  p.modifiers.add("mm_relic_fire_forging");
  assert.ok(h.trigger(id + "_equipped_trigger", p, env), "fire bypass unlocks scripted passive features");
  assert.equal(h.trigger(id + "_ready_trigger", p, env), false, "fire bypass does not replace active-ability rite");
}
for (const [trait, vars, immune] of [["mm_royal_black_emperor", {}, true], ["mm_royal_white_empress", {}, true], ["mm_dragon_black_blood", {}, false], ["mm_dragon_half", { mm_dragon_bio_black: true }, true], ["mm_dragon_half", { mm_dragon_bio_white: true }, true], ["mm_royal_dragon_king", { mm_royal_throne: 1 }, false]]) {
  const p = h.character("immunity", { traits: [trait], vars });
  assert.equal(h.trigger("mm_relic_oracle_immune_trigger", p, h.environment({ root: p })), immune);
}
for (const branch of ["black", "white"]) {
  const person = h.character("acquired-imperial-blood", { traits: ["mm_dragon_branch_" + branch], vars: { ["mm_dragon_absorbed_" + branch]: true } });
  assert.equal(h.trigger("mm_relic_oracle_immune_trigger", person, h.environment({ root: person })), true, "recorded imperial blood remains immune whether inherited or acquired");
}
for (const [trait, vars, expected] of [["mm_royal_dragon_king", { mm_royal_throne: 1 }, "white"], ["mm_royal_black_emperor", {}, "black"], ["mm_royal_white_empress", {}, "white"], ["mm_dragon_half", { mm_dragon_bio_black: true }, "black"]]) {
  const person = h.character("monthly-controlled", { traits: [trait], vars, faith: "faith:mm_dragon_creed" });
  person.flags.add("mm_relic_forced_white_rite");
  const env = h.environment({ root: person });
  h.run("mm_dragon_route_creed_effect", person, env);
  assert.equal(person.rite.id, "mm_dragon_" + expected, "forced white survives ordinary routing but cannot override imperial immunity");
}
const oracle = read(mod + "common/scripted_effects/mm_relic_target_powers.txt");
assert.match(oracle, /remove_character_flag = mm_relic_oracle_cast_in_progress/);
assert.doesNotMatch(oracle, /mm_relic_oracle_puppeteer/);
{
  const p = h.character("sky-holder");
  const env = h.environment({ root: p, randomChoices: [{ type: "list", index: 0 }, { type: "list", index: 0 }, { type: "list", index: 0 }] });
  p.traits.add("reckless");
  h.run("mm_relic_three_commander_traits_effect", p, env);
  assert.equal(p.traits.size, 4, "three distinct new commander traits");
  assert.ok(!p.traits.has("cautious_leader"), "does not add an opposing trait");
}
const access = JSON.parse(read("artwork/dragon-relics/template-access-provenance.json"));
assert.equal(access.counts.templates, 147);
assert.equal(access.counts.can_equip, 146);
assert.equal(access.counts.can_benefit, 145);
assert.equal(hash(path.join(root, access.output)), access.outputSha256);
const originalTemplates = new Map();
for (const source of access.sources) {
  assert.equal(hash(source.path), source.sha256, "copied template source remains current");
  for (const node of h.parsePdx(fs.readFileSync(source.path, "utf8"), source.path)) originalTemplates.set(node.key, node.value);
}
const overridden = parse(access.output);
assert.equal(overridden.length, originalTemplates.size);
for (const node of overridden) {
  const restored = node.value.map(field => {
    if (!["can_equip", "can_benefit"].includes(field.key)) return field;
    const or = one(field.value, "OR");
    assert.equal(one(or, "has_character_modifier"), "mm_relic_fire_forging");
    return { ...field, value: one(or, "AND") };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(originalTemplates.get(node.key))), node.key + " changes only its two intended predicate bodies");
}
const active = parse(mod + "common/modifiers/mm_relic_active_powers.txt");
for (const node of active) {
  const icon = one(node.value, "icon");
  assert.ok(fs.existsSync(path.join("D:/SteamLibrary/steamapps/common/Crusader Kings III/game/gfx/interface/icons/modifiers", icon + ".dds")), "native modifier icon exists: " + icon);
  for (const lang of ["simp_chinese", "english"]) {
    const loc = read(mod + "localization/" + lang + "/mm_relic_powers_l_" + lang + ".yml");
    assert.match(loc, new RegExp("\\n " + node.key + "_desc:0 "), "script-driven powers have visible descriptions");
  }
}
assert.deepEqual(Array.from(one(active, "mm_relic_fire_forging"), node => node.key), ["icon"], "fire remains a template-unlock marker, without invented numerical buffs");
{
  const actor = h.character("foreign-rite-holder", { faith: "unrelated" });
  const artifact = h.character("held-crown", { vars: { mm_relic_black_crown_identity: true } });
  artifact.equipped = true;
  actor.artifacts = [artifact];
  const target = h.character("ordinary-dragon", { traits: ["myv_wyvern"] });
  const env = h.environment({ root: actor, scopes: { actor, recipient: target } });
  const interactions = parse(mod + "common/character_interactions/mm_relic_powers.txt");
  for (const node of interactions) {
    assert.equal(one(node.value, "common_interaction"), "yes");
    assert.ok(one(node.value, "filter_tags").some(tag => tag.key === "myv_wyvern_interaction"), "visible in the filtered dragon menu");
    assert.ok(fs.existsSync(path.join("D:/SteamLibrary/steamapps/common/Crusader Kings III/game/gfx/interface/icons/character_interactions", one(node.value, "icon") + ".dds")));
  }
  const crown = one(interactions, "mm_relic_subjugate_interaction");
  h.scriptedTriggers.set("qa_relic_interaction_shown", one(crown, "is_shown"));
  h.scriptedTriggers.set("qa_relic_interaction_valid", one(crown, "is_valid_showing_failures_only"));
  assert.equal(h.trigger("qa_relic_interaction_shown", actor, env), true, "wrong rite does not hide the crown entry");
  assert.equal(h.trigger("qa_relic_interaction_valid", actor, env), false, "visibility does not bypass rite and blood requirements");
  const effective = parse(access.output);
  const whiteTemplate = one(effective, "mm_relic_white_book_template");
  h.scriptedTriggers.set("qa_relic_template_benefit", one(whiteTemplate, "can_benefit"));
  assert.equal(h.trigger("qa_relic_template_benefit", actor, env), false);
  actor.modifiers.add("mm_relic_fire_forging");
  assert.equal(h.trigger("qa_relic_template_benefit", actor, env), true, "fire marker actually unlocks a foreign-rite artifact benefit predicate");
  assert.equal(h.trigger("qa_relic_interaction_valid", actor, env), false, "fire does not unlock unrelated active powers");
}
assert.equal(Number(one(one(active, "mm_relic_earth_creation"), "build_speed")), -0.3);
assert.equal(Number(one(one(active, "mm_relic_earth_creation"), "build_gold_cost")), -0.8);
assert.equal(Number(one(one(active, "mm_relic_sea_coastal_trade"), "tax_mult")), 0.5);
const powers = read(mod + "common/scripted_effects/mm_relic_self_powers.txt");
assert.match(powers, /every_held_title = \{\s*limit = \{ tier = tier_county any_county_province = \{ is_coastal = yes \}/);
assert.doesNotMatch(powers, /every_vassal/);
assert.match(powers, /mm_relic_earth_creation years = 2/);
assert.match(powers, /mm_relic_sea_trade years = 3/);
assert.match(powers, /mm_relic_sky_execution years = 3/);
const initialization = read(mod + "common/scripted_effects/mm_dragon_relic_initialization.txt");
assert.equal((initialization.match(/set_holy_site_owner =/g) || []).length, 7);
assert.equal((initialization.match(/equip_artifact_to_owner = yes/g) || []).length, 7);
assert.equal((initialization.match(/set_artifact_rarity = illustrious/g) || []).length, 7);
assert.equal((initialization.match(/holy_site_artifact_count < 3/g) || []).length, 7);
const cb = parse(mod + "common/casus_belli_types/mm_relic_storm_kingdom.txt")[0];
assert.equal(one(cb.value, "target_title_tier"), "kingdom");
assert.equal(Number(one(one(cb.value, "cost"), "piety")), 0);
assert.doesNotMatch(read(mod + "common/casus_belli_types/mm_relic_storm_kingdom.txt"), /used_lifetime_invasion/);
for (const type of ["court_scheme", "seduce_scheme"]) {
  const source = read(mod + "common/schemes/scheme_types/zzzzzz_mm_relic_" + type + ".txt");
  assert.equal((source.match(/add = 16 desc = mm_relic_sea_seduction_bonus/g) || []).length, 1);
}
const inspirations = parse(mod + "common/inspirations/zzzzzz_mm_relic_forging.txt");
assert.equal(inspirations.length, 9);
assert.ok(!inspirations.some(node => ["adventure_inspiration", "research_inspiration", "religious_inspiration"].includes(node.key)));
const baselineWeapon = parse("patches/dragon-creed/mod/common/inspirations/zzzz_mm_v1312_forging.txt").find(node => node.key === "weapon_inspiration");
const newWeapon = inspirations.find(node => node.key === "weapon_inspiration");
assert.deepEqual(JSON.parse(JSON.stringify(newWeapon.value.filter(n => n.key !== "progress_chance"))), JSON.parse(JSON.stringify(baselineWeapon.value.filter(n => n.key !== "progress_chance"))), "existing fire-rite forging quality logic survives intact");
for (const lang of ["simp_chinese", "english"]) {
  const dir = path.join(root, mod, "localization", lang);
  for (const filename of fs.readdirSync(dir)) assert.deepEqual(Array.from(fs.readFileSync(path.join(dir, filename)).subarray(0, 3)), [239, 187, 191], "localization BOM");
}
console.log("v1.3.20 relic script and template predicate parity checks PASS; CK3 runtime not exercised");

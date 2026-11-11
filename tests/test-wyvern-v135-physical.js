"use strict";
// Finite evaluation executes the shipping script values/effects, not a second formula.
// It is not an engine or renderer test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v135-finite-helper");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v135/physical-contract.json"), "utf8").replace(/^\uFEFF/, ""));
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"]);
const native = process.env.CK3_WYVERN_MOD_DIR || "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
const nativeValues = h.parsePdx(fs.readFileSync(path.join(native, "common/script_values/myv_wyvern_values.txt"), "utf8"), "native values");
const display = nativeValues.find(n => n.key === "myv_wyvern_display_size");
assert.ok(display);
h.scriptValues.set(display.key, display.value);
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < Math.max(1e-8, expected * 1e-8), `${label}: ${actual} != ${expected}`);
function subject(id, size, traits = [], vars = {}) {
  const c = h.character(id, { traits, vars: { myv_wyvern_size: size, ...vars } });
  const env = h.environment({ root: c, stubs: ["myv_refresh_wyvern_portrait_flags_effect", "myv_refresh_wyvern_prowess_effect"] });
  env.characters.set(id, c);
  return [c, env];
}
for (const [id, size, mass] of fixture.named) {
  const [c, env] = subject(id, size, ["mm_royal_dragon_king", "myv_wyvern_physique_powerful"]);
  near(h.value("mm_royal_reference_size", c, env), size, id + " reference length");
  near(h.value("mm_royal_reference_mass", c, env), mass, id + " reference mass");
  near(h.value("mm_wyvern_mass_tonnes", c, env), mass, id + " mass at reference size");
  c.vars.set("myv_wyvern_size", size / 2);
  near(h.value("mm_wyvern_mass_tonnes", c, env), mass / 8, id + " half size");
}
for (const [throne, size, mass] of fixture.complete) {
  const id = ["99001305", "99001002", "99001003", "99001308"][throne - 1];
  const [c, env] = subject(id, size, ["mm_royal_complete"], { mm_royal_throne: throne });
  near(h.value("mm_wyvern_mass_tonnes", c, env), mass, "complete " + throne);
}
for (const [trait, factor] of [[null, 1], ["myv_wyvern_physique_weak", 0.85], ["myv_wyvern_physique_powerful", 1.15]]) {
  const [c, env] = subject("ordinary", 300, trait ? [trait] : []);
  near(h.value("mm_wyvern_mass_tonnes", c, env), 100 * factor, "ordinary 30m");
  c.vars.set("myv_wyvern_size", 5);
  near(h.value("mm_wyvern_mass_tonnes", c, env), 100 * factor / 216000, "ordinary 0.5m");
  c.vars.set("myv_wyvern_size", 600);
  near(h.value("mm_wyvern_mass_tonnes", c, env), 800 * factor, "ordinary 60m");
}
{
  const [c, env] = subject("99001309", 210, ["mm_royal_black_emperor"]);
  const prior = h.value("myv_wyvern_visual_size_tier", c, env);
  h.run("mm_royal_apply_physical_profile_effect", c, env);
  assert.equal(c.vars.get("myv_wyvern_size"), 1000);
  assert.equal(c.vars.get("mm_royal_visual_tier"), prior);
  assert.equal(h.value("myv_wyvern_visual_size_tier", c, env), prior);
  h.run("mm_royal_apply_physical_profile_effect", c, env);
  assert.equal(c.vars.get("mm_royal_visual_tier"), prior);
  const [ordinary, e] = subject("ordinary-old-save", 210, ["myv_wyvern_tamed"], { mm_royal_creation_throne: 1 });
  h.run("mm_royal_apply_physical_profile_effect", ordinary, e);
  assert.equal(ordinary.vars.get("myv_wyvern_size"), 210);
  assert.ok(!ordinary.vars.has("mm_royal_visual_tier"));
}
{
  const [a, ae] = subject("ordinary", 300);
  const [b, be] = subject("99001309", 1000, ["mm_royal_black_emperor"]);
  const [c, ce] = subject("large", 10000);
  for (const name of ["mm_wyvern_mass_agility_multiplier", "mm_wyvern_mass_wound_multiplier"]) {
    const small = h.value(name, a, ae), heavy = h.value(name, b, be), huge = h.value(name, c, ce);
    assert.ok(small > heavy && heavy >= huge && huge > 0, name + " monotonic positive");
  }
}
// Execute the actual crash backend and both emperor roll branches. A nested
// caller verifies that aerial damage uses its temporary scope, not event root.
for (const [id, traits] of [["99001309", ["mm_royal_black_emperor"]], ["99001310", ["mm_royal_white_empress"]]]) {
  for (const roll of [0, 1]) {
    const [c, env] = subject(id, 1000, traits);
    env.randomChoices = [{ type: "list", index: roll }];
    h.run("myv_apply_aerial_crash_injuries_effect", c, env);
    assert.equal(env.listRolls, 1, "one emperor immunity roll");
    const actual = c.xp.get("myv_wyvern_wound_left_eye") || 0;
    if (roll === 0) assert.equal(actual, 0);
    else near(actual, 75 * h.value("mm_wyvern_mass_wound_multiplier", c, env), "crash backend damage");
  }
}
{
  const [target, env] = subject("99001309", 1000, ["mm_royal_black_emperor"]);
  const caller = h.character("caller", { vars: { myv_aerial_wound_amount: 80, myv_aerial_wound_part: 1, myv_aerial_wound_side: 1 } });
  env.root = h.character("unrelated-event-root");
  env.scopes.myv_aerial_wound_target = target;
  h.run("mm_royal_native_aerial_wound_effect", caller, env);
  near(target.xp.get("myv_wyvern_wound_left_eye"), 80 * h.value("mm_wyvern_mass_wound_multiplier", target, env), "aerial target and caller scope");
  assert.ok(!caller.vars.has("mm_mass_adjusted_aerial_wound"));
}
// Real repair effect preserves unrelated wounds, hunger, ancestry and leaves an
// ordinary descendant with a creation throne untouched.
for (const [id, coordination, temperament] of [
  ["99001001", "dexterous", "fierce"], ["99001002", "coordinated", "docile"],
  ["99001003", "dexterous", "fierce"], ["99001304", "dexterous", "fierce"],
  ["99001305", "dexterous", "alert"], ["99001306", "dexterous", "alert"],
  ["99001307", "dexterous", "alert"], ["99001308", "dexterous", "alert"],
  ["99001309", "dexterous", "fierce"], ["99001310", "dexterous", "alert"]
]) {
  const [c, env] = subject(id, 300, ["myv_wyvern_physique_weak", "myv_wyvern_coordination_clumsy", "myv_wyvern_temperament_docile", "myv_wyvern_eye_injuries"], { myv_wyvern_hunger: 61, mm_royal_creation_throne: 3 });
  c.flags.add("mm_royal_fixed_identity");
  c.xp.set("myv_wyvern_wound_left_eye", 45);
  const mother = h.character("mother"); c.mother = mother;
  h.run("mm_royal_repair_profile_effect", c, env);
  assert.ok(c.traits.has("myv_wyvern_physique_powerful"));
  assert.ok(c.traits.has("myv_wyvern_coordination_" + coordination));
  assert.ok(c.traits.has("myv_wyvern_temperament_" + temperament));
  assert.equal(c.traits.has("mm_royal_perfect_instinct"), id === "99001309" || id === "99001310");
  assert.ok(c.traits.has("myv_wyvern_eye_injuries"));
  assert.equal(c.xp.get("myv_wyvern_wound_left_eye"), 45);
  assert.equal(c.vars.get("myv_wyvern_hunger"), 61);
  assert.equal(c.mother, mother);
  const before = [...c.traits].sort();
  h.run("mm_royal_repair_profile_effect", c, env);
  assert.deepEqual([...c.traits].sort(), before);
}
{
  const [c, env] = subject("descendant", 100, ["myv_wyvern_physique_weak", "myv_wyvern_temperament_docile"], { mm_royal_creation_throne: 1 });
  const before = [...c.traits].sort();
  h.run("mm_royal_repair_profile_effect", c, env);
  assert.deepEqual([...c.traits].sort(), before);
}
for (const trait of ["myv_wyvern_temperament_fierce", "myv_wyvern_temperament_alert"]) {
  const [c, env] = subject("emperor-profile", 1000, [trait, "mm_royal_perfect_instinct"]);
  near(h.value("myv_wyvern_temperament_agility_multiplier", c, env), 1.1, "combined agility exactly once");
  near(h.value("myv_wyvern_temperament_prowess_multiplier", c, env), 1.1, "combined prowess exactly once");
}
// Ascension uses a stored source reference; ordinary creation-throne lineage
// cannot impersonate a fixed sovereign or invent its appearance/weight.
{
  const [c, env] = subject("ascended", 850, ["mm_asc_dragon_body"], { mm_asc_source_reference_size: 850, mm_asc_source_reference_mass: 7500, mm_asc_source_visual_tier: 6 });
  near(h.value("mm_wyvern_mass_tonnes", c, env), 7500, "ascended source snapshot");
  c.vars.set("myv_wyvern_size", 425);
  near(h.value("mm_wyvern_mass_tonnes", c, env), 937.5, "ascended source half size");
  const [ordinary, other] = subject("ordinary-lineage", 300, ["myv_wyvern_tamed"], { mm_royal_creation_throne: 1 });
  near(h.value("mm_royal_reference_mass", ordinary, other), 0, "ordinary has no sovereign source reference");
  near(h.value("mm_wyvern_mass_tonnes", ordinary, other), 100, "ordinary lineage physical baseline");
}

// A valid new incarnation inherits the correct physical and original trait profile.
for (const [anchorId, throne, trait, size, mass] of [
  ["99001001", 1, "mm_royal_dragon_king", 750, 8000],
  ["99001309", 0, "mm_royal_black_emperor", 1000, 12500],
  ["99001310", 0, "mm_royal_white_empress", 1000, 10000],
  ["99001002", 2, "mm_royal_complete", 900, 9000]
]) {
  const anchor = h.character(anchorId);
  const [c, env] = subject("successor-" + anchorId, 200, [trait], { mm_asc_seat_anchor: anchor, mm_royal_throne: throne });
  env.characters.set(anchorId, anchor);
  h.run("mm_royal_repair_profile_effect", c, env);
  h.run("mm_royal_apply_physical_profile_effect", c, env);
  assert.ok(c.traits.has("myv_wyvern_physique_powerful"));
  near(c.vars.get("myv_wyvern_size"), size, "successor size");
  near(h.value("mm_wyvern_mass_tonnes", c, env), mass, "successor mass");
  assert.equal(c.traits.has("mm_royal_perfect_instinct"), throne === 0);
}
for (const [anchorId, throne, trait] of [
  ["99001001", 2, "mm_royal_dragon_king"],
  ["99001309", 0, "mm_royal_white_empress"],
  ["99001001", 2, "mm_royal_complete"],
  ["99001309", 0, "mm_asc_dragon_body"]
]) {
  const anchor = h.character(anchorId);
  const [c, env] = subject("wrong-incarnation", 200, [trait], { mm_asc_seat_anchor: anchor, mm_royal_throne: throne });
  env.characters.set(anchorId, anchor);
  h.run("mm_royal_repair_profile_effect", c, env);
  h.run("mm_royal_apply_physical_profile_effect", c, env);
  assert.equal(c.vars.get("myv_wyvern_size"), 200);
  assert.ok(!c.traits.has("mm_royal_perfect_instinct"));
  assert.ok(!c.traits.has("myv_wyvern_physique_powerful"));
}
{
  const source = h.character("99001309", { traits: ["mm_royal_black_emperor"], vars: { myv_wyvern_size: 1000, mm_royal_visual_tier: 6 } });
  const [c, env] = subject("old-fusion", 1200, ["mm_asc_dragon_body"], { mm_asc_blood_source: source });
  env.characters.set(source.id, source);
  h.run("mm_royal_repair_source_body_effect", c, env);
  h.run("mm_royal_repair_profile_effect", c, env);
  h.run("mm_royal_apply_physical_profile_effect", c, env);
  assert.equal(c.vars.get("myv_wyvern_size"), 1200, "larger actual old body is preserved");
  assert.equal(c.vars.get("mm_asc_source_reference_size"), 1000);
  assert.equal(c.vars.get("mm_asc_source_reference_mass"), 12500);
  assert.equal(c.vars.get("mm_royal_visual_tier"), 6);
  assert.ok(!c.traits.has("mm_royal_perfect_instinct"), "fusion alone is not a throne");
  source.vars.set("mm_royal_visual_tier", 9);
  c.vars.set("mm_asc_source_reference_mass", 13000);
  h.run("mm_royal_repair_source_body_effect", c, env);
  assert.equal(c.vars.get("mm_asc_source_reference_mass"), 13000, "valid old snapshot remains frozen");
  assert.equal(c.vars.get("mm_royal_visual_tier"), 6);
  const [unknown, ue] = subject("missing-source", 200, ["mm_asc_dragon_body"]);
  h.run("mm_royal_repair_source_body_effect", unknown, ue);
  assert.ok(!unknown.vars.has("mm_asc_source_reference_mass"), "unknown source is not invented");
}
{
  const base = createHarness(["wyvern-kings"]);
  const c = base.character("standalone", { traits: ["mm_asc_dragon_body"], vars: { mm_asc_source_reference_size: 1000 } });
  const env = base.environment({ root: c });
  assert.equal(base.trigger("mm_royal_has_source_body_trigger", c, env), false);
  assert.equal(base.value("mm_royal_reference_size", c, env), 0);
  const source = fs.readFileSync(path.join(__dirname, "../patches/wyvern-kings/mod/common/script_values/zzzzzzzzzz_mm_royal_physical_values.txt"), "utf8");
  assert.ok(!source.includes("has_trait = mm_asc_dragon_body"), "kings does not type-reference an optional trait");
}
// Native growth is still the source of length; the mass value derives from the
// current size, so no separate, stale weight variable needs an annual update.
const root = path.resolve(__dirname, "..");
const nativeEffects = fs.readFileSync(path.join(native, "common/scripted_effects/myv_wyvern_effects.txt"), "utf8");
assert.match(nativeEffects, /myv_wyvern_yearly_growth_effect\s*=\s*\{[\s\S]*?change_variable\s*=\s*\{\s*name\s*=\s*myv_wyvern_size\s+add\s*=\s*myv_wyvern_yearly_size_growth/);
const uiRelative = "gui/custom_gui/myv_wyvern_character_window.gui";
const nativeGui = fs.readFileSync(path.join(native, uiRelative), "utf8");
const gui = fs.readFileSync(path.join(root, "patches/wyvern-kings/mod", uiRelative), "utf8");
const insertion = gui.match(/\r?\n\t\t\tvbox = \{\r?\n\t\t\t\tlayoutpolicy_horizontal = expanding\r?\n\t\t\t\tmargin = \{ 8 2 \}\r?\n\t\t\t\ttooltip = "mm_wyvern_mass_tooltip"[\s\S]*?\t\t\tdivider_light = \{ layoutpolicy_vertical = expanding \}\r?\n\r?\n/);
assert.ok(insertion, "native panel has exactly one added mass metric");
assert.equal(gui.replace(insertion[0], ""), nativeGui, "all existing panel bytes are preserved");
assert.equal((gui.match(/Character.Custom\('mm_wyvern_mass_display'\)/g) || []).length, 1);
for (const language of ["english", "simp_chinese"]) {
  const loc = fs.readFileSync(path.join(root, "patches/wyvern-kings/mod/localization", language, `mm_royal_mass_l_${language}.yml`), "utf8");
  for (const key of ["mm_wyvern_mass_label", "mm_wyvern_mass_kilograms_text", "mm_wyvern_mass_tonnes_text", "mm_wyvern_mass_tooltip"]) assert.ok(loc.includes(key + ":0"));
}
const identity = fs.readFileSync(path.join(root, "patches/wyvern-kings/mod/common/scripted_effects/mm_royal_identity_effects.txt"), "utf8");
assert.equal((identity.match(/mm_royal_apply_physical_profile_effect = yes/g) || []).length, 10);
for (const [relative, expected] of [
  ["patches/wyvern-kings/mod/common/character_interactions/mm_royal_devour.txt", 4],
  ["patches/wyvern-ascension/mod/common/scripted_effects/mm_ascension_devour_effects.txt", 4]
]) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  assert.equal((text.match(/mm_royal_apply_physical_profile_effect = yes/g) || []).length, expected, relative);
}
console.log("V135 finite physical, profile, succession, old-fusion and panel preservation checks passed; CK3 engine remains unverified.");

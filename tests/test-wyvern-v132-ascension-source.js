"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const moduleRoot = path.join(root, "patches", "wyvern-ascension");
const modRoot = path.join(moduleRoot, "mod");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v132/ascension-source-contract.json"), "utf8"));
const read = relative => fs.readFileSync(path.join(modRoot, relative), "utf8");

function block(source, key) {
  const match = new RegExp("(?:^|\\n)\\s*" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*\\{").exec(source);
  assert.ok(match, "missing PDX block " + key);
  const start = source.indexOf("{", match.index);
  let depth = 0;
  let quoted = false;
  let comment = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (comment) { if (char === "\n") comment = false; continue; }
    if (char === "#" && !quoted) { comment = true; continue; }
    if (char === '"' && source[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start + 1, index);
  }
  assert.fail("unclosed PDX block " + key);
}

const completion = block(read("common/traits/zzzzzzzzzz_mm_ascension_legacy_completion.txt"), fixture.legacyTrait);
for (const [key, value] of Object.entries(fixture.legacyFields)) {
  assert.match(completion, new RegExp("(?:^|\\n)\\s*" + key + "\\s*=\\s*" + value + "(?:\\s|$)"), "legacy completion keeps " + key);
}
for (const flag of fixture.legacyFlags) assert.match(completion, new RegExp("flag\\s*=\\s*" + flag + "(?:\\s|$)"));
assert.match(completion, /desc = mm_asc_master_unknown_desc/, "unrecorded legacy source remains explicit");

const traits = read("common/traits/mm_ascension_traits.txt");
for (const [track, thresholds] of Object.entries(fixture.trackThresholds)) {
  const body = block(block(block(traits, "mm_asc_usurper_blood"), "tracks"), track);
  assert.deepEqual([...body.matchAll(/(\d+)\s*=\s*\{/g)].map(match => Number(match[1])), thresholds);
}
const bodyTrait = block(traits, "mm_asc_dragon_body");
assert.doesNotMatch(bodyTrait, /(?:inheritance_blocker|claim_inheritance_blocker|disables_combat_leadership|can_not_marry|can_have_children|fertility)\s*=/,
  "reversible body cannot silently remove political or reproductive rights");
assert.doesNotMatch(block(traits, "mm_asc_usurper_blood"), /(?:immortal|life_expectancy|years_of_fertility)\s*=/,
  "unfinished blood does not pre-award completion powers");

const values = read("common/script_values/mm_ascension_values.txt");
assert.match(values, new RegExp("mm_asc_erosion_per_year\\s*=\\s*" + fixture.annualErosion + "\\b"));
assert.match(values, new RegExp("mm_asc_fusion_per_ritual\\s*=\\s*" + fixture.ritualFusion + "\\b"));
for (const [resource, amount] of Object.entries(fixture.ritualCosts)) {
  assert.match(values, new RegExp("mm_asc_ritual_" + resource + "\\s*=\\s*" + amount + "\\b"));
}

const effects = read("common/scripted_effects/mm_ascension_effects.txt");
const toggle = block(effects, "mm_asc_change_form_effect");
assert.match(toggle, /mm_asc_can_change_form = yes/);
assert.match(toggle, /add_character_flag = mm_asc_dragon_form/);
assert.match(toggle, /remove_character_flag = mm_asc_dragon_form/);
assert.doesNotMatch(toggle, /(?:add_trait|remove_trait|change_first_name|set_variable|death|create_character|add_prowess_skill)\s*=/,
  "switching form must preserve identity, outcome, and skills");
assert.doesNotMatch(effects, /(?:create_character|set_mother|set_father|set_real_father|set_house|set_culture|set_character_faith)\s*=/);
assert.doesNotMatch(effects, /name = myv_living_wyverns/, "sovereigns never enter animal population trimming");
assert.match(block(effects, "mm_asc_inherit_throne_effect"), /change_first_name = \{ template_character = var:mm_asc_blood_source \}/);
assert.match(block(effects, "mm_asc_resolve_effect"), /mm_asc_source_claim_valid = yes/);
assert.match(block(effects, "mm_asc_snapshot_source_effect"), /value = var:mm_asc_blood_source\.var:myv_wyvern_size/);
assert.match(block(effects, "mm_asc_snapshot_source_effect"), /value = var:mm_asc_blood_source\.var:myv_wyvern_color/);
for (const id of fixture.seatIds) {
  assert.match(block(effects, "mm_asc_initialize_seats_effect"), new RegExp("exists = character:" + id));
  assert.match(block(effects, "mm_asc_initialize_seats_effect"), new RegExp("name = mm_asc_seat_" + id));
}

const clear = block(effects, "mm_asc_clear_negatives_effect");
assert.doesNotMatch(clear, /(?:remove_trait|add_stress)\s*=/, "completion cannot cure pre-existing disease or erase historical stress");
for (const match of clear.matchAll(/remove_character_modifier\s*=\s*(\S+)/g)) assert.match(match[1], /^mm_asc_/);

const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, "sources.json"), "utf8"));
const nativeEffects = fs.readFileSync(path.join(manifest.sourceRoots.workshop, "3811316052/common/scripted_effects/myv_wyvern_effects.txt"), "utf8");
const guarded = read("common/scripted_effects/zzzzzzzzzz_mm_ascension_maintenance.txt");
const normalize = source => source.replace(/#[^\r\n]*/g, "").replace(/\s+/g, "");
for (const key of fixture.protectedEffects) {
  const wrapper = block(guarded, key);
  assert.match(wrapper, /limit = \{ NOT = \{ has_trait = mm_asc_dragon_body \} \}/);
  const inner = block(wrapper, "if").replace(/\s*limit = \{ NOT = \{ has_trait = mm_asc_dragon_body \} \}\s*/, "");
  let native = block(nativeEffects, key);
  if (key === "myv_apply_wyvern_identity_effect") {
    assert.match(native, /set_culture\s*=\s*culture:myv_wyvern_culture/);
    assert.match(native, /set_character_faith\s*=\s*faith:pagan/);
    native = native.replace(/set_culture\s*=\s*culture:myv_wyvern_culture/, "").replace(/set_character_faith\s*=\s*faith:pagan/, "");
    assert.doesNotMatch(inner, /set_culture\s*=|set_character_faith\s*=/, "maintenance must not overwrite assigned culture or faith");
  }
  assert.equal(normalize(inner), normalize(native), key + " preserves the remaining ordinary MYV backend");
}
for (const entry of manifest.outputs) {
  const bytes = fs.readFileSync(path.join(moduleRoot, entry.path));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path + " output hash");
}

const awakening = read("common/decisions/zzzzzzzzzz_mm_ascension_awakening.txt");
assert.doesNotMatch(awakening, /character:9900/, "awakening targets and prerequisites resolve current holders");
assert.match(awakening, /global_var:mm_asc_seat_99001310 = \{ is_alive = yes/);
const civilian = read("common/scripted_triggers/zzzzzzzzzz_mm_ascension_civil_rights.txt");
for (const key of ["can_hunt_trigger", "court_position_employee_shown_trigger", "can_be_knight_trigger"]) {
  assert.match(block(civilian, key), /OR = \{ myv_is_wyvern = no has_trait = mm_asc_dragon_body \}/,
    key + " retains ordinary eligibility for a sovereign body");
}
assert.match(block(civilian, "can_be_knight_trigger"), /limit = \{ myv_is_wyvern = yes NOT = \{ has_trait = mm_asc_dragon_body \} \}/,
  "a sovereign does not enter the tamed-animal knight backend");
assert.match(read("common/scripted_guis/zzzzzzzzzz_mm_ascension_character_window.txt"), /NOT = \{ has_trait = mm_asc_dragon_body \}/,
  "both sovereign appearances retain the ordinary political character sheet");
assert.doesNotMatch(read("common/character_interactions/zzzzzzzzzz_mm_ascension_hunt_eligibility.txt"), /myv_is_living_wyvern = yes/,
  "a living sovereign is never advertised as huntable wildlife");
for (const locale of ["english/mm_ascension_l_english.yml", "simp_chinese/mm_ascension_l_simp_chinese.yml"]) {
  const text = read("localization/" + locale);
  assert.equal(text.charCodeAt(0), 0xfeff, "CK3 localization uses a UTF-8 BOM");
  for (const track of Object.keys(fixture.trackThresholds)) assert.match(text, new RegExp("trait_track_" + track + ":0"));
  for (const key of ["mm_asc_master_unknown_desc", "mm_asc_change_form_decision", "mm_asc_devour_own_twin_interaction"]) assert.match(text, new RegExp("\\n " + key + ":0"));
}

console.log("V1.3.2 ascension source, native UI, legacy completion, and sovereign isolation contracts are present; CK3 display remains an in-game gate.");

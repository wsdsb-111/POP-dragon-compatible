"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const requirements = require("./fixtures/v132/independent-requirements.json");
const contract = requirements.ascension;
const h = createHarness(["wyvern-bloodline", "wyvern-ascension"]);
const root = path.resolve(__dirname, "..");
// This group isolates ascension transactions; the new physical module's real
// values and successor guards execute separately in test-wyvern-v135-physical.
const stubs = ["myv_refresh_wyvern_portrait_flags_effect", "myv_refresh_wyvern_prowess_effect", "mm_royal_queue_daily_effect",
  "mm_royal_repair_profile_effect", "mm_royal_apply_physical_profile_effect"];

function scenario(options = {}) {
  const originA = h.character("biological-A");
  const originB = h.character("biological-B");
  const source = h.character("real-dead-source", {
    name: "Actual renamed predecessor",
    alive: options.sourceAlive === true,
    traits: ["myv_wyvern_legendary", options.sourceTrait || "mm_royal_dragon_king"],
    vars: { myv_wyvern_size: 7, myv_wyvern_color: 4, mm_royal_throne: 3, mm_royal_creation_throne: 3 },
  });
  const human = h.character("same-human-ID", {
    name: "Human original name",
    traits: contract.preservedTraits,
    modifiers: ["third_party_illness"],
    culture: "japanese", faith: "shinto", house: "original-house", dynasty: "original-dynasty",
    mother: originA, father: originB, realFather: originB,
    variableLists: { mm_dragon_origins: [originA, originB] },
    stress: 77,
  });
  human.titles = ["k_original_kingdom"];
  const env = h.environment({ root: human, year: 1066, scopes: { myv_slay_wyvern_target: source }, stubs });
  for (const id of contract.seatIds) env.characters.set(id, h.character(id, { alive: false }));
  return { source, human, env, originA, originB };
}

function receive(s) { h.run("mm_asc_receive_blood_effect", s.human, s.env); }
function xp(s, erosion, fusion) { s.human.xp.set("mm_asc_erosion", erosion); s.human.xp.set("mm_asc_fusion", fusion); }
function assertPreserved(s) {
  for (const trait of contract.preservedTraits) assert.ok(s.human.traits.has(trait), trait + " survives both endings");
  assert.equal(s.human.stress, 77, "historical stress is not healed");
  assert.ok(s.human.modifiers.has("third_party_illness"));
  assert.equal(s.human.id, "same-human-ID");
  assert.equal(s.human.culture, "japanese");
  assert.equal(s.human.faith, "shinto");
  assert.equal(s.human.house, "original-house");
  assert.equal(s.human.dynasty, "original-dynasty");
  assert.equal(s.human.mother, s.originA);
  assert.equal(s.human.father, s.originB);
  assert.equal(s.human.realFather, s.originB);
  assert.deepEqual(Array.from(s.human.variableLists.get("mm_dragon_origins")), [s.originA, s.originB]);
  assert.deepEqual(s.human.titles, ["k_original_kingdom"]);
  assert.equal(s.source.alive, false, "the predecessor never resurrects");
}

const values = { mm_asc_erosion_per_year: contract.erosionPerYear, mm_asc_fusion_per_ritual: contract.fusionPerRitual,
  mm_asc_ritual_gold: contract.cost.gold, mm_asc_ritual_piety: contract.cost.piety, mm_asc_ritual_prestige: contract.cost.prestige };
for (const [name, expected] of Object.entries(values)) assert.equal(Number(h.scriptValues.get(name)), expected);

for (const stage of contract.erosionStages) {
  const s = scenario(); receive(s); xp(s, stage.xp, 0);
  h.run("mm_asc_refresh_erosion_effect", s.human, s.env);
  assert.deepEqual(Array.from(s.human.modifiers).filter(value => value.startsWith("mm_asc_erosion_")), [stage.modifier]);
}

{
  const s = scenario(); receive(s);
  assert.ok(s.human.traits.has("mm_asc_usurper_blood"));
  assert.ok(!s.human.traits.has("mm_wyvern_bathed_in_dragon_blood"));
  assert.equal(s.human.vars.get("mm_asc_blood_source"), s.source);
  const rivalSource = h.character("different-source", { alive: false, traits: ["myv_wyvern_legendary"], vars: { myv_wyvern_size: 9, myv_wyvern_color: 1 } });
  s.env.scopes.myv_slay_wyvern_target = rivalSource;
  receive(s);
  assert.equal(s.human.vars.get("mm_asc_blood_source"), s.source, "later kills never replace the race source");
  h.run("mm_asc_perform_ritual_effect", s.human, s.env);
  assert.deepEqual([s.human.gold, s.human.piety, s.human.prestige], [4750, 4750, 4900]);
  assert.equal(s.human.xp.get("mm_asc_fusion"), contract.fusionPerRitual);
  const paymentCount = s.env.payments.length;
  h.run("mm_asc_perform_ritual_effect", s.human, s.env);
  assert.equal(s.env.payments.length, paymentCount, "same-calendar-year duplicate cannot charge");
  s.env.year += 1;
  h.run("mm_asc_perform_ritual_effect", s.human, s.env);
  assert.equal(s.human.xp.get("mm_asc_fusion"), 40, "next year permits exactly one new ritual");
  h.run("mm_asc_yearly_effect", s.human, s.env);
  h.run("mm_asc_yearly_effect", s.human, s.env);
  assert.equal(s.human.xp.get("mm_asc_erosion"), 10, "duplicate yearly callback is idempotent");
}

for (const blocked of ["minor", "imprisoned", "incapable", "gold", "piety", "prestige", "source-living", "claim-conflict", "missing-snapshot"]) {
  const s = scenario(); receive(s);
  if (blocked === "minor") s.human.age = 17;
  if (blocked === "imprisoned") s.human.imprisoned = true;
  if (blocked === "incapable") s.human.incapable = true;
  if (["gold", "piety", "prestige"].includes(blocked)) s.human[blocked] = contract.cost[blocked] - 1;
  if (blocked === "source-living") s.source.alive = true;
  if (blocked === "claim-conflict") s.source.vars.set("mm_asc_blood_claimant", h.character("impostor"));
  if (blocked === "missing-snapshot") s.human.vars.delete("mm_asc_source_color");
  h.run("mm_asc_perform_ritual_effect", s.human, s.env);
  assert.equal(s.env.payments.length, 0, blocked + " cannot consume resources");
  assert.equal(s.human.xp.get("mm_asc_fusion"), 0);
}

for (const outcome of ["fusion", "dragon", "double-full"]) {
  const s = scenario(); receive(s);
  for (const modifier of contract.negativeModifiers) s.human.modifiers.add(modifier);
  xp(s, outcome === "fusion" ? 90 : 100, outcome === "dragon" ? 80 : 100);
  h.run("mm_asc_resolve_effect", s.human, s.env);
  const expected = outcome === "fusion" ? "fusion" : "dragon";
  assert.equal(s.human.vars.get("mm_asc_outcome"), "flag:" + expected);
  assert.ok(s.human.traits.has("mm_asc_dragon_body"), "both endings gain reversible human/dragon body");
  assert.equal(s.human.traits.has("mm_wyvern_bathed_in_dragon_blood"), expected === "fusion");
  assert.equal(s.human.traits.has("mm_royal_dragon_king"), expected === "dragon");
  assert.equal(s.human.flags.has("mm_asc_dragon_form"), expected === "dragon");
  assert.equal(s.human.flags.has("mm_wyvern_human_form"), expected === "fusion");
  assert.equal(s.human.name, expected === "dragon" ? s.source.name : "Human original name");
  assert.equal(s.source.vars.get("mm_asc_current_incarnation"), expected === "dragon" ? s.human : s.source);
  assert.equal(s.human.vars.get("mm_asc_visual_family"), 3, "actual sea source overrides human culture");
  for (const modifier of contract.negativeModifiers) assert.ok(!s.human.modifiers.has(modifier));
  assertPreserved(s);
  const events = s.env.events.length;
  const payments = s.env.payments.length;
  h.run("mm_asc_perform_ritual_effect", s.human, s.env);
  h.run("mm_asc_yearly_effect", s.human, s.env);
  h.run("mm_asc_resolve_effect", s.human, s.env);
  assert.equal(s.env.events.length, events, "delayed callbacks never replay an ending");
  assert.equal(s.env.payments.length, payments);
  h.run("mm_asc_change_form_effect", s.human, s.env);
  assert.equal(s.human.flags.has("mm_asc_dragon_form"), expected === "fusion");
  h.run("mm_asc_change_form_effect", s.human, s.env);
  assert.equal(s.human.flags.has("mm_asc_dragon_form"), expected === "dragon");
  assertPreserved(s);
}

for (const first of ["ritual", "yearly"]) {
  const s = scenario(); receive(s); xp(s, 90, 80); s.env.year += 1;
  const ritual = () => h.run("mm_asc_perform_ritual_effect", s.human, s.env);
  const yearly = () => h.run("mm_asc_yearly_effect", s.human, s.env);
  if (first === "ritual") { ritual(); yearly(); } else { yearly(); ritual(); }
  assert.equal(s.human.vars.get("mm_asc_outcome"), first === "ritual" ? "flag:fusion" : "flag:dragon", "the first real entry to reach 100 wins");
  assert.equal(s.env.payments.length, first === "ritual" ? 3 : 0, "losing entry cannot charge after the race ends");
  assert.equal(s.env.events.filter(event => ["mm_asc.0002", "mm_asc.0003"].includes(event)).length, 1);
}

{
  const s = scenario(); receive(s); xp(s, 100, 100);
  s.source.vars.set("mm_asc_blood_claimant", h.character("different-corpse-claimant"));
  h.run("mm_asc_resolve_effect", s.human, s.env);
  h.run("mm_asc_resolve_effect", s.human, s.env);
  assert.ok(!s.human.vars.has("mm_asc_outcome"), "a stolen claim cannot write an irreversible result");
  assert.ok(s.human.traits.has("mm_asc_usurper_blood"));
  assert.equal(s.env.events.filter(event => event === "mm_asc.0004").length, 1, "claim conflict is reported once");
  assert.equal(s.source.vars.get("mm_asc_current_incarnation"), s.source);
}

for (const [trait, expectedRank, expectedFamily] of [["mm_royal_complete", 2, 3], ["mm_royal_white_empress", 3, 5], ["mm_royal_black_emperor", 4, 6]]) {
  const s = scenario({ sourceTrait: trait }); receive(s); xp(s, 100, 0);
  h.run("mm_asc_resolve_effect", s.human, s.env);
  assert.ok(s.human.traits.has(trait));
  assert.equal(s.human.vars.get("mm_asc_source_rank"), expectedRank);
  assert.equal(s.human.vars.get("mm_asc_visual_family"), expectedFamily);
}

{
  const s = scenario();
  const twin = h.character("still-living-twin", { traits: ["mm_royal_dragon_king"], vars: { mm_royal_throne: 3 } });
  twin.vars.set("mm_asc_seat_anchor", twin); twin.vars.set("mm_asc_current_incarnation", twin);
  twin.vars.set("mm_royal_twin", s.source); s.source.vars.set("mm_royal_twin", twin);
  receive(s); xp(s, 100, 0); h.run("mm_asc_resolve_effect", s.human, s.env);
  assert.equal(s.human.vars.get("mm_royal_twin"), twin);
  assert.equal(twin.vars.get("mm_royal_twin"), s.human, "living counterpart resolves the new holder reciprocally");
  assert.ok(!twin.relations.get("mm_dragon_twin").has(s.source), "active twin relation no longer points at the dead predecessor");
  s.human.name = "Current holder's actual renamed name";
  s.human.alive = false;
  const successor = h.character("second-successor-human");
  const env = h.environment({ root: successor, scopes: { myv_slay_wyvern_target: s.human }, stubs });
  h.run("mm_asc_receive_blood_effect", successor, env);
  successor.xp.set("mm_asc_erosion", 100);
  h.run("mm_asc_resolve_effect", successor, env);
  assert.equal(s.source.vars.get("mm_asc_current_incarnation"), successor, "a second succession retains the original seat anchor");
  assert.equal(successor.vars.get("mm_asc_predecessor"), s.human);
  assert.equal(successor.name, "Current holder's actual renamed name", "name comes from the actual killed incarnation");
  assert.equal(twin.vars.get("mm_royal_twin"), successor);
  assert.equal(s.human.alive, false);
  assert.equal(s.source.alive, false);
}

{
  const s = scenario();
  s.human.traits.add("mm_wyvern_bathed_in_dragon_blood");
  receive(s);
  assert.ok(!s.human.traits.has("mm_asc_usurper_blood"), "old completed holder is never downgraded");
  assert.ok(!s.human.vars.has("mm_asc_blood_source"), "legacy missing source is not invented");
}

const body = h.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-ascension/mod/common/traits/mm_ascension_traits.txt"), "utf8"), "ascension traits")
  .find(node => node.key === "mm_asc_dragon_body").value;
for (const forbidden of ["inheritance_blocker", "claim_inheritance_blocker", "fertility", "can_marry", "can_have_children", "can_be_commander"]) {
  assert.ok(!body.some(node => node.key === forbidden), "operable body does not inherit wild-animal restriction " + forbidden);
}
const previousCompletion = h.parsePdx(fs.readFileSync(path.join(__dirname, "fixtures/v132/completed-trait-v131.txt"), "utf8"), "1.3.1 completed blood")
  .find(node => node.key === "mm_wyvern_bathed_in_dragon_blood").value;
const activeCompletion = h.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-ascension/mod/common/traits/zzzzzzzzzz_mm_ascension_legacy_completion.txt"), "utf8"), "1.3.2 completed blood")
  .find(node => node.key === "mm_wyvern_bathed_in_dragon_blood").value;
for (const oldNode of previousCompletion.filter(node => !["name", "desc", "opposites"].includes(node.key))) {
  assert.ok(activeCompletion.some(node => JSON.stringify(node) === JSON.stringify(oldNode)), "late completed trait preserves original gameplay field " + oldNode.key);
}
const whisperEvent = h.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-ascension/mod/events/mm_ascension_events.txt"), "utf8"), "whisper event")
  .find(node => node.key === "mm_asc.0001").value;
for (const [index, option] of h.all(whisperEvent, "option").entries()) {
  h.scriptedEffects.set("qa_whisper_option", option.value.filter(node => node.key !== "name"));
  const active = scenario(); receive(active);
  h.run("qa_whisper_option", active.human, active.env);
  assert.ok(active.human.stress > 77, "active whisper option " + index + " has real stress consequence");
  const ended = scenario(); receive(ended); xp(ended, 0, 100);
  h.run("mm_asc_resolve_effect", ended.human, ended.env);
  h.run("qa_whisper_option", ended.human, ended.env);
  assert.equal(ended.human.stress, 77, "stale open whisper option " + index + " cannot hurt a completed recipient");
  assert.ok(!contract.negativeModifiers.some(value => ended.human.modifiers.has(value)));
}

// Test the actual new gate without pretending to simulate court positioning,
// activities or the rest of CK3's role candidate selection.
const nativeRoot = process.env.CK3_WYVERN_MOD_DIR || "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
const nativeCourtRoles = fs.readFileSync(path.join(nativeRoot, "gfx/court_scene/character_roles/00_default_roles.txt"), "utf8");
const ascCourtRoles = fs.readFileSync(path.join(root, "patches/wyvern-ascension/mod/gfx/court_scene/character_roles/00_default_roles.txt"), "utf8");
const originalCourtGate = "myv_is_wyvern = no";
const independentBodyGate = "OR = { myv_is_wyvern = no has_trait = mm_asc_dragon_body }";
assert.equal(nativeCourtRoles.split(originalCourtGate).length - 1, 158, "the audited native role file contains exactly 158 dragon filters");
assert.equal(ascCourtRoles, nativeCourtRoles.split(originalCourtGate).join(independentBodyGate), "court role source preserves every original byte except the 158 explicit body-aware gates");
function courtNodes(nodes) { return nodes.flatMap(node => [node, ...(Array.isArray(node.value) ? courtNodes(node.value) : [])]); }
const bodyAwareGates = courtNodes(h.parsePdx(ascCourtRoles, "ascension court roles")).filter(node => node.key === "OR" && Array.isArray(node.value)
  && node.value.length === 2 && node.value.some(child => child.key === "myv_is_wyvern" && child.value === "no")
  && node.value.some(child => child.key === "has_trait" && child.value === "mm_asc_dragon_body"));
assert.equal(bodyAwareGates.length, 158, "each native filter has one actual body-aware AST gate");
for (const gate of bodyAwareGates) {
  h.scriptedTriggers.set("qa_actual_court_role_gate", [gate]);
  for (const spec of [
    { id: "ordinary-human", traits: [], flags: [], allowed: true },
    { id: "native-wild-dragon", traits: ["myv_wyvern"], flags: [], allowed: false },
    { id: "native-tamed-dragon", traits: ["myv_wyvern_tamed"], flags: [], allowed: false },
    { id: "native-legendary-dragon", traits: ["myv_wyvern_legendary"], flags: [], allowed: false },
    { id: "asc-human-appearance", traits: ["mm_asc_dragon_body"], flags: ["mm_wyvern_human_form"], allowed: true },
    { id: "asc-dragon-appearance", traits: ["mm_asc_dragon_body"], flags: ["mm_asc_dragon_form"], allowed: true },
  ]) {
    const character = h.character(spec.id, spec);
    assert.equal(h.trigger("qa_actual_court_role_gate", character, h.environment({ root: character })), spec.allowed, spec.id + " passes the actual role filter exactly as specified");
  }
}
console.log("Wyvern v1.3.2 independent ascension finite fixtures passed; CK3 runtime and portrait rendering remain separate gates.");

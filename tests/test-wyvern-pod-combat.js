"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceManifest = JSON.parse(fs.readFileSync(
  path.join(projectRoot, "patches", "wyvern-pod", "combat-sources.json"), "utf8"));
const powerFile = path.join(projectRoot, "patches", "wyvern-pod", "mod", "common", "script_values",
  "zzzzzzzzzzzz_mm_pod_combat.txt");
const powerSource = fs.readFileSync(powerFile, "utf8");
const ascensionContract = JSON.parse(fs.readFileSync(
  path.join(projectRoot, "tests", "fixtures", "v132", "independent-requirements.json"), "utf8"));
const ascensionSourceAssertion = fs.readFileSync(
  path.join(projectRoot, "tests", "test-wyvern-v132-ascension-source.js"), "utf8");
const ascensionEffects = fs.readFileSync(path.join(projectRoot, "patches", "wyvern-ascension", "mod",
  "common", "scripted_effects", "mm_ascension_effects.txt"), "utf8");
const targetStart = powerSource.indexOf("myv_wyvern_target_prowess = {");
assert.ok(targetStart >= 0, "PoD target prowess override exists");
const targetSource = powerSource.slice(targetStart);

assert.equal(sourceManifest.benchmark.value, 186, "awake elder reference remains M=186 native Prowess");
assert.deepEqual(sourceManifest.targets.map(target => target.cap),
  [190, 275, 225, 215, 285, 230, 265, 260, 240, 298, 350, 400],
  "ordinary, fixed-character, complete, and emperor caps match the requested values");
const expectedIdentityCaps = [
  ["99001001", "Constantine", 275], ["99001305", "Norton", 225],
  ["99001306", "Jormungandr", 215], ["99001002", "Fenrir", 285],
  ["99001307", "Leviathan", 230], ["99001003", "Behemoth", 265],
  ["99001304", "Hrist", 260], ["99001308", "Vidar", 240],
  ["99001310", "White Empress", 350], ["99001309", "Black Emperor", 400],
];
assert.deepEqual(sourceManifest.targets
  .filter(target => target.characterId)
  .map(target => [target.characterId, target.name, target.cap]), expectedIdentityCaps,
  "each historical identity retains its individually assigned cap");
const originalSeatIds = ["99001001", "99001002", "99001003", "99001304", "99001305",
  "99001306", "99001307", "99001308", "99001309", "99001310"];
assert.deepEqual(ascensionContract.ascension.seatIds, originalSeatIds,
  "the existing ascension source ID contract remains unchanged");
assert.deepEqual(sourceManifest.inheritanceRouting.originalSeatIds, originalSeatIds,
  "combat inheritance routing uses the same original seat IDs");
assert.match(ascensionSourceAssertion, /for \(const id of fixture\.seatIds\)/,
  "the existing source assertion still checks every fixture seat ID");
assert.match(ascensionSourceAssertion, /exists = character:/);
assert.match(ascensionSourceAssertion, /name = mm_asc_seat_/);
assert.match(ascensionEffects,
  /name = mm_asc_seat_anchor value = var:mm_asc_blood_source\.var:mm_asc_seat_anchor/,
  "multi-generation successors retain the original seat anchor through their source");
assert.match(powerSource, /value = 190\s+# Black Emperor/, "ordinary fallback cap is 190");
for (const [characterId, , cap] of expectedIdentityCaps) {
  assert.match(powerSource,
    new RegExp(`this = character:${characterId} \\} value = ${cap} \\}`),
    `${characterId} has its fixed ${cap} Prowess cap`);
}
for (const [trait, cap] of [
  ["mm_royal_black_emperor", 400], ["mm_royal_white_empress", 350],
  ["mm_royal_complete", 298], ["mm_royal_fire_king", 250],
  ["mm_royal_earth_king", 250], ["mm_royal_sea_king", 248],
  ["mm_royal_sky_king", 250],
]) {
  assert.match(powerSource, new RegExp(`has_trait = ${trait} \\} value = ${cap} \\}`),
    `${trait} fallback has cap ${cap}`);
}
const expectedInheritedSeatCaps = [
  ["99001001", "Constantine", "mm_royal_fire_king", 275],
  ["99001305", "Norton", "mm_royal_fire_king", 225],
  ["99001306", "Jormungandr", "mm_royal_earth_king", 215],
  ["99001002", "Fenrir", "mm_royal_earth_king", 285],
  ["99001307", "Leviathan", "mm_royal_sea_king", 230],
  ["99001003", "Behemoth", "mm_royal_sea_king", 265],
  ["99001304", "Hrist", "mm_royal_sky_king", 260],
  ["99001308", "Vidar/Odin", "mm_royal_sky_king", 240],
];
assert.deepEqual(sourceManifest.inheritanceRouting.elementalSeatCaps
  .map(route => [route.seatAnchorId, route.name, route.trait, route.cap]), expectedInheritedSeatCaps,
"each inherited elemental throne maps to its original fixed character cap");
for (const [seatAnchorId, name, trait, cap] of expectedInheritedSeatCaps) {
  const route = new RegExp(`else_if\\s*=\\s*\\{\\s*limit\\s*=\\s*\\{\\s*AND\\s*=\\s*\\{` +
    `\\s*has_trait\\s*=\\s*${trait}\\s+has_variable\\s*=\\s*mm_asc_blood_source` +
    `\\s+exists\\s*=\\s*var:mm_asc_blood_source\\s+var:mm_asc_blood_source\\s*=\\s*\\{` +
    `\\s*has_variable\\s*=\\s*mm_asc_seat_anchor\\s+exists\\s*=\\s*var:mm_asc_seat_anchor` +
    `\\s+var:mm_asc_seat_anchor\\s*=\\s*character:${seatAnchorId}\\s*\\}\\s*\\}\\s*\\}` +
    `\\s*value\\s*=\\s*${cap}\\s*\\}`);
  assert.match(powerSource, route, `${name} inherited seat ${seatAnchorId} keeps cap ${cap}`);
}
for (const marker of [
  "max = mm_royal_power_cap",
  "multiply = myv_wyvern_wing_injury_prowess_multiplier",
  "multiply = myv_wyvern_hindleg_injury_prowess_multiplier",
  "multiply = myv_wyvern_tail_injury_prowess_multiplier",
  "multiply = mm_wyvern_hunger_power_multiplier",
  "multiply = myv_wyvern_malnutrition_prowess_multiplier",
  "var:myv_wyvern_hunger <= 0",
  "min = 0",
]) {
  assert.ok(targetSource.includes(marker), "target prowess formula includes " + marker);
}
assert.ok(targetSource.indexOf("max = mm_royal_power_cap") <
  targetSource.indexOf("multiply = myv_wyvern_wing_injury_prowess_multiplier"),
"condition penalties apply after the fully fed cap");
assert.ok(targetSource.indexOf("multiply = mm_wyvern_hunger_power_multiplier") <
  targetSource.indexOf("var:myv_wyvern_hunger <= 0"),
"zero hunger is handled after the hunger multiplier");
assert.ok(powerSource.indexOf("this = character:99001309") <
  powerSource.indexOf("has_trait = mm_royal_black_emperor"),
"Black Emperor identity cap precedes its trait fallback");
assert.ok(powerSource.indexOf("has_trait = mm_royal_complete") <
  powerSource.indexOf("var:mm_asc_seat_anchor = character:99001001"),
"the existing Complete King cap precedes inherited seat-specific caps");
assert.ok(powerSource.indexOf("this = character:99001304") <
  powerSource.indexOf("has_trait = mm_royal_fire_king"),
"specific royal IDs precede branch fallback caps");
assert.doesNotMatch(powerSource, /\b(?:add_trait|add_prowess_skill|set_prowess)\s*=/,
  "the PoD override adds no trait or separate native Prowess writer");
assert.doesNotMatch(powerSource, /mm_asc_dragon_body/,
  "inherited caps work without requiring the completed dragon-body trait");

function evaluateStaticFixture(input) {
  if (input.explicitZeroHungerBranch && input.hunger === 0) return 0;
  const sizeProwess = input.sizeProwess ?? input.preConditionCap;
  const cap = input.identityCap ?? input.preConditionCap;
  let value = input.preConditionCap ?? Math.min(cap,
    sizeProwess * input.sizeFactor * (input.royalFactor ?? 1) *
      (input.physique ?? 1) * (input.temperament ?? 1) * (input.enrage ?? 1));
  value = Math.min(cap, value);
  value *= input.wing ?? 1;
  value *= input.hindleg ?? 1;
  value *= input.tail ?? 1;
  value *= input.hunger ?? 1;
  value *= input.malnutrition ?? 1;
  return Math.round(Math.max(0, Math.min(cap, value)));
}

for (const fixture of sourceManifest.staticFixtures) {
  assert.equal(evaluateStaticFixture(fixture.input), fixture.expectedFinalProwess,
    fixture.id + " matches its static target calculation");
}

console.log("PoD Wyvern combat static contract checks passed");

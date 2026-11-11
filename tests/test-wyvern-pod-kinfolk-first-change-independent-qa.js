"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");

const root = path.resolve(__dirname, "..");
const modRoot = path.join(root, "patches", "wyvern-pod", "mod");
const gameRoot = "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
const nativeRoot = "D:/SteamLibrary/steamapps/workshop/content/1158310/2216659254";
const readBytes = relative => fs.readFileSync(path.join(modRoot, relative));
const read = relative => readBytes(relative).toString("utf8").replace(/^\uFEFF/, "");
const readNative = relative => fs.readFileSync(path.join(nativeRoot, relative), "utf8").replace(/^\uFEFF/, "");
const h = createHarness(["wyvern-pod"]);

function definition(source, name, label) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("^[\\t ]*" + escaped + "[\\t ]*=[\\t ]*\\{", "m").exec(source);
  assert.ok(match, label + " is missing " + name);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  let quoted = false;
  let escapedCharacter = false;
  let comment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === "\n") comment = false;
    } else if (quoted) {
      if (escapedCharacter) escapedCharacter = false;
      else if (character === "\\") escapedCharacter = true;
      else if (character === '"') quoted = false;
    } else if (character === "#") comment = true;
    else if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  assert.fail(label + " has an unclosed " + name);
}

function descendants(nodes) {
  const result = [];
  for (const node of nodes) {
    result.push(node);
    if (Array.isArray(node.value)) result.push(...descendants(node.value));
  }
  return result;
}

function has(nodes, key, value) {
  return descendants(nodes).some(node => node.key === key && (value === undefined || node.value === value));
}

function requireValue(nodes, key, value, label) {
  assert.ok(h.all(nodes, key).some(node => node.value === value), label + " must contain " + key + " = " + value);
}

function requireNot(nodes, key, value, label) {
  assert.ok(h.all(nodes, "NOT").some(node => has(node.value, key, value)), label + " must exclude " + key + " = " + value);
}

const triggerDefinitions = h.parsePdx(read("common/scripted_triggers/mm_pod_kinfolk_first_change.txt"), "kinfolk first-change trigger");
assert.equal(triggerDefinitions.length, 1, "the first-change trigger file declares only this eligibility trigger");
const eligibilityTrigger = triggerDefinitions[0];
assert.equal(eligibilityTrigger.key, "mm_pod_kinfolk_first_change_eligible_trigger");
requireValue(eligibilityTrigger.value, "is_alive", "yes", "eligibility trigger");
const ageLimit = h.all(eligibilityTrigger.value, "age").find(node => node.operator === "<");
assert.ok(ageLimit, "eligibility trigger must use an exclusive under-16 age limit");
assert.equal(ageLimit.value, "16");
requireValue(eligibilityTrigger.value, "has_trait", "kinfolk", "eligibility trigger");
requireNot(eligibilityTrigger.value, "has_trait", "fera", "eligibility trigger");
requireNot(eligibilityTrigger.value, "has_trait", "changeling", "eligibility trigger");
requireNot(eligibilityTrigger.value, "has_trait", "revenant", "eligibility trigger");
requireNot(eligibilityTrigger.value, "has_character_flag", "fera_first_change", "eligibility trigger");
h.scriptedTriggers.set(eligibilityTrigger.key, eligibilityTrigger.value);

const decisionDefinitions = h.parsePdx(read("common/decisions/mm_pod_kinfolk_first_change_decisions.txt"), "kinfolk first-change decision");
const decision = decisionDefinitions.find(node => node.key === "mm_pod_prepare_kinfolk_children_decision");
assert.ok(decision, "the player recovery decision is present");
const picture = h.first(decision.value, "picture");
const pictureReference = picture && h.first(picture.value, "reference");
assert.ok(pictureReference, "decision picture reference exists");
const pictureRelativePath = pictureReference.value.split("/").join(path.sep);
assert.ok(fs.existsSync(path.join(modRoot, pictureRelativePath)) || fs.existsSync(path.join(gameRoot, pictureRelativePath)),
  "decision picture file exists in the compatibility mod or CK3 game resources");
for (const gateName of ["is_shown", "is_valid"]) {
  const gate = h.first(decision.value, gateName);
  assert.ok(gate, "decision must declare " + gateName);
  requireValue(gate.value, "is_ai", "no", gateName);
  requireValue(gate.value, "is_adult", "yes", gateName);
  assert.ok(h.all(gate.value, "any_child").some(node => has(node.value, eligibilityTrigger.key, "yes")),
    gateName + " must require at least one eligible child");
}
requireValue(decision.value, "ai_check_interval", "0", "decision");
const costNodes = h.all(decision.value, "cost").concat(descendants(decision.value).filter(node => /^cost_/.test(node.key)));
for (const cost of costNodes) {
  const leaves = Array.isArray(cost.value) ? descendants(cost.value).filter(node => !Array.isArray(node.value)) : [cost];
  assert.ok(leaves.every(node => Number(node.value) === 0), "decision must not charge gold, piety, or another nonzero cost");
}

const decisionEffect = h.first(decision.value, "effect");
assert.ok(decisionEffect, "decision effect exists");
const decisionEffectKeys = Array.from(decisionEffect.value, node => node.key).filter(key => key !== "custom_tooltip");
assert.deepEqual(decisionEffectKeys, ["every_child"],
  "decision has no effect outside the eligible child iteration");
const everyChild = h.all(decisionEffect.value, "every_child");
assert.equal(everyChild.length, 1, "the effect only iterates the player's own children");
assert.ok(has(h.first(everyChild[0].value, "limit").value, eligibilityTrigger.key, "yes"), "every_child reuses the eligibility trigger");
const childChanges = Array.from(everyChild[0].value).filter(node => node.key !== "limit");
assert.equal(childChanges.length, 1, "each eligible child receives one change only");
assert.equal(childChanges[0].key, "add_character_flag");
assert.equal(childChanges[0].value, "fera_first_change");
assert.equal(has(decisionEffect.value, "add_trait") || has(decisionEffect.value, "remove_trait")
  || has(decisionEffect.value, "set_variable") || has(decisionEffect.value, "change_variable"), false,
"decision must preserve each child's current Fera type and traits");

for (const [locale, filename] of [
  ["English", "localization/english/mm_pod_kinfolk_first_change_l_english.yml"],
  ["Simplified Chinese", "localization/simp_chinese/mm_pod_kinfolk_first_change_l_simp_chinese.yml"],
]) {
  const bytes = readBytes(filename);
  assert.ok(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), locale + " localization has a UTF-8 BOM");
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  for (const key of ["mm_pod_prepare_kinfolk_children_decision", "mm_pod_prepare_kinfolk_children_decision_desc",
    "mm_pod_prepare_kinfolk_children_decision_tooltip", "mm_pod_prepare_kinfolk_children_decision_confirm",
    "mm_pod_prepare_kinfolk_children_decision_effect"]) {
    assert.match(text, new RegExp("^\\s*" + key + ":0\\s+\"", "m"), locale + " localization contains " + key);
  }
}

// Execute only the decision's parsed every_child effect with the finite harness.
// The harness models is_adult as age >= 18; this fixture deliberately does not
// claim that CK3's adult rule or the game engine has been verified here.
const feraTypes = ["trait:werewolf", "trait:wererat", "trait:gurahl", "trait:bastet"];
const cases = [
  ["kinfolk-age-0", 0, ["kinfolk"], true, []],
  ["kinfolk-age-15", 15, ["kinfolk"], true, []],
  ["kinfolk-age-16", 16, ["kinfolk"], true, []],
  ["dead-kinfolk", 5, ["kinfolk"], false, []],
  ["already-flagged-kinfolk", 7, ["kinfolk"], true, ["fera_first_change"]],
  ["ordinary-child", 8, [], true, []],
  ["fera-child", 9, ["kinfolk", "fera"], true, []],
  ["changeling-child", 10, ["kinfolk", "changeling"], true, []],
  ["revenant-child", 11, ["kinfolk", "revenant"], true, []],
];
const children = cases.map(([id, age, traits, alive, flags], index) => h.character(id, {
  age, traits, alive, flags, vars: { fera_type: feraTypes[index % feraTypes.length] },
}));
const unrelatedCourtier = h.character("unrelated-courtier", {
  age: 12, traits: ["kinfolk"], vars: { fera_type: "trait:corax" },
});
const player = h.character("adult-player", { age: 30 });
player.children = children;
player.courtiers = [unrelatedCourtier];
const env = h.environment({ root: player });
const expectedEligible = new Set(["kinfolk-age-0", "kinfolk-age-15"]);
for (const child of children) {
  assert.equal(h.trigger(eligibilityTrigger.key, child, env), expectedEligible.has(child.id), child.id + " eligibility");
}
assert.equal(h.trigger(eligibilityTrigger.key, unrelatedCourtier, env), true,
  "eligibility is an individual check; the decision's every_child scope enforces parent-child ownership");

const qaEffectName = "qa_apply_pod_kinfolk_first_change";
h.scriptedEffects.set(qaEffectName, decisionEffect.value);
function snapshot(person) {
  return {
    flags: [...person.flags].sort(),
    traits: [...person.traits].sort(),
    vars: [...person.vars.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}
const before = new Map([...children, unrelatedCourtier].map(person => [person.id, snapshot(person)]));
h.run(qaEffectName, player, env);
for (const person of children) {
  const expectedFlags = new Set(before.get(person.id).flags);
  if (expectedEligible.has(person.id)) expectedFlags.add("fera_first_change");
  assert.deepEqual([...person.flags].sort(), [...expectedFlags].sort(), person.id + " flag result");
  assert.deepEqual([...person.traits].sort(), before.get(person.id).traits, person.id + " traits remain unchanged");
  assert.deepEqual([...person.vars.entries()].sort(([left], [right]) => left.localeCompare(right)),
    before.get(person.id).vars, person.id + " fera_type and other variables remain unchanged");
}
assert.deepEqual(snapshot(unrelatedCourtier), before.get(unrelatedCourtier.id), "unrelated courtiers are outside every_child");
const afterFirstRun = new Map([...children, unrelatedCourtier].map(person => [person.id, snapshot(person)]));
h.run(qaEffectName, player, env);
for (const person of [...children, unrelatedCourtier]) {
  assert.deepEqual(snapshot(person), afterFirstRun.get(person.id), person.id + " second application is idempotent");
}

// Check the installed PoD birth, birthday and native first-change hand-off.
const nativeBirth = h.parsePdx(definition(readNative("common/scripted_effects/POD_child_birth_effects.txt"),
  "POD_supernatural_trait_assignment_on_birth", "PoD birth effects"), "PoD birth effect")[0];
const birthBranch = descendants(nativeBirth.value).find(node => node.key === "if"
  && has(node.value, "add_character_flag", "fera_first_change"));
assert.ok(birthBranch, "PoD birth effect still assigns the original First Change flag");
assert.ok(has(birthBranch.value, "has_trait", "kinfolk") && has(birthBranch.value, "has_trait", "fera"),
  "native birth branch remains restricted to a kinfolk or Fera parent");
const birthRoll = descendants(birthBranch.value).find(node => node.key === "random"
  && has(node.value, "add_character_flag", "fera_first_change"));
assert.ok(birthRoll, "native birth flag stays on the existing random branch");
requireValue(birthRoll.value, "chance", "0", "native birth roll base chance");
assert.ok(has(h.first(birthRoll.value, "modifier").value, "add", "fera_shapeshifter_chance"),
  "native birth chance modifier remains intact");
const birthChance = h.parsePdx(definition(readNative("common/script_values/POD_fera_values.txt"),
  "fera_shapeshifter_chance", "PoD Fera values"), "PoD Fera birth chance")[0];
requireValue(birthChance.value, "value", "25", "native shapeshifter birth chance");

const nativeEvents = h.parsePdx(definition(readNative("events/POD_fera/POD_fera_maintenance_events.txt"),
  "POD_fera_maintenance.2", "PoD first-change event"), "PoD first-change event")[0];
const nativeEventTrigger = h.first(nativeEvents.value, "trigger");
assert.ok(nativeEventTrigger, "PoD native first-change event trigger exists");
requireValue(nativeEventTrigger.value, "has_character_flag", "fera_first_change", "native first-change trigger");
requireValue(nativeEventTrigger.value, "has_trait", "kinfolk", "native first-change trigger");
requireNot(nativeEventTrigger.value, "has_trait", "changeling", "native first-change trigger");
requireNot(nativeEventTrigger.value, "has_trait", "revenant", "native first-change trigger");
const nativeOption = h.first(nativeEvents.value, "option");
assert.ok(nativeOption && has(nativeOption.value, "save_scope_as", "fera_type")
  && has(nativeOption.value, "add_trait_force_tooltip", "scope:fera_type")
  && has(nativeOption.value, "trait:werewolf"), "native transformation preserves stored fera_type and its fallback");
h.scriptedTriggers.set("qa_native_first_change_event", nativeEventTrigger.value);

const nativeBirthday = h.parsePdx(definition(readNative("common/on_action/childhood_on_actions.txt"),
  "on_16th_birthday", "PoD birthday on_action"), "PoD 16th birthday")[0];
const birthdayGate = h.first(nativeBirthday.value, "trigger");
requireValue(birthdayGate.value, "age", "16", "native sixteenth-birthday gate");
const birthdayEvents = h.first(nativeBirthday.value, "events");
assert.ok(h.all(birthdayEvents.value, "POD_fera_maintenance.2").length > 0,
  "PoD's native age-16 hook still queues First Change event .2");
h.scriptedTriggers.set("qa_native_sixteenth_birthday", birthdayGate.value);
const age16WithFlag = h.character("native-hook-age-16", { age: 16, traits: ["kinfolk"], flags: ["fera_first_change"] });
const age15WithFlag = h.character("native-hook-age-15", { age: 15, traits: ["kinfolk"], flags: ["fera_first_change"] });
assert.equal(h.trigger("qa_native_sixteenth_birthday", age16WithFlag, env), true);
assert.equal(h.trigger("qa_native_sixteenth_birthday", age15WithFlag, env), false);
assert.equal(h.trigger("qa_native_first_change_event", age16WithFlag, env), true);
assert.equal(h.trigger("qa_native_first_change_event", h.character("native-hook-changeling", {
  age: 16, traits: ["kinfolk", "changeling"], flags: ["fera_first_change"],
}), env), false);

console.log("Independent PoD kinfolk First Change QA passed (finite harness/static checks; not CK3 runtime evidence).");

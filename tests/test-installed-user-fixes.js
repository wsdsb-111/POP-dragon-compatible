"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const profile = readJson("package.json").config?.compatibilityProfile;
assert(["oriental", "wyvern-pod"].includes(profile), "unknown compatibility profile");

const expectedPaths = profile === "wyvern-pod" ? [
  "common/decisions/mm_pod_kinfolk_first_change_decisions.txt",
  "common/scripted_triggers/mm_pod_kinfolk_first_change.txt",
  "localization/english/mm_pod_kinfolk_first_change_l_english.yml",
  "localization/simp_chinese/mm_pod_kinfolk_first_change_l_simp_chinese.yml",
  "common/on_action/zzzz_mm_pod_kinfolk_first_change_birthday.txt",
  "common/scripted_effects/mm_pod_kinfolk_first_change_effects.txt",
  "events/mm_pod_kinfolk_first_change_events.txt",
] : [
  "common/character_interactions/zzzzzzzz_mm_royal_availability.txt",
  "gfx/portraits/portrait_modifiers/mm_wyvern_human_form_portrait.txt",
  "gfx/portraits/portrait_modifiers/myv_wyvern_color_and_size.txt",
  "gfx/portraits/portrait_modifiers/zzz_myv_wyvern_no_human_accessories.txt",
  "gfx/portraits/trait_portrait_modifiers/myv_wyvern_trait_portrait_modifiers.txt",
];

const sourceRoot = getSourceRoot(profile);
const provenance = readJson("migration/installed-fix-sources.json");
assert.deepEqual(provenance.files.map((file) => file.path).sort(), [...expectedPaths].sort(),
  "provenance must list exactly the installed user-fix files for this profile");
for (const entry of provenance.files) {
  const file = path.resolve(root, sourceRoot, ...entry.path.split("/"));
  assert(file.startsWith(sourceRootAbsolute(sourceRoot) + path.sep), "user-fix source escapes its module");
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, entry.bytes, entry.path + " byte length");
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path + " installed-source SHA-256");
}

const { createHarness } = require("./wyvern-v132-finite-helper");
const harness = createHarness(profile === "wyvern-pod" ? ["wyvern-pod"] : []);
if (profile === "wyvern-pod") verifyPodKinfolk(harness, sourceRoot);
else verifyOrientalHumanForm(harness, sourceRoot);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function getSourceRoot(profileId) {
  const profiles = readJson("package-profiles.json");
  if (profiles[profileId]?.overlay) return profiles[profileId].overlay;
  const moduleId = profileId === "oriental" ? "wyvern-oriental" : profileId;
  const modules = readJson("modules.json");
  const module = (Array.isArray(modules) ? modules : modules.modules).find((item) => item.id === moduleId);
  assert(module?.source, "missing source module " + moduleId);
  return module.source;
}

function sourceRootAbsolute(relativePath) {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  assert(relative && relative !== ".." && !relative.startsWith(".." + path.sep), "source root must stay in the repository");
  return absolute;
}

function verifyPodKinfolk(h, sourceRoot) {
  const eligible = "mm_pod_kinfolk_first_change_eligible_trigger";
  const effectName = "mm_pod_mark_eligible_kinfolk_descendants_effect";
  assert(h.scriptedTriggers.has(eligible), "installed kinfolk eligibility trigger is loaded");
  assert(h.scriptedEffects.has(effectName), "installed descendant effect is loaded");

  const player = h.character("adult-root", { age: 40 });
  const deadParent = person(h, "dead-parent", 35, ["kinfolk"], false, "trait:werewolf");
  const direct = person(h, "direct-kinfolk", 14, ["kinfolk"], true, "trait:wererat");
  const grandchild = person(h, "grandchild", 15, ["kinfolk"], true, "trait:gurahl");
  const greatGrandchild = person(h, "great-grandchild", 8, ["kinfolk"], true, "trait:bastet");
  const fourthGeneration = person(h, "fourth-generation", 2, ["kinfolk"], true, "trait:corax");
  const age16 = person(h, "age-16", 16, ["kinfolk"], true, "trait:werewolf");
  const nonkinfolk = person(h, "nonkinfolk", 12, [], true, "trait:wererat");
  const fera = person(h, "fera", 12, ["kinfolk", "fera"], true, "trait:gurahl");
  const changeling = person(h, "changeling", 12, ["kinfolk", "changeling"], true, "trait:bastet");
  const revenant = person(h, "revenant", 12, ["kinfolk", "revenant"], true, "trait:corax");
  const deadKinfolk = person(h, "dead-kinfolk", 12, ["kinfolk"], false, "trait:werewolf");
  const alreadyMarked = person(h, "already-marked", 10, ["kinfolk"], true, "trait:wererat", ["fera_first_change"]);
  player.children = [deadParent, direct, age16];
  deadParent.children = [grandchild, nonkinfolk, fera, deadKinfolk];
  grandchild.children = [greatGrandchild, alreadyMarked];
  greatGrandchild.children = [fourthGeneration, changeling, revenant];

  const people = [deadParent, direct, grandchild, greatGrandchild, fourthGeneration, age16,
    nonkinfolk, fera, changeling, revenant, deadKinfolk, alreadyMarked];
  const before = new Map(people.map((character) => [character.id, snapshot(character)]));
  const env = h.environment({ root: player });
  h.run(effectName, player, env);
  const expected = new Set(["direct-kinfolk", "grandchild", "great-grandchild", "fourth-generation"]);
  for (const character of people) {
    const state = snapshot(character);
    const flags = new Set(before.get(character.id).flags);
    if (expected.has(character.id)) flags.add("fera_first_change");
    assert.deepEqual(state.flags, [...flags].sort(), character.id + " First Change flag");
    assert.deepEqual(state.traits, before.get(character.id).traits, character.id + " traits remain unchanged");
    assert.deepEqual(state.vars, before.get(character.id).vars, character.id + " species variables remain unchanged");
  }

  const hookPath = path.join(root, sourceRoot, "common/on_action/zzzz_mm_pod_kinfolk_first_change_birthday.txt");
  const hooks = h.parsePdx(fs.readFileSync(hookPath, "utf8"), "kinfolk birthday hooks");
  for (const name of ["on_birthday", "on_16th_birthday"]) {
    const hook = hooks.find((node) => node.key === name);
    assert(hook, name + " hook exists");
    const events = h.first(hook.value, "events");
    assert(events && deepNodes(events.value).some((node) => node.key === "mm_pod_kinfolk_first_change.0001"),
      name + " queues the age-16 bridge event");
  }
  const eventPath = path.join(root, sourceRoot, "events/mm_pod_kinfolk_first_change_events.txt");
  const event = h.parsePdx(fs.readFileSync(eventPath, "utf8"), "kinfolk birthday bridge")
    .find((node) => node.key === "mm_pod_kinfolk_first_change.0001");
  assert(event, "age-16 bridge event exists");
  const trigger = h.first(event.value, "trigger");
  assert(deepNodes(trigger.value).some((node) => node.key === "age" && node.value === "16"),
    "bridge event is gated at age 16");
  assert(deepNodes(h.first(event.value, "immediate").value)
    .filter((node) => node.key === "trigger_event")
    .some((node) => node.value === "POD_fera_maintenance.2"), "bridge queues PoD's native First Change event");
}

function person(h, id, age, traits, alive, feraType, flags = []) {
  return h.character(id, { age, traits, alive, flags, vars: { fera_type: feraType } });
}

function snapshot(character) {
  return {
    flags: [...character.flags].sort(),
    traits: [...character.traits].sort(),
    vars: [...character.vars.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

function verifyOrientalHumanForm(h, sourceRoot) {
  const file = path.join(root, sourceRoot, "common/character_interactions/zzzzzzzz_mm_royal_availability.txt");
  const definitions = h.parsePdx(fs.readFileSync(file, "utf8"), "Oriental human-form interaction");
  const interaction = definitions.find((node) => node.key === "mm_wyvern_toggle_human_form_interaction");
  assert(interaction, "Oriental human-form interaction exists");
  const onSend = h.first(interaction.value, "on_send");
  assert(onSend, "human-form toggle uses on_send");
  const effects = deepNodes(onSend.value);
  assert(effects.some((node) => node.key === "add_character_flag" && node.value === "mm_wyvern_human_form"),
    "on_send enables human form");
  assert(effects.some((node) => node.key === "remove_character_flag" && node.value === "mm_wyvern_human_form"),
    "on_send disables human form");
}

function deepNodes(nodes) {
  const result = [];
  for (const node of nodes || []) {
    result.push(node);
    if (Array.isArray(node.value)) result.push(...deepNodes(node.value));
  }
  return result;
}

console.log("Installed user-fix QA passed (source SHA and finite/static checks; not CK3 runtime evidence).");

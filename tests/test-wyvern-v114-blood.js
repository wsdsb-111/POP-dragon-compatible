"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const ascensionHarness = createHarness(["wyvern-bloodline", "wyvern-ascension"]);

const root = path.resolve(__dirname, "..");
const captureRoot = path.join(root, "patches/wyvern-capture");
const moduleRoot = path.join(captureRoot, "mod");
const eventPath = path.join(moduleRoot, "events/myv_wyvern_events.txt");
const killEffectsPath = path.join(moduleRoot, "common/scripted_effects/mm_wyvern_victory_effects.txt");
const bloodEffectsPath = path.join(root, "patches/wyvern-ascension/mod/common/scripted_effects/zzzzzzzzzz_mm_ascension_reward.txt");
const traitId = "mm_wyvern_bathed_in_dragon_blood";
const rewardTraitId = "mm_asc_usurper_blood";
const bloodEffectId = "mm_wyvern_legendary_blood_reward_effect";

function tokenizePdx(source, file) {
  const tokens = [];
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === "#") {
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "open", value: char, start: index++ });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "close", value: char, start: index++ });
      continue;
    }
    if (char === '"') {
      const start = index++;
      let value = "";
      let closed = false;
      while (index < source.length) {
        const next = source[index++];
        if (next === "\\" && index < source.length) value += next + source[index++];
        else if (next === '"') {
          closed = true;
          break;
        } else value += next;
      }
      assert(closed, file + ": unterminated quoted token at " + start);
      tokens.push({ type: "scalar", value, start });
      continue;
    }
    const operator = source.slice(index).match(/^(?:>=|<=|!=|=|>|<)/);
    if (operator) {
      tokens.push({ type: "operator", value: operator[0], start: index });
      index += operator[0].length;
      continue;
    }
    const start = index;
    while (index < source.length && !/[\s{}#"=<>!]/.test(source[index])) index++;
    assert(index > start, file + ": unsupported token at " + index);
    tokens.push({ type: "scalar", value: source.slice(start, index), start });
  }
  return tokens;
}

function parsePdx(source, file) {
  const tokens = tokenizePdx(source, file);
  let cursor = 0;

  function parseEntries(closes) {
    const parsed = [];
    while (cursor < tokens.length) {
      if (tokens[cursor].type === "close") {
        assert(closes, file + ": unexpected closing brace");
        cursor++;
        return parsed;
      }
      const key = tokens[cursor++];
      assert.equal(key.type, "scalar", file + ": expected key");
      const operator = tokens[cursor];
      if (!operator || operator.type !== "operator") {
        parsed.push({ key: null, operator: null, value: { kind: "scalar", value: key.value } });
        continue;
      }
      cursor++;
      const valueToken = tokens[cursor++];
      assert(valueToken, file + ": missing value for " + key.value);
      let value;
      if (valueToken.type === "open") value = { kind: "block", entries: parseEntries(true) };
      else {
        assert.equal(valueToken.type, "scalar", file + ": expected value for " + key.value);
        value = { kind: "scalar", value: valueToken.value };
      }
      parsed.push({ key: key.value, operator: operator.value, value });
    }
    assert(!closes, file + ": missing closing brace");
    return parsed;
  }

  const parsed = { kind: "block", entries: parseEntries(false) };
  assert.equal(cursor, tokens.length, file + ": parser left unconsumed tokens");
  return parsed;
}

function entries(node, key) {
  return node.entries.filter(entry => entry.key === key);
}

function one(node, key, context) {
  const matches = entries(node, key);
  assert.equal(matches.length, 1, context + ": expected exactly one " + key + ", found " + matches.length);
  return matches[0].value;
}

function asBlock(value, context) {
  assert(value && value.kind === "block", context + ": expected a PDX block");
  return value;
}

function asScalar(value, context) {
  assert(value && value.kind === "scalar", context + ": expected a scalar");
  return value.value;
}

function listFiles(directory, suffix) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(file, suffix) : (entry.name.endsWith(suffix) ? [file] : []);
  });
}

function readAst(file) {
  return parsePdx(fs.readFileSync(file, "utf8"), file);
}

const eventAst = readAst(eventPath);
const killEffectsAst = readAst(killEffectsPath);
const bloodEffectsAst = readAst(bloodEffectsPath);
const killEffect = asBlock(one(killEffectsAst, "mm_wyvern_resolve_kill_effect", "victory effects"), "kill effect");
const bloodEffect = asBlock(one(bloodEffectsAst, bloodEffectId, "blood effects"), "blood reward effect");
const eventMap = new Map(eventAst.entries.filter(entry => /^myv_wyvern\.\d+$/.test(entry.key))
  .map(entry => [entry.key, asBlock(entry.value, entry.key)]));

function traitDefinitions() {
  const directory = path.join(moduleRoot, "common/traits");
  const definitions = [];
  for (const file of listFiles(directory, ".txt")) {
    const source = fs.readFileSync(file, "utf8");
    if (!new RegExp("(?:^|\\s)" + traitId + "\\s*=").test(source)) continue;
    definitions.push({ file, definition: one(readAst(file), traitId, "trait file") });
  }
  return definitions;
}

const bloodTraits = traitDefinitions();
assert.equal(bloodTraits.length, 1, "the dragon-blood reward must have one trait definition");
const traitDefinition = asBlock(bloodTraits[0].definition, "dragon-blood trait");
for (const [field, expected] of [
  ["immortal", "yes"],
  ["no_prowess_loss_from_age", "yes"],
  ["health", "666"],
  ["prowess", "10"],
  ["monthly_prestige", "2"]
]) {
  assert.equal(asScalar(one(traitDefinition, field, "dragon-blood trait"), field), expected,
    "dragon-blood trait must expose the requested native " + field + " modifier");
}

function findLocalization(locale, key) {
  const directory = path.join(moduleRoot, "localization", locale);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp("^\\s*" + escapedKey + ":\\d+\\s+\"", "m");
  const matches = listFiles(directory, ".yml").filter(file => matcher.test(fs.readFileSync(file, "utf8").replace(/^\ufeff/, "")));
  assert.equal(matches.length, 1, locale + " localization must define " + key + " once");
  const bytes = fs.readFileSync(matches[0]);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], matches[0] + " must retain UTF-8 BOM");
  return matches[0];
}

for (const locale of ["english", "simp_chinese"]) {
  findLocalization(locale, "trait_" + traitId);
  findLocalization(locale, "trait_" + traitId + "_desc");
}

function character(name, options = {}) {
  const result = ascensionHarness.character(name, { ...options, vars: options.variables || {} });
  result.variables = result.vars;
  result.wyvern = options.wyvern === true;
  return result;
}

function newState(options = {}) {
  const actor = character("Hunter", { alive: options.actorAlive, ai: options.actorAi });
  const target = character("Starbreaker", {
    alive: options.targetAlive,
    wyvern: true,
    traits: options.targetTraits,
    flags: options.targetFlags,
    variables: options.targetVariables
  });
  const mount = character("Rider's Mount", { wyvern: true });
  actor.variables.set("myv_slay_mounted_wild_survives_crash", options.wildSurvives ?? 1);
  actor.variables.set("myv_slay_mounted_player_survives_crash", options.playerSurvives ?? 1);
  actor.variables.set("myv_slay_mounted_player_mount", mount);
  const scopes = new Map();
  if (options.targetPresent !== false) {
    scopes.set("myv_slay_wyvern_target", target);
    scopes.set("mm_capture_target", target);
  }
  return {
    actor,
    target,
    mount,
    scopes,
    bloodCalls: 0,
    addedTraits: new Map(),
    triggeredEvents: []
  };
}

function resolveReference(reference, current, state) {
  if (reference === "root") return state.actor;
  if (reference.startsWith("scope:")) return state.scopes.get(reference.slice(6));
  if (reference.startsWith("var:")) return current.variables.get(reference.slice(4));
  return reference;
}

function parseExpected(raw) {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function matchesOperator(actual, operator, raw) {
  const expected = parseExpected(raw);
  if (operator === "=" || operator === "!=") {
    const equal = actual === expected;
    return operator === "=" ? equal : !equal;
  }
  if (operator === ">=") return actual >= expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === "<") return actual < expected;
  throw new Error("unsupported trigger operator " + operator);
}

function livingWild(character) {
  return Boolean(character && character.wyvern && character.alive &&
    !character.variables.has("mm_wyvern_captor") && !character.traits.has("myv_wyvern_tamed"));
}

function evaluateTrigger(trigger, current, state) {
  return trigger.entries.every(entry => evaluateTriggerEntry(entry, current, state));
}

function evaluateTriggerEntry(entry, current, state) {
  if (entry.key === "OR") return asBlock(entry.value, "OR").entries.some(child => evaluateTriggerEntry(child, current, state));
  if (entry.key === "AND") return asBlock(entry.value, "AND").entries.every(child => evaluateTriggerEntry(child, current, state));
  if (entry.key === "NOT") return !evaluateTrigger(asBlock(entry.value, "NOT"), current, state);
  if (entry.key === "exists") return Boolean(resolveReference(asScalar(entry.value, "exists"), current, state));
  if (entry.key && entry.key.startsWith("scope:") && entry.value.kind === "block") {
    const scoped = resolveReference(entry.key, current, state);
    return Boolean(scoped) && evaluateTrigger(entry.value, scoped, state);
  }
  if (entry.key === "is_alive") return current.alive === (asScalar(entry.value, "is_alive") === "yes");
  if (entry.key === "is_ai") return current.ai === (asScalar(entry.value, "is_ai") === "yes");
  if (entry.key === "myv_is_living_wild_wyvern") {
    return (asScalar(entry.value, entry.key) === "yes") === livingWild(current);
  }
  if (entry.key === "mm_wyvern_can_capture_target_trigger") {
    const target = state.scopes.get("mm_capture_target");
    return (asScalar(entry.value, entry.key) === "yes") === livingWild(target);
  }
  if (entry.key === "has_trait") return current.traits.has(asScalar(entry.value, entry.key));
  if (entry.key === "rite") return current.rite === asScalar(entry.value, entry.key);
  if (entry.key === "has_character_flag") return current.flags.has(asScalar(entry.value, entry.key));
  if (entry.key === "has_variable") return current.variables.has(asScalar(entry.value, entry.key));
  if (entry.key && entry.key.startsWith("var:")) {
    return matchesOperator(current.variables.get(entry.key.slice(4)), entry.operator, asScalar(entry.value, entry.key));
  }
  throw new Error("finite blood-trait trigger interpreter has no rule for " + entry.key);
}

function effectBranch(branch, current, state) {
  const limit = asBlock(one(branch, "limit", "effect branch"), "effect limit");
  if (!evaluateTrigger(limit, current, state)) return false;
  runEffectList(branch.entries.filter(entry => entry.key !== "limit"), current, state);
  return true;
}

function runEffectList(list, current, state) {
  let previousBranch = null;
  for (const entry of list) {
    if (entry.key === "if") {
      previousBranch = { taken: effectBranch(asBlock(entry.value, "if effect"), current, state) };
    } else if (entry.key === "else_if") {
      assert(previousBranch, "else_if without if");
      const taken = !previousBranch.taken && effectBranch(asBlock(entry.value, "else_if effect"), current, state);
      previousBranch.taken = previousBranch.taken || taken;
    } else if (entry.key === "else") {
      assert(previousBranch, "else without if");
      if (!previousBranch.taken) runEffectList(asBlock(entry.value, "else effect").entries, current, state);
      previousBranch = null;
    } else {
      previousBranch = null;
      runEffectEntry(entry, current, state);
    }
  }
}

function runEffectEntry(entry, current, state) {
  if (entry.key === "mm_asc_receive_blood_effect") {
    const before = new Set(current.traits);
    const env = ascensionHarness.environment({ root: state.actor, scopes: Object.fromEntries(state.scopes) });
    ascensionHarness.run(entry.key, current, env);
    for (const trait of current.traits) if (!before.has(trait)) state.addedTraits.set(trait, (state.addedTraits.get(trait) || 0) + 1);
    return;
  }
  if (entry.key === "hidden_effect" || entry.key === "show_as_tooltip") {
    runEffectList(asBlock(entry.value, entry.key).entries, current, state);
    return;
  }
  if (entry.key && entry.key.startsWith("scope:") && entry.value.kind === "block") {
    const scoped = resolveReference(entry.key, current, state);
    if (scoped) runEffectList(entry.value.entries, scoped, state);
    return;
  }
  if (entry.key === "root") {
    if (entry.value.kind === "block") runEffectList(entry.value.entries, state.actor, state);
    return;
  }
  if (entry.key && entry.key.startsWith("var:") && entry.value.kind === "block") {
    const scoped = resolveReference(entry.key, current, state);
    if (scoped) runEffectList(entry.value.entries, scoped, state);
    return;
  }
  if (entry.key === "save_scope_as") {
    state.scopes.set(asScalar(entry.value, entry.key), current);
    return;
  }
  if (entry.key === "set_variable") {
    const definition = asBlock(entry.value, "set_variable");
    const variableName = asScalar(one(definition, "name", "set_variable"), "set_variable.name");
    const raw = asScalar(one(definition, "value", "set_variable"), "set_variable.value");
    current.variables.set(variableName, raw.startsWith("scope:") ? resolveReference(raw, current, state) : parseExpected(raw));
    return;
  }
  if (entry.key === "death") {
    current.alive = false;
    return;
  }
  if (entry.key === "add_trait") {
    const trait = asScalar(entry.value, "add_trait");
    current.traits.add(trait);
    state.addedTraits.set(trait, (state.addedTraits.get(trait) || 0) + 1);
    return;
  }
  if (entry.key === "remove_trait") {
    current.traits.delete(asScalar(entry.value, "remove_trait"));
    return;
  }
  if (entry.key === "trigger_event") {
    state.triggeredEvents.push(asScalar(entry.value, "trigger_event"));
    return;
  }
  if (entry.key === "add_prestige" || entry.key === "custom_tooltip" || entry.key === "ai_chance") return;
  if (entry.key === bloodEffectId) {
    state.bloodCalls++;
    runEffectList(bloodEffect.entries, current, state);
    return;
  }
  if (entry.key === "mm_wyvern_resolve_kill_effect") {
    runEffectList(killEffect.entries, current, state);
    return;
  }
  if (entry.key === "mm_creed_award_dragon_victory_effect") {
    // The legacy fixture contains no founder rite; dedicated creed tests cover the reward.
    assert.notEqual(current.rite, "rite:mm_dragon_black");
    return;
  }
  if (entry.key === "mm_creed_earth_wyvern_return_roll_effect") {
    // This legacy fixture has no earth rite; actual return rolls are tested separately.
    assert.notEqual(current.rite, "rite:mm_dragon_earth");
    current.flags.delete("mm_creed_earth_wyvern_returned");
    return;
  }
  if (entry.key === "mm_wyvern_capture_target_effect") {
    const target = state.scopes.get("mm_capture_target");
    if (target) target.variables.set("mm_wyvern_captor", state.actor);
    return;
  }
  if ([
    "myv_slay_create_trophy_effect",
    "mm_wyvern_create_random_material_drops_effect",
    "mm_wyvern_source_original_material_effect",
    "mm_wyvern_grant_decorative_trophies_effect",
    "myv_grant_wyvern_slayer_reward_effect",
    "myv_slay_reset_state_effect",
    "myv_apply_aerial_crash_injuries_effect"
  ].includes(entry.key)) return;
  if (["name", "trigger", "option", "type", "window", "override_background", "title", "desc", "theme", "left_portrait", "right_portrait"].includes(entry.key)) return;
  throw new Error("finite blood-trait effect interpreter has no rule for " + entry.key);
}

function findEvent(eventId) {
  const event = eventMap.get(eventId);
  assert(event, "missing event " + eventId);
  return event;
}

function findOption(event, name, state) {
  const candidates = entries(event, "option").map(entry => asBlock(entry.value, "event option"))
    .filter(option => asScalar(one(option, "name", "option"), "option.name") === name);
  const applicable = candidates.filter(option => {
    const triggers = entries(option, "trigger");
    assert(triggers.length <= 1, "event option has repeated trigger blocks");
    return triggers.length === 0 || evaluateTrigger(asBlock(triggers[0].value, "option trigger"), state.actor, state);
  });
  assert.equal(applicable.length, 1, "expected one applicable option named " + name);
  return applicable[0];
}

function runEventOption(event, option, state, options = {}) {
  const immediate = entries(event, "immediate");
  assert(immediate.length <= 1, "event has repeated immediate blocks");
  if (immediate.length && options.runImmediate !== false) {
    runEffectList(asBlock(immediate[0].value, "event immediate").entries, state.actor, state);
  }
  const controls = new Set(["name", "trigger", "custom_tooltip", "ai_chance"]);
  runEffectList(option.entries.filter(entry => !controls.has(entry.key)), state.actor, state);
}

function directBloodState(options = {}) {
  const state = newState(options);
  if (options.targetAlive !== true) state.target.alive = false;
  return state;
}

for (const options of [
  { targetTraits: ["myv_wyvern_legendary"] },
  { targetFlags: ["mm_wyvern_legendary_origin"] }
]) {
  const state = directBloodState(options);
  runEffectList(bloodEffect.entries, state.actor, state);
  assert(state.actor.traits.has(rewardTraitId), "dead legendary source starts the usurper phase");
  assert(!state.actor.traits.has(traitId), "new acquisition does not skip the fusion phase");
  assert.equal(state.addedTraits.get(rewardTraitId), 1, "first valid grant adds the initial trait once");
  runEffectList(bloodEffect.entries, state.actor, state);
  assert.equal(state.addedTraits.get(rewardTraitId), 1, "repeated grant must not add the initial trait again");
}

for (const options of [
  { label: "missing source", targetPresent: false, targetTraits: ["myv_wyvern_legendary"] },
  { label: "live source", targetAlive: true, targetTraits: ["myv_wyvern_legendary"] },
  { label: "ordinary source", targetTraits: [] },
  { label: "dead recipient", actorAlive: false, targetTraits: ["myv_wyvern_legendary"] },
  { label: "recipient already has trait", actorAlive: true, targetTraits: ["myv_wyvern_legendary"], actorTrait: true }
]) {
  const state = directBloodState(options);
  if (options.actorTrait) state.actor.traits.add(traitId);
  runEffectList(bloodEffect.entries, state.actor, state);
  assert.equal(state.addedTraits.get(rewardTraitId) || 0, 0, options.label + " must not add initial dragon blood");
  if (options.actorTrait) assert(state.actor.traits.has(traitId), "existing completed blood is preserved");
}

const event0201 = findEvent("myv_wyvern.0201");
const killOptionId = "mm_wyvern_victory_kill";
const captureOptionId = "mm_wyvern_victory_capture";

function runVictoryChoice(options = {}, optionId = killOptionId) {
  const state = newState(options);
  const option = findOption(event0201, optionId, state);
  runEventOption(event0201, option, state);
  return state;
}

const normalLegendaryKill = runVictoryChoice({ targetTraits: ["myv_wyvern_legendary"] });
assert.equal(normalLegendaryKill.target.alive, false, "normal kill endpoint kills its target before the reward");
assert.equal(normalLegendaryKill.bloodCalls, 1, "normal kill endpoint calls the blood helper once");
assert(normalLegendaryKill.actor.traits.has(rewardTraitId), "normal legendary kill grants initial dragon blood");

const normalOrdinaryKill = runVictoryChoice();
assert.equal(normalOrdinaryKill.target.alive, false, "ordinary kill endpoint still kills its target");
assert.equal(normalOrdinaryKill.bloodCalls, 1, "normal kill endpoint routes through the guarded reward helper");
assert(!normalOrdinaryKill.actor.traits.has(rewardTraitId), "ordinary dragon kill does not grant dragon blood");

const capture = runVictoryChoice({ targetTraits: ["myv_wyvern_legendary"] }, captureOptionId);
assert.equal(capture.target.alive, true, "capture endpoint leaves the legendary target alive");
assert(capture.target.variables.has("mm_wyvern_captor"), "capture endpoint marks the target captured");
assert.equal(capture.bloodCalls, 0, "capture endpoint must not call the blood helper");
assert(!capture.actor.traits.has(rewardTraitId), "capture must not grant dragon blood");

function run0273(wildSurvives, legendary = true) {
  const state = newState({ wildSurvives });
  if (legendary) state.target.traits.add("myv_wyvern_legendary");
  const event = findEvent("myv_wyvern.0273");
  const options = entries(event, "option").map(entry => asBlock(entry.value, ".0273 option"));
  const selected = options.filter(option => {
    const trigger = asBlock(one(option, "trigger", ".0273 option"), ".0273 trigger");
    return evaluateTrigger(trigger, state.actor, state);
  });
  assert.equal(selected.length, 1, ".0273 must select exactly one survival outcome");
  runEventOption(event, selected[0], state, { runImmediate: false });
  return state;
}

const fatal0273 = run0273(0);
assert.equal(fatal0273.target.alive, false, ".0273 fatal target branch still kills the dragon");
assert.equal(fatal0273.bloodCalls, 1, ".0273 fatal kill calls the blood helper once");
assert(fatal0273.actor.traits.has(rewardTraitId), ".0273 fatal legendary kill grants initial dragon blood");

const survived0273 = run0273(1);
assert.equal(survived0273.target.alive, true, ".0273 surviving dragon stays alive");
assert.equal(survived0273.bloodCalls, 0, ".0273 survival route must not call the blood helper before a kill");

function run0275(wildSurvives, playerSurvives) {
  const state = newState({ wildSurvives, playerSurvives, targetTraits: ["myv_wyvern_legendary"] });
  const event = findEvent("myv_wyvern.0275");
  const option = asBlock(one(event, "option", ".0275 event"), ".0275 option");
  runEventOption(event, option, state, { runImmediate: false });
  return state;
}

const survived0275 = run0275(1, 1);
assert(survived0275.target.alive, ".0275 mutual survival keeps the dragon alive");
assert.equal(survived0275.bloodCalls, 0, ".0275 mutual survival must not call the blood helper");

const playerOnly0275 = run0275(0, 1);
assert.equal(playerOnly0275.target.alive, false, ".0275 player-only survival includes a dead dragon");
assert(playerOnly0275.actor.alive, ".0275 player-only survival keeps the recipient alive");
assert.equal(playerOnly0275.bloodCalls, 1, ".0275 grants only after the fatal dragon branch");
assert(playerOnly0275.actor.traits.has(rewardTraitId), ".0275 surviving player receives initial dragon blood");

for (const [wildSurvives, playerSurvives, label] of [[0, 0, "both die"], [1, 0, "player dies, dragon lives"]]) {
  const state = run0275(wildSurvives, playerSurvives);
  assert(!state.actor.alive, label + " must leave the player dead");
  assert.equal(state.bloodCalls, 0, label + " must not call the blood helper for a doomed recipient");
  assert(!state.actor.traits.has(rewardTraitId), label + " must not grant a reward before the player death");
}

console.log("Wyvern v1.1.4 blood-trait independent QA: PASS (finite PDX AST execution; CK3 scheduling and native effects stubbed)");

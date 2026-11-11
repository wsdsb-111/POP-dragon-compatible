"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const captureRoot = path.join(root, "patches/wyvern-capture");
const eventPath = path.join(captureRoot, "mod/events/myv_wyvern_events.txt");
const victoryEffectsPath = path.join(captureRoot, "mod/common/scripted_effects/mm_wyvern_victory_effects.txt");
const trophyEffectsPath = path.join(captureRoot, "mod/common/scripted_effects/mm_wyvern_trophies.txt");
const captureTriggersPath = path.join(captureRoot, "mod/common/scripted_triggers/zzzz_mm_wyvern_capture_triggers.txt");
const fixturePath = path.join(root, "tests/fixtures/wyvern-capture/original_victory_events.json");
const captureSourcesPath = path.join(captureRoot, "sources.json");
const victorySourcesPath = path.join(root, "patches/wyvern-trophies/victory-sources.json");

// This is a small structural PDX interpreter for the effects and event branches
// exercised below. It stubs the base living-wyvern predicate, capture eligibility,
// randomized crash rolls, material loot/slayer/reset effects and capture;
// it does not model CK3 event scheduling, artifact persistence, or game-side rendering.

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
      tokens.push({ type: "open", value: char, start: index, end: index + 1 });
      index++;
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "close", value: char, start: index, end: index + 1 });
      index++;
      continue;
    }
    if (char === '"') {
      const start = index++;
      let value = "";
      let closed = false;
      while (index < source.length) {
        const next = source[index++];
        if (next === "\\" && index < source.length) {
          value += next + source[index++];
        } else if (next === '"') {
          closed = true;
          break;
        } else {
          value += next;
        }
      }
      assert(closed, file + ": unterminated quoted PDX token at " + start);
      tokens.push({ type: "scalar", value, start, end: index });
      continue;
    }
    const start = index;
    const operator = source.slice(index).match(/^(?:>=|<=|!=|=|>|<)/);
    if (operator) {
      tokens.push({ type: "operator", value: operator[0], start, end: index + operator[0].length });
      index += operator[0].length;
      continue;
    }
    while (index < source.length && !/[\s{}#"=<>!]/.test(source[index])) index++;
    assert(index > start, file + ": unsupported PDX character " + JSON.stringify(source[index]) + " at " + index);
    tokens.push({ type: "scalar", value: source.slice(start, index), start, end: index });
  }
  return tokens;
}

function parsePdx(source, file) {
  const tokens = tokenizePdx(source, file);
  let cursor = 0;

  function parseEntries(terminatesAtClose) {
    const entries = [];
    while (cursor < tokens.length) {
      if (tokens[cursor].type === "close") {
        assert(terminatesAtClose, file + ": unexpected closing brace at " + tokens[cursor].start);
        const close = tokens[cursor++];
        return { entries, end: close.end };
      }
      const keyToken = tokens[cursor++];
      assert.equal(keyToken.type, "scalar", file + ": expected a PDX key at " + keyToken.start);
      const operator = tokens[cursor];
      if (!operator || operator.type !== "operator") {
        entries.push({
          key: null,
          operator: null,
          value: { kind: "scalar", value: keyToken.value, start: keyToken.start, end: keyToken.end },
          start: keyToken.start,
          end: keyToken.end
        });
        continue;
      }
      cursor++;
      const valueToken = tokens[cursor++];
      assert(valueToken, file + ": missing value for " + keyToken.value);
      let value;
      let end;
      if (valueToken.type === "open") {
        const nested = parseEntries(true);
        value = { kind: "block", entries: nested.entries, start: valueToken.start, end: nested.end };
        end = nested.end;
      } else {
        assert.equal(valueToken.type, "scalar", file + ": expected a scalar or block for " + keyToken.value);
        value = { kind: "scalar", value: valueToken.value, start: valueToken.start, end: valueToken.end };
        end = valueToken.end;
      }
      entries.push({ key: keyToken.value, operator: operator.value, value, start: keyToken.start, end });
    }
    assert(!terminatesAtClose, file + ": missing closing brace");
    return { entries, end: source.length };
  }

  const parsed = parseEntries(false);
  assert.equal(cursor, tokens.length, file + ": parser did not consume the full file");
  return { kind: "block", entries: parsed.entries, source };
}

function entries(block, key) {
  return block.entries.filter(entry => entry.key === key);
}

function one(block, key, context) {
  const matches = entries(block, key);
  assert.equal(matches.length, 1, context + ": expected one " + key + " entry, found " + matches.length);
  return matches[0].value;
}

function scalar(value, context) {
  assert(value && value.kind === "scalar", context + ": expected scalar");
  return value.value;
}

function block(value, context) {
  assert(value && value.kind === "block", context + ": expected block");
  return value;
}

function normalizedBlock(source, entry) {
  return source.slice(entry.start, entry.end)
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/[\t ]+$/, ""))
    .join("\n");
}

function eventEntries(ast) {
  return ast.entries.filter(entry => /^myv_wyvern\.\d+$/.test(entry.key) && entry.value.kind === "block");
}

function eventMap(ast) {
  return new Map(eventEntries(ast).map(entry => [entry.key, entry]));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const eventSource = fs.readFileSync(eventPath, "utf8");
const eventAst = parsePdx(eventSource, eventPath);
const victoryEffectsSource = fs.readFileSync(victoryEffectsPath, "utf8");
const victoryEffectsAst = parsePdx(victoryEffectsSource, victoryEffectsPath);
const trophyEffectsSource = fs.readFileSync(trophyEffectsPath, "utf8");
const trophyEffectsAst = parsePdx(trophyEffectsSource, trophyEffectsPath);
const captureTriggersAst = parsePdx(fs.readFileSync(captureTriggersPath, "utf8"), captureTriggersPath);
const originalFixture = readJson(fixturePath);
const captureSources = readJson(captureSourcesPath);
const victorySources = readJson(victorySourcesPath);

assert.equal(victorySources.output, "patches/wyvern-capture/mod/events/myv_wyvern_events.txt");
assert.deepEqual([...victorySources.changedEvents].sort(), Object.keys(originalFixture).sort());
const sourceRecord = captureSources.sourceFiles.find(source => source.path === victorySources.sourcePath);
assert(sourceRecord, "the original Wyvern event source must be pinned in capture metadata");
assert.equal(sourceRecord.sha256, victorySources.sourceSha256, "the independent victory fingerprint must match capture metadata");

const originalEventPath = path.join(captureSources.sourceRoots.workshop, ...victorySources.sourcePath.split("/"));
let unchangedSourceCompared = false;
if (fs.existsSync(originalEventPath)) {
  const originalBytes = fs.readFileSync(originalEventPath);
  assert.equal(crypto.createHash("sha256").update(originalBytes).digest("hex"), victorySources.sourceSha256,
    "the local upstream event file must match the frozen source hash");
  const originalSource = originalBytes.toString("utf8");
  const originalAst = parsePdx(originalSource, originalEventPath);
  const originalEvents = eventMap(originalAst);
  const patchedEvents = eventMap(eventAst);
  assert.deepEqual([...patchedEvents.keys()].sort(), [...originalEvents.keys()].sort(),
    "the event override must preserve the upstream event set");
  for (const eventId of victorySources.changedEvents) {
    const sourceEntry = originalEvents.get(eventId);
    const fixtureAst = parsePdx(originalFixture[eventId], "fixture:" + eventId);
    const fixtureEntry = eventMap(fixtureAst).get(eventId);
    assert(sourceEntry && fixtureEntry, "the original changed event must exist in both source and fixture: " + eventId);
    assert.equal(normalizedBlock(originalSource, sourceEntry), normalizedBlock(originalFixture[eventId], fixtureEntry),
      "the frozen original fixture must match the local source for " + eventId);
  }
  for (const [eventId, originalEntry] of originalEvents) {
    if (victorySources.changedEvents.includes(eventId)) continue;
    let patchedBlock = normalizedBlock(eventSource, patchedEvents.get(eventId));
    function replaceReviewedOnce(before, after, label) {
      assert.equal(patchedBlock.split(before).length, 2, label + " appears exactly once");
      patchedBlock = patchedBlock.replace(before, after);
    }
    if (eventId === "myv_wyvern.0203") {
      replaceReviewedOnce("            triggered_desc = { trigger = { has_character_flag = mm_creed_earth_wyvern_returned } desc = mm_creed_earth_wyvern_survived }\n", "", "return description");
      replaceReviewedOnce("    immediate = { mm_creed_earth_wyvern_return_roll_effect = yes }\n", "", "return roll");
      replaceReviewedOnce(`        if = { limit = { has_character_flag = mm_creed_earth_wyvern_returned } remove_character_flag = mm_creed_earth_wyvern_returned }
        else = { death = { death_reason = death_myv_killed_by_wyvern killer = scope:myv_slay_wyvern_target } }`, `\t\tdeath = {
\t\t\tdeath_reason = death_myv_killed_by_wyvern
\t\t\tkiller = scope:myv_slay_wyvern_target
\t\t}`, "return death gate");
    }
    if (eventId === "myv_wyvern.0274") {
      replaceReviewedOnce(`        if = {
            limit = { var:myv_slay_mounted_player_survives_crash = 0 }
            mm_creed_earth_wyvern_return_roll_effect = yes
            if = { limit = { has_character_flag = mm_creed_earth_wyvern_returned } remove_character_flag = mm_creed_earth_wyvern_returned set_variable = { name = myv_slay_mounted_player_survives_crash value = 1 } }
        }\n`, "", "crash return gate");
      replaceReviewedOnce(`scope:myv_defeated_slay_mount = {
                    mm_creed_earth_wyvern_return_roll_effect = yes
                    if = { limit = { has_character_flag = mm_creed_earth_wyvern_returned } remove_character_flag = mm_creed_earth_wyvern_returned }
                    else = { death = { death_reason = death_myv_wyvern_rider_duel_mount killer = scope:myv_slay_wyvern_target } }
                }`, "scope:myv_defeated_slay_mount = { death = { death_reason = death_myv_wyvern_rider_duel_mount killer = scope:myv_slay_wyvern_target } }", "mount return gate");
    }
    if (eventId === "myv_wyvern.0300") {
      const restoredCulture = `if = {
                limit = { exists = var:mm_dragon_name_original_culture }
                set_culture = var:mm_dragon_name_original_culture
                remove_variable = mm_dragon_name_original_culture
            }`;
      assert.equal(patchedBlock.split(restoredCulture).length, 2, "hatching restores the saved culture exactly once");
      patchedBlock = patchedBlock.replace(restoredCulture, "set_culture = culture:myv_wyvern_culture")
        .replace("# consulted by the name controller; confirmation restores its original culture.", "# consulted by the name controller. The creature always remains a wyvern.");
    }
    assert.equal(patchedBlock, normalizedBlock(originalSource, originalEntry),
      "unchanged event must match upstream apart from the verified hatching culture restoration: " + eventId);
  }
  unchangedSourceCompared = true;
} else {
  for (const eventId of victorySources.changedEvents) {
    const fixtureAst = parsePdx(originalFixture[eventId], "fixture:" + eventId);
    assert(eventMap(fixtureAst).has(eventId), "frozen fixture missing " + eventId);
    assert(eventMap(eventAst).has(eventId), "patched file missing " + eventId);
  }
}

function findEvent(id) {
  return block(one(eventAst, id, "events"), id);
}

function optionByName(event, name) {
  return entries(event, "option").map(entry => block(entry.value, "option"))
    .find(option => scalar(one(option, "name", "option name"), "option name") === name);
}

function optionsFor(event, state) {
  return entries(event, "option").map(entry => block(entry.value, "option"))
    .filter(option => {
      const triggers = entries(option, "trigger");
      assert(triggers.length <= 1, "an option cannot have repeated trigger blocks");
      return triggers.length === 0 || evaluateTrigger(block(triggers[0].value, "option trigger"), state.actor, state);
    });
}

function newCharacter(name, options = {}) {
  return {
    kind: options.kind || "character",
    name,
    alive: options.alive !== false,
    ai: options.ai === true,
    isWyvern: options.isWyvern === true,
    traits: new Set(options.traits || []),
    flags: new Set(options.flags || []),
    variables: new Map(Object.entries(options.variables || {})),
    prestige: 0
  };
}

function newState(options = {}) {
  const actor = newCharacter(options.actorName || "Hunter", {
    alive: options.actorAlive !== false,
    ai: options.actorAi === true
  });
  const target = options.target || newCharacter(options.targetName || "Ashwing", {
    alive: options.targetAlive !== false,
    isWyvern: true,
    traits: options.targetTraits || [],
    flags: options.targetFlags || [],
    variables: options.targetVariables || {}
  });
  const mount = options.mount || newCharacter("Mount", { isWyvern: true, alive: options.mountAlive !== false });
  const scopes = new Map([[
    "root", actor
  ], [
    "myv_slay_wyvern_target", target
  ], [
    "myv_slay_mounted_player_mount", mount
  ]]);
  if (options.targetPresent === false) scopes.delete("myv_slay_wyvern_target");
  actor.variables.set("myv_slay_mounted_wild_survives_crash", options.wildSurvives === undefined ? 1 : options.wildSurvives);
  actor.variables.set("myv_slay_mounted_player_survives_crash", options.playerSurvives === undefined ? 1 : options.playerSurvives);
  return {
    actor,
    target,
    mount,
    scopes,
    artifacts: [],
    externalCalls: [],
    triggeredEvents: [],
    deaths: [],
    canCapture: options.canCapture !== false,
    artifactHistoryCalls: 0
  };
}

function resolveReference(value, current, state) {
  const reference = scalar(value, "reference");
  if (reference === "root") return state.actor;
  if (reference.startsWith("scope:")) return state.scopes.get(reference.slice(6));
  if (reference.startsWith("var:")) return current.variables.get(reference.slice(4));
  return reference;
}

function expectedScalar(value) {
  if (value === "yes") return true;
  if (value === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function scalarEquals(actual, expected) {
  const parsed = expectedScalar(expected);
  return typeof actual === "number" && typeof parsed === "number" ? actual === parsed : actual === parsed;
}

const livingWildTrigger = block(one(captureTriggersAst, "myv_is_living_wild_wyvern", "capture triggers"), "living wild trigger");
const customEffects = new Map([
  ["mm_wyvern_legendary_blood_reward_effect", block(one(trophyEffectsAst, "mm_wyvern_legendary_blood_reward_effect", "blood reward"), "blood reward")],
  ["mm_wyvern_source_original_material_effect", block(one(trophyEffectsAst, "mm_wyvern_source_original_material_effect", "source annotation"), "source annotation")],
  ["mm_wyvern_resolve_kill_effect", block(one(victoryEffectsAst, "mm_wyvern_resolve_kill_effect", "victory effects"), "kill effect")],
  ["mm_wyvern_grant_decorative_trophies_effect", block(one(trophyEffectsAst, "mm_wyvern_grant_decorative_trophies_effect", "trophy effects"), "trophy effect")],
  ["mm_wyvern_create_decorative_trophy_set_effect", block(one(trophyEffectsAst, "mm_wyvern_create_decorative_trophy_set_effect", "trophy effects"), "trophy set effect")]
]);

function evaluateTrigger(trigger, current, state) {
  return trigger.entries.every(entry => evaluateTriggerEntry(entry, current, state));
}

function evaluateTriggerEntry(entry, current, state) {
  if (entry.key === "OR") return block(entry.value, "OR trigger").entries.some(child => evaluateTriggerEntry(child, current, state));
  if (entry.key === "AND") return block(entry.value, "AND trigger").entries.every(child => evaluateTriggerEntry(child, current, state));
  if (entry.key === "NOT") return !evaluateTrigger(block(entry.value, "NOT trigger"), current, state);
  if (entry.key === "exists") return Boolean(resolveReference(entry.value, current, state));
  if (entry.key.startsWith("scope:") && entry.value.kind === "block") {
    const scoped = resolveReference({ kind: "scalar", value: entry.key }, current, state);
    return Boolean(scoped) && evaluateTrigger(block(entry.value, "scoped trigger"), scoped, state);
  }
  if (entry.key.startsWith("var:")) {
    return scalarEquals(current.variables.get(entry.key.slice(4)), scalar(entry.value, entry.key));
  }
  if (entry.key === "rite") return current.rite === scalar(entry.value, entry.key);
  if (entry.key === "is_alive") return current.alive === (scalar(entry.value, entry.key) === "yes");
  if (entry.key === "is_ai") return current.ai === (scalar(entry.value, entry.key) === "yes");
  if (entry.key === "myv_is_living_wyvern") {
    return current.isWyvern && current.alive === (scalar(entry.value, entry.key) === "yes");
  }
  if (entry.key === "myv_is_living_wild_wyvern") {
    return (scalar(entry.value, entry.key) === "yes") === evaluateTrigger(livingWildTrigger, current, state);
  }
  if (entry.key === "mm_wyvern_can_capture_target_trigger") {
    const target = state.scopes.get("mm_capture_target");
    return (scalar(entry.value, entry.key) === "yes") === Boolean(target && state.canCapture && evaluateTrigger(livingWildTrigger, target, state));
  }
  if (entry.key === "has_trait") return current.traits.has(scalar(entry.value, entry.key)) === true;
  if (entry.key === "has_variable") return current.variables.has(scalar(entry.value, entry.key)) === true;
  if (entry.key === "has_character_flag") return current.flags.has(scalar(entry.value, entry.key)) === true;
  if (entry.key === "this") return resolveReference(entry.value, current, state) === current;
  throw new Error("finite trigger interpreter has no stub for " + entry.key);
}

function branchLimit(branch, current, state) {
  const limits = entries(branch, "limit");
  assert.equal(limits.length, 1, "effect branch requires one limit block");
  return evaluateTrigger(block(limits[0].value, "effect limit"), current, state);
}

function runEffectBranch(branch, current, state, parameters) {
  if (!branchLimit(branch, current, state)) return false;
  runEffectList(branch.entries.filter(entry => entry.key !== "limit"), current, state, parameters);
  return true;
}

function artifactOptionValue(artifactDefinition, key, parameters, current, state) {
  const value = one(artifactDefinition, key, "create_artifact." + key);
  const raw = scalar(value, "create_artifact." + key);
  const parameter = raw.match(/^\$(.+)\$$/);
  if (parameter) return parameters[parameter[1]];
  if (raw === "root") return state.actor;
  if (raw.startsWith("scope:") || raw.startsWith("var:")) return resolveReference(value, current, state);
  return raw;
}

function createArtifact(definition, current, state, parameters) {
  const artifact = {
    kind: "artifact",
    nameKey: artifactOptionValue(definition, "name", parameters, current, state),
    descriptionKey: artifactOptionValue(definition, "description", parameters, current, state),
    type: artifactOptionValue(definition, "type", parameters, current, state),
    visuals: artifactOptionValue(definition, "visuals", parameters, current, state),
    rarity: artifactOptionValue(definition, "rarity", parameters, current, state),
    creator: artifactOptionValue(definition, "creator", parameters, current, state),
    variables: new Map()
  };
  state.artifacts.push(artifact);
  const scopeName = entries(definition, "save_scope_as");
  if (scopeName.length) state.scopes.set(scalar(scopeName[0].value, "create_artifact scope"), artifact);
}

function runEffectList(list, current, state, parameters = {}) {
  let previousBranch = null;
  for (const entry of list) {
    if (entry.key === "if") {
      const taken = runEffectBranch(block(entry.value, "if effect"), current, state, parameters);
      previousBranch = { taken };
    } else if (entry.key === "else_if") {
      assert(previousBranch, "else_if without preceding if");
      const taken = !previousBranch.taken && runEffectBranch(block(entry.value, "else_if effect"), current, state, parameters);
      previousBranch.taken = previousBranch.taken || taken;
    } else if (entry.key === "else") {
      assert(previousBranch, "else without preceding if");
      if (!previousBranch.taken) runEffectList(block(entry.value, "else effect").entries, current, state, parameters);
      previousBranch = null;
    } else {
      previousBranch = null;
      runEffectEntry(entry, current, state, parameters);
    }
  }
}

function runEffectEntry(entry, current, state, parameters) {
  if (entry.key === "hidden_effect" || entry.key === "show_as_tooltip") {
    runEffectList(block(entry.value, entry.key).entries, current, state, parameters);
    return;
  }
  if (entry.key === "scope:mm_capture_target" || entry.key.startsWith("scope:")) {
    const scoped = resolveReference({ kind: "scalar", value: entry.key }, current, state);
    if (entry.value.kind === "block" && scoped) runEffectList(entry.value.entries, scoped, state, parameters);
    return;
  }
  if (entry.key.startsWith("var:")) {
    const scoped = resolveReference({ kind: "scalar", value: entry.key }, current, state);
    if (entry.value.kind === "block" && scoped) runEffectList(entry.value.entries, scoped, state, parameters);
    return;
  }
  if (entry.key === "root") {
    if (entry.value.kind === "block") runEffectList(entry.value.entries, state.actor, state, parameters);
    return;
  }
  if (entry.key === "set_variable") {
    const definition = block(entry.value, "set_variable");
    const name = scalar(one(definition, "name", "set_variable"), "set_variable.name");
    const variableValue = one(definition, "value", "set_variable");
    const raw = scalar(variableValue, "set_variable.value");
    current.variables.set(name, raw === "root" ? state.actor : (raw.startsWith("scope:") || raw.startsWith("var:") ? resolveReference(variableValue, current, state) : expectedScalar(raw)));
    return;
  }
  if (entry.key === "save_scope_as") {
    state.scopes.set(scalar(entry.value, "save_scope_as"), current);
    return;
  }
  if (entry.key === "add_prestige") {
    state.actor.prestige += Number(scalar(entry.value, "add_prestige"));
    return;
  }
  if (entry.key === "create_artifact") {
    createArtifact(block(entry.value, "create_artifact"), current, state, parameters);
    return;
  }
  if (entry.key === "add_artifact_history") {
    state.artifactHistoryCalls++;
    return;
  }
  if (entry.key === "mm_wyvern_apply_trophy_affixes_effect") {
    // Distribution/count/idempotency are executed independently in the affix suite.
    state.externalCalls.push("native-random-trophy-affixes");
    return;
  }
  if (entry.key === "set_artifact_name" || entry.key === "set_artifact_description") {
    current[entry.key === "set_artifact_name" ? "nameKey" : "descriptionKey"] = scalar(entry.value, entry.key);
    return;
  }
  if (entry.key === "death") {
    current.alive = false;
    state.deaths.push(current.name);
    return;
  }
  if (entry.key === "trigger_event") {
    state.triggeredEvents.push(scalar(entry.value, "trigger_event"));
    return;
  }
  if (entry.key === "add_trait") {
    current.traits.add(scalar(entry.value, "add_trait"));
    return;
  }
  if (entry.key === "remove_trait") {
    current.traits.delete(scalar(entry.value, "remove_trait"));
    return;
  }
  if (entry.key === "myv_slay_create_trophy_effect") {
    state.externalCalls.push("original-crafting-loot-and-egg-rolls");
    return;
  }
  if (entry.key === "mm_wyvern_create_random_material_drops_effect") {
    state.externalCalls.push("independent-material-drops-and-eggs");
    return;
  }
  if (entry.key === "myv_grant_wyvern_slayer_reward_effect") {
    state.externalCalls.push("slayer-reward");
    return;
  }
  if (entry.key === "mm_creed_award_dragon_victory_effect") {
    // The legacy fixture contains no founder rite; dedicated creed tests cover the reward.
    assert.notEqual(current.rite, "rite:mm_dragon_black");
    return;
  }
  if (entry.key === "mm_creed_earth_wyvern_return_roll_effect") {
    // These original trophy fixtures use non-eligible characters; dedicated
    // combat fixtures execute the real random return effect separately.
    assert.notEqual(current.rite, "rite:mm_dragon_earth");
    current.flags.delete("mm_creed_earth_wyvern_returned");
    return;
  }
  if (entry.key === "myv_slay_reset_state_effect") {
    state.externalCalls.push("reset-slay-state");
    return;
  }
  if (entry.key === "mm_wyvern_capture_target_effect") {
    state.externalCalls.push("capture-target");
    state.target.variables.set("mm_wyvern_captor", state.actor);
    return;
  }
  if (customEffects.has(entry.key)) {
    const localParameters = {};
    if (entry.value.kind === "block") {
      for (const parameter of entry.value.entries) localParameters[parameter.key] = scalar(parameter.value, "effect parameter");
    }
    runEffectList(customEffects.get(entry.key).entries, current, state, { ...parameters, ...localParameters });
    return;
  }
  if (["name", "trigger", "custom_tooltip", "ai_chance", "send_interface_toast"].includes(entry.key)) return;
  throw new Error("finite effect interpreter has no explicit stub for " + entry.key);
}

function runImmediate(event, state) {
  const immediates = entries(event, "immediate");
  assert(immediates.length <= 1, "event has repeated immediate blocks");
  if (immediates.length) runEffectList(block(immediates[0].value, "event immediate").entries, state.actor, state);
}

function chooseOption(event, state, predicate) {
  const applicable = optionsFor(event, state);
  const matches = applicable.filter(predicate);
  assert.equal(matches.length, 1, "scenario must enable exactly one selected event option");
  const option = matches[0];
  const controlKeys = new Set(["name", "trigger", "custom_tooltip", "ai_chance"]);
  runEffectList(option.entries.filter(entry => !controlKeys.has(entry.key)), state.actor, state);
  return option;
}

function nameOfOption(option) {
  return scalar(one(option, "name", "option"), "option name");
}

const event0201 = findEvent("myv_wyvern.0201");
const event0273 = findEvent("myv_wyvern.0273");
const event0275 = findEvent("myv_wyvern.0275");

const killName = "mm_wyvern_victory_kill";
const captureName = "mm_wyvern_victory_capture";
const unavailableName = "mm_wyvern_victory_unavailable";
const killOption = optionByName(event0201, killName);
const captureOption = optionByName(event0201, captureName);
assert(killOption && captureOption, "victory event must offer separate kill and capture options");
assert(!entries(killOption, "mm_wyvern_capture_target_effect").length, "kill option must not capture");
assert(!entries(captureOption, "mm_wyvern_resolve_kill_effect").length, "capture option must not kill");
assert(!entries(captureOption, "myv_slay_create_trophy_effect").length, "capture option must not award crafting loot");
assert(!entries(captureOption, "mm_wyvern_create_random_material_drops_effect").length, "capture option must not award personal materials");

function activateVictoryEvent(state) {
  runImmediate(event0201, state);
  if (state.scopes.has("myv_slay_wyvern_target")) {
    assert.equal(state.scopes.get("mm_capture_target"), state.target, "victory event must freeze its original target scope");
  } else {
    assert(!state.scopes.has("mm_capture_target"), "victory event must not invent a missing target");
  }
}

function selectNamedOption(event, state, name) {
  return chooseOption(event, state, option => nameOfOption(option) === name);
}

const killState = newState();
activateVictoryEvent(killState);
selectNamedOption(event0201, killState, killName);
assert.equal(killState.target.alive, false, "a valid kill must kill its free wild target");
assert.equal(killState.actor.prestige, 500, "the existing 500 prestige reward remains on the kill branch");
assert.equal(killState.externalCalls.filter(call => call === "independent-material-drops-and-eggs").length, 1,
  "the kill branch must use the independent material and preserved egg helper once");
assert.equal(killState.externalCalls.filter(call => call === "original-crafting-loot-and-egg-rolls").length, 0,
  "the kill branch must not also roll the old mutually exclusive fang/scale table");
assert.equal(killState.externalCalls.filter(call => call === "slayer-reward").length, 1,
  "the existing slayer reward remains on the kill branch");
assert.equal(killState.artifacts.length, 1, "a valid kill creates only one decorative head trophy");

const captureState = newState();
activateVictoryEvent(captureState);
selectNamedOption(event0201, captureState, captureName);
assert.equal(captureState.target.alive, true, "capture must leave the defeated target alive");
assert(captureState.target.variables.has("mm_wyvern_captor"), "capture effect stub must mark the target captured");
assert.equal(captureState.actor.prestige, 0, "capture must not grant kill prestige");
assert(!captureState.externalCalls.includes("independent-material-drops-and-eggs"), "capture must not roll materials or eggs");
assert(!captureState.externalCalls.includes("original-crafting-loot-and-egg-rolls"), "capture must not roll the old material table");
assert(!captureState.externalCalls.includes("slayer-reward"), "capture must not grant the slayer reward");
assert.equal(captureState.artifacts.length, 0, "capture must not grant decorative trophies");

for (const invalid of [
  { label: "missing target", targetPresent: false },
  { label: "dead target", targetAlive: false },
  { label: "captured target", targetVariables: { mm_wyvern_captor: "prior-captor" } },
  { label: "tamed target", targetTraits: ["myv_wyvern_tamed"] }
]) {
  const state = newState(invalid);
  activateVictoryEvent(state);
  const available = optionsFor(event0201, state);
  assert(!available.some(option => nameOfOption(option) === killName), invalid.label + " must not expose the kill option");
  assert(!available.some(option => nameOfOption(option) === captureName), invalid.label + " must not expose the capture option");
  selectNamedOption(event0201, state, unavailableName);
  assert.equal(state.actor.prestige, 0, invalid.label + " must not grant kill prestige");
  assert(!state.externalCalls.includes("independent-material-drops-and-eggs"), invalid.label + " must not roll materials or eggs");
  assert(!state.externalCalls.includes("original-crafting-loot-and-egg-rolls"), invalid.label + " must not roll the old material table");
  assert(!state.externalCalls.includes("slayer-reward"), invalid.label + " must not grant the slayer reward");
  assert.equal(state.artifacts.length, 0, invalid.label + " must not grant decorative trophies");
  if (state.scopes.has("mm_capture_target")) {
    runEffectList(customEffects.get("mm_wyvern_resolve_kill_effect").entries, state.actor, state);
    assert.equal(state.target.alive, invalid.targetAlive !== false, invalid.label + " must fail the kill helper's independent target gate");
    assert.equal(state.actor.prestige, 0, invalid.label + " must fail the kill helper before prestige");
    assert.equal(state.artifacts.length, 0, invalid.label + " must fail the kill helper before decorative awards");
    assert(!state.externalCalls.includes("independent-material-drops-and-eggs"), invalid.label + " must fail the kill helper before material drops");
    assert(!state.externalCalls.includes("original-crafting-loot-and-egg-rolls"), invalid.label + " must fail before the old material table");
  }
}

const trophyNames = ["head"];
const legacyTrophyNames = ["fang", "eye", "scale", "head", "claw"];
const expectedVisuals = new Map(trophyNames.map(name => [name, "mm_wyvern_trophy_" + name]));
for (const [kind, originalFlag, rarity] of [
  ["fang", null, "famed"],
  ["scale", "myv_wyvern_scale_material", "famed"],
  ["blood", "myv_wyvern_blood_material", "illustrious"]
]) {
  const state = newState({ targetName: "Starbreaker" });
  const material = { kind: "artifact", variables: new Map(originalFlag ? [[originalFlag, 1]] : []), rarity };
  state.scopes.set("myv_wyvern_trophy", material);
  runEffectList(customEffects.get("mm_wyvern_source_original_material_effect").entries, state.actor, state);
  assert.equal(material.nameKey, "mm_wyvern_material_" + kind + "_name");
  assert.equal(material.descriptionKey, "mm_wyvern_material_" + kind + "_desc");
  assert.equal(material.variables.get("mm_wyvern_trophy_source"), state.target);
  if (originalFlag) assert.equal(material.variables.get(originalFlag), 1, "source annotation preserves crafting eligibility");
  assert.equal(material.rarity, rarity, "source annotation preserves original rarity");
  assert.equal(state.artifacts.length, 0, "source annotation does not create another random material");
}
function runDecorativeAward(options = {}) {
  const state = newState(options);
  const target = state.target;
  state.scopes.set("myv_slay_wyvern_target", target);
  runEffectList(customEffects.get("mm_wyvern_grant_decorative_trophies_effect").entries, state.actor, state);
  return state;
}

for (const [label, options, rarity] of [
  ["ordinary", {}, "famed"],
  ["legendary trait", { targetTraits: ["myv_wyvern_legendary"] }, "illustrious"],
  ["preserved legendary origin", { targetFlags: ["mm_wyvern_legendary_origin"] }, "illustrious"]
]) {
  const state = runDecorativeAward({ ...options, targetName: "Starbreaker" });
  assert.equal(state.artifacts.length, 1, label + " source must produce only the head court trophy");
  assert.deepEqual(state.artifacts.map(artifact => artifact.visuals), [...expectedVisuals.values()], label + " trophy set");
  for (const artifact of state.artifacts) {
    assert.equal(artifact.rarity, rarity, label + " trophy rarity");
    assert.equal(artifact.variables.get("mm_wyvern_trophy_source"), state.target,
      label + " trophy must retain the exact source character");
    const itemName = artifact.visuals.replace("mm_wyvern_trophy_", "");
    assert.equal(artifact.nameKey, "mm_wyvern_trophy_" + itemName + "_name", label + " artifact name key");
    assert.equal(artifact.descriptionKey, "mm_wyvern_trophy_" + itemName + "_desc", label + " artifact description key");
  }
  assert.equal(state.target.variables.get("mm_wyvern_trophies_claimed"), state.actor,
    label + " source must be marked to prevent duplicate awards");
  runEffectList(customEffects.get("mm_wyvern_grant_decorative_trophies_effect").entries, state.actor, state);
  assert.equal(state.artifacts.length, 1, label + " repeat call must not create duplicate head trophies");
}

for (const invalid of [
  { label: "dead", targetAlive: false },
  { label: "captured", targetVariables: { mm_wyvern_captor: "prior-captor" } },
  { label: "tamed", targetTraits: ["myv_wyvern_tamed"] }
]) {
  const state = runDecorativeAward(invalid);
  assert.equal(state.artifacts.length, 0, invalid.label + " target must not receive decorative trophies");
}

const localizationFiles = [
  path.join(captureRoot, "mod/localization/english/mm_wyvern_trophies_l_english.yml"),
  path.join(captureRoot, "mod/localization/simp_chinese/mm_wyvern_trophies_l_simp_chinese.yml")
];
function localizationMap(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, "utf8").replace(/^\ufeff/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*([^\s:]+):\d+\s+"(.*)"\s*$/);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}
for (const file of localizationFiles) {
  const localization = localizationMap(file);
  for (const name of legacyTrophyNames) {
    const nameTemplate = localization.get("mm_wyvern_trophy_" + name + "_name");
    const descriptionTemplate = localization.get("mm_wyvern_trophy_" + name + "_desc");
    assert(nameTemplate && descriptionTemplate, file + " must define name and description for " + name);
    assert(nameTemplate.includes("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]"), name + " name must use its wyvern source");
    assert(descriptionTemplate.includes("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]"), name + " description must use its wyvern source");
    const sourceName = "Starbreaker";
    assert(nameTemplate.replaceAll("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]", sourceName).includes(sourceName));
    assert(descriptionTemplate.replaceAll("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]", sourceName).includes(sourceName));
  }
}

function collectAtoms(node, output = []) {
  for (const entry of node.entries) {
    if (entry.key) output.push(entry.key);
    if (entry.value.kind === "scalar") output.push(entry.value.value);
    else collectAtoms(entry.value, output);
  }
  return output;
}
const trophyAtoms = [...collectAtoms(customEffects.get("mm_wyvern_grant_decorative_trophies_effect")), ...collectAtoms(customEffects.get("mm_wyvern_create_decorative_trophy_set_effect"))];
assert(!trophyAtoms.some(atom => atom === "myv_wyvern_scale_material" || atom === "myv_wyvern_blood_material"),
  "decorative trophy effects must remain separate from original crafting material variables");
for (const name of trophyNames) assert(expectedVisuals.has(name), "each decorative artifact must have a dedicated visual key");

const artSources = readJson(path.join(root, "patches/wyvern-trophies/sources.json"));
const guardedEffects = parsePdx(fs.readFileSync(path.join(captureRoot, "mod/common/scripted_effects/zzzz_mm_wyvern_capture_effects.txt"), "utf8"), "guarded effects");
const nativeEffectFixture = readJson(path.join(root, "tests/fixtures/wyvern-capture/original_guarded_effects.json"));
function canonical(node) {
  if (node.kind === "scalar") return node.value;
  return node.entries.map(entry => [entry.key, entry.operator, canonical(entry.value)]);
}
for (const [key, frozen] of Object.entries(nativeEffectFixture)) {
  const expected = one(parsePdx(frozen, key), key, "native effect");
  const stable = key === "myv_wyvern_stable_integrity_effect";
  const actual = one(guardedEffects, stable ? "mm_wyvern_uncaptured_stable_integrity_effect" : key, "guarded effect");
  const body = stable ? actual : { kind: "block", entries: one(actual, "if", key).entries.filter(entry => entry.key !== "limit") };
  assert.deepEqual(canonical(body), canonical(expected), key + " must preserve native behavior for uncaptured dragons");
  const upstreamName = stable ? "myv_wyvern_stable_effects.txt" : "myv_wyvern_effects.txt";
  const upstreamFile = path.join(captureSources.sourceRoots.workshop, "3811316052/common/scripted_effects", upstreamName);
  if (fs.existsSync(upstreamFile)) {
    const bytes = fs.readFileSync(upstreamFile);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), captureSources.sourceFiles.find(source => source.path.endsWith("/" + upstreamName)).sha256);
    assert.deepEqual(canonical(one(parsePdx(bytes.toString("utf8"), upstreamFile), key, "upstream")), canonical(expected));
  }
}
const visuals = fs.readFileSync(path.join(captureRoot, "mod/common/artifacts/visuals/mm_wyvern_trophies.txt"), "utf8");
for (const asset of artSources.assets) {
  const png = fs.readFileSync(path.join(root, asset.source));
  const dds = fs.readFileSync(path.join(captureRoot, "mod", asset.icon));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1254);
  assert.equal(png.readUInt32BE(20), 1254);
  assert.equal(png[25], 6, "RGBA source must retain an alpha channel");
  assert.equal(dds.subarray(0, 4).toString(), "DDS ");
  assert.equal(dds.readUInt32LE(12), 240);
  assert.equal(dds.readUInt32LE(16), 240);
  assert.equal(dds.subarray(84, 88).toString(), "DXT5");
  assert.equal(dds.length, 128 + 60 * 60 * 16);
  assert.equal(crypto.createHash("sha256").update(png).digest("hex"), asset.sourceSha256);
  assert.equal(crypto.createHash("sha256").update(dds).digest("hex"), asset.iconSha256);
  assert(visuals.includes(asset.courtAsset) && visuals.includes(path.basename(asset.icon)));
  assert.equal(asset.courtAssetIsFallback, false);
}

function containsFreeWildTargetGuard(node) {
  return node.entries.some(entry => {
    if (entry.key === "scope:myv_slay_wyvern_target" && entry.value.kind === "block" &&
        entry.value.entries.some(child => child.key === "myv_is_living_wild_wyvern" && child.value.kind === "scalar" && child.value.value === "yes")) {
      return true;
    }
    return entry.value.kind === "block" && containsFreeWildTargetGuard(entry.value);
  });
}

function hasFreeWildTargetGuard(option) {
  const triggers = entries(option, "trigger");
  return triggers.some(trigger => containsFreeWildTargetGuard(block(trigger.value, "victory trigger")));
}

function prepareCrashState(eventId, options) {
  const state = newState(options);
  if (eventId === "myv_wyvern.0273") activateVictoryEvent(state);
  state.actor.variables.set("myv_slay_mounted_wild_survives_crash", options.wildSurvives);
  state.actor.variables.set("myv_slay_mounted_player_survives_crash", options.playerSurvives === undefined ? 1 : options.playerSurvives);
  return state;
}

function eventOptionNamed(event, name, state) {
  return optionsFor(event, state).filter(option => nameOfOption(option) === name);
}

for (const [wildSurvives, expectedEvent] of [[0, null], [1, "myv_wyvern.0201"]]) {
  const state = prepareCrashState("myv_wyvern.0273", { wildSurvives, playerSurvives: 1 });
  const options = optionsFor(event0273, state);
  assert.equal(options.length, 1, ".0273 must have exactly one valid option for a live free target");
  const option = options[0];
  const hasWildFlag = evaluateTrigger(block(one(option, "trigger", ".0273 option"), ".0273 trigger"), state.actor, state);
  assert(hasWildFlag, ".0273 selected branch must match the forced survival roll");
  assert(hasFreeWildTargetGuard(option), ".0273 kill and survival routes must recheck the target is still free wild");
  chooseOption(event0273, state, candidate => candidate === option);
  assert.equal(state.target.alive, wildSurvives === 1, ".0273 fatal crash must remain fatal");
  assert.deepEqual(state.triggeredEvents, expectedEvent ? [expectedEvent] : [], ".0273 may route to victory choice only after survival");
  assert.equal(state.artifacts.length, wildSurvives === 0 ? 1 : 0, ".0273 awards one head only on a fatal kill");
  assert.equal(state.externalCalls.filter(call => call === "independent-material-drops-and-eggs").length, wildSurvives === 0 ? 1 : 0,
    ".0273 must make the independent material/egg attempt only on the fatal kill branch");
  assert.equal(state.externalCalls.filter(call => call === "original-crafting-loot-and-egg-rolls").length, 0,
    ".0273 must not invoke the upstream mutually exclusive material table");
  assert.equal(state.externalCalls.filter(call => call === "slayer-reward").length, wildSurvives === 0 ? 1 : 0,
    ".0273 slayer reward belongs only to the fatal kill branch");
}

for (const wildSurvives of [0, 1]) {
  const state = prepareCrashState("myv_wyvern.0273", {
    wildSurvives,
    playerSurvives: 1,
    targetVariables: { mm_wyvern_captor: "prior-captor" }
  });
  const options = optionsFor(event0273, state);
  assert.equal(options.length, 1, ".0273 captured target must resolve to its invalid-target fallback");
  chooseOption(event0273, state, candidate => candidate === options[0]);
  assert.equal(state.target.alive, true, ".0273 must not kill an already captured target");
  assert.equal(state.artifacts.length, 0, ".0273 must not award a captured target trophy");
  assert(!state.externalCalls.includes("independent-material-drops-and-eggs"), ".0273 captured target must not roll materials");
  assert.equal(state.triggeredEvents.length, 0, ".0273 must not route a captured target into the victory-choice event");
  assert(!state.externalCalls.includes("slayer-reward"), ".0273 invalid target must not grant slayer credit");
}

function run0275(options) {
  const state = prepareCrashState("myv_wyvern.0275", options);
  const eventOption = entries(event0275, "option").map(entry => block(entry.value, ".0275 option"))[0];
  assert(eventOption, ".0275 must retain its single outcome resolver");
  chooseOption(event0275, state, candidate => candidate === eventOption);
  return state;
}

const bothSurvive = run0275({ wildSurvives: 1, playerSurvives: 1 });
assert.equal(bothSurvive.target.alive, true, ".0275 both-survive outcome keeps the wild wyvern alive");
assert.equal(bothSurvive.actor.alive, true, ".0275 both-survive outcome keeps the player alive");
assert.deepEqual(bothSurvive.triggeredEvents, ["myv_wyvern.0201"], ".0275 routes only a mutual survival to the kill/capture choice");
assert.equal(bothSurvive.artifacts.length, 0, ".0275 must wait for the explicit kill choice before awarding trophies");
assert(!bothSurvive.externalCalls.includes("independent-material-drops-and-eggs"), ".0275 mutual survival must not roll materials");

const playerOnlySurvives = run0275({ wildSurvives: 0, playerSurvives: 1 });
assert.equal(playerOnlySurvives.target.alive, false, ".0275 fatal wild crash still kills the target");
assert.equal(playerOnlySurvives.actor.alive, true, ".0275 keeps the player alive when its survival roll succeeds");
assert.deepEqual(playerOnlySurvives.triggeredEvents, [], ".0275 fatal crash must not open the kill/capture choice");
assert.equal(playerOnlySurvives.artifacts.length, 1, ".0275 awards one head only to a surviving victor");
assert.equal(playerOnlySurvives.externalCalls.filter(call => call === "independent-material-drops-and-eggs").length, 1,
  ".0275 must roll materials and eggs only when the player survives the fatal wild crash");

const noPlayerSurvives = run0275({ wildSurvives: 1, playerSurvives: 0 });
assert.equal(noPlayerSurvives.actor.alive, false, ".0275 fatal player crash remains fatal");
assert.equal(noPlayerSurvives.target.alive, true, ".0275 does not kill a target that survived its crash roll");
assert.deepEqual(noPlayerSurvives.triggeredEvents, [], ".0275 must not route to victory choice when the player dies");
assert.equal(noPlayerSurvives.artifacts.length, 0, ".0275 must not award trophies to a dead victor");
assert(!noPlayerSurvives.externalCalls.includes("independent-material-drops-and-eggs"), ".0275 dead player must not receive material drops");

const neitherSurvives = run0275({ wildSurvives: 0, playerSurvives: 0 });
assert.equal(neitherSurvives.actor.alive, false, ".0275 fatal player crash cannot be revived by the outcome resolver");
assert.equal(neitherSurvives.target.alive, false, ".0275 fatal wild crash cannot be revived by the outcome resolver");
assert.deepEqual(neitherSurvives.triggeredEvents, [], ".0275 cannot route a fatal crash into the victory-choice event");
assert.equal(neitherSurvives.artifacts.length, 0, ".0275 neither-dead outcome grants no decorative trophies");
assert(!neitherSurvives.externalCalls.includes("independent-material-drops-and-eggs"), ".0275 neither-dead outcome grants no personal materials");

const captured0275 = run0275({
  wildSurvives: 0,
  playerSurvives: 1,
  targetVariables: { mm_wyvern_captor: "prior-captor" }
});
assert.equal(captured0275.target.alive, true, ".0275 fatal branch must fail closed for an already captured target");
assert.equal(captured0275.artifacts.length, 0, ".0275 captured target receives no trophies");
assert(!captured0275.externalCalls.includes("independent-material-drops-and-eggs"), ".0275 captured target receives no material drops");
assert(!captured0275.externalCalls.includes("slayer-reward"), ".0275 captured target grants no slayer credit");
assert.deepEqual(captured0275.triggeredEvents, [], ".0275 captured target is not re-routed into victory choice");

console.log("Wyvern trophy independent QA: PASS (limited PDX AST execution; upstream fidelity=" +
  (unchangedSourceCompared ? "compared" : "fixture and frozen hash") + "; engine and external-effect behavior explicitly stubbed)");

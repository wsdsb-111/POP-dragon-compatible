"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const modRoot = path.join(root, "patches", "wyvern-capture", "mod");
const trophyPath = path.join(modRoot, "common", "scripted_effects", "mm_wyvern_trophies.txt");
const affixPath = path.join(modRoot, "common", "scripted_effects", "mm_wyvern_trophy_affixes.txt");
const onActionsPath = path.join(modRoot, "common", "on_action", "zzzz_mm_wyvern_capture_on_actions.txt");
const fixturePath = path.join(root, "tests", "fixtures", "v117", "material-loot-cases.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const visualsPath = path.join(modRoot, "common", "artifacts", "visuals", "mm_wyvern_trophies.txt");

function tokenizePdx(source, label) {
  const tokens = [];
  for (let index = source.charCodeAt(0) === 0xfeff ? 1 : 0; index < source.length;) {
    const character = source[index];
    if (/\s/.test(character)) index += 1;
    else if (character === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (character === "{") {
      tokens.push({ type: "open", value: character });
      index += 1;
    } else if (character === "}") {
      tokens.push({ type: "close", value: character });
      index += 1;
    } else if (character === '"') {
      index += 1;
      let value = "";
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === "\\" && index < source.length) value += current + source[index++];
        else if (current === '"') {
          closed = true;
          break;
        } else value += current;
      }
      assert.ok(closed, label + " has an unterminated string");
      tokens.push({ type: "scalar", value });
    } else {
      const operator = source.slice(index).match(/^(?:>=|<=|!=|=|>|<)/);
      if (operator) {
        tokens.push({ type: "operator", value: operator[0] });
        index += operator[0].length;
      } else {
        const start = index;
        while (index < source.length && !/[\s{}#"=<>!]/.test(source[index])) index += 1;
        assert.ok(index > start, label + " has an unsupported token at " + String(index));
        tokens.push({ type: "scalar", value: source.slice(start, index) });
      }
    }
  }
  return tokens;
}

function parsePdx(source, label) {
  const tokens = tokenizePdx(source, label);
  let cursor = 0;
  function parseEntries(nested) {
    const result = [];
    while (cursor < tokens.length) {
      const token = tokens[cursor++];
      if (token.type === "close") {
        assert.ok(nested, label + " has an unmatched closing brace");
        return result;
      }
      assert.equal(token.type, "scalar", label + " expected a PDX key");
      const operator = tokens[cursor];
      if (!operator || operator.type !== "operator") {
        result.push({ key: null, operator: null, value: { kind: "scalar", value: token.value } });
        continue;
      }
      cursor += 1;
      const valueToken = tokens[cursor++];
      assert.ok(valueToken && valueToken.type !== "close", label + " has a key with no value");
      result.push({
        key: token.value,
        operator: operator.value,
        value: valueToken.type === "open"
          ? { kind: "block", entries: parseEntries(true) }
          : { kind: "scalar", value: valueToken.value },
      });
    }
    assert.ok(!nested, label + " has an unclosed block");
    return result;
  }
  return { kind: "block", entries: parseEntries(false) };
}

function block(value, label) {
  assert.equal(value?.kind, "block", label + " must be a PDX block");
  return value;
}

function scalar(value, label) {
  assert.equal(value?.kind, "scalar", label + " must be a PDX scalar");
  return value.value;
}

function entries(value, key) {
  return value.entries.filter(entry => entry.key === key);
}

function one(value, key, label) {
  const matches = entries(value, key);
  assert.equal(matches.length, 1, label + " must have one " + key + " entry");
  return matches[0].value;
}

function namedBlock(value, name, label) {
  return block(one(value, name, label), label + "." + name);
}

const trophyAst = parsePdx(fs.readFileSync(trophyPath, "utf8"), trophyPath);
const affixAst = parsePdx(fs.readFileSync(affixPath, "utf8"), affixPath);
const onActionsAst = parsePdx(fs.readFileSync(onActionsPath, "utf8"), onActionsPath);
const visualsAst = parsePdx(fs.readFileSync(visualsPath, "utf8"), visualsPath);
const materialEffect = namedBlock(trophyAst, "mm_wyvern_create_random_material_drops_effect", "trophy effects");
const headGrantEffect = namedBlock(trophyAst, "mm_wyvern_grant_decorative_trophies_effect", "trophy effects");
const headSetEffect = namedBlock(trophyAst, "mm_wyvern_create_decorative_trophy_set_effect", "trophy effects");
const affixApplyEffect = namedBlock(affixAst, "mm_wyvern_apply_trophy_affixes_effect", "affix effects");
const affixRollEffect = namedBlock(affixAst, "mm_wyvern_roll_trophy_affix_effect", "affix effects");
const effects = new Map();
const scriptEffectsDir = path.join(modRoot, "common", "scripted_effects");
const effectAsts = fs.readdirSync(scriptEffectsDir)
  .filter(file => /^mm_wyvern_.*\.txt$/i.test(file))
  .map(file => parsePdx(fs.readFileSync(path.join(scriptEffectsDir, file), "utf8"), path.join(scriptEffectsDir, file)));
for (const ast of effectAsts) {
  for (const entry of ast.entries) {
    if (entry.key && entry.value.kind === "block") effects.set(entry.key, entry.value);
  }
}

function walk(node, callback) {
  for (const entry of node.entries) {
    callback(entry);
    if (entry.value.kind === "block") walk(entry.value, callback);
  }
}

function countKey(node, key) {
  let count = 0;
  walk(node, entry => { if (entry.key === key) count += 1; });
  return count;
}

function collectRollBlocks(effectName, active = new Set()) {
  assert.ok(!active.has(effectName), "scripted effect call graph must not recurse: " + effectName);
  const nextActive = new Set([...active, effectName]);
  const body = effects.get(effectName);
  assert.ok(body, "missing called script effect " + effectName);
  const result = [];
  const calls = [];
  walk(body, entry => {
    if (entry.key === "random" && entry.value.kind === "block" && entries(entry.value, "chance").length === 1) {
      result.push(block(entry.value, "random chance roll"));
    }
    if (entry.key && effects.has(entry.key) && entry.value.kind === "block" && entry.key !== "mm_wyvern_apply_trophy_affixes_effect") calls.push(entry.key);
  });
  for (const call of calls) result.push(...collectRollBlocks(call, nextActive));
  return result;
}

function countReachableCalls(effectName, targetName, active = new Set()) {
  assert.ok(!active.has(effectName), "scripted effect call graph must not recurse: " + effectName);
  const nextActive = new Set([...active, effectName]);
  const body = effects.get(effectName);
  assert.ok(body, "missing called script effect " + effectName);
  let count = 0;
  const calls = [];
  walk(body, entry => {
    if (entry.key === targetName) count += 1;
    else if (entry.key && effects.has(entry.key) && entry.value.kind === "block" && entry.key !== "mm_wyvern_apply_trophy_affixes_effect") calls.push(entry.key);
  });
  for (const call of calls) count += countReachableCalls(call, targetName, nextActive);
  return count;
}

const randomRolls = collectRollBlocks("mm_wyvern_create_random_material_drops_effect");
assert.equal(randomRolls.length, fixture.kinds.length, "the loot helper must make one independent chance roll per material kind");
assert.deepEqual(randomRolls.map(roll => Number(scalar(one(roll, "chance", "material chance"), "material chance"))).sort((a, b) => a - b),
  Object.values(fixture.chancePercent).sort((a, b) => a - b), "drop chance table must match the v1.1.7 contract");
assert.equal(countReachableCalls("mm_wyvern_create_random_material_drops_effect", "myv_slay_create_trophy_effect"), 0,
  "the new independent loot path must bypass the upstream mutually exclusive 65/20/15 material table");
assert.equal(countReachableCalls("mm_wyvern_create_random_material_drops_effect", "myv_slay_try_find_wyvern_eggs_effect"), 1,
  "the new loot path must retain exactly one upstream egg-search attempt");

function resolve(raw, current, state, parameters) {
  const expanded = raw.replace(/\$([^$]+)\$/g, (match, name) => {
    assert.ok(Object.prototype.hasOwnProperty.call(parameters, name), "unbound script parameter " + name);
    return String(parameters[name]);
  });
  if (expanded === "root") return state.root;
  if (expanded === "this") return current;
  if (expanded.startsWith("scope:")) return state.scopes.get(expanded.slice(6));
  if (expanded.startsWith("var:")) return current.variables.get(expanded.slice(4));
  if (expanded === "yes") return true;
  if (expanded === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(expanded)) return Number(expanded);
  return expanded;
}

function triggerValue(value, current, state, parameters) {
  return value.kind === "scalar" ? resolve(value.value, current, state, parameters) : undefined;
}

function evaluateTrigger(trigger, current, state, parameters) {
  return trigger.entries.every(entry => {
    const expected = triggerValue(entry.value, current, state, parameters);
    if (entry.key === "AND") return block(entry.value, "AND trigger").entries.every(child => evaluateTrigger({ entries: [child] }, current, state, parameters));
    if (entry.key === "OR") return block(entry.value, "OR trigger").entries.some(child => evaluateTrigger({ entries: [child] }, current, state, parameters));
    if (entry.key === "NOT") return !evaluateTrigger(block(entry.value, "NOT trigger"), current, state, parameters);
    if (entry.key.startsWith("scope:") && entry.value.kind === "block") {
      const target = state.scopes.get(entry.key.slice(6));
      return Boolean(target) && evaluateTrigger(block(entry.value, "scoped trigger"), target, state, parameters);
    }
    if (entry.key.startsWith("var:")) {
      const actual = current.variables.get(entry.key.slice(4));
      if (entry.operator === ">=") return Number(actual) >= Number(expected);
      if (entry.operator === "<=") return Number(actual) <= Number(expected);
      if (entry.operator === ">") return Number(actual) > Number(expected);
      if (entry.operator === "<") return Number(actual) < Number(expected);
      return actual === expected;
    }
    if (entry.key === "exists") return Boolean(expected && expected.exists !== false);
    if (entry.key === "is_alive") return current.alive === expected;
    if (entry.key === "is_ai") return current.ai === expected;
    if (entry.key === "has_variable") return current.variables.has(expected);
    if (entry.key === "has_trait") return current.traits.has(expected);
    if (entry.key === "has_character_flag") return current.flags.has(expected);
    if (entry.key === "has_artifact_modifier") return current.modifiers.has(expected);
    if (entry.key === "rarity") return current.rarity === expected;
    if (entry.key === "artifact_slot_type") return current.slot === expected;
    if (entry.key === "myv_is_living_wild_wyvern") return current.isWyvern && current.alive && !current.variables.has("mm_wyvern_captor") && !current.traits.has("myv_wyvern_tamed");
    throw new Error("v117 loot QA trigger interpreter has no rule for " + String(entry.key));
  });
}

function newState(options = {}) {
  const dragon = {
    id: "dragon_" + (options.name || "Starbreaker"),
    name: options.name || "Starbreaker",
    alive: true,
    isWyvern: true,
    variables: new Map(options.size === undefined || options.size === null ? [] : [["myv_wyvern_size", options.size]]),
    traits: new Set(options.legendary ? ["myv_wyvern_legendary"] : []),
    flags: new Set(options.legendaryOrigin ? ["mm_wyvern_legendary_origin"] : []),
    exists: true,
  };
  const actor = {
    id: "root",
    alive: true,
    ai: false,
    variables: new Map(),
    traits: new Set(),
    flags: new Set(),
    artifacts: [],
  };
  const state = {
    root: actor,
    actor,
    dragon,
    scopes: new Map([
      ["myv_slay_wyvern_target", dragon],
      ["mm_wyvern_trophy_source", dragon],
    ]),
    artifacts: [],
    effectCalls: [],
    eggSearchCalls: 0,
    randomDraws: options.randomDraws || [],
    randomIndex: 0,
  };
  return state;
}

function artifactValue(definition, key, current, state, parameters, optional = false) {
  const found = entries(definition, key);
  if (optional && found.length === 0) return undefined;
  assert.equal(found.length, 1, "create_artifact must have one " + key);
  return resolve(scalar(found[0].value, "create_artifact." + key), current, state, parameters);
}

function createArtifact(definition, current, state, parameters) {
  const artifact = {
    id: "artifact_" + String(state.artifacts.length + 1),
    owner: state.root,
    name: artifactValue(definition, "name", current, state, parameters),
    description: artifactValue(definition, "description", current, state, parameters),
    type: artifactValue(definition, "type", current, state, parameters),
    visuals: artifactValue(definition, "visuals", current, state, parameters),
    rarity: artifactValue(definition, "rarity", current, state, parameters),
    creator: artifactValue(definition, "creator", current, state, parameters, true),
    slot: artifactValue(definition, "slot", current, state, parameters, true),
    variables: new Map(),
    modifiers: new Set(),
    baseModifiers: new Set(),
    exists: true,
  };
  for (const entry of entries(definition, "modifier")) artifact.modifiers.add(resolve(scalar(entry.value, "artifact modifier"), artifact, state, parameters));
  for (const entry of entries(definition, "add_artifact_modifier")) artifact.modifiers.add(resolve(scalar(entry.value, "artifact modifier"), artifact, state, parameters));
  artifact.baseModifiers = new Set(artifact.modifiers);
  state.artifacts.push(artifact);
  state.root.artifacts.push(artifact);
  const saved = entries(definition, "save_scope_as");
  if (saved.length) state.scopes.set(resolve(scalar(saved[0].value, "save_scope_as"), artifact, state, parameters), artifact);
  return artifact;
}

function runConditionalChain(list, start, current, state, parameters) {
  let end = start;
  while (end + 1 < list.length && ["else_if", "else"].includes(list[end + 1].key)) end += 1;
  let selected = false;
  for (let index = start; index <= end; index += 1) {
    const branch = block(list[index].value, "conditional effect");
    const limits = entries(branch, "limit");
    const allowed = list[index].key === "else" || (limits.length === 1 && evaluateTrigger(block(limits[0].value, "effect limit"), current, state, parameters));
    if (!selected && allowed) {
      selected = true;
      runEffectList(branch.entries.filter(entry => entry.key !== "limit"), current, state, parameters);
    }
  }
  return end;
}

function runRandomList(randomList, current, state, parameters) {
  const outcomes = randomList.entries.filter(entry => entry.key && /^\d+$/.test(entry.key) && entry.value.kind === "block");
  const selected = outcomes.find(outcome => {
    const outcomeBlock = block(outcome.value, "random-list outcome");
    const triggers = entries(outcomeBlock, "trigger");
    assert.ok(triggers.length <= 1, "a random-list outcome has at most one trigger");
    return !triggers.length || evaluateTrigger(block(triggers[0].value, "random-list trigger"), current, state, parameters);
  });
  assert.ok(selected, "random_list must have one eligible outcome");
  runEffectList(block(selected.value, "selected random-list outcome").entries, current, state, parameters);
}

function runEffectList(list, current, state, parameters = {}) {
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (entry.key === "if") {
      index = runConditionalChain(list, index, current, state, parameters);
      continue;
    }
    if (["else_if", "else", "limit", "chance", "trigger"].includes(entry.key)) continue;
    if (entry.key?.startsWith("scope:") && entry.value.kind === "block") {
      const scoped = state.scopes.get(entry.key.slice(6));
      assert.ok(scoped, "missing effect scope " + entry.key);
      runEffectList(block(entry.value, "scoped effect" ).entries, scoped, state, parameters);
      continue;
    }
    if (entry.key === "root" && entry.value.kind === "block") {
      runEffectList(block(entry.value, "root effect").entries, state.root, state, parameters);
      continue;
    }
    if (entry.key === "random") {
      const randomBlock = block(entry.value, "random chance effect");
      const chance = Number(scalar(one(randomBlock, "chance", "random chance"), "random chance"));
      assert.ok(chance >= 0 && chance <= 100, "chance must be a percent");
      const draw = state.randomDraws[state.randomIndex++] ?? 100;
      assert.ok(draw >= 1 && draw <= 100, "deterministic random draws use the range 1..100");
      if (draw <= chance) runEffectList(randomBlock.entries.filter(child => child.key !== "chance"), current, state, parameters);
      continue;
    }
    if (entry.key === "random_list") {
      runRandomList(block(entry.value, "random_list"), current, state, parameters);
      continue;
    }
    if (entry.key === "create_artifact") {
      createArtifact(block(entry.value, "create_artifact"), current, state, parameters);
      continue;
    }
    if (entry.key === "set_variable") {
      const definition = block(entry.value, "set_variable");
      const name = scalar(one(definition, "name", "set_variable"), "set_variable.name");
      const value = resolve(scalar(one(definition, "value", "set_variable"), "set_variable.value"), current, state, parameters);
      current.variables.set(name, value);
      continue;
    }
    if (entry.key === "save_scope_as") {
      state.scopes.set(resolve(scalar(entry.value, "save_scope_as"), current, state, parameters), current);
      continue;
    }
    if (entry.key === "set_artifact_name" || entry.key === "set_artifact_description") {
      current[entry.key === "set_artifact_name" ? "name" : "description"] = resolve(scalar(entry.value, entry.key), current, state, parameters);
      continue;
    }
    if (entry.key === "add_artifact_modifier") {
      current.modifiers.add(resolve(scalar(entry.value, entry.key), current, state, parameters));
      continue;
    }
    if (entry.key === "remove_artifact_modifier") {
      current.modifiers.delete(resolve(scalar(entry.value, entry.key), current, state, parameters));
      continue;
    }
    if (entry.key === "set_artifact_flag" || entry.key === "add_artifact_flag") {
      current.variables.set(resolve(scalar(entry.value, entry.key), current, state, parameters), true);
      continue;
    }
    if (entry.key === "remove_artifact_flag") {
      current.variables.delete(resolve(scalar(entry.value, entry.key), current, state, parameters));
      continue;
    }
    if (entry.key === "mm_wyvern_apply_trophy_affixes_effect") {
      state.effectCalls.push(entry.key);
    }
    if (entry.key === "myv_slay_try_find_wyvern_eggs_effect") {
      state.eggSearchCalls += 1;
      state.effectCalls.push(entry.key);
      continue;
    }
    if (entry.key === "myv_slay_create_trophy_effect") {
      throw new Error("independent loot path re-entered the upstream mutually exclusive material roll");
    }
    if (entry.key === "add_artifact_history" || entry.key === "send_interface_toast") continue;
    if (effects.has(entry.key)) {
      const local = {};
      if (entry.value.kind === "block") {
        for (const parameter of entry.value.entries) {
          if (parameter.key) local[parameter.key] = resolve(scalar(parameter.value, "script parameter"), current, state, parameters);
        }
      }
      state.effectCalls.push(entry.key);
      runEffectList(effects.get(entry.key).entries, current, state, { ...parameters, ...local });
      continue;
    }
    if (["name", "description", "type", "visuals", "creator", "rarity", "slot", "generate_history", "decaying", "custom_tooltip"].includes(entry.key)) continue;
    throw new Error("v117 loot QA effect interpreter has no rule for " + String(entry.key));
  }
}

function callEffect(effect, state, parameters = {}) {
  runEffectList(effect.entries, state.root, state, parameters);
}

function baseAffixByModifier() {
  const randomList = namedBlock(affixRollEffect, "random_list", "affix roll helper");
  const result = new Map();
  let category = 0;
  for (const outcome of randomList.entries.filter(entry => entry.key && /^\d+$/.test(entry.key))) {
    const not = entries(block(outcome.value, "affix outcome"), "trigger").map(entry => block(entry.value, "affix outcome trigger"))
      .flatMap(trigger => entries(trigger, "NOT").map(entry => block(entry.value, "affix NOT")))
      .flatMap(trigger => entries(trigger, "OR").map(entry => block(entry.value, "affix OR")));
    assert.equal(not.length, 1, "each affix outcome must exclude its already-used category");
    const modifiers = entries(not[0], "has_artifact_modifier").map(entry => scalar(entry.value, "affix category modifier"));
    assert.equal(modifiers.length, 2, "each affix category must have its two quality variants");
    for (const modifier of modifiers) result.set(modifier, category);
    category += 1;
  }
  return result;
}

const categoryByModifier = baseAffixByModifier();

function assertAffixCount(artifact, label) {
  const added = [...artifact.modifiers].filter(modifier => categoryByModifier.has(modifier) && !artifact.baseModifiers.has(modifier));
  const expected = artifact.rarity === "illustrious" ? 4 : 3;
  assert.equal(added.length, expected, label + " must have three/four generated affixes");
  assert.equal(new Set(added.map(modifier => categoryByModifier.get(modifier))).size, expected,
    label + " must not roll a category twice");
  assert.equal(artifact.variables.get("mm_wyvern_trophy_affixes_generated"), 1, label + " must persist the affix idempotence marker");
}

function runLoot(options, draws) {
  const state = newState({ ...options, randomDraws: draws });
  callEffect(materialEffect, state);
  return state;
}

function materialKinds(state) {
  return state.artifacts.map(artifact => artifact.variables.get("mm_wyvern_material_kind"))
    .filter(kind => typeof kind === "string" && kind.startsWith("flag:"))
    .map(kind => kind.slice(5));
}

const expectedKinds = fixture.kinds.slice().sort();
const branchKindByIndex = [];
for (let index = 0; index < randomRolls.length; index += 1) {
  const draws = Array(randomRolls.length).fill(100);
  draws[index] = 1;
  const state = runLoot({ size: 240 }, draws);
  assert.equal(state.randomIndex, randomRolls.length, "each kill must consume exactly one draw per material chance");
  assert.equal(state.artifacts.length, 1, "each independent roll must create at most one material");
  const kind = materialKinds(state)[0];
  assert.ok(fixture.kinds.includes(kind), "chance branch must mark its one material kind");
  branchKindByIndex[index] = kind;
}
assert.deepEqual(branchKindByIndex.slice().sort(), expectedKinds,
  "each independent chance branch must map to one unique fang/scale/claw/horn/blood item");
const chanceByKind = new Map(randomRolls.map((roll, index) => [
  branchKindByIndex[index], Number(scalar(one(roll, "chance", "material chance"), "material chance")),
]));
assert.deepEqual(Object.fromEntries([...chanceByKind.entries()].sort(([a], [b]) => a.localeCompare(b))),
  Object.fromEntries(Object.entries(fixture.chancePercent).sort(([a], [b]) => a.localeCompare(b))),
  "chance must be attached to the intended material kind");

for (let index = 0; index < randomRolls.length; index += 1) {
  const roll = randomRolls[index];
  const chance = Number(scalar(one(roll, "chance", "material chance"), "material chance"));
  const kind = branchKindByIndex[index];
  const hitDraws = Array(randomRolls.length).fill(100);
  hitDraws[index] = chance;
  assert.deepEqual(materialKinds(runLoot({}, hitDraws)), [kind], kind + " must still hit at its inclusive percentage boundary");
  const missDraws = Array(randomRolls.length).fill(100);
  missDraws[index] = chance + 1;
  assert.deepEqual(materialKinds(runLoot({}, missDraws)), [], kind + " must miss immediately above its chance boundary");
}

for (const [label, source, expectedOrdinaryOrLegendary] of [
  ["ordinary", { size: 240 }, fixture.sourceQuality.ordinary],
  ["legendary trait", { size: 1, legendary: true }, fixture.sourceQuality.legendary],
  ["legendary origin", { size: 150, legendaryOrigin: true }, fixture.sourceQuality.legendary],
]) {
  const state = runLoot(source, Array(randomRolls.length).fill(1));
  assert.equal(state.randomIndex, randomRolls.length, label + " should execute each independent chance once");
  assert.equal(state.eggSearchCalls, 1, label + " should preserve one original egg-search attempt");
  assert.equal(state.artifacts.length, fixture.kinds.length, label + " all-hit roll must produce exactly one of each material");
  assert.deepEqual(materialKinds(state).slice().sort(), expectedKinds, label + " item kinds must be unique");
  for (const artifact of state.artifacts) {
    const kind = artifact.variables.get("mm_wyvern_material_kind").slice(5);
    assert.equal(artifact.variables.get("mm_wyvern_trophy_source"), state.dragon,
      label + " " + kind + " must retain the exact source dragon");
    if (kind === "blood") {
      assert.equal(artifact.rarity, fixture.sourceQuality.blood, "legacy dragon blood stays illustrious");
      assert.ok(artifact.modifiers.has(fixture.bloodNativeModifier), "dragon blood keeps its original prestige bonus");
      assert.equal(artifact.variables.get(fixture.nativeMaterialFlags.blood), 1, "dragon blood retains its native crafting flag");
    } else {
      assert.equal(artifact.rarity, expectedOrdinaryOrLegendary,
        label + " " + kind + " rarity must follow source trait/origin, not dragon size");
    }
    assertAffixCount(artifact, label + " " + kind);
  }
  const artifactCount = state.artifacts.length;
  const drawCount = state.randomIndex;
  callEffect(materialEffect, state);
  assert.equal(state.artifacts.length, artifactCount, label + " repeated loot call must not duplicate same-source drops");
  assert.equal(state.randomIndex, drawCount, label + " source marker must stop a second random roll");
  assert.equal(state.eggSearchCalls, 1, label + " duplicate source call must not rerun the egg search");
}

const allMiss = runLoot({ size: 240 }, Array(randomRolls.length).fill(100));
assert.equal(allMiss.artifacts.length, 0, "all independent chances may fail without a material artifact");
assert.equal(allMiss.eggSearchCalls, 1, "egg search remains once even when every material roll fails");

function runHeadAward(options) {
  const state = newState(options);
  callEffect(headGrantEffect, state);
  return state;
}

for (const [label, source, rarity] of [
  ["ordinary", { size: 240 }, "famed"],
  ["legendary", { size: 1, legendary: true }, "illustrious"],
  ["preserved legendary origin", { size: 150, legendaryOrigin: true }, "illustrious"],
]) {
  const state = runHeadAward(source);
  assert.equal(state.artifacts.length, 1, label + " kill award must create only the head court artifact");
  const head = state.artifacts[0];
  assert.equal(head.type, "pedestal", label + " head uses the pedestal court slot");
  assert.equal(head.visuals, "mm_wyvern_trophy_head", label + " head uses the existing court visual");
  assert.equal(head.name, "mm_wyvern_trophy_head_name", label + " head keeps its source-aware name");
  assert.equal(head.description, "mm_wyvern_trophy_head_desc", label + " head keeps its source-aware description");
  assert.equal(head.rarity, rarity, label + " head quality");
  assert.equal(head.variables.get("mm_wyvern_trophy_source"), state.dragon, label + " head source reference");
  assert.equal(head.variables.get("mm_wyvern_material_kind"), "flag:head", label + " head typed material marker");
  assert.ok(!state.artifacts.some(artifact => /eye|fang|scale|claw/i.test(String(artifact.visuals))),
    "new court award must not create eye/fang/scale/claw display trophies");
  const count = state.artifacts.length;
  callEffect(headGrantEffect, state);
  assert.equal(state.artifacts.length, count, label + " repeated head award must remain idempotent");
}

assert.equal(countKey(headSetEffect, "create_artifact"), 1, "the new court award helper must create exactly one artifact");
assert.equal(countKey(headSetEffect, "destroy_artifact"), 0, "head award must not delete legacy court artifacts");
assert.equal(countKey(headGrantEffect, "destroy_artifact"), 0, "head grant must not delete legacy court artifacts");
assert.equal(countKey(trophyAst, "destroy_artifact"), 0, "material and trophy helpers must not delete legacy eye artifacts");
assert.equal(countKey(onActionsAst, "destroy_artifact"), 0, "on-game-start migration must preserve old eye trophies");
assert.equal(countKey(headSetEffect, "mm_wyvern_apply_trophy_affixes_effect"), 1,
  "head court award must continue using the established affix helper once");
assert.match(fs.readFileSync(visualsPath, "utf8"), /mm_wyvern_trophy_eye\s*=/,
  "legacy eye trophy visual definition must remain available for existing saves");
const headVisual = namedBlock(visualsAst, "mm_wyvern_trophy_head", "trophy visuals");
assert.equal(scalar(one(headVisual, "default_type", "head trophy visual"), "head visual default_type"), "pedestal",
  "head court visual must default to the pedestal artifact type");

console.log("Wyvern v1.1.7 material loot: PASS (finite PDX chance execution, provenance, source quality, native blood, unique independent drops, head-only award, and legacy eye preservation)");

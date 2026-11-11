"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const patchRoot = path.join(projectRoot, "patches");
const bloodRoot = path.join(patchRoot, "wyvern-bloodline", "mod");
const humanRoot = path.join(patchRoot, "wyvern-human-form", "mod");
const captureRoot = path.join(patchRoot, "wyvern-capture", "mod");
const nativeModRoot = process.env.CK3_WYVERN_MOD_DIR
  ? path.resolve(process.env.CK3_WYVERN_MOD_DIR)
  : "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
const immortalityModRoot = process.env.CK3_ZG_BUXIU_MOD_DIR
  ? path.resolve(process.env.CK3_ZG_BUXIU_MOD_DIR)
  : "D:/SteamLibrary/steamapps/workshop/content/1158310/2939268227";
const nativeEggFixture = JSON.parse(fs.readFileSync(
  path.join(projectRoot, "tests", "fixtures", "v120", "native-egg-effects.json"), "utf8"));
for (const field of ["stableCreate", "hatch", "tamedCreate", "immortalityReference"]) {
  assert.equal(typeof nativeEggFixture[field], "string", "native compatibility fixture contains " + field);
}

function tokenize(source, label) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === '"') {
      index += 1;
      let value = "";
      let closed = false;
      while (index < source.length) {
        const next = source[index++];
        if (next === "\\" && index < source.length) value += source[index++];
        else if (next === '"') {
          closed = true;
          break;
        } else value += next;
      }
      assert.ok(closed, label + " has an unterminated quoted value");
      tokens.push(value);
      continue;
    }
    const operator = ["?=", ">=", "<=", "!=", "==", "=", ">", "<"]
      .find(candidate => source.startsWith(candidate, index));
    if (operator) {
      tokens.push(operator);
      index += operator.length;
      continue;
    }
    if (character === "{" || character === "}") {
      tokens.push(character);
      index += 1;
      continue;
    }
    const start = index;
    while (index < source.length && !/[\s{}#"=<>?]/.test(source[index])) index += 1;
    assert.ok(index > start, label + " contains an unsupported token at offset " + index);
    tokens.push(source.slice(start, index));
  }
  return tokens;
}

function parsePdx(source, label) {
  const tokens = tokenize(source, label);
  let index = 0;
  function parseBlock(nested) {
    const nodes = [];
    while (index < tokens.length && tokens[index] !== "}") {
      const key = tokens[index++];
      const operator = tokens[index];
      if (!["?=", ">=", "<=", "!=", "==", "=", ">", "<"].includes(operator)) {
        assert.ok(nested, label + " expected an operator after " + key);
        nodes.push({ key, operator: null, value: key });
        continue;
      }
      index += 1;
      if (tokens[index] === "{") {
        index += 1;
        nodes.push({ key, operator, value: parseBlock(true) });
      } else {
        assert.ok(index < tokens.length, label + " is missing a value for " + key);
        nodes.push({ key, operator, value: tokens[index++] });
      }
    }
    if (nested) {
      assert.equal(tokens[index], "}", label + " has an unclosed block");
      index += 1;
    }
    return nodes;
  }
  const nodes = parseBlock(false);
  assert.equal(index, tokens.length, label + " has unexpected trailing tokens");
  return nodes;
}

function extractDefinition(source, name, label) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("^[\\t ]*" + escaped + "[\\t ]*=[\\t ]*\\{", "m").exec(source);
  assert.ok(match, label + " is missing " + name);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  let quote = false;
  let escapedCharacter = false;
  let comment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === "\n") comment = false;
    } else if (quote) {
      if (escapedCharacter) escapedCharacter = false;
      else if (character === "\\") escapedCharacter = true;
      else if (character === '"') quote = false;
    } else if (character === "#") comment = true;
    else if (character === '"') quote = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  assert.fail(label + " has an unclosed " + name + " block");
}

function parseDefinitionFile(filePath, name, label) {
  const source = fs.readFileSync(filePath, "utf8");
  return parsePdx(extractDefinition(source, name, label), label + ":" + name)[0];
}

function parseDefinitions(filePath, label) {
  return new Map(parsePdx(fs.readFileSync(filePath, "utf8"), label)
    .filter(node => Array.isArray(node.value))
    .map(node => [node.key, node.value]));
}

function first(block, key) {
  return block.find(node => node.key === key);
}

function all(block, key) {
  return block.filter(node => node.key === key);
}

function value(block, key, label) {
  const node = first(block, key);
  assert.ok(node, label + " is missing " + key);
  return node.value;
}

function optionalValue(block, key) {
  const node = first(block, key);
  return node ? node.value : undefined;
}

function scalar(block, key, label) {
  const result = value(block, key, label);
  assert.equal(typeof result, "string", label + " expected scalar " + key);
  return result;
}

function readScriptedFiles(root, folder, names, label) {
  const definitions = new Map();
  for (const name of names) {
    const file = path.join(root, folder, name);
    for (const [key, block] of parseDefinitions(file, label + "/" + name)) definitions.set(key, block);
  }
  return definitions;
}

const effectFiles = [
  [bloodRoot, "common/scripted_effects", [
    "mm_dragon_lineage.txt",
    "mm_dragon_branch_projection.txt",
    "mm_dragon_half_eggs.txt",
    "mm_dragon_egg_features.txt",
    "zzzzz_mm_dragon_native_eggs.txt",
  ], "bloodline effects"],
  [humanRoot, "common/scripted_effects", ["mm_dragon_features.txt"], "human-form effects"],
];
const scriptedEffects = new Map();
for (const [root, folder, files, label] of effectFiles) {
  for (const [key, block] of readScriptedFiles(root, folder, files, label)) scriptedEffects.set(key, block);
}

const nativeTriggerFile = path.join(nativeModRoot, "common", "scripted_triggers", "myv_wyvern_triggers.txt");
const nativeTriggerDefinitions = fs.existsSync(nativeTriggerFile)
  ? readScriptedFiles(nativeModRoot, "common/scripted_triggers", ["myv_wyvern_triggers.txt"], "native wyvern triggers")
  : new Map([[
    "myv_is_wyvern",
    first(parsePdx(`myv_is_wyvern = {
      OR = {
        has_trait = myv_wyvern
        has_trait = myv_wyvern_tamed
        has_trait = myv_wyvern_legendary
      }
    }`, "frozen native wyvern identity trigger"), "myv_is_wyvern").value,
  ]]);
const scriptedTriggers = new Map([
  ...nativeTriggerDefinitions,
  ...readScriptedFiles(bloodRoot, "common/scripted_triggers", ["mm_dragon_breeding.txt", "mm_dragon_lineage.txt"], "dragon breeding triggers"),
]);
const lineageScriptValues = new Map(parsePdx(fs.readFileSync(path.join(bloodRoot, "common/script_values/mm_dragon_lineage_values.txt"), "utf8"), "lineage values")
  .map(node => [node.key, node.value]));

function makeCharacter(id, options = {}) {
  const character = {
    kind: "character",
    id,
    alive: options.alive !== false,
    female: options.female === true,
    age: options.age === undefined ? 30 : options.age,
    imprisoned: options.imprisoned === true,
    incapable: options.incapable === true,
    ai: options.ai === true,
    isRuler: options.isRuler === true,
    traits: new Set(options.traits || []),
    flags: new Set(options.flags || []),
    vars: new Map(Object.entries(options.vars || {})),
    variableLists: new Map(Object.entries(options.variableLists || {})),
    closeFamilyIds: new Set(options.closeFamilyIds || []),
    bondedCharacter: options.bondedCharacter || null,
    stableCounty: options.stableCounty || null,
    location: options.location || { id: id + "-location" },
    provinces: options.provinces || [],
    courtiers: new Set(),
    dynasty: options.dynasty || null,
    house: options.house || null,
    culture: options.culture || null,
    faith: options.faith || null,
    mother: options.mother || null,
    father: options.father || null,
    realFather: options.realFather || null,
  };
  return character;
}

function makeEnvironment(options = {}) {
  return {
    scopes: { ...(options.scopes || {}) },
    randomChoices: [...(options.randomChoices || [])],
    randomRolls: [],
    createdCharacters: [],
    createdEggs: [],
    globalLists: new Map(),
    creationFemale: options.creationFemale === true,
  };
}

function getVariable(target, name) {
  return target && target.vars instanceof Map ? target.vars.get(name) : undefined;
}

function hasVariable(target, name) {
  return !!target && target.vars instanceof Map && target.vars.has(name);
}

function resolvePath(sourcePath, current, env, parameters = {}) {
  if (typeof sourcePath !== "string") return sourcePath;
  let target = current;
  let rest = sourcePath;
  const macro = /^\$([^$]+)\$(.*)$/.exec(rest);
  if (macro) {
    target = parameters[macro[1]];
    rest = macro[2];
  } else if (rest.startsWith("scope:")) {
    const match = /^scope:([^.]*)/.exec(rest);
    target = env.scopes[match[1]];
    rest = rest.slice(match[0].length);
  } else if (rest.startsWith("var:")) {
    const match = /^var:([^.]*)/.exec(rest);
    target = getVariable(current, match[1]);
    rest = rest.slice(match[0].length);
  } else if (rest === "this") return current;
  else if (rest === "location") return current?.location;

  while (rest) {
    if (rest.startsWith(".var:")) {
      const match = /^\.var:([^.]*)/.exec(rest);
      target = getVariable(target, match[1]);
      rest = rest.slice(match[0].length);
    } else if (rest[0] === ".") {
      const match = /^\.([^.]+)/.exec(rest);
      target = property(target, match[1]);
      rest = rest.slice(match[0].length);
    } else {
      return undefined;
    }
  }
  return target;
}

function property(target, name) {
  if (!target) return undefined;
  if (name === "is_alive") return target.alive;
  if (name === "is_female") return target.female;
  if (name === "is_imprisoned") return target.imprisoned;
  if (name === "is_incapable") return target.incapable;
  if (name === "is_ai") return target.ai;
  if (name === "is_ruler") return target.isRuler;
  if (name === "holder") return target.holder;
  if (name === "real_father") return target.realFather;
  if (name === "court") return target.courtiers;
  if (name === "stable_county") return target.stableCounty;
  return target[name];
}

function atom(raw, current, env, parameters) {
  if (typeof raw !== "string") return raw;
  if (raw === "yes") return true;
  if (raw === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "this" || raw.startsWith("scope:") || raw.startsWith("var:") || raw.startsWith("$")) {
    return resolvePath(raw, current, env, parameters);
  }
  return raw;
}

function equal(left, right) {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  const normalizedLeft = typeof left === "string" && /^-?\d+(?:\.\d+)?$/.test(left) ? Number(left) : left;
  const normalizedRight = typeof right === "string" && /^-?\d+(?:\.\d+)?$/.test(right) ? Number(right) : right;
  return normalizedLeft === normalizedRight;
}

function compare(left, operator, right) {
  if (operator === "=" || operator === "==" || operator === "?=") return equal(left, right);
  if (operator === "!=") return !equal(left, right);
  if (operator === ">") return Number(left) > Number(right);
  if (operator === ">=") return Number(left) >= Number(right);
  if (operator === "<") return Number(left) < Number(right);
  if (operator === "<=") return Number(left) <= Number(right);
  return false;
}

function bindParameters(parameterBlock, current, env, parentParameters) {
  const parameters = {};
  for (const node of parameterBlock || []) {
    parameters[node.key] = atom(node.value, current, env, parentParameters);
  }
  return parameters;
}

function runTriggerDefinition(name, current, env, parameters = {}) {
  const definition = scriptedTriggers.get(name);
  assert.ok(definition, "missing scripted trigger " + name);
  return evaluateTriggerBlock(definition, current, env, parameters);
}

function evaluateTriggerNode(node, current, env, parameters = {}) {
  const { key, operator, value: operand } = node;
  if (key === "always") return operand === "yes";
  if (key === "has_variable_list") return current.variableLists.has(operand) && current.variableLists.get(operand).length > 0;
  if (["AND", "OR", "NOR"].includes(key)) {
    const results = (Array.isArray(operand) ? operand : []).map(child => evaluateTriggerNode(child, current, env, parameters));
    return key === "AND" ? results.every(Boolean) : key === "OR" ? results.some(Boolean) : !results.some(Boolean);
  }
  if (key === "NOT") return !evaluateTriggerBlock(operand, current, env, parameters);
  if (key === "trigger_if") {
    const limit = first(operand, "limit");
    return !limit || !evaluateTriggerBlock(limit.value, current, env, parameters)
      ? true
      : evaluateTriggerBlock(operand.filter(child => child.key !== "limit"), current, env, parameters);
  }
  if (key === "trigger_else") return evaluateTriggerBlock(operand, current, env, parameters);
  if (scriptedTriggers.has(key)) {
    const passed = runTriggerDefinition(key, current, env,
      Array.isArray(operand) ? bindParameters(operand, current, env, parameters) : {});
    return operand === "no" ? !passed : passed;
  }
  if (key === "exists") return resolvePath(operand, current, env, parameters) !== undefined;
  if (key === "has_trait") return !!current && current.traits.has(operand);
  if (key === "has_character_flag") return !!current && current.flags.has(operand);
  if (key === "has_variable") {
    if (!Array.isArray(operand)) return hasVariable(current, operand);
    return operand.filter(entry => entry.key === "name")
      .some(entry => hasVariable(current, entry.value));
  }
  if (key === "has_relation_myv_wyvern_bonded_character") {
    return !!current && current.bondedCharacter === atom(operand, current, env, parameters);
  }
  if (key === "is_close_family_of") {
    const target = atom(operand, current, env, parameters);
    return !!current && !!target && current.closeFamilyIds.has(target.id);
  }
  if (key === "any_county_province") {
    return !!current && current.provinces.some(province => evaluateTriggerBlock(operand, province, env, parameters));
  }
  if (key === "has_building_or_higher") {
    return !!current && current.buildings instanceof Set && current.buildings.has(operand);
  }
  if (key === "is_target_in_variable_list") {
    const listName = scalar(operand, "name", "is_target_in_variable_list");
    const target = atom(scalar(operand, "target", "is_target_in_variable_list"), current, env, parameters);
    const list = current && current.variableLists.get(listName);
    return Array.isArray(list) && list.includes(target);
  }
  if (key === "artifact_owner") {
    return !!current && !!current.owner && evaluateTriggerBlock(operand, current.owner, env, parameters);
  }
  if (key.startsWith("scope:") || key.startsWith("var:") || key.startsWith("$")) {
    const target = resolvePath(key, current, env, parameters);
    if (Array.isArray(operand)) return target !== undefined && evaluateTriggerBlock(operand, target, env, parameters);
    return compare(target, operator, atom(operand, current, env, parameters));
  }

  const actual = key === "age" ? current.age : property(current, key);
  return compare(actual, operator, atom(operand, current, env, parameters));
}

function evaluateTriggerBlock(block, current, env, parameters = {}) {
  return (block || []).every(node => evaluateTriggerNode(node, current, env, parameters));
}

function effectValue(block, key, current, env, parameters) {
  const raw = scalar(block, key, "effect value");
  return atom(raw, current, env, parameters);
}

function setVariable(current, name, result) {
  assert.ok(current && current.vars instanceof Map, "set_variable requires a character or artifact scope");
  current.vars.set(name, result);
}

function nextRandomChoice(env, kind) {
  const choice = env.randomChoices.length ? env.randomChoices.shift() : undefined;
  if (kind === "list") return choice && typeof choice === "object" ? choice.index : choice === undefined ? 0 : choice;
  const success = choice && typeof choice === "object" ? choice.success : choice === undefined ? true : !!choice;
  return success;
}

function executeConditional(nodes, index, current, env, parameters) {
  const branches = [nodes[index]];
  let nextIndex = index + 1;
  while (nextIndex < nodes.length && (nodes[nextIndex].key === "else_if" || nodes[nextIndex].key === "else")) {
    branches.push(nodes[nextIndex++]);
  }
  for (const branch of branches) {
    const branchBlock = branch.value;
    const limit = first(branchBlock, "limit");
    if (branch.key !== "else" && limit && !evaluateTriggerBlock(limit.value, current, env, parameters)) continue;
    executeEffectSequence(branchBlock.filter(child => child.key !== "limit"), current, env, parameters);
    return nextIndex;
  }
  return nextIndex;
}

function executeRandomList(block, current, env, parameters) {
  const branches = block.filter(node => Array.isArray(node.value) && /^\d+$/.test(node.key));
  const eligible = branches.filter(branch => {
    let weight = Number(branch.key);
    for (const modifier of all(branch.value, "modifier")) {
      const factor = Number(scalar(modifier.value, "factor", "random_list modifier"));
      const conditions = modifier.value.filter(node => node.key !== "factor");
      if (evaluateTriggerBlock(conditions, current, env, parameters)) weight *= factor;
    }
    return weight > 0;
  });
  if (!eligible.length) return;
  const index = nextRandomChoice(env, "list");
  const chosen = eligible[Math.min(Math.max(index, 0), eligible.length - 1)];
  executeEffectSequence(chosen.value.filter(node => node.key !== "modifier"), current, env, parameters);
}

function mockCreateArtifact(current, env, fields, parameters) {
  const artifact = {
    kind: "artifact",
    id: "artifact-" + (env.createdEggs.length + 1),
    vars: new Map(),
    variableLists: new Map(),
    owner: current,
    creator: atom(optionalValue(fields, "creator"), current, env, parameters),
    destroyed: false,
    location: current && current.location,
  };
  env.createdEggs.push(artifact);
  for (const node of fields) {
    if (node.key === "save_scope_as") env.scopes[node.value] = artifact;
  }
  return artifact;
}

function mockCreateCharacter(block, current, env, parameters) {
  const fields = block;
  const child = makeCharacter("child-" + (env.createdCharacters.length + 1), {
    age: Number(atom(optionalValue(fields, "age"), current, env, parameters) || 0),
    female: env.creationFemale,
    location: atom(optionalValue(fields, "location"), current, env, parameters),
    culture: atom(optionalValue(fields, "culture"), current, env, parameters),
    faith: atom(optionalValue(fields, "faith"), current, env, parameters),
  });
  child.mother = atom(optionalValue(fields, "mother"), current, env, parameters);
  child.father = atom(optionalValue(fields, "father"), current, env, parameters);
  child.realFather = atom(optionalValue(fields, "real_father"), current, env, parameters);
  child.genderFemaleChance = Number(atom(optionalValue(fields, "gender_female_chance"), current, env, parameters));
  child.dynastyPolicy = optionalValue(fields, "dynasty");
  const trait = optionalValue(fields, "trait");
  if (trait) child.traits.add(trait);
  env.createdCharacters.push(child);
  const afterCreation = first(fields, "after_creation");
  if (afterCreation) executeEffectSequence(afterCreation.value, child, env, parameters);
  return child;
}

function executeEffectNode(node, current, env, parameters = {}) {
  const { key, value: operand } = node;
  if (key === "if") return;
  if (key === "else" || key === "else_if") throw new Error("conditional branch evaluated without if");
  if (key === "random_list") return executeRandomList(operand, current, env, parameters);
  if (key === "random") {
    const chanceValue = scalar(operand, "chance", "random chance");
    const chance = Number(lineageScriptValues.get(chanceValue) ?? chanceValue);
    const success = nextRandomChoice(env, "chance");
    env.randomRolls.push({ chance, success });
    if (success) executeEffectSequence(operand.filter(child => child.key !== "chance"), current, env, parameters);
    return;
  }
  if (key.startsWith("scope:") || key.startsWith("var:") || key.startsWith("$")) {
    const target = resolvePath(key, current, env, parameters);
    if (Array.isArray(operand)) executeEffectSequence(operand, target, env, parameters);
    return;
  }
  if (key === "artifact_owner") {
    if (current && current.owner) executeEffectSequence(operand, current.owner, env, parameters);
    return;
  }
  if (key === "location") {
    if (current && current.location) executeEffectSequence(operand, current.location, env, parameters);
    return;
  }
  if (key === "save_scope_as") {
    env.scopes[operand] = current;
    return;
  }
  if (key === "clear_saved_scope") {
    delete env.scopes[operand];
    return;
  }
  if (key === "set_variable") {
    const name = scalar(operand, "name", "set_variable");
    const resultNode = first(operand, "value");
    setVariable(current, name, resultNode ? atom(resultNode.value, current, env, parameters) : true);
    return;
  }
  if (key === "change_variable") {
    const name = scalar(operand, "name", "change_variable");
    const add = first(operand, "add");
    const subtract = first(operand, "subtract");
    assert.ok(!!add !== !!subtract, "change_variable needs one add or subtract");
    const amount = Number(atom((add || subtract).value, current, env, parameters));
    setVariable(current, name, Number(getVariable(current, name) || 0) + (subtract ? -amount : amount));
    return;
  }
  if (key === "remove_variable") {
    current.vars.delete(operand);
    return;
  }
  if (key === "clear_variable_list") {
    current.variableLists.delete(operand);
    return;
  }
  if (key === "add_to_variable_list") {
    const name = scalar(operand, "name", "add_to_variable_list");
    const target = atom(scalar(operand, "target", "add_to_variable_list"), current, env, parameters);
    const list = current.variableLists.get(name) || [];
    list.push(target);
    current.variableLists.set(name, list);
    return;
  }
  if (key === "every_in_list") {
    const name = scalar(operand, "variable", "every_in_list");
    const list = current.variableLists.get(name) || [];
    for (const target of list) executeEffectSequence(operand.filter(child => child.key !== "variable"), target, env, parameters);
    return;
  }
  if (key === "add_trait") {
    current.traits.add(operand);
    return;
  }
  if (key === "remove_trait") {
    current.traits.delete(operand);
    return;
  }
  if (key === "add_character_flag") {
    current.flags.add(Array.isArray(operand) ? scalar(operand, "flag", "add_character_flag") : operand);
    return;
  }
  if (key === "remove_character_flag") {
    current.flags.delete(operand);
    return;
  }
  if (key === "create_artifact") {
    mockCreateArtifact(current, env, operand, parameters);
    return;
  }
  if (key === "create_character") {
    mockCreateCharacter(operand, current, env, parameters);
    return;
  }
  if (key === "add_courtier") {
    current.courtiers.add(atom(operand, current, env, parameters));
    return;
  }
  if (key === "destroy_artifact") {
    const artifact = atom(operand, current, env, parameters);
    if (artifact) artifact.destroyed = true;
    return;
  }
  if (key === "add_artifact_history" || key === "trigger_event") return;
  if (scriptedEffects.has(key)) {
    const callParameters = Array.isArray(operand)
      ? bindParameters(operand, current, env, parameters)
      : {};
    executeEffectSequence(scriptedEffects.get(key), current, env, callParameters);
    return;
  }
  if (key.startsWith("myv_create_") && key.endsWith("_wyvern_egg_artifact_effect")) {
    const egg = {
      kind: "artifact",
      id: "native-egg-" + (env.createdEggs.length + 1),
      vars: new Map(),
      variableLists: new Map(),
      owner: current,
      location: current.location,
      destroyed: false,
    };
    env.createdEggs.push(egg);
    env.scopes.myv_wyvern_egg = egg;
    return;
  }
  throw new Error("finite PDX executor does not support effect " + key);
}

function executeEffectSequence(nodes, current, env, parameters = {}) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.key === "if") index = executeConditional(nodes, index, current, env, parameters) - 1;
    else executeEffectNode(node, current, env, parameters);
  }
}

function executeEffectDefinition(name, current, env, parameters = {}) {
  const effect = scriptedEffects.get(name);
  assert.ok(effect, "missing scripted effect " + name);
  executeEffectSequence(effect, current, env, parameters);
}

function variableSlots(character) {
  const origins = [];
  for (let index = 1; index <= 16; index += 1) {
    const source = character.vars.get("mm_dragon_origin_" + index);
    if (source !== undefined) origins.push(source);
  }
  return origins;
}

function characterSnapshot(character) {
  const encode = item => item && item.id ? "@" + item.id : item;
  return {
    alive: character.alive,
    female: character.female,
    age: character.age,
    traits: [...character.traits].sort(),
    flags: [...character.flags].sort(),
    vars: [...character.vars].map(([key, item]) => [key, encode(item)]).sort(([a], [b]) => a.localeCompare(b)),
    lists: [...character.variableLists].map(([key, items]) => [key, items.map(encode)]).sort(([a], [b]) => a.localeCompare(b)),
    courtiers: [...character.courtiers].map(encode).sort(),
  };
}

const interactionFile = path.join(bloodRoot, "common", "character_interactions", "mm_dragon_breeding.txt");
const humanInteractionFile = path.join(humanRoot, "common", "character_interactions", "mm_wyvern_human_form.txt");
const lineageOnActionFile = path.join(bloodRoot, "common", "on_action", "mm_dragon_lineage.txt");
const bloodTraitsFile = path.join(bloodRoot, "common", "traits", "mm_dragon_bloodline.txt");
const featureTraitsFile = path.join(humanRoot, "common", "traits", "mm_dragon_features.txt");
const bloodLocalizationRoot = path.join(bloodRoot, "localization");

const interactions = parseDefinitions(interactionFile, "dragon breeding interactions");
const lineageOnActions = parseDefinitions(lineageOnActionFile, "natural lineage on_actions");
const bloodTraits = parseDefinitions(bloodTraitsFile, "dragon bloodline traits");
const featureTraits = parseDefinitions(featureTraitsFile, "dragon appearance traits");

function runNaturalBirth(child, mother, familyFather, realFather, options = {}) {
  const env = makeEnvironment({
    scopes: { child, mother, father: familyFather, real_father: realFather },
    randomChoices: options.randomChoices || [{ type: "chance", success: false }],
  });
  const birthEffect = first(lineageOnActions.get("mm_dragon_natural_birth"), "effect");
  assert.ok(birthEffect, "natural birth on_action has an effect block");
  executeEffectSequence(birthEffect.value, child, env);
  return env;
}

function parentWithBlood(id, generation, sources, trait) {
  const character = makeCharacter(id, { traits: [trait] });
  character.vars.set("mm_dragon_lineage_generation", generation);
  character.vars.set("mm_dragon_origin_count", sources.length);
  character.variableLists.set("mm_dragon_origins", [...sources]);
  sources.forEach((source, index) => character.vars.set("mm_dragon_origin_" + (index + 1), source));
  return character;
}

function lineageChild(id) {
  return makeCharacter(id, { female: true, age: 0 });
}

function findDescSources(descBlock, expectedCount) {
  const firstValid = first(descBlock, "first_valid");
  assert.ok(firstValid, "trait desc has first_valid");
  const branches = all(firstValid.value, "triggered_desc");
  for (let count = 1; count <= 16; count += 1) {
    const branch = branches.find(candidate => {
      const trigger = first(candidate.value, "trigger");
      const hasSource = trigger && first(trigger.value, "has_variable");
      return hasSource && hasSource.value === "mm_dragon_origin_" + count;
    });
    assert.ok(branch, "trait desc handles source slot " + count);
    const key = scalar(branch.value, "desc", "trait desc branch");
    assert.equal(key, "mm_dragon_blood_sources_" + count, "source branch maps to matching localized list");
  }
  assert.ok(expectedCount >= 1 && expectedCount <= 16);
}

function localizedValue(source, key, label) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp("^[\\t ]*" + escapedKey + ":[0-9]*[\\t ]*\"", "m").exec(source);
  assert.ok(startMatch, label + " is missing " + key);
  let result = "";
  let escaped = false;
  for (let index = startMatch.index + startMatch[0].length; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      result += character;
      escaped = false;
    } else if (character === "\\") {
      result += character;
      escaped = true;
    } else if (character === "\"") {
      return result;
    } else result += character;
  }
  assert.fail(label + " has an unclosed quoted value for " + key);
}

// The PDX runner below executes only the parsed lineage, breeding-trigger,
// feature-roll, egg-creation, and egg-hatch blocks. It is not a CK3 engine.

// 1. Natural birth reads the real biological father, not the legal/family father.
const sourceLegal = makeCharacter("legal-dragon", { traits: ["mm_dragon_half"] });
sourceLegal.vars.set("mm_dragon_lineage_generation", 0);
sourceLegal.vars.set("mm_dragon_origin_count", 1);
sourceLegal.vars.set("mm_dragon_origin_1", sourceLegal);
sourceLegal.variableLists.set("mm_dragon_origins", [sourceLegal]);
const sourceBiological = parentWithBlood("biological-dragon", 0, [makeCharacter("true-origin")], "mm_dragon_half");
const childFromRealFather = lineageChild("child-real-father");
runNaturalBirth(childFromRealFather, makeCharacter("ordinary-mother", { female: true }), sourceLegal, sourceBiological);
assert.deepEqual(variableSlots(childFromRealFather), [sourceBiological.variableLists.get("mm_dragon_origins")[0]],
  "natural lineage follows scope:real_father rather than scope:father");
assert.ok(childFromRealFather.traits.has("mm_dragon_lineage_1"), "half-dragon parent creates first-generation lineage");

const ordinaryMother = makeCharacter("ordinary-human-mother", { female: true });
const ordinaryFather = makeCharacter("ordinary-human-father");
const ordinaryNewborn = makeCharacter("ordinary-human-newborn", {
  female: true,
  age: 0,
  traits: ["existing_ordinary_trait"],
  flags: ["existing_ordinary_flag"],
  vars: { existing_ordinary_var: "preserved" },
});
const ordinaryNewbornBefore = characterSnapshot(ordinaryNewborn);
runNaturalBirth(ordinaryNewborn, ordinaryMother, ordinaryFather, ordinaryFather);
const ordinaryNewbornAfter = characterSnapshot(ordinaryNewborn);
assert.deepEqual({ traits: ordinaryNewbornAfter.traits, flags: ordinaryNewbornAfter.flags, vars: ordinaryNewbornAfter.vars }, {
  traits: ordinaryNewbornBefore.traits,
  flags: ordinaryNewbornBefore.flags,
  vars: ordinaryNewbornBefore.vars,
}, "ordinary human parents leave newborn traits, flags, and variables unchanged");

const generationFixtures = [
  { parentTrait: "mm_dragon_half", parentGeneration: 0, childTrait: "mm_dragon_lineage_1", childGeneration: 1 },
  { parentTrait: "mm_dragon_lineage_1", parentGeneration: 1, childTrait: "mm_dragon_lineage_2", childGeneration: 2 },
  { parentTrait: "mm_dragon_lineage_2", parentGeneration: 2, childTrait: "mm_dragon_lineage_3", childGeneration: 3 },
  { parentTrait: "mm_dragon_lineage_3", parentGeneration: 3, childTrait: "mm_dragon_lineage_4", childGeneration: 4 },
];
for (const [index, fixture] of generationFixtures.entries()) {
  const origin = makeCharacter("generation-origin-" + index);
  const parent = parentWithBlood("generation-parent-" + index, fixture.parentGeneration, [origin], fixture.parentTrait);
  const child = lineageChild("generation-child-" + index);
  runNaturalBirth(child, parent, makeCharacter("family-father-" + index), null);
  assert.ok(child.traits.has(fixture.childTrait), "G" + fixture.childGeneration + " receives the matching bloodline trait");
  assert.equal(child.vars.get("mm_dragon_lineage_generation"), fixture.childGeneration);
  assert.deepEqual(variableSlots(child), [origin]);
}

const generationFourParent = parentWithBlood("g4-parent", 4, [makeCharacter("g5-origin")], "mm_dragon_lineage_4");
const generationFiveChild = lineageChild("g5-child");
const g5FailureEnv = runNaturalBirth(
  generationFiveChild,
  generationFourParent,
  makeCharacter("g5-legal-father"),
  null,
  { randomChoices: [{ type: "chance", success: false }] }
);
assert.deepEqual(variableSlots(generationFiveChild), [], "G5 has no inherited dragon source");
assert.ok(!["mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4"]
  .some(trait => generationFiveChild.traits.has(trait)), "G5 has no bloodline trait");
assert.ok(!generationFiveChild.traits.has("mm_dragon_black_blood"), "a failed terminal roll does not produce Black Blood");
assert.equal(generationFiveChild.vars.get("mm_dragon_lineage_generation"), 5, "failed C offspring records only its terminal diagnostic generation");
assert.deepEqual([...generationFiveChild.vars], [["mm_dragon_origin_count", 0], ["mm_dragon_lineage_generation", 5]], "failed C offspring stores zero active sources and no source slots");
assert.equal(generationFiveChild.variableLists.size, 0, "failed C offspring stores no source-character list");
assert.ok(generationFiveChild.flags.has("mm_dragon_lineage_initialized"), "failed C roll is marked so it cannot be rerolled");
assert.deepEqual(g5FailureEnv.randomRolls, [{ chance: 10, success: false }], "G5 fixture explicitly follows the 10% failure branch");

const cWithoutOrigin = makeCharacter("c-parent-without-source", { traits: ["mm_dragon_lineage_4"] });
const sourceLessCChild = lineageChild("source-less-c-child");
const sourceLessCEnv = runNaturalBirth(
  sourceLessCChild,
  cWithoutOrigin,
  makeCharacter("source-less-c-family-father"),
  null,
  { randomChoices: [{ type: "chance", success: true }] }
);
assert.ok(sourceLessCChild.traits.has("mm_dragon_black_blood"), "a source-less qualifying C trait still has the specified mutation chance");
assert.deepEqual(variableSlots(sourceLessCChild), [], "a source-less C parent cannot invent a source dragon");
assert.deepEqual(sourceLessCEnv.randomRolls, [{ chance: 10, success: true }], "missing historical ancestry does not remove the qualifying parent's mutation trial");

const cMotherOrigin = makeCharacter("c-mother-origin");
const cFatherOrigin = makeCharacter("c-father-origin");
const cMother = parentWithBlood("c-mother", 4, [cMotherOrigin], "mm_dragon_lineage_4");
const cRealFather = parentWithBlood("c-real-father", 4, [cMotherOrigin, cFatherOrigin], "mm_dragon_lineage_4");
const blackChild = lineageChild("black-blood-child");
const doubleCSuccessEnv = runNaturalBirth(
  blackChild,
  cMother,
  makeCharacter("c-family-father"),
  cRealFather,
  { randomChoices: [{ type: "chance", success: true }] }
);
assert.ok(blackChild.traits.has("mm_dragon_black_blood"), "a successful C-grade roll creates Black Blood");
assert.ok(!["mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4"]
  .some(trait => blackChild.traits.has(trait)), "Black Blood is exclusive with the normal lineage grades");
assert.equal(blackChild.vars.get("mm_dragon_lineage_generation"), 6, "new Black Blood records its distinct terminal sentinel");
assert.deepEqual(variableSlots(blackChild), [cMotherOrigin, cFatherOrigin], "two C parents merge source characters and de-duplicate shared origins");
assert.deepEqual(doubleCSuccessEnv.randomRolls, [{ chance: 10, success: true }], "two C parents still produce one 10% roll per child");
const blackChildBeforeRepeat = characterSnapshot(blackChild);
const blackChildRepeatEnv = runNaturalBirth(blackChild, cMother, makeCharacter("repeat-family-father"), cRealFather);
assert.deepEqual(characterSnapshot(blackChild), blackChildBeforeRepeat, "a repeated birth hook cannot alter an initialized Black Blood child");
assert.deepEqual(blackChildRepeatEnv.randomRolls, [], "a repeated birth hook does not reroll Black Blood");

const cOnlyMother = parentWithBlood("c-only-mother", 4, [cMotherOrigin], "mm_dragon_lineage_4");
const cMotherOnlyChild = lineageChild("c-mother-only-child");
const cMotherOnlyEnv = runNaturalBirth(
  cMotherOnlyChild,
  cOnlyMother,
  makeCharacter("c-mother-only-family-father"),
  null,
  { randomChoices: [{ type: "chance", success: true }] }
);
assert.ok(cMotherOnlyChild.traits.has("mm_dragon_black_blood"), "a C-grade mother can pass the terminal roll without a real father scope");
assert.deepEqual(variableSlots(cMotherOnlyChild), [cMotherOrigin], "maternal C ancestry preserves its exact source character");
assert.deepEqual(cMotherOnlyEnv.randomRolls, [{ chance: 10, success: true }]);

const cOnlyRealFather = parentWithBlood("c-only-real-father", 4, [cFatherOrigin], "mm_dragon_lineage_4");
const cFatherOnlyChild = lineageChild("c-father-only-child");
const cFatherOnlyEnv = runNaturalBirth(
  cFatherOnlyChild,
  makeCharacter("c-father-only-mother", { female: true }),
  makeCharacter("c-father-only-family-father"),
  cOnlyRealFather,
  { randomChoices: [{ type: "chance", success: true }] }
);
assert.ok(cFatherOnlyChild.traits.has("mm_dragon_black_blood"), "the biological C-grade father can pass the terminal roll");
assert.deepEqual(variableSlots(cFatherOnlyChild), [cFatherOrigin], "paternal ancestry uses scope:real_father and preserves its source");
assert.deepEqual(cFatherOnlyEnv.randomRolls, [{ chance: 10, success: true }]);

const ordinaryBlackPartner = makeCharacter("ordinary-black-partner", { female: true });
const blackChildBeforeBirth = characterSnapshot(blackChild);
const blackChildOffspring = lineageChild("black-child-offspring");
const blackOnlyOffspringEnv = runNaturalBirth(blackChildOffspring, blackChild, ordinaryBlackPartner, null, { randomChoices: [{ type: "chance", success: false }] });
assert.deepEqual(variableSlots(blackChildOffspring), variableSlots(blackChild), "Black Blood transmits its exact biological sources");
assert.ok(blackChildOffspring.flags.has("mm_dragon_lineage_initialized"));
assert.ok(blackChildOffspring.traits.has("mm_dragon_lineage_4"), "single black parent with ordinary human produces C when mutation fails");
assert.deepEqual(blackOnlyOffspringEnv.randomRolls, [{ chance: 10, success: false }], "single black parent uses one ordinary mutation trial");
assert.deepEqual(characterSnapshot(blackChild), blackChildBeforeBirth, "lineage evaluation does not mutate the Black Blood parent");

const closerOrigin = makeCharacter("closer-origin");
const distantOrigin = makeCharacter("distant-origin");
const distantMother = parentWithBlood("distant-mother", 2, [distantOrigin], "mm_dragon_lineage_2");
const closerRealFather = parentWithBlood("closer-real-father", 0, [closerOrigin], "mm_dragon_half");
const nearestChild = lineageChild("nearest-child");
const nearestEnv = runNaturalBirth(nearestChild, distantMother, makeCharacter("unrelated-family-father"), closerRealFather);
assert.equal(nearestChild.vars.get("mm_dragon_lineage_generation"), 1, "the closer biological parent wins");
assert.deepEqual(variableSlots(nearestChild), [distantOrigin, closerOrigin], "strongest grade selection preserves both biological ancestries");
assert.deepEqual(nearestEnv.randomRolls, [{ chance: 10, success: false }], "a closer inherited generation still receives the one required mutation trial");

const closerHalfAndC = lineageChild("closer-half-and-c-child");
const closerHalf = parentWithBlood("closer-half", 0, [closerOrigin], "mm_dragon_half");
const terminalCParent = parentWithBlood("terminal-c-parent", 4, [distantOrigin], "mm_dragon_lineage_4");
const closerHalfEnv = runNaturalBirth(
  closerHalfAndC,
  closerHalf,
  makeCharacter("closer-half-family-father"),
  terminalCParent
);
assert.ok(closerHalfAndC.traits.has("mm_dragon_lineage_1"), "first-generation ancestry outranks a C-grade parent");
assert.ok(!closerHalfAndC.traits.has("mm_dragon_black_blood"), "a C-grade parent cannot override a closer bloodline");
assert.deepEqual(variableSlots(closerHalfAndC), [closerOrigin, distantOrigin], "the C parent's biological ancestry survives alongside the stronger grade");
assert.deepEqual(closerHalfEnv.randomRolls, [{ chance: 10, success: false }], "all eligible parent grades share one mutation trial");

const sharedSourceA = makeCharacter("shared-source-a");
const sharedSourceB = makeCharacter("shared-source-b");
const equalMother = parentWithBlood("equal-mother", 0, [sharedSourceA, sharedSourceB], "mm_dragon_half");
const equalRealFather = parentWithBlood("equal-real-father", 0, [sharedSourceB], "mm_dragon_half");
const equalChild = lineageChild("equal-child");
runNaturalBirth(equalChild, equalMother, makeCharacter("equal-legal-father"), equalRealFather);
assert.equal(equalChild.vars.get("mm_dragon_lineage_generation"), 1, "equal-strength sources retain the same generation");
assert.deepEqual(variableSlots(equalChild), [sharedSourceA, sharedSourceB], "equal sources merge and de-duplicate by character identity");

const capSources = Array.from({ length: 18 }, (_, index) => makeCharacter("cap-source-" + index));
const capMother = parentWithBlood("cap-mother", 0, capSources.slice(0, 16), "mm_dragon_half");
const capFather = parentWithBlood("cap-father", 0, capSources.slice(15), "mm_dragon_half");
const capChild = lineageChild("cap-child");
runNaturalBirth(capChild, capMother, makeCharacter("cap-legal-father"), capFather);
assert.equal(variableSlots(capChild).length, 16, "the legacy compact projection retains sixteen display slots");
assert.deepEqual(variableSlots(capChild), capSources.slice(0, 16), "source slots stay ordered and preserve the first sixteen unique characters");
assert.deepEqual(capChild.variableLists.get("mm_dragon_origins"), capSources, "the authoritative ancestry list preserves all eighteen unique sources");

// 2. Same-stable eligibility is evaluated from the actual script trigger.
function stablePairFixture(overrides = {}) {
  const keeper = makeCharacter("stable-keeper");
  const stableCounty = {
    kind: "county",
    id: "stable-county",
    holder: keeper,
    provinces: [{ kind: "province", id: "stable-barony", buildings: new Set(["myv_wyvern_stable_01"]) }],
  };
  const mother = makeCharacter("stable-mother", {
    female: true,
    age: 20,
    traits: ["myv_wyvern_tamed"],
    flags: ["myv_wyvern_in_stable"],
    vars: { myv_wyvern_stable_county: stableCounty },
  });
  const father = makeCharacter("stable-father", {
    female: false,
    age: 20,
    traits: ["myv_wyvern_tamed"],
    flags: ["myv_wyvern_in_stable"],
    vars: { myv_wyvern_stable_county: stableCounty },
  });
  Object.assign(father, overrides.father || {});
  Object.assign(mother, overrides.mother || {});
  if (overrides.differentStable) {
    const otherCounty = { ...stableCounty, id: "other-stable-county" };
    father.vars.set("myv_wyvern_stable_county", otherCounty);
  }
  if (overrides.closeFamily) father.closeFamilyIds.add(mother.id);
  return { keeper, stableCounty, mother, father };
}

function stablePairAllowed(fixture) {
  const env = makeEnvironment();
  return runTriggerDefinition("mm_dragon_stable_pair_valid_trigger", fixture.father, env, {
    MOTHER: fixture.mother,
    KEEPER: fixture.keeper,
  });
}

assert.equal(stablePairAllowed(stablePairFixture()), true, "eligible adult stable pair passes");
assert.equal(stablePairAllowed(stablePairFixture({ father: { age: 11 } })), false, "underage dragon cannot be selected");
assert.equal(stablePairAllowed(stablePairFixture({ differentStable: true })), false, "different stable is rejected");
assert.equal(stablePairAllowed(stablePairFixture({ closeFamily: true })), false, "close relatives cannot breed");
assert.equal(stablePairAllowed(stablePairFixture({ father: { female: true } })), false, "same-sex pair is rejected");
assert.equal(stablePairAllowed(stablePairFixture({ mother: { alive: false } })), false, "dead mother is rejected");
assert.equal(stablePairAllowed(stablePairFixture({ mother: { flags: new Set(["myv_wyvern_in_stable", "mm_dragon_forced_breeding_cooldown"]) } })), false,
  "pair cooldown blocks repeated breeding");

// Execute the actual two-click interaction and patched native egg effect.
const stable = stablePairFixture();
const selectMother = interactions.get("mm_dragon_select_stable_mother_interaction");
const forceBreeding = interactions.get("mm_dragon_force_stable_breeding_interaction");
assert.ok(selectMother && forceBreeding, "both explicit character-click interactions exist");
const stableEnv = makeEnvironment({ scopes: { actor: stable.keeper, recipient: stable.mother } });
executeEffectSequence(value(selectMother, "on_accept", "mother selection"), stable.keeper, stableEnv);
assert.equal(stable.keeper.vars.get("mm_dragon_selected_mother"), stable.mother, "first click stores the exact female dragon");
stableEnv.scopes.recipient = stable.father;
executeEffectSequence(value(forceBreeding, "on_accept", "forced breeding"), stable.keeper, stableEnv);
assert.equal(stableEnv.createdEggs.length, 1, "one accepted pair interaction creates exactly one egg");
assert.equal(stableEnv.createdEggs[0].vars.get("myv_wyvern_egg_mother"), stable.mother, "egg stores the selected mother");
assert.equal(stableEnv.createdEggs[0].vars.get("myv_wyvern_egg_father"), stable.father, "egg stores the clicked male as father");
assert.ok(stable.mother.flags.has("mm_dragon_forced_breeding_cooldown"), "cooldown starts only after the egg exists");
assert.ok(!stable.keeper.vars.has("mm_dragon_selected_mother"), "successful pair consumes the selected mother");
executeEffectSequence(value(forceBreeding, "on_accept", "repeated forced breeding"), stable.keeper, stableEnv);
assert.equal(stableEnv.createdEggs.length, 1, "a second click without reselecting does not create another egg");

for (const badFixture of [
  stablePairFixture({ father: { age: 11 } }),
  stablePairFixture({ differentStable: true }),
  stablePairFixture({ closeFamily: true }),
]) {
  badFixture.keeper.vars.set("mm_dragon_selected_mother", badFixture.mother);
  const before = [badFixture.keeper, badFixture.mother, badFixture.father].map(characterSnapshot);
  const env = makeEnvironment({ scopes: { actor: badFixture.keeper, recipient: badFixture.father } });
  executeEffectSequence(value(forceBreeding, "on_accept", "invalid stable breeding"), badFixture.keeper, env);
  assert.deepEqual([badFixture.keeper, badFixture.mother, badFixture.father].map(characterSnapshot), before,
    "invalid stable pair has no character-state writes");
  assert.equal(env.createdEggs.length, 0, "invalid stable pair creates no egg");
}

// 3. Human/dragon request is consent-based; invalid acceptance paths have no writes.
const humanRequest = interactions.get("mm_dragon_request_half_dragon_interaction");
assert.equal(scalar(humanRequest, "auto_accept", "human breeding interaction"), "no", "dragon partner must accept or refuse");
assert.equal(first(humanRequest, "on_decline"), undefined, "decline has no mutation handler");
assert.equal(first(humanRequest, "on_send"), undefined, "sending a request has no mutation handler");
const requestMother = makeCharacter("request-mother", {
  female: true,
  age: 24,
  traits: ["myv_wyvern_tamed"],
  flags: ["mm_wyvern_human_form"],
});
const humanFather = makeCharacter("request-father", { female: false, age: 25, traits: ["mm_wyvern_bathed_in_dragon_blood"] });
requestMother.bondedCharacter = humanFather;
function humanPairAllowed(mother = requestMother, father = humanFather) {
  return runTriggerDefinition("mm_dragon_human_pair_valid_trigger", mother, makeEnvironment(), { FATHER: father });
}
assert.equal(humanPairAllowed(), true, "eligible bonded human and human-form dragon pass the actual pair trigger");
assert.equal(humanPairAllowed(requestMother, makeCharacter("minor-human", { age: 17, traits: ["mm_wyvern_bathed_in_dragon_blood"] })), false,
  "minor human cannot request breeding");
assert.equal(humanPairAllowed(requestMother, makeCharacter("wyvern-father", {
  age: 25,
  traits: ["mm_wyvern_bathed_in_dragon_blood", "myv_wyvern_tamed"],
})), false, "a wyvern cannot use the human-blood breeding interaction");
const relatedHuman = makeCharacter("related-human", { traits: ["mm_wyvern_bathed_in_dragon_blood"] });
const relatedMother = makeCharacter("related-mother", {
  female: true,
  age: 24,
  traits: ["myv_wyvern_tamed"],
  flags: ["mm_wyvern_human_form"],
});
relatedMother.closeFamilyIds.add(relatedHuman.id);
relatedMother.bondedCharacter = relatedHuman;
assert.equal(humanPairAllowed(relatedMother, relatedHuman), false, "close relative is rejected");

const acceptedRequestEnv = makeEnvironment({ scopes: { actor: humanFather, recipient: requestMother } });
executeEffectSequence(value(humanRequest, "on_accept", "accepted human breeding"), humanFather, acceptedRequestEnv);
assert.equal(acceptedRequestEnv.createdEggs.length, 1, "accepted consent creates exactly one half-dragon egg");
assert.equal(acceptedRequestEnv.createdEggs[0].vars.get("myv_wyvern_egg_mother"), requestMother,
  "half egg records the consenting female dragon as biological mother");
assert.equal(acceptedRequestEnv.createdEggs[0].vars.get("myv_wyvern_egg_father"), humanFather,
  "half egg records the requesting human as biological father");
assert.ok(requestMother.flags.has("mm_dragon_half_breeding_cooldown"), "accepted human pair receives the five-year cooldown");

const underageMother = makeCharacter("underage-mother", { female: true, age: 17, traits: ["myv_wyvern_tamed"], flags: ["mm_wyvern_human_form"] });
underageMother.bondedCharacter = humanFather;
const invalidRequestBefore = [underageMother, humanFather].map(characterSnapshot);
const invalidRequestEnv = makeEnvironment({ scopes: { actor: humanFather, recipient: underageMother } });
executeEffectSequence(value(humanRequest, "on_accept", "invalid human breeding"), humanFather, invalidRequestEnv);
assert.deepEqual([underageMother, humanFather].map(characterSnapshot), invalidRequestBefore, "invalid human pair has no writes");
assert.equal(invalidRequestEnv.createdEggs.length, 0, "invalid human pair creates no egg");

// 4. The half-dragon egg freezes both biological parents; the later holder is only the hatch owner.
const hatchMother = makeCharacter("egg-biological-mother", {
  female: true,
  traits: ["myv_wyvern_tamed", "mm_dragon_tail", "mm_dragon_horns", "mm_dragon_pupils", "mm_dragon_scales"],
});
const hatchFather = makeCharacter("egg-biological-father", { female: false, culture: "father-culture", faith: "father-faith" });
const eggHolder = makeCharacter("later-egg-holder", { isRuler: true, location: { id: "holder-location" } });
const halfEgg = {
  kind: "artifact",
  id: "half-egg",
  vars: new Map([
    ["mm_dragon_half_egg", true],
    ["myv_wyvern_egg_mother", hatchMother],
    ["myv_wyvern_egg_father", hatchFather],
    ["mm_dragon_egg_tail", true],
    ["mm_dragon_egg_horns", true],
  ]),
  variableLists: new Map(),
  owner: eggHolder,
  destroyed: false,
};
const hatchEnv = makeEnvironment({ creationFemale: true });
executeEffectDefinition("mm_dragon_hatch_half_egg_effect", halfEgg, hatchEnv);
assert.equal(hatchEnv.createdCharacters.length, 1, "half-dragon egg creates one newborn");
const hatchling = hatchEnv.createdCharacters[0];
assert.equal(hatchling.mother, hatchMother, "newborn mother is the exact egg-stored biological mother");
assert.equal(hatchling.father, hatchFather, "newborn father is the exact egg-stored biological father");
assert.equal(hatchling.realFather, hatchFather, "biological father is wired as real_father");
assert.notEqual(hatchling.mother, eggHolder, "egg holder never substitutes for the mother");
assert.notEqual(hatchling.father, eggHolder, "egg holder never substitutes for the father");
assert.equal(hatchling.location, eggHolder.location, "current holder supplies birth location only");
assert.ok(eggHolder.courtiers.has(hatchling), "newborn joins current egg holder as courtier");
assert.equal(hatchling.genderFemaleChance, 50, "half-dragon hatching rolls sex at 50 percent");
assert.ok(hatchling.traits.has("mm_dragon_half"), "hatchling receives half-dragon identity");
assert.ok(hatchling.flags.has("mm_dragon_blood_human"), "hatchling receives the human-lineage marker");
assert.ok(hatchling.traits.has("mm_dragon_tail") && hatchling.traits.has("mm_dragon_horns"), "egg-frozen features apply to the hatchling");
assert.ok(!hatchling.traits.has("myv_wyvern") && !hatchling.traits.has("myv_wyvern_tamed"), "half-dragon does not receive wyvern identity");
assert.ok(!hatchEnv.globalLists.has("myv_living_wyverns"), "half-dragon is not registered in the MYV living-wyvern index");
assert.equal(halfEgg.destroyed, true, "egg is destroyed after successful creation");
executeEffectDefinition("mm_dragon_hatch_half_egg_effect", halfEgg, hatchEnv);
assert.equal(hatchEnv.createdCharacters.length, 1, "the hatch-started guard prevents the same egg from creating a second child");

const nonRulerHolder = makeCharacter("non-ruler-egg-holder", { location: { id: "non-ruler-location" } });
const nonRulerEgg = {
  kind: "artifact",
  id: "non-ruler-half-egg",
  vars: new Map([
    ["mm_dragon_half_egg", true],
    ["myv_wyvern_egg_mother", hatchMother],
    ["myv_wyvern_egg_father", hatchFather],
    ["mm_dragon_egg_tail", true],
  ]),
  variableLists: new Map(),
  owner: nonRulerHolder,
  destroyed: false,
};
const nonRulerHatchEnv = makeEnvironment();
executeEffectDefinition("mm_dragon_hatch_half_egg_effect", nonRulerEgg, nonRulerHatchEnv);
assert.equal(nonRulerHatchEnv.createdCharacters.length, 1, "a non-ruler egg holder still receives the newborn");
assert.equal(nonRulerHolder.courtiers.size, 0, "a non-ruler holder does not receive the newborn as a courtier");
assert.equal(nonRulerEgg.destroyed, true, "a successful non-ruler hatch consumes the egg");

const invalidEgg = {
  kind: "artifact",
  id: "invalid-half-egg",
  vars: new Map([["mm_dragon_half_egg", true], ["myv_wyvern_egg_mother", hatchMother]]),
  variableLists: new Map(),
  owner: eggHolder,
  destroyed: false,
};
const invalidEggBefore = { ...characterSnapshot(eggHolder), vars: [...invalidEgg.vars] };
const invalidHatchEnv = makeEnvironment();
executeEffectDefinition("mm_dragon_hatch_half_egg_effect", invalidEgg, invalidHatchEnv);
assert.equal(invalidHatchEnv.createdCharacters.length, 0, "missing biological father blocks hatch creation");
assert.equal(invalidEgg.destroyed, false, "invalid egg is preserved");
assert.deepEqual({ ...characterSnapshot(eggHolder), vars: [...invalidEgg.vars] }, invalidEggBefore,
  "invalid hatch does not mutate the holder or egg data");

// 5. Random outcomes execute the real parsed feature effect, and never re-roll after toggles.
const appearanceTraits = ["mm_dragon_tail", "mm_dragon_horns", "mm_dragon_pupils", "mm_dragon_scales"];
for (let branch = 0; branch < 5; branch += 1) {
  const transformedDragon = makeCharacter("form-roll-" + branch);
  const env = makeEnvironment({ randomChoices: [{ type: "list", index: branch }] });
  executeEffectDefinition("mm_dragon_initialize_features_effect", transformedDragon, env);
  const gained = appearanceTraits.filter(trait => transformedDragon.traits.has(trait));
  assert.ok(gained.length === 3 || gained.length === 4, "every random feature outcome grants three or four appearance traits");
  assert.equal(transformedDragon.vars.get("mm_dragon_feature_count"), gained.length, "stored feature count matches rolled traits");
  assert.ok(transformedDragon.flags.has("mm_dragon_features_rolled"), "roll marker is set");
  const beforeToggle = characterSnapshot(transformedDragon);
  env.randomChoices = [{ type: "list", index: (branch + 1) % 5 }];
  executeEffectDefinition("mm_dragon_initialize_features_effect", transformedDragon, env);
  assert.deepEqual(characterSnapshot(transformedDragon), beforeToggle, "form toggling does not reroll appearance traits");
}

// Every feature-count result on half-dragon eggs is run through the actual PDX effect.
const createHalfEgg = scriptedEffects.get("mm_dragon_create_half_egg_effect");
assert.ok(createHalfEgg, "half-dragon egg creation effect exists");
for (const [legendary, expectedCounts] of [[false, [1, 2]], [true, [3, 4]]]) {
  for (let branch = 0; branch < 2; branch += 1) {
    const mother = makeCharacter("feature-mother-" + legendary + "-" + branch, {
      female: true,
      traits: ["mm_dragon_tail", "mm_dragon_horns", "mm_dragon_pupils", "mm_dragon_scales"],
      flags: legendary ? ["mm_wyvern_legendary_origin"] : [],
      vars: { mm_dragon_feature_count: 4 },
    });
    const father = makeCharacter("feature-father-" + legendary + "-" + branch);
    const env = makeEnvironment({ scopes: { mm_dragon_half_dragon_parent: mother }, randomChoices: [
      { type: "list", index: branch },
      { type: "list", index: 0 }, { type: "list", index: 0 },
      { type: "list", index: 0 }, { type: "list", index: 0 },
    ] });
    executeEffectDefinition("mm_dragon_create_half_egg_effect", father, env);
    const egg = env.scopes.mm_dragon_half_egg;
    assert.ok(egg, "accepted pair creates a half-dragon egg");
    assert.equal(egg.vars.get("myv_wyvern_egg_mother"), mother, "half egg stores biological mother");
    assert.equal(egg.vars.get("myv_wyvern_egg_father"), father, "half egg stores biological father");
    const eggFeatures = appearanceTraits.filter(trait => egg.vars.has("mm_dragon_egg_" + trait.slice("mm_dragon_".length)));
    assert.equal(eggFeatures.length, expectedCounts[branch], "ordinary/legendary mother freezes the selected 1-2/3-4 unique features");
    assert.ok(eggFeatures.every(trait => mother.traits.has(trait)), "offspring feature roll is a subset of the actual mother's features");
    assert.equal(new Set(eggFeatures).size, eggFeatures.length, "one egg cannot select a feature twice");
  }
}

// 6. Legendary inheritance is rolled independently for either exact parent, on the exact new egg.
const nativeEggScript = scriptedEffects.get("myv_create_stable_bred_wyvern_egg_artifact_effect");
assert.ok(nativeEggScript, "patched stable egg effect exists");
for (const parentSide of ["mother", "father"]) {
  for (const success of [false, true]) {
    const mother = makeCharacter("legend-mother-" + parentSide + success, {
      female: true,
      traits: parentSide === "mother" ? ["myv_wyvern_legendary"] : ["myv_wyvern_tamed"],
    });
    const father = makeCharacter("legend-father-" + parentSide + success, {
      female: false,
      traits: parentSide === "father" ? ["myv_wyvern_legendary"] : ["myv_wyvern_tamed"],
    });
    const keeper = makeCharacter("legend-egg-holder-" + parentSide + success);
    const env = makeEnvironment({ scopes: {
      myv_wyvern_egg_mother: mother,
      myv_wyvern_egg_father: father,
      myv_wyvern_egg_creator: mother,
      myv_wyvern_egg_location: { id: "egg-location" },
    }, randomChoices: [{ type: "list", index: 0 }, { type: "chance", success }] });
    executeEffectDefinition("myv_create_stable_bred_wyvern_egg_artifact_effect", keeper, env);
    const egg = env.scopes.myv_wyvern_egg;
    assert.ok(egg, "native stable egg creation stub returns one artifact");
    assert.equal(egg.vars.get("myv_wyvern_egg_mother"), mother, "stable egg binds exact mother");
    assert.equal(egg.vars.get("myv_wyvern_egg_father"), father, "stable egg binds exact father");
    assert.equal(egg.vars.has("mm_dragon_legendary_egg"), success,
      "either legendary parent exposes the independent 50 percent roll on this egg");
    assert.equal(env.randomRolls[env.randomRolls.length - 1].chance, 50, "legendary inheritance chance is fifty percent");
  }
}
{
  const ordinaryMother = makeCharacter("ordinary-egg-mother", { female: true, traits: ["myv_wyvern_tamed"] });
  const ordinaryFather = makeCharacter("ordinary-egg-father", { traits: ["myv_wyvern_tamed"] });
  const env = makeEnvironment({ scopes: {
    myv_wyvern_egg_mother: ordinaryMother,
    myv_wyvern_egg_father: ordinaryFather,
    myv_wyvern_egg_creator: ordinaryMother,
    myv_wyvern_egg_location: { id: "ordinary-location" },
  } });
  executeEffectDefinition("myv_create_stable_bred_wyvern_egg_artifact_effect", makeCharacter("ordinary-owner"), env);
  assert.ok(!env.scopes.myv_wyvern_egg.vars.has("mm_dragon_legendary_egg"), "non-legendary parents never roll legendary offspring");
  assert.equal(env.randomRolls.length, 0, "ordinary eggs do not consume the legendary roll");
}

const nativeTamedCreationFile = path.join(nativeModRoot, "common", "scripted_effects", "myv_wyvern_effects.txt");
const nativeTamedCreation = fs.existsSync(nativeTamedCreationFile)
  ? parseDefinitionFile(nativeTamedCreationFile, "myv_create_tamed_wyvern_effect", "native tamed wyvern creation")
  : first(parsePdx(nativeEggFixture.tamedCreate, "frozen native tamed wyvern creation"), "myv_create_tamed_wyvern_effect");
assert.ok(nativeTamedCreation, "native tamed creation is available from its source or frozen snapshot");
const nativeCreateCharacter = first(nativeTamedCreation.value, "create_character");
assert.ok(nativeCreateCharacter, "native tamed hatch still creates a character");
assert.equal(scalar(nativeCreateCharacter.value, "gender_female_chance", "native tamed hatch"), "50",
  "native dragon hatch keeps a fifty percent sex roll");

// 7. Trait values preserve the chosen immortal reference while wyverns gain disease resistance.
const bloodTrait = parseDefinitionFile(
  path.join(captureRoot, "common", "traits", "mm_wyvern_dragon_blood.txt"),
  "mm_wyvern_bathed_in_dragon_blood",
  "dragon-blood trait"
).value;
const zgBuxiuFile = path.join(immortalityModRoot, "common", "traits", "zhuge_traits_cheat_menu.txt");
const zgBuxiuDefinition = fs.existsSync(zgBuxiuFile)
  ? parseDefinitionFile(zgBuxiuFile, "zg_buxiu", "ZG Bu Xiu reference trait")
  : first(parsePdx(nativeEggFixture.immortalityReference, "frozen ZG Bu Xiu reference trait"), "zg_buxiu");
assert.ok(zgBuxiuDefinition, "ZG Bu Xiu reference is available from its source or frozen snapshot");
const zgBuxiu = zgBuxiuDefinition.value;
for (const key of ["immortal", "long_reign_bonus_mult", "no_prowess_loss_from_age", "health", "elderly_health", "life_expectancy", "fertility"]) {
  assert.equal(scalar(bloodTrait, key, "bathed in dragon blood"), scalar(zgBuxiu, key, "zg_buxiu"),
    "dragon-blood trait preserves zg_buxiu " + key);
}
for (const flag of ["is_immortal", "immortal_visuals", "immortal_fertility", "immortal_incapability"]) {
  assert.ok(all(bloodTrait, "flag").some(node => node.value === flag), "dragon-blood trait keeps " + flag);
}
assert.equal(scalar(bloodTrait, "prowess", "bathed in dragon blood"), "10");
assert.equal(scalar(bloodTrait, "monthly_prestige", "bathed in dragon blood"), "2");
assert.notEqual(scalar(bloodTrait, "icon", "bathed in dragon blood"), "immortal.dds", "dragon-blood has its dedicated icon");

const speciesHealth = parseDefinitions(
  path.join(captureRoot, "common", "traits", "zzzzz_mm_wyvern_species_health.txt"),
  "wyvern epidemic resistance"
);
for (const speciesTrait of ["myv_wyvern", "myv_wyvern_tamed", "myv_wyvern_legendary"]) {
  const trait = speciesHealth.get(speciesTrait);
  assert.ok(trait, "native species trait is preserved: " + speciesTrait);
  assert.equal(scalar(trait, "epidemic_resistance", speciesTrait), "100", speciesTrait + " has +100 epidemic resistance");
  assert.ok(all(trait, "flag").some(node => node.value === "immune_to_disease"), speciesTrait + " retains disease immunity");
}

const halfTrait = bloodTraits.get("mm_dragon_half");
assert.ok(halfTrait, "half-dragon trait exists");
assert.equal(optionalValue(halfTrait, "immortal"), undefined, "half-dragon is not immortal");
assert.ok(!all(halfTrait, "flag").some(node => ["is_immortal", "immortal_visuals", "immortal_fertility", "immortal_incapability"].includes(node.value)),
  "half-dragon does not inherit the immortality flags");

const expectedBloodlineModifiers = new Map([
  ["mm_dragon_half", {
    life_expectancy: "150", health: "5", epidemic_resistance: "70", martial: "30", prowess: "50",
    diplomacy: "1", attraction_opinion: "20", general_opinion: "10", monthly_prestige: "10",
    monthly_legitimacy_add: "2", domicile_monthly_gold_mult: "0.2",
  }],
  ["mm_dragon_black_blood", {
    life_expectancy: "100", health: "5", epidemic_resistance: "60", martial: "40", prowess: "80",
    diplomacy: "1", attraction_opinion: "18", general_opinion: "8", monthly_prestige: "12",
    monthly_legitimacy_add: "2.5", domicile_monthly_gold_mult: "0.25",
  }],
  ["mm_dragon_lineage_1", {
    life_expectancy: "50", health: "4", epidemic_resistance: "50", martial: "15", prowess: "30",
    diplomacy: "1", attraction_opinion: "10", same_opinion: "10", monthly_prestige: "5",
    monthly_legitimacy_add: "1",
  }],
  ["mm_dragon_lineage_2", {
    life_expectancy: "30", health: "3", epidemic_resistance: "40", martial: "10", prowess: "20",
    diplomacy: "1", attraction_opinion: "7", same_opinion: "7", monthly_prestige: "3",
    monthly_legitimacy_add: "0.75",
  }],
  ["mm_dragon_lineage_3", {
    life_expectancy: "15", health: "2", epidemic_resistance: "30", martial: "5", prowess: "10",
    attraction_opinion: "4", same_opinion: "4", monthly_prestige: "2", monthly_legitimacy_add: "0.5",
  }],
  ["mm_dragon_lineage_4", {
    life_expectancy: "5", health: "1", epidemic_resistance: "20", martial: "2", prowess: "5",
    attraction_opinion: "2", same_opinion: "2", monthly_prestige: "1", monthly_legitimacy_add: "0.25",
  }],
]);
const numericModifierKeys = [
  "life_expectancy", "health", "epidemic_resistance", "martial", "prowess", "diplomacy",
  "attraction_opinion", "same_opinion", "general_opinion", "monthly_prestige",
  "monthly_legitimacy_add", "domicile_monthly_gold_mult", "enemy_hard_casualty_modifier",
  "movement_speed", "max_combat_roll", "siege_phase_time",
];
const progenitorBattleModifiers = {
  enemy_hard_casualty_modifier: "0.2",
  movement_speed: "0.1",
  max_combat_roll: "3",
  siege_phase_time: "-0.2",
};
for (const [traitName, expected] of expectedBloodlineModifiers) {
  const trait = bloodTraits.get(traitName);
  assert.ok(trait, "bloodline trait exists: " + traitName);
  for (const key of numericModifierKeys) {
    const expectedValue = expected[key] || (traitName === "mm_dragon_half" ? progenitorBattleModifiers[key] : undefined);
    if (expectedValue === undefined) {
      assert.equal(optionalValue(trait, key), undefined, traitName + " has no unapproved " + key + " modifier");
    } else {
      assert.equal(scalar(trait, key, traitName), expectedValue, traitName + " has the selected " + key + " value");
    }
  }
}
for (const traitName of ["mm_dragon_black_blood", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4"]) {
  const trait = bloodTraits.get(traitName);
  for (const key of Object.keys(progenitorBattleModifiers)) {
    assert.equal(optionalValue(trait, key), undefined, traitName + " does not receive the progenitor-only battlefield modifier " + key);
  }
}
for (const traitName of expectedBloodlineModifiers.keys()) {
  const trait = bloodTraits.get(traitName);
  assert.equal(optionalValue(trait, "immortal"), undefined, traitName + " remains long-lived but mortal");
  assert.ok(!all(trait, "flag").some(node => ["is_immortal", "immortal_visuals", "immortal_fertility", "immortal_incapability"].includes(node.value)),
    traitName + " does not receive immortality flags");
}

const bloodTraitLabels = {
  trait_mm_dragon_half: "混血种·初代种",
  trait_mm_dragon_lineage_1: "混血种·S级",
  trait_mm_dragon_lineage_2: "混血种·A级",
  trait_mm_dragon_lineage_3: "混血种·B级",
  trait_mm_dragon_lineage_4: "混血种·C级",
  trait_mm_dragon_black_blood: "混血种·黑血",
};
for (const locale of ["english/mm_dragon_bloodline_l_english.yml", "simp_chinese/mm_dragon_bloodline_l_simp_chinese.yml"]) {
  const source = fs.readFileSync(path.join(bloodLocalizationRoot, locale), "utf8");
  for (const key of Object.keys(bloodTraitLabels)) {
    assert.ok(localizedValue(source, key, locale).trim().length > 0, locale + " defines " + key);
  }
}
const chineseBloodLocale = fs.readFileSync(
  path.join(bloodLocalizationRoot, "simp_chinese/mm_dragon_bloodline_l_simp_chinese.yml"), "utf8");
for (const [key, expectedLabel] of Object.entries(bloodTraitLabels)) {
  assert.equal(localizedValue(chineseBloodLocale, key, "Simplified Chinese bloodline localization"), expectedLabel,
    key + " uses the approved Progenitor/S/A/B/C/Black Blood display name");
}

// 8. All lineage descriptions render only saved sources and support the sixteen-source cap.
for (const traitName of ["mm_dragon_half", "mm_dragon_lineage_1", "mm_dragon_lineage_2", "mm_dragon_lineage_3", "mm_dragon_lineage_4", "mm_dragon_black_blood"]) {
  findDescSources(value(bloodTraits.get(traitName), "desc", traitName), 16);
}
for (const locale of ["english/mm_dragon_bloodline_l_english.yml", "simp_chinese/mm_dragon_bloodline_l_simp_chinese.yml"]) {
  const filePath = path.join(bloodLocalizationRoot, locale);
  const source = fs.readFileSync(filePath, "utf8");
  for (let index = 1; index <= 16; index += 1) {
    const key = "mm_dragon_blood_sources_" + index;
    const localized = localizedValue(source, key, locale);
    for (let slot = 1; slot <= index; slot += 1) {
      assert.ok(new RegExp("mm_dragon_origin_" + slot + "(?!\\d)").test(localized),
        locale + "/" + key + " renders source slot " + slot);
    }
  }
}

// 9. The override keeps the complete frozen MYV egg create/hatch body.
function preservesPdxNode(expected, actual) {
  if (expected.key !== actual.key || expected.operator !== actual.operator) return false;
  if (Array.isArray(expected.value)) {
    return Array.isArray(actual.value) && preservesPdxSequence(expected.value, actual.value);
  }
  return !Array.isArray(actual.value) && expected.value === actual.value;
}
function preservesPdxSequence(expected, actual) {
  let expectedIndex = 0;
  for (const node of actual) {
    if (expectedIndex < expected.length && preservesPdxNode(expected[expectedIndex], node)) expectedIndex += 1;
  }
  return expectedIndex === expected.length;
}
function containsPdxNode(nodes, predicate) {
  return nodes.some(node => predicate(node) || (Array.isArray(node.value) && containsPdxNode(node.value, predicate)));
}
const frozenStableEffect = first(parsePdx(nativeEggFixture.stableCreate, "frozen native stable egg effect"),
  "myv_create_stable_bred_wyvern_egg_artifact_effect");
const patchedStableEffect = parseDefinitionFile(
  path.join(bloodRoot, "common", "scripted_effects", "zzzzz_mm_dragon_native_eggs.txt"),
  "myv_create_stable_bred_wyvern_egg_artifact_effect",
  "patched stable egg effect"
);
assert.deepEqual(patchedStableEffect.value.slice(0, frozenStableEffect.value.length), frozenStableEffect.value,
  "patched stable egg effect preserves the frozen native body before adding lineage rolls");
const frozenHatchEffect = first(parsePdx(nativeEggFixture.hatch, "frozen native egg hatch effect"), "myv_hatch_wyvern_egg_effect");
const patchedHatchEffect = parseDefinitionFile(
  path.join(bloodRoot, "common", "scripted_effects", "zzzzz_mm_dragon_native_eggs.txt"),
  "myv_hatch_wyvern_egg_effect",
  "patched egg hatch effect"
);
const nativeHatchElse = first(patchedHatchEffect.value, "else");
assert.ok(nativeHatchElse, "custom half egg is isolated behind a native hatch else branch");
assert.equal(preservesPdxSequence(frozenHatchEffect.value.filter(node => node.key !== "destroy_artifact"), nativeHatchElse.value), true,
  "the native MYV hatch path remains in order inside else, with lineage additions isolated around it");
assert.ok(containsPdxNode(nativeHatchElse.value, node => node.key === "if" &&
  JSON.stringify(node).includes("scope:myv_new_wyvern") &&
  JSON.stringify(node).includes("destroy_artifact")), "native egg is consumed only after a hatchling exists");
assert.ok(containsPdxNode(nativeHatchElse.value, node => node.key === "if" &&
  JSON.stringify(node).includes("mm_dragon_legendary_egg") &&
  JSON.stringify(node).includes("mm_wyvern_legendary_origin")),
"native stable hatch applies the frozen legendary-egg result to the new wyvern");

console.log("Wyvern v1.2.0 bloodline finite-PDX fixtures and structural regressions are present.");

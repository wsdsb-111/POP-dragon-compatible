"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const captureRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const fixture = JSON.parse(fs.readFileSync(
  path.join(projectRoot, "tests", "fixtures", "v122", "native-combat-contract.json"), "utf8"));
const nativeRoot = process.env.CK3_WYVERN_MOD_DIR
  ? path.resolve(process.env.CK3_WYVERN_MOD_DIR)
  : "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
const combatTriggerFile = path.join(captureRoot, "common", "scripted_triggers", "zzzzzz_mm_wyvern_lifecycle_combat.txt");
const combatValueFile = path.join(captureRoot, "common", "script_values", "zzzzzz_mm_wyvern_combat_values.txt");
const armyEffectFile = path.join(captureRoot, "common", "scripted_effects", "zzzzzz_mm_wyvern_army_effects.txt");
const aiEffectFile = path.join(captureRoot, "common", "scripted_effects", "zzzzzz_mm_wyvern_ai_hunt_effects.txt");
const interactionFile = path.join(captureRoot, "common", "character_interactions", "zzzzzz_mm_wyvern_mount_interaction.txt");

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
    assert.ok(index > start, label + " has an unsupported token at offset " + index);
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
  source = source.replace(/^\uFEFF/, "");
  const escaped = name.replace(/[.*+?^()|[\]\\]/g, "\\$&");
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
  assert.fail(label + " has an unclosed " + name + " block");
}

function definitions(source, label) {
  return new Map(parsePdx(source, label)
    .filter(node => Array.isArray(node.value))
    .map(node => [node.key, node.value]));
}

function readDefinitions(filePath, label) {
  return definitions(fs.readFileSync(filePath, "utf8"), label);
}

function definitionFromText(source, name, label) {
  const block = parsePdx(extractDefinition(source, name, label), label + ":" + name)[0];
  assert.ok(block && block.key === name && Array.isArray(block.value), label + " did not parse " + name);
  return block.value;
}

function first(block, key) {
  return (block || []).find(node => node.key === key);
}

function all(block, key) {
  return (block || []).filter(node => node.key === key);
}

function required(block, key, label) {
  const node = first(block, key);
  assert.ok(node, label + " is missing " + key);
  return node.value;
}

function readNativeDefinitions(relativePath, fallbackText, label) {
  const file = path.join(nativeRoot, ...relativePath.split("/"));
  return fs.existsSync(file) ? readDefinitions(file, label) : definitions(fallbackText, label + " frozen fallback");
}

const nativeTriggerFallback = [
  "myv_is_wyvern = { OR = { has_trait = myv_wyvern has_trait = myv_wyvern_tamed has_trait = myv_wyvern_legendary } }",
  "myv_is_living_wyvern = { myv_is_wyvern = yes is_alive = yes }",
  "myv_is_living_wild_wyvern = { myv_is_living_wyvern = yes NOT = { has_trait = myv_wyvern_tamed } }",
  "myv_is_personally_bonded_tamed_wyvern = { trigger_if = { limit = { myv_is_living_wyvern = yes } has_trait = myv_wyvern_tamed trigger_if = { limit = { exists = var:myv_wyvern_bonded_character } var:myv_wyvern_bonded_character = $OWNER$ trigger_else = { always = no } } trigger_else = { always = no } } trigger_else = { always = no } }",
  "myv_is_active_wyvern_war_rider = { trigger_if = { limit = { is_alive = yes } has_trait = myv_wyvern_rider trigger_if = { limit = { exists = var:myv_war_mount } var:myv_war_mount = { myv_is_personally_bonded_tamed_wyvern = { OWNER = prev } has_trait = myv_wyvern_harmony age >= 12 } trigger_else = { always = no } } trigger_else = { always = no } } trigger_else = { always = no } }",
].join("\n");
const nativeValueFallback = [
  "myv_wyvern_physique_prowess_multiplier = { value = 1 if = { limit = { has_trait = myv_wyvern_physique_weak } value = 0.9 } else_if = { limit = { has_trait = myv_wyvern_physique_powerful } value = 1.1 } }",
  "myv_wyvern_temperament_prowess_multiplier = { value = 1 if = { limit = { has_trait = myv_wyvern_temperament_docile } value = 0.9 } else_if = { limit = { has_trait = myv_wyvern_temperament_fierce } value = 1.1 } }",
  "myv_wyvern_wing_injury_prowess_multiplier = { value = 1 if = { limit = { has_trait_xp = { trait = myv_wyvern_wing_injuries track = myv_wyvern_wound_left_wing value >= 100 } } value = 0.75 } else_if = { limit = { has_trait_xp = { trait = myv_wyvern_wing_injuries track = myv_wyvern_wound_left_wing value >= 75 } } value = 0.88 } }",
  "myv_wyvern_hindleg_injury_prowess_multiplier = { value = 1 if = { limit = { has_trait_xp = { trait = myv_wyvern_hindleg_injuries track = myv_wyvern_wound_left_hindleg value >= 100 } } value = 0.75 } }",
  "myv_wyvern_tail_injury_prowess_multiplier = { value = 1 if = { limit = { has_trait_xp = { trait = myv_wyvern_tail_injury value >= 100 } } value = 0.9 } }",
  "myv_slay_hidden_advantage = { value = myv_slay_hunter_combat_tier subtract = myv_slay_wyvern_combat_tier }",
  "myv_slay_advantage_chance_modifier = { value = myv_slay_hidden_advantage multiply = 5 }",
  "myv_wyvern_malnutrition_progress = { value = var:myv_wyvern_malnutrition min = 0 max = 100 }",
  "myv_wyvern_malnutrition_level = { value = 0 if = { limit = { myv_wyvern_malnutrition_progress >= 100 } value = 5 } else_if = { limit = { myv_wyvern_malnutrition_progress >= 80 } value = 4 } else_if = { limit = { myv_wyvern_malnutrition_progress >= 60 } value = 3 } else_if = { limit = { myv_wyvern_malnutrition_progress >= 40 } value = 2 } else_if = { limit = { myv_wyvern_malnutrition_progress >= 20 } value = 1 } }",
  "myv_wyvern_malnutrition_prowess_multiplier = { value = 1 subtract = { value = myv_wyvern_malnutrition_level multiply = 0.1 } }",
  "myv_wyvern_food_reserve = { value = 100 if = { limit = { has_variable = myv_wyvern_hunger } value = var:myv_wyvern_hunger } subtract = myv_wyvern_malnutrition_progress }",
  "myv_wyvern_rider_damage_multiplier = { value = 2 }",
  "myv_wyvern_rider_toughness_multiplier = { value = 2 }",
  "myv_war_mount_harmony_power = { value = 0 if = { limit = { has_trait = myv_wyvern_rider has_variable = myv_war_mount var:myv_war_mount = { myv_is_living_wyvern = yes has_trait = myv_wyvern_harmony has_variable = myv_war_mount_rider var:myv_war_mount_rider = scope:myv_war_mount_bonus_rider } } value = var:myv_war_mount.myv_wyvern_target_prowess if = { limit = { var:myv_war_mount = { has_trait_xp = { trait = myv_wyvern_harmony value >= 100 } } } multiply = 1 } else_if = { limit = { var:myv_war_mount = { has_trait_xp = { trait = myv_wyvern_harmony value >= 75 } } } multiply = 0.9 } else_if = { limit = { var:myv_war_mount = { has_trait_xp = { trait = myv_wyvern_harmony value >= 50 } } } multiply = 0.8 } else_if = { limit = { var:myv_war_mount = { has_trait_xp = { trait = myv_wyvern_harmony value >= 25 } } } multiply = 0.7 } else = { multiply = 0.6 } } round = yes min = 0 max = 150 }",
].join("\n");
const nativeTriggers = readNativeDefinitions("common/scripted_triggers/myv_wyvern_triggers.txt", nativeTriggerFallback, "native wyvern triggers");
const nativeValues = new Map([
  ...readNativeDefinitions("common/script_values/myv_wyvern_values.txt", nativeValueFallback, "native wyvern values"),
  ...readNativeDefinitions("common/script_values/myv_wyvern_nutrition_values.txt", nativeValueFallback, "native nutrition values"),
]);
const nativeEffectFallback = [
  "myv_sync_wyvern_malnutrition_trait_effect = { remove_character_modifier = myv_wyvern_malnourished if = { limit = { myv_wyvern_malnutrition_progress > 0 } if = { limit = { NOT = { has_trait = myv_wyvern_malnutrition } } add_trait = myv_wyvern_malnutrition } } else = { remove_trait = myv_wyvern_malnutrition } }",
  "myv_change_wyvern_food_reserve_effect = { if = { limit = { myv_is_living_wyvern = yes } save_scope_value_as = { name = myv_wyvern_updated_food_reserve value = { value = myv_wyvern_food_reserve add = $AMOUNT$ } } if = { limit = { scope:myv_wyvern_updated_food_reserve < 0 } set_variable = { name = myv_wyvern_hunger value = 0 } set_variable = { name = myv_wyvern_malnutrition value = { value = scope:myv_wyvern_updated_food_reserve multiply = -1 max = 100 } } } else = { set_variable = { name = myv_wyvern_malnutrition value = 0 } set_variable = { name = myv_wyvern_hunger value = { value = scope:myv_wyvern_updated_food_reserve max = 100 } } } myv_sync_wyvern_malnutrition_trait_effect = yes myv_wyvern_refresh_hunger_state_effect = yes if = { limit = { myv_wyvern_malnutrition_progress >= 100 } death = { death_reason = death_myv_wyvern_starvation } } } }",
].join("\n");
const nativeEffects = readNativeDefinitions(
  "common/scripted_effects/myv_wyvern_nutrition_effects.txt", nativeEffectFallback, "native nutrition effects");
const nativeRefreshFile = path.join(nativeRoot, "common", "scripted_effects", "myv_wyvern_effects.txt");
const nativeRefreshFallback = [
  "myv_wyvern_refresh_hunger_state_effect = { myv_refresh_wyvern_prowess_effect = yes }",
  "myv_refresh_wyvern_prowess_effect = { myv_refresh_war_mount_combat_stats_effect = yes }",
  "myv_refresh_war_mount_combat_stats_effect = { set_variable = { name = myv_pending_war_mount_modifier_tier value = myv_war_mount_harmony_power } }",
].join("\n");
const nativeRefreshNames = [
  "myv_wyvern_refresh_hunger_state_effect",
  "myv_refresh_wyvern_prowess_effect",
  "myv_refresh_war_mount_combat_stats_effect",
];
const nativeRefreshEffects = fs.existsSync(nativeRefreshFile)
  ? new Map(nativeRefreshNames.map(name => [name,
    definitionFromText(fs.readFileSync(nativeRefreshFile, "utf8"), name, "native refresh effects")]))
  : definitions(nativeRefreshFallback, "frozen native refresh effects");
const runtimeTriggers = definitions(fs.readFileSync(combatTriggerFile, "utf8"), "wyvern lifecycle triggers");
const optionalCreedTriggers = definitions(fs.readFileSync(path.join(captureRoot, "common", "scripted_triggers", "mm_dragon_creed_combat.txt"), "utf8"), "optional creed defaults");
const triggers = new Map([...nativeTriggers, ...runtimeTriggers, ...optionalCreedTriggers]);
const runtimeValues = definitions(fs.readFileSync(combatValueFile, "utf8"), "wyvern combat values");
const values = new Map([...nativeValues, ...runtimeValues]);
const armyEffects = definitions(fs.readFileSync(armyEffectFile, "utf8"), "wyvern army effects");
const aiEffects = definitions(fs.readFileSync(aiEffectFile, "utf8"), "wyvern AI effects");
const effects = new Map([...nativeEffects, ...nativeRefreshEffects, ...armyEffects, ...aiEffects]);
const interaction = definitionFromText(fs.readFileSync(interactionFile, "utf8"),
  "myv_set_wyvern_war_mount_interaction", "war-mount interaction");

function makeCharacter(id, options = {}) {
  return {
    kind: "character",
    id,
    age: options.age === undefined ? 30 : options.age,
    alive: options.alive !== false,
    adult: options.adult !== false,
    ai: options.ai !== false,
    imprisoned: options.imprisoned === true,
    incapable: options.incapable === true,
    hostage: options.hostage === true,
    traits: new Set(options.traits || []),
    flags: new Set(options.flags || []),
    modifiers: new Set(options.modifiers || []),
    variables: new Map(Object.entries(options.variables || {})),
    traitXp: new Map(Object.entries(options.traitXp || {})),
    employer: options.employer || null,
    bondedCharacter: options.bondedCharacter || null,
    currentTravelPlan: options.currentTravelPlan || null,
    involvedActivity: options.involvedActivity || null,
    knightPermitted: options.knightPermitted,
    location: options.location || { id: id + "-home" },
    capitalProvince: options.capitalProvince || null,
    knightArmy: options.knightArmy || null,
    commandingArmy: options.commandingArmy || null,
    inRange: options.inRange !== false,
    prowess: options.prowess || 0,
    valueOverrides: new Map(Object.entries(options.valueOverrides || {})),
  };
}

function hasVariable(character, name) {
  return !!character && character.variables instanceof Map && character.variables.has(name);
}

function variable(character, name) {
  return hasVariable(character, name) ? character.variables.get(name) : undefined;
}

function resolvePath(pathText, current, env, params = {}) {
  if (pathText === "prev") return env.prev;
  if (pathText.startsWith("$") && pathText.endsWith("$")) return params[pathText.slice(1, -1)];
  let target = current;
  let rest = pathText;
  if (rest.startsWith("scope:")) {
    const split = rest.slice(6).split(".");
    target = env.scopes[split.shift()];
    rest = split.join(".");
  } else if (rest.startsWith("var:")) {
    const split = rest.slice(4).split(".");
    target = variable(current, split.shift());
    rest = split.join(".");
  }
  if (rest) {
    for (const key of rest.split(".")) {
      if (target === null || target === undefined) return undefined;
      if (key === "prev") target = env.prev;
      else if (key === "location") target = target.location;
      else if (key === "knight_army") target = target.knightArmy;
      else if (key === "commanding_army") target = target.commandingArmy;
      else if (key === "capital_province") target = target.capitalProvince;
      else if (key === "employer") target = target.employer;
      else if (key === "title_province") target = target.titleProvince;
      else if (key === "is_alive") target = target.alive;
      else if (key === "is_ai") target = target.ai;
      else if (key === "adult") target = target.adult;
      else if (key === "involved_activity") target = target.involvedActivity;
      else if (key === "current_travel_plan") target = target.currentTravelPlan;
      else if (target.variables instanceof Map && target.variables.has(key)) target = target.variables.get(key);
      else if (Object.prototype.hasOwnProperty.call(target, key)) target = target[key];
      else if (target.valueOverrides instanceof Map && target.valueOverrides.has(key)) target = target.valueOverrides.get(key);
      else if (values.has(key) && target.kind === "character") target = evalValue(key, target, env, params);
      else return undefined;
    }
  }
  return target;
}

function atom(value, current, env, params = {}) {
  if (Array.isArray(value)) return value;
  if (value === "yes") return true;
  if (value === "no") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("$") && value.endsWith("$")) return params[value.slice(1, -1)];
  if (value === "root" || value === "this") return current;
  if (value === "prev") return env.prev;
  if (value.startsWith("scope:") || value.startsWith("var:")) return resolvePath(value, current, env, params);
  if (["employer", "location", "knight_army", "commanding_army", "capital_province"].includes(value)) {
    return resolvePath(value, current, env, params);
  }
  if (values.has(value)) return evalValue(value, current, env, params);
  return value;
}

function same(left, right) {
  return left === right || (left && right && left.id && right.id && left.id === right.id);
}

function compare(left, operator, right) {
  if (["=", "==", "?="].includes(operator)) return same(left, right);
  if (operator === "!=") return !same(left, right);
  if (operator === ">") return Number(left) > Number(right);
  if (operator === ">=") return Number(left) >= Number(right);
  if (operator === "<") return Number(left) < Number(right);
  if (operator === "<=") return Number(left) <= Number(right);
  return false;
}

function evaluateTriggerBlock(block, current, env, params = {}) {
  for (let index = 0; index < (block || []).length; index += 1) {
    const node = block[index];
    if (node.key === "trigger_if") {
      const branches = [node];
      let nextIndex = index + 1;
      while (nextIndex < block.length && block[nextIndex].key === "trigger_else") {
        branches.push(block[nextIndex++]);
      }
      const limit = first(node.value, "limit");
      if (limit && evaluateTriggerBlock(limit.value, current, env, params)) {
        if (!evaluateTriggerBlock(node.value.filter(child => child.key !== "limit"), current, env, params)) return false;
      } else if (branches.length > 1 && !evaluateTriggerBlock(branches[1].value, current, env, params)) return false;
      index = nextIndex - 1;
      continue;
    }
    if (node.key === "trigger_else") continue;
    if (!evaluateTriggerNode(node, current, env, params)) return false;
  }
  return true;
}

function evaluateTriggerNode(node, current, env, params = {}) {
  const { key, operator, value: operand } = node;
  if (key === "AND" || key === "OR" || key === "NOR") {
    if (key === "AND") return evaluateTriggerBlock(operand, current, env, params);
    const results = operand.map(child => evaluateTriggerNode(child, current, env, params));
    return key === "OR" ? results.some(Boolean) : !results.some(Boolean);
  }
  if (key === "NOT") return !evaluateTriggerBlock(operand, current, env, params);
  if (key === "exists") return resolvePath(operand, current, env, params) !== undefined
    && resolvePath(operand, current, env, params) !== null;
  if (key === "trigger_if") {
    const limit = first(operand, "limit");
    return !limit || !evaluateTriggerBlock(limit.value, current, env, params)
      || evaluateTriggerBlock(operand.filter(child => child.key !== "limit"), current, env, params);
  }
  if (key === "trigger_else") return true;
  if (triggers.has(key)) {
    const passed = evaluateTriggerBlock(triggers.get(key), current, env,
      Array.isArray(operand) ? bindParameters(operand, current, env, params) : {});
    return operand === "no" ? !passed : passed;
  }
  if (key.startsWith("scope:") || key.startsWith("var:") || key.startsWith("$")) {
    const target = resolvePath(key, current, env, params);
    if (Array.isArray(operand)) return target !== undefined
      && evaluateTriggerBlock(operand, target, { ...env, prev: current }, params);
    return compare(target, operator, atom(operand, current, env, params));
  }
  if (key === "has_trait") return !!current && current.traits.has(operand);
  if (key === "has_character_flag") return !!current && current.flags.has(operand);
  if (key === "has_character_modifier") return !!current && current.modifiers.has(operand);
  if (key === "has_variable") {
    if (Array.isArray(operand)) return all(operand, "name").some(entry => hasVariable(current, entry.value));
    return hasVariable(current, operand);
  }
  if (key === "is_alive") return compare(current && current.alive, operator, atom(operand, current, env, params));
  if (key === "is_ai") return compare(current && current.ai, operator, atom(operand, current, env, params));
  if (key === "adult") return compare(current && current.adult, operator, atom(operand, current, env, params));
  if (key === "imprisoned" || key === "is_imprisoned") return compare(current && current.imprisoned, operator, atom(operand, current, env, params));
  if (key === "incapable" || key === "is_incapable") return compare(current && current.incapable, operator, atom(operand, current, env, params));
  if (key === "hostage") return compare(current && current.hostage, operator, atom(operand, current, env, params));
  if (key === "is_available_quick") {
    const checks = operand.map(entry => evaluateTriggerNode(entry, current, env, params));
    return checks.every(Boolean) && current.alive && !current.imprisoned && !current.incapable && !current.hostage;
  }
  if (key === "always") return atom(operand, current, env, params) === true;
  if (key === "is_knight_permitted") {
    const owner = atom(operand, current, env, params);
    return !!owner && owner.knightPermitted !== false;
  }
  if (key === "has_relation_myv_wyvern_bonded_character") return !!current && same(current.bondedCharacter, atom(operand, current, env, params));
  if (key === "is_commanding_army") return !!current && !!current.commandingArmy;
  if (key === "in_diplomatic_range") return !!current && current.inRange !== false;
  if (key === "has_trait_xp") {
    const trait = required(operand, "trait", "has_trait_xp");
    const valueNode = first(operand, "value");
    const trackNode = first(operand, "track");
    const actual = current && current.traitXp.get(trackNode ? trackNode.value : trait) || 0;
    return valueNode ? compare(actual, valueNode.operator, Number(valueNode.value)) : actual > 0;
  }
  const actual = key === "prowess" ? current && current.prowess
    : key === "employer" ? current && current.employer
      : key === "location" ? current && current.location
        : key === "knight_army" ? current && current.knightArmy
          : key === "myv_wyvern_malnutrition_progress" ? evalValue(key, current, env, params)
            : current && current[key];
  return compare(actual, operator, atom(operand, current, env, params));
}

function bindParameters(block, current, env, parent = {}) {
  const params = {};
  for (const node of block || []) params[node.key] = atom(node.value, current, env, parent);
  return params;
}

function runTrigger(name, current, env, params = {}) {
  const body = triggers.get(name);
  assert.ok(body, "missing parsed scripted trigger " + name);
  return evaluateTriggerBlock(body, current, env, params);
}

function applyValueOperations(block, initialValue, initialized, current, env, params = {}) {
  let result = initialValue;
  let hasValue = initialized;
  for (let index = 0; index < (block || []).length; index += 1) {
    const node = block[index];
    if (node.key === "if") {
      const branches = [node];
      let nextIndex = index + 1;
      while (nextIndex < block.length && ["else_if", "else"].includes(block[nextIndex].key)) {
        branches.push(block[nextIndex++]);
      }
      for (const branch of branches) {
        const limit = first(branch.value, "limit");
        if (branch.key !== "else" && limit && !evaluateTriggerBlock(limit.value, current, env, params)) continue;
        const applied = applyValueOperations(branch.value.filter(child => child.key !== "limit"),
          result, hasValue, current, env, params);
        result = applied.result;
        hasValue = applied.initialized;
        break;
      }
      index = nextIndex - 1;
      continue;
    }
    if (node.key === "value") {
      result = Array.isArray(node.value)
        ? evalInlineValue(node.value, current, env, params)
        : resolveValueAtom(node.value, current, env, params);
      hasValue = true;
    } else if (["add", "subtract", "multiply", "divide"].includes(node.key)) {
      const operand = Array.isArray(node.value)
        ? evalInlineValue(node.value, current, env, params)
        : resolveValueAtom(node.value, current, env, params);
      if (!hasValue) {
        result = 0;
        hasValue = true;
      }
      if (node.key === "add") result += operand;
      else if (node.key === "subtract") result -= operand;
      else if (node.key === "multiply") result *= operand;
      else if (node.key === "divide") result /= operand;
    } else if (node.key === "round" && node.value === "yes") result = Math.round(result);
    else if (node.key === "ceiling" && node.value === "yes") result = Math.ceil(result);
    else if (node.key === "min") result = Math.max(result, resolveValueAtom(node.value, current, env, params));
    else if (node.key === "max") result = Math.min(result, resolveValueAtom(node.value, current, env, params));
  }
  return { result, initialized: hasValue };
}

function evalInlineValue(block, current, env, params = {}) {
  return applyValueOperations(block, 0, false, current, env, params).result;
}

function resolveValueAtom(raw, current, env, params = {}) {
  if (Array.isArray(raw)) return evalInlineValue(raw, current, env, params);
  if (raw.startsWith("scope:") || raw.startsWith("var:") || raw.startsWith("$")) {
    const result = resolvePath(raw, current, env, params);
    return typeof result === "number" ? result : Number(result || 0);
  }
  if (raw === "prowess") return Number(current && current.prowess || 0);
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return evalValue(raw, current, env, params);
}

function evalValue(name, current, env, params = {}) {
  const override = current && current.valueOverrides && current.valueOverrides.get(name);
  if (override !== undefined) return Number(override);
  const body = values.get(name);
  assert.ok(body, "missing parsed script value " + name);
  const active = env.valueStack || new Set();
  assert.ok(!active.has(name), "recursive script value " + name);
  const nextEnv = { ...env, valueStack: new Set(active).add(name) };
  return applyValueOperations(body, 0, false, current, nextEnv, params).result;
}

function makeEnvironment(options = {}) {
  return {
    scopes: { ...(options.scopes || {}) },
    effects: [],
    deaths: [],
    prev: options.prev,
  };
}

function cloneAst(value) {
  if (Array.isArray(value)) return value.map(cloneAst);
  if (value && typeof value === "object") {
    return { key: value.key, operator: value.operator, value: cloneAst(value.value) };
  }
  return value;
}

function stableAst(value) {
  if (Array.isArray(value)) return value.map(stableAst);
  if (value && typeof value === "object") {
    return [value.key, value.operator, stableAst(value.value)];
  }
  return value;
}

function containsNode(block, predicate) {
  return (block || []).some(node => predicate(node) ||
    (Array.isArray(node.value) && containsNode(node.value, predicate)));
}

function executeConditional(nodes, index, current, env, params) {
  const branches = [nodes[index]];
  let nextIndex = index + 1;
  while (nextIndex < nodes.length && ["else_if", "else"].includes(nodes[nextIndex].key)) {
    branches.push(nodes[nextIndex++]);
  }
  for (const branch of branches) {
    const limit = first(branch.value, "limit");
    if (branch.key !== "else" && limit && !evaluateTriggerBlock(limit.value, current, env, params)) continue;
    executeEffectSequence(branch.value.filter(node => node.key !== "limit"), current, env, params);
    break;
  }
  return nextIndex;
}

function executeEffectNode(node, current, env, params = {}) {
  const { key, value: operand } = node;
  if (key === "if") throw new Error("if must be dispatched by executeEffectSequence");
  if (key === "save_scope_as") {
    env.scopes[operand] = current;
    return;
  }
  if (key === "clear_saved_scope") {
    delete env.scopes[operand];
    return;
  }
  if (key === "save_scope_value_as") {
    const name = required(operand, "name", "save_scope_value_as");
    env.scopes[name] = evalInlineValue(required(operand, "value", "save_scope_value_as"), current, env, params);
    return;
  }
  if (key === "set_variable") {
    const name = required(operand, "name", "set_variable");
    const raw = first(operand, "value");
    const value = raw
      ? Array.isArray(raw.value) ? evalInlineValue(raw.value, current, env, params) : atom(raw.value, current, env, params)
      : true;
    current.variables.set(name, value);
    return;
  }
  if (key === "remove_variable") {
    current.variables.delete(operand);
    return;
  }
  if (key === "set_location") {
    current.location = atom(required(operand, "location", "set_location"), current, env, params);
    return;
  }
  if (key === "add_character_flag") {
    current.flags.add(operand);
    return;
  }
  if (key === "remove_character_flag") {
    current.flags.delete(operand);
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
  if (key === "add_character_modifier") {
    current.modifiers.add(operand);
    return;
  }
  if (key === "remove_character_modifier") {
    current.modifiers.delete(operand);
    return;
  }
  if (key === "death") {
    env.deaths.push(atom(required(operand, "death_reason", "death"), current, env, params));
    return;
  }
  if ([
    "fire_specific_court_position_effect",
    "myv_refresh_war_mount_combat_stats_effect",
    "myv_sync_wyvern_malnutrition_trait_effect",
    "myv_wyvern_refresh_hunger_state_effect",
  ].includes(key)) {
    env.effects.push(key);
    return;
  }
  if (effects.has(key)) {
    const callParams = Array.isArray(operand) ? bindParameters(operand, current, env, params) : {};
    executeEffectSequence(effects.get(key), current, env, callParams);
    return;
  }
  if ((key.startsWith("scope:") || key.startsWith("var:") || key.startsWith("$")) && Array.isArray(operand)) {
    const target = resolvePath(key, current, env, params);
    if (target) executeEffectSequence(operand, target, { ...env, prev: current }, params);
    return;
  }
  if (Array.isArray(operand)) {
    const target = resolvePath(key, current, env, params);
    if (target) executeEffectSequence(operand, target, { ...env, prev: current }, params);
    return;
  }
  throw new Error("finite PDX executor does not support effect " + key);
}

function executeEffectSequence(nodes, current, env, params = {}) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.key === "if") index = executeConditional(nodes, index, current, env, params) - 1;
    else executeEffectNode(node, current, env, params);
  }
}

function executeEffect(name, current, env, params = {}) {
  const body = effects.get(name);
  assert.ok(body, "missing parsed scripted effect " + name);
  executeEffectSequence(body, current, env, params);
}

function hasTraitBlockFlag(block, flag) {
  return all(block, "flag").some(node => node.value === flag);
}

function normalizeMaintenanceBody(body) {
  const normalized = cloneAst(body);
  const candidates = [];
  function visit(nodes) {
    for (const node of nodes || []) {
      if (node.key === "if") {
        const limit = first(node.value, "limit");
        if (limit && containsNode(limit.value,
          child => child.key === "has_variable" && child.value === "myv_wyvern_lair_barony")) {
          candidates.push(limit.value);
        }
      }
      if (Array.isArray(node.value)) visit(node.value);
    }
  }
  visit(normalized);
  assert.equal(candidates.length, 1, "maintenance has exactly one lair home-return guard");
  const guardLimit = candidates[0];
  const negated = first(guardLimit, "NOT");
  assert.ok(negated, "home-return guard must contain a single deployment suppression");
  negated.value = [{ key: "GUARD", operator: "=", value: "deployment-suppressed" }];
  return normalized;
}

function findHomeReturnGuard(body) {
  const found = [];
  function visit(nodes) {
    for (const node of nodes || []) {
      if (node.key === "if") {
        const limit = first(node.value, "limit");
        if (limit &&
            containsNode(limit.value, child => child.key === "has_variable" && child.value === "myv_wyvern_lair_barony") &&
            containsNode(limit.value, child => child.key === "myv_is_wyvern_deployed_with_army")) {
          found.push(node);
        }
      }
      if (Array.isArray(node.value)) visit(node.value);
    }
  }
  visit(body);
  assert.equal(found.length, 1, "maintenance home-return branch skips independent army deployment");
  return found[0];
}

function assertNoStableLedgerWrites(block) {
  const ledger = new Set([
    "myv_wyvern_stable_county",
    "myv_wyvern_stable_payer",
    "myv_wyvern_stable_satiety_debt",
  ]);
  function visit(nodes) {
    for (const node of nodes || []) {
      if (node.key === "set_variable" || node.key === "change_variable") {
        const name = first(node.value, "name");
        assert.ok(!name || !ledger.has(name.value), "combat deployment must not write stable ledger " + (name && name.value));
      }
      if (Array.isArray(node.value)) visit(node.value);
    }
  }
  visit(block);
}

function locateAiTargetFilter(effectBody) {
  let randomList;
  function visit(nodes) {
    for (const node of nodes || []) {
      if (node.key === "random") {
        randomList = node;
        return;
      }
      if (Array.isArray(node.value)) visit(node.value);
      if (randomList) return;
    }
  }
  visit(effectBody);
  assert.ok(randomList, "AI attempt still uses its original quarterly random roll");
  const list = first(randomList.value, "random_in_global_list");
  assert.ok(list, "AI still selects from the native living-wyvern list");
  return required(list.value, "limit", "AI living-wyvern target filter");
}

function normalizeAiAttempt(body) {
  const normalized = cloneAst(body);
  const limit = locateAiTargetFilter(normalized);
  const gates = limit.filter(node => node.key === "OR" &&
    containsNode(node.value, child => child.key === "scope:myv_wyvern_ai_slay_hunter") &&
    containsNode(node.value, child => child.key === "prowess"));
  assert.equal(gates.length, 1, "AI candidate limit adds exactly one prowess-threshold gate");
  limit.splice(limit.indexOf(gates[0]), 1);
  return stableAst(normalized);
}

const originalAiAttempt = definitionFromText(fixture.nativeAiAttempt,
  "myv_wyvern_ai_attempt_slay_effect", "frozen original AI hunt attempt");
const activeAiAttempt = aiEffects.get("myv_wyvern_ai_attempt_slay_effect");
assert.ok(activeAiAttempt, "active AI attempt effect exists");
assert.deepEqual(normalizeAiAttempt(activeAiAttempt), stableAst(originalAiAttempt),
  "AI candidate gate preserves the original attempt chance, candidate pool, range and event flow");
const aiFilter = locateAiTargetFilter(activeAiAttempt);
const hunterGate = first(aiFilter, "OR");
assert.ok(hunterGate, "AI candidates require one legendary-aware hunter threshold");
const aiNormalArm = first(hunterGate.value, "scope:myv_wyvern_ai_slay_hunter");
assert.ok(aiNormalArm, "AI filter includes the shared prowess-61 branch");
assert.equal(first(aiNormalArm.value, "prowess")?.operator, ">", "AI threshold is strict greater-than 60");
const aiLegendArm = first(hunterGate.value, "AND");
assert.ok(aiLegendArm, "AI filter distinguishes ordinary from legendary prey");
assert.ok(all(aiLegendArm.value, "mm_wyvern_is_legendary_blood").some(node => node.value === "no"),
  "the >30 route excludes legendary blood");
const legendaryHunterPath = first(aiLegendArm.value, "scope:myv_wyvern_ai_slay_hunter");
assert.equal(first(legendaryHunterPath.value, "prowess")?.operator, ">", "ordinary AI threshold is strict greater-than 30");

function aiCanSelect(hunterProwess, legendary) {
  const hunter = makeCharacter("ai-hunter-" + hunterProwess + "-" + legendary, { prowess: hunterProwess });
  const prey = makeCharacter("wild-prey-" + hunterProwess + "-" + legendary,
    { traits: legendary ? ["myv_wyvern_legendary"] : ["myv_wyvern"], prowess: 100 });
  return evaluateTriggerBlock(aiFilter, prey, makeEnvironment({
    scopes: { myv_wyvern_ai_slay_hunter: hunter },
  }));
}
assert.equal(aiCanSelect(30, false), false, "AI cannot randomly select an ordinary wyvern below the >30 finish threshold");
assert.equal(aiCanSelect(31, false), true, "AI may select an ordinary wyvern at 31 prowess");
assert.equal(aiCanSelect(60, true), false, "AI cannot randomly select legendary blood at 60 prowess");
assert.equal(aiCanSelect(61, true), true, "AI may select legendary blood at 61 prowess");

function fixedStrike(hunterProwess, dragon) {
  const hunter = makeCharacter("strike-" + hunterProwess + "-" + dragon.id, { prowess: hunterProwess });
  const env = makeEnvironment({ scopes: { myv_slay_wyvern_target: dragon } });
  return {
    eligible: runTrigger("mm_wyvern_hunter_can_finish", hunter, env),
    chance: evalValue("myv_slay_final_strike_chance", hunter, env),
  };
}
const normalSatiated = makeWyvern("normal-satiated-strike", 100);
const legendSatiated = makeWyvern("legend-satiated-strike", 100, {
  traits: ["mm_wyvern_legendary_origin"],
  basePower: 150,
});
assert.deepEqual(fixedStrike(30, normalSatiated), { eligible: false, chance: 0 },
  "30 prowess is blocked before the final normal-wyvern strike roll");
assert.deepEqual(fixedStrike(31, normalSatiated), { eligible: true, chance: 20 },
  "31 prowess passes the normal threshold and retains injury risk");
assert.deepEqual(fixedStrike(60, legendSatiated), { eligible: false, chance: 0 },
  "60 prowess is blocked before the final legendary strike roll");
assert.deepEqual(fixedStrike(61, legendSatiated), { eligible: true, chance: 20 },
  "61 prowess passes the legendary threshold without guaranteeing a kill");
const normalHungryStrike = makeWyvern("normal-hungry-strike", 0);
const legendHungryStrike = makeWyvern("legend-hungry-strike", 0, {
  traits: ["mm_wyvern_legendary_origin"],
  basePower: 150,
});
assert.equal(runValue("myv_wyvern_target_prowess", normalHungryStrike), 25);
assert.equal(runValue("myv_wyvern_target_prowess", legendHungryStrike), 75,
  "severely hungry legendary blood retains its higher 50-percent coefficient");
assert.deepEqual(fixedStrike(31, normalHungryStrike), { eligible: true, chance: 55 },
  "a very hungry ordinary wyvern reaches a 55-percent final strike chance at 31 prowess");
assert.deepEqual(fixedStrike(61, legendHungryStrike), { eligible: true, chance: 45 },
  "the target's very hungry 75-power body still has a 45-percent roll at 61 prowess");

function numeric(block, key, label) {
  const result = required(block, key, label);
  assert.equal(typeof result, "string", label + " expected scalar " + key);
  return Number(result);
}

function nestedPdxBody(name, source, label) {
  return definitionFromText(name + " = {\n" + source + "\n}", name, label);
}

function treeCount(block, predicate) {
  let count = 0;
  function visit(nodes) {
    for (const node of nodes || []) {
      if (predicate(node)) count += 1;
      if (Array.isArray(node.value)) visit(node.value);
    }
  }
  visit(block);
  return count;
}

function normalizeTargetPipeline(block, isRuntime) {
  const normalized = cloneAst(block);
  const list = normalized;
  if (!isRuntime) {
    const oldHunger = list.findIndex(node => node.key === "if" && first(node.value, "limit") &&
      containsNode(first(node.value, "limit").value,
        child => child.key === "has_character_modifier" && child.value === "myv_wyvern_hungry"));
    assert.ok(oldHunger >= 0, "frozen native target keeps its old hungry modifier");
    list.splice(oldHunger, 1);
  } else {
    const hunger = list.findIndex(node => node.key === "multiply" && node.value === "mm_wyvern_hunger_power_multiplier");
    assert.ok(hunger >= 0, "runtime target pipeline has the new hunger multiplier point");
    const cap = list.findIndex((node, index) => index < hunger && node.key === "max" && node.value === "150");
    assert.ok(cap >= 0, "runtime caps pre-hunger power before the reduction multiplier");
    list.splice(hunger, 1);
    list.splice(cap, 1);
  }
  return stableAst(list);
}

function runValue(name, current) {
  return evalValue(name, current, makeEnvironment());
}

function makeWyvern(id, hunger, options = {}) {
  const traits = ["myv_wyvern_tamed", ...(options.traits || [])];
  const flags = options.flags || [];
  const variables = { myv_wyvern_hunger: hunger, ...(options.variables || {}) };
  return makeCharacter(id, {
    traits,
    flags,
    variables,
    modifiers: options.modifiers || [],
    traitXp: options.traitXp || {},
    adult: options.adult,
    age: options.age,
    alive: options.alive,
    employer: options.employer,
    bondedCharacter: options.bondedCharacter,
    knightArmy: options.knightArmy,
    commandingArmy: options.commandingArmy,
    currentTravelPlan: options.currentTravelPlan,
    valueOverrides: { myv_wyvern_size_prowess: options.basePower === undefined ? 100 : options.basePower,
      myv_wyvern_agility: options.agility === undefined ? 60 : options.agility },
  });
}

function expectedOriginValues() {
  return {
    myv_wyvern: 4,
    myv_wyvern_tamed: 3,
    myv_wyvern_legendary: 5,
  };
}

assert.equal(typeof fixture.nativeTargetPower, "string", "native snapshot includes target power");
assert.equal(typeof fixture.nativeMaintenance, "string", "native snapshot includes maintenance");
assert.equal(typeof fixture.humanKnightBody, "string", "native snapshot includes human knight body");
assert.equal(typeof fixture.mountedDeploymentBody, "string", "native snapshot includes mounted deployment body");
assert.equal(typeof fixture.nativeAiAttempt, "string", "native snapshot includes original AI attempt");

const activeTarget = values.get("myv_wyvern_target_prowess");
const frozenTarget = definitionFromText(fixture.nativeTargetPower, "myv_wyvern_target_prowess", "frozen native target value");
assert.ok(activeTarget, "active canonical target value exists");
assert.deepEqual(normalizeTargetPipeline(activeTarget, true), normalizeTargetPipeline(frozenTarget, false),
  "target power keeps every native physique, temperament, injury, rage and nutrition operation around the replaced hunger stage");
const runtimeHungerIndex = activeTarget.findIndex(node =>
  node.key === "multiply" && node.value === "mm_wyvern_hunger_power_multiplier");
const preHungerCaps = activeTarget.filter((node, index) =>
  index < runtimeHungerIndex && node.key === "max" && node.value === "150");
const postHungerCaps = activeTarget.filter((node, index) =>
  index > runtimeHungerIndex && node.key === "max" && node.value === "150");
assert.equal(preHungerCaps.length, 1, "fully composed dragon power is capped at 150 before hunger");
assert.equal(postHungerCaps.length, 1, "final displayed dragon power remains capped at 150");
assert.equal(activeTarget.filter(node => node.key === "multiply" && node.value === "mm_wyvern_hunger_power_multiplier").length, 1,
  "hunger reduction is applied exactly once");

const speciesTraits = readDefinitions(
  path.join(captureRoot, "common", "traits", "zzzzz_mm_wyvern_species_health.txt"),
  "active dragon species traits");
for (const [name, health] of Object.entries(expectedOriginValues())) {
  const trait = speciesTraits.get(name);
  assert.ok(trait, "active species health override contains " + name);
  if (name === "myv_wyvern_legendary") {
    assert.equal(required(trait, "immortal", name), "yes", name + " retains royal immortality");
    assert.equal(required(trait, "no_prowess_loss_from_age", name), "yes", name + " does not lose prowess from age");
    assert.equal(numeric(trait, "life_expectancy", name), 666, name + " has the royal-only lifespan sentinel");
    assert.equal(numeric(trait, "elderly_health", name), 666, name + " has the royal-only elderly health sentinel");
    for (const flag of ["is_immortal", "immortal_visuals", "immortal_incapability", "immune_to_disease"]) {
      assert.ok(hasTraitBlockFlag(trait, flag), name + " retains " + flag);
    }
  } else {
    assert.equal(numeric(trait, "life_expectancy", name), 200, name + " has an exact 200-year lifespan");
    assert.equal(first(trait, "immortal"), undefined, name + " is not immortal");
    assert.equal(first(trait, "no_prowess_loss_from_age"), undefined, name + " loses prowess with age");
    assert.notEqual(Number(first(trait, "elderly_health")?.value), 666, name + " lacks the immortality sentinel");
    for (const flag of ["is_immortal", "immortal_visuals", "immortal_incapability"]) {
      assert.ok(!hasTraitBlockFlag(trait, flag), name + " does not carry " + flag);
    }
    assert.ok(hasTraitBlockFlag(trait, "immune_to_disease"), name + " retains its original disease immunity");
  }
  assert.equal(numeric(trait, "health", name), health, name + " keeps its original health value");
  assert.equal(numeric(trait, "epidemic_resistance", name), 100, name + " has +100 epidemic resistance");
}
const originSource = fs.readFileSync(path.join(captureRoot, "common", "traits", "zzzz_mm_wyvern_capture_traits.txt"), "utf8");
const originTrait = definitionFromText(originSource, "mm_wyvern_legendary_origin", "legendary origin trait");
assert.equal(numeric(originTrait, "health", "legendary origin"), 2);
assert.equal(first(originTrait, "life_expectancy"), undefined, "origin no longer adds a lifespan modifier");
const nutritionFallbackBlock = nativeEffects.get("myv_change_wyvern_food_reserve_effect");
assert.ok(nutritionFallbackBlock, "native food reserve effect is parsed from the source or frozen fallback");
const starvationDeathCount = treeCount(nutritionFallbackBlock, node =>
  node.key === "death" && first(node.value, "death_reason")?.value === "death_myv_wyvern_starvation");
assert.equal(starvationDeathCount, 1, "nutrition still invokes explicit scripted starvation death once");
const nativeSlayFile = path.join(nativeRoot, "common", "scripted_effects", "myv_wyvern_ai_slay_effects.txt");
const nativeSlaySource = fs.existsSync(nativeSlayFile)
  ? fs.readFileSync(nativeSlayFile, "utf8")
  : "death = { death_reason = death_myv_wyvern_slain killer = root } death = { death_reason = death_myv_killed_by_wyvern killer = scope:myv_slay_wyvern_target }";
assert.match(nativeSlaySource, /death_reason\s*=\s*death_myv_wyvern_slain/,
  "agelessness does not remove the original scripted slaying death");
assert.match(nativeSlaySource, /death_reason\s*=\s*death_myv_killed_by_wyvern/,
  "agelessness does not remove the original scripted combat death");

const normalHunger = [
  [9, 0.25],
  [10, 0.5],
  [19, 0.5],
  [20, 0.7],
  [29, 0.7],
  [30, 0.9],
  [49, 0.9],
  [50, 1],
];
for (const [hunger, expected] of normalHunger) {
  const dragon = makeWyvern("normal-hunger-" + hunger, hunger);
  assert.equal(runValue("mm_wyvern_hunger_power_multiplier", dragon), expected,
    "normal hunger boundary " + hunger + " applies exact coefficient");
  assert.equal(runValue("myv_wyvern_target_prowess", dragon), Math.round(100 * expected),
    "normal target power executes the parsed hunger coefficient at " + hunger);
}
for (const form of [
  { name: "original-legendary", trait: "myv_wyvern_legendary" },
  { name: "tamed-origin-trait", trait: "mm_wyvern_legendary_origin" },
  { name: "tamed-origin-flag", flag: true },
]) {
  for (const [hunger, expected] of [[9, 0.5], [10, 0.6], [19, 0.6], [20, 0.8], [29, 0.8], [30, 0.95], [49, 0.95], [50, 1]]) {
    const options = form.trait ? { traits: [form.trait] } : { flags: ["mm_wyvern_legendary_origin"] };
    const dragon = form.name === "original-legendary"
      ? makeCharacter(form.name + "-" + hunger, {
        traits: ["myv_wyvern_legendary"],
        variables: { myv_wyvern_hunger: hunger },
        valueOverrides: { myv_wyvern_size_prowess: 100, myv_wyvern_agility: 60 },
      })
      : makeWyvern(form.name + "-" + hunger, hunger, options);
    assert.equal(runValue("mm_wyvern_hunger_power_multiplier", dragon), expected,
      form.name + " legendary boundary " + hunger + " stays consistent");
    assert.equal(runValue("myv_wyvern_target_prowess", dragon), Math.round(100 * expected),
      form.name + " canonical target uses legendary coefficient after taming");
  }
}

for (const [progress, expectedMultiplier] of [[0, 1], [19, 1], [20, 0.9], [40, 0.8], [60, 0.7], [80, 0.6], [100, 0.5]]) {
  const dragon = makeWyvern("nutrition-" + progress, 100, { variables: { myv_wyvern_malnutrition: progress } });
  assert.equal(runValue("myv_wyvern_malnutrition_prowess_multiplier", dragon), expectedMultiplier,
    "native nutrition tier " + progress + " evaluates to the frozen linear multiplier");
}
const malnourished = makeWyvern("nutrition-combined", 100, { variables: { myv_wyvern_malnutrition: 20 } });
assert.equal(runValue("myv_wyvern_target_prowess", malnourished), 90,
  "malnutrition remains separate from the full-satiety hunger tier");

const weakDocile = makeWyvern("weak-docile", 100, { traits: ["myv_wyvern_physique_weak", "myv_wyvern_temperament_docile"] });
const powerfulFierce = makeWyvern("powerful-fierce", 100, { traits: ["myv_wyvern_physique_powerful", "myv_wyvern_temperament_fierce"] });
const wingInjury = makeWyvern("wing-injury", 100, { traitXp: { myv_wyvern_wound_left_wing: 100 } });
const hindlegInjury = makeWyvern("hindleg-injury", 100, { traitXp: { myv_wyvern_wound_left_hindleg: 100 } });
const tailInjury = makeWyvern("tail-injury", 100, { traitXp: { myv_wyvern_tail_injury: 100 } });
const enraged = makeWyvern("enraged", 100, { modifiers: ["myv_wyvern_enraged"] });
assert.equal(runValue("myv_wyvern_target_prowess", weakDocile), 81, "weak physique and docile temperament both reduce real target power");
assert.equal(runValue("myv_wyvern_target_prowess", powerfulFierce), 121, "powerful physique and fierce temperament both increase real target power");
assert.equal(runValue("myv_wyvern_target_prowess", wingInjury), 75, "severe wing injury reduces target power");
assert.equal(runValue("myv_wyvern_target_prowess", hindlegInjury), 75, "severe hindleg injury reduces target power");
assert.equal(runValue("myv_wyvern_target_prowess", tailInjury), 90, "severe tail injury reduces target power");
assert.equal(runValue("myv_wyvern_target_prowess", enraged), 110, "enraged boost is applied before the cap and hunger");
const extremeNormal = makeWyvern("extreme-hungry-normal", 0, {
  traits: ["myv_wyvern_physique_powerful", "myv_wyvern_temperament_fierce"],
  modifiers: ["myv_wyvern_enraged"],
  basePower: 150,
});
const extremeLegend = makeWyvern("extreme-hungry-legend", 0, {
  traits: ["mm_wyvern_legendary_origin", "myv_wyvern_physique_powerful", "myv_wyvern_temperament_fierce"],
  modifiers: ["myv_wyvern_enraged"],
  basePower: 150,
});
assert.equal(runValue("myv_wyvern_target_prowess", extremeNormal), 38,
  "maximal healthy normal build is capped before hunger and cannot exceed 38 after rounding at 25 percent");
assert.equal(runValue("myv_wyvern_target_prowess", extremeLegend), 75,
  "maximal healthy legendary build is capped before hunger and cannot exceed 75 at 50 percent");
assert.equal(runValue("myv_wyvern_target_prowess", makeWyvern("hard-cap", 100, { basePower: 200 })), 150,
  "full-strength canonical target retains the existing 150 cap");

function feedWyvern(id, hunger, malnutrition, amount) {
  const dragon = makeWyvern(id, hunger, {
    variables: { myv_wyvern_malnutrition: malnutrition },
  });
  const env = makeEnvironment();
  executeEffect("myv_change_wyvern_food_reserve_effect", dragon, env, { AMOUNT: amount });
  return { dragon, env };
}
const fedAcrossSevereBoundary = feedWyvern("fed-to-29", 9, 0, 20);
assert.equal(variable(fedAcrossSevereBoundary.dragon, "myv_wyvern_hunger"), 29,
  "the parsed native feed effect increases the actual food reserve");
assert.equal(variable(fedAcrossSevereBoundary.dragon, "myv_wyvern_malnutrition"), 0);
assert.equal(runValue("myv_wyvern_target_prowess", fedAcrossSevereBoundary.dragon), 70,
  "feeding clears the below-10 penalty and returns to the native 10-29 hunger band");
assert.ok(fedAcrossSevereBoundary.env.effects.includes("myv_sync_wyvern_malnutrition_trait_effect"));
assert.ok(fedAcrossSevereBoundary.env.effects.includes("myv_wyvern_refresh_hunger_state_effect"),
  "feeding triggers the native hunger refresh after changing the reserve");
const fedTo30 = feedWyvern("fed-to-30", 10, 0, 20);
assert.equal(variable(fedTo30.dragon, "myv_wyvern_hunger"), 30);
assert.equal(runValue("myv_wyvern_target_prowess", fedTo30.dragon), 90,
  "feeding across 30 reaches the 90-percent tier");
const recoveringMalnutrition = feedWyvern("partial-nutrition-recovery", 0, 100, 20);
assert.equal(variable(recoveringMalnutrition.dragon, "myv_wyvern_malnutrition"), 80,
  "feeding cancels twenty points of existing malnutrition first");
assert.deepEqual(recoveringMalnutrition.env.deaths, [],
  "partial starvation recovery does not trigger death");
const starvation = feedWyvern("starvation-boundary", 0, 100, 0);
assert.deepEqual(starvation.env.deaths, ["death_myv_wyvern_starvation"],
  "explicit starvation death remains reachable for an ordinary finite-lived dragon");
assert.equal(treeCount(nativeEffects.get("myv_change_wyvern_food_reserve_effect"), node =>
  node.key === "death" && first(node.value, "death_reason")?.value === "death_myv_wyvern_starvation"), 1);

const hungerRefresh = nativeRefreshEffects.get("myv_wyvern_refresh_hunger_state_effect");
const prowessRefresh = nativeRefreshEffects.get("myv_refresh_wyvern_prowess_effect");
const mountRefresh = nativeRefreshEffects.get("myv_refresh_war_mount_combat_stats_effect");
assert.ok(treeCount(hungerRefresh, node => node.key === "myv_refresh_wyvern_prowess_effect") > 0,
  "hunger refresh recalculates canonical dragon Prowess");
assert.ok(treeCount(prowessRefresh, node => node.key === "myv_refresh_war_mount_combat_stats_effect") > 0,
  "dragon Prowess refresh propagates to its rider");
assert.ok(treeCount(mountRefresh, node => node.key === "set_variable" &&
  first(node.value, "name")?.value === "myv_pending_war_mount_modifier_tier" &&
  first(node.value, "value")?.value === "myv_war_mount_harmony_power") > 0,
  "rider refresh stores the canonical Harmony contribution value");
assert.equal(treeCount(nativeValues.get("myv_war_mount_harmony_power"), node =>
  node.key === "value" && node.value === "var:myv_war_mount.myv_wyvern_target_prowess"), 1,
  "the rider Harmony value reads the mounted dragon's canonical target power exactly once");
const rider = makeCharacter("canonical-rider", {
  traits: ["myv_wyvern_rider"],
  variables: {},
});
const mount = makeWyvern("canonical-mount", 100, { traits: ["myv_wyvern_harmony"] });
mount.variables.set("myv_war_mount_rider", rider);
rider.variables.set("myv_war_mount", mount);
const canonicalPowers = [];
for (const harmony of [0, 25, 50, 75, 100]) {
  mount.traitXp.set("myv_wyvern_harmony", harmony);
  canonicalPowers.push(evalValue("myv_war_mount_harmony_power", rider,
    makeEnvironment({ scopes: { myv_war_mount_bonus_rider: rider } })));
}
assert.deepEqual(canonicalPowers, [60, 70, 80, 90, 100],
  "Harmony levels 1-5 scale the exact canonical dragon target by 60-100 percent");
mount.variables.set("myv_wyvern_hunger", 9);
mount.traitXp.set("myv_wyvern_harmony", 75);
assert.equal(runValue("myv_wyvern_target_prowess", mount), 25);
assert.equal(evalValue("myv_war_mount_harmony_power", rider,
  makeEnvironment({ scopes: { myv_war_mount_bonus_rider: rider } })), 23,
  "the same hunger-adjusted canonical target flows into the rider's 90-percent Harmony contribution");

function candidateDragon(id, overrides = {}) {
  const owner = overrides.owner || makeCharacter(id + "-liege");
  const dragon = makeWyvern(id, 100, {
    traits: overrides.traits || [],
    flags: overrides.flags || [],
    adult: overrides.adult,
    alive: overrides.alive,
    modifiers: overrides.modifiers || [],
    currentTravelPlan: overrides.currentTravelPlan,
    employer: overrides.employer === undefined ? owner : overrides.employer,
    knightArmy: overrides.knightArmy,
    variables: overrides.variables || {},
  });
  if (overrides.bonded !== false) dragon.variables.set("myv_wyvern_bonded_character", owner);
  if (overrides.captor) dragon.variables.set("mm_wyvern_captor", overrides.captor);
  return { owner, dragon };
}

function canServe(dragon, owner) {
  return runTrigger("mm_wyvern_can_serve_as_knight", dragon, makeEnvironment(), { ARMY_OWNER: owner });
}

const eligible = candidateDragon("eligible-dragon");
assert.equal(canServe(eligible.dragon, eligible.owner), true,
  "an adult unassigned tamed dragon in its employer's court can serve as a knight");
assert.equal(runTrigger("can_be_knight_trigger", eligible.dragon, makeEnvironment(),
  { ARMY_OWNER: eligible.owner }), true, "the active knight-list trigger reaches the new dragon branch");
const playerOwner = makeCharacter("player-knight-owner", { ai: false, knightPermitted: true });
const playerEligible = candidateDragon("player-permitted-dragon", { owner: playerOwner });
assert.equal(canServe(playerEligible.dragon, playerOwner), true, "player knight permissions are honored");
const playerForbidden = makeCharacter("player-forbidden-owner", { ai: false, knightPermitted: false });
const forbiddenDragon = candidateDragon("player-forbidden-dragon", { owner: playerForbidden });
assert.equal(canServe(forbiddenDragon.dragon, playerForbidden), false,
  "player knight prohibition remains effective for a tamed dragon");
const wildOwner = makeCharacter("wild-dragon-liege");
const wildDragon = makeCharacter("wild-dragon", {
  traits: ["myv_wyvern"],
  employer: wildOwner,
  variables: { myv_wyvern_bonded_character: wildOwner },
});
assert.equal(canServe(wildDragon, wildOwner), false, "wild dragons cannot join as independent knights");
const youngDragon = candidateDragon("young-dragon", { adult: false });
assert.equal(canServe(youngDragon.dragon, youngDragon.owner), false, "juvenile dragons are not eligible");
const captiveDragon = candidateDragon("captured-dragon", { captor: makeCharacter("captor") });
assert.equal(canServe(captiveDragon.dragon, captiveDragon.owner), false, "captured dragons are not eligible");
const wrongEmployer = candidateDragon("wrong-employer", { employer: makeCharacter("other-employer") });
assert.equal(canServe(wrongEmployer.dragon, wrongEmployer.owner), false, "dragon must be employed by the army owner");
const unbondedDragon = candidateDragon("unbonded-dragon", { bonded: false });
assert.equal(canServe(unbondedDragon.dragon, unbondedDragon.owner), false, "dragon needs a living bonded keeper");
const travelingDragon = candidateDragon("traveling-dragon", {
  flags: ["myv_wyvern_travelling_with_rider"],
});
assert.equal(canServe(travelingDragon.dragon, travelingDragon.owner), false, "a traveling companion cannot also enlist");
const activityDragon = candidateDragon("activity-dragon", {
  currentTravelPlan: { id: "travel-plan" },
});
assert.equal(canServe(activityDragon.dragon, activityDragon.owner), false, "a dragon with a current travel plan cannot enlist");
const oneWayRider = makeCharacter("one-way-rider", { traits: ["myv_wyvern_rider"] });
const staleAssignment = candidateDragon("stale-rider-assignment");
staleAssignment.dragon.variables.set("myv_war_mount_rider", oneWayRider);
assert.equal(runTrigger("mm_wyvern_has_assigned_rider", staleAssignment.dragon, makeEnvironment()), false,
  "a one-sided stale rider reference is not a valid assigned mount");
assert.equal(canServe(staleAssignment.dragon, staleAssignment.owner), true,
  "only a live reciprocal assigned rider reserves the dragon from the solo-knight path");
const assignedRider = makeCharacter("reciprocal-rider", {
  traits: ["myv_wyvern_rider"],
  variables: {},
});
const assignedDragon = candidateDragon("reciprocal-dragon");
assignedDragon.dragon.variables.set("myv_war_mount_rider", assignedRider);
assignedRider.variables.set("myv_war_mount", assignedDragon.dragon);
assert.equal(runTrigger("mm_wyvern_has_assigned_rider", assignedDragon.dragon, makeEnvironment()), true,
  "valid mounted assignment requires the exact reciprocal dragon reference");
assert.equal(canServe(assignedDragon.dragon, assignedDragon.owner), false,
  "a reciprocally assigned mount cannot count again as an independent knight");

const canKnight = triggers.get("can_be_knight_trigger");
const humanKnightBranch = first(canKnight, "trigger_else");
assert.ok(humanKnightBranch, "vanilla human knight branch remains the else path");
assert.deepEqual(stableAst(humanKnightBranch.value),
  stableAst(nestedPdxBody("human_knight", fixture.humanKnightBody, "frozen vanilla human knight body")),
  "the human can_be_knight_trigger body remains atomically identical to the frozen native snapshot");
const dragonKnightBranch = first(canKnight, "trigger_if");
assert.ok(dragonKnightBranch, "dragon knight eligibility is isolated in its own branch");
assert.equal(treeCount(dragonKnightBranch.value, node => node.key === "myv_is_wyvern" && node.value === "no"), 0,
  "the new dragon branch does not inherit the native human-only wyvern exclusion");
assert.ok(!/mm_wyvern_solo_knight|solo_knight_mode/.test(fs.readFileSync(combatTriggerFile, "utf8")),
  "independent knight service uses the ordinary knight list without a new mode flag");

const validMountActor = makeCharacter("mount-actor", {
  ai: false,
  traits: ["myv_wyvern_rider"],
  variables: {},
});
const validMountRecipient = makeWyvern("mount-recipient", 100, {
  traits: ["myv_wyvern_harmony"],
  bondedCharacter: validMountActor,
  employer: validMountActor,
  variables: { myv_wyvern_bonded_character: validMountActor },
});
validMountRecipient.bondedCharacter = validMountActor;
assert.equal(canServe(validMountRecipient, validMountActor), true,
  "a compatible bonded dragon is initially eligible for the solo knight branch");
const shownMount = evaluateTriggerBlock(required(interaction, "is_shown", "mount interaction"), validMountActor,
  makeEnvironment({ scopes: { actor: validMountActor, recipient: validMountRecipient } }));
assert.equal(shownMount, true, "eligible bonded wyvern is shown for the existing mount interaction");
const validMountEnvironment = makeEnvironment({ scopes: { actor: validMountActor, recipient: validMountRecipient } });
assert.equal(evaluateTriggerBlock(required(interaction, "is_valid_showing_failures_only", "mount interaction"),
  validMountActor, validMountEnvironment), true, "unassigned dragon passes the mount interaction landing gate");
executeEffectSequence(required(interaction, "on_accept", "mount interaction"),
  validMountActor, validMountEnvironment);
assert.equal(variable(validMountActor, "myv_war_mount"), validMountRecipient);
assert.equal(variable(validMountRecipient, "myv_war_mount_rider"), validMountActor,
  "accepted mount assignment writes both reciprocal sides");
assert.equal(canServe(validMountRecipient, validMountActor), false,
  "a successfully assigned war mount is immediately excluded from solo knight eligibility");

const raceActor = makeCharacter("race-actor", { ai: false, traits: ["myv_wyvern_rider"] });
const raceRecipient = makeWyvern("race-recipient", 100, {
  traits: ["myv_wyvern_harmony"],
  bondedCharacter: raceActor,
  knightArmy: { location: { id: "already-deployed" } },
});
raceRecipient.bondedCharacter = raceActor;
const raceEnv = makeEnvironment({ scopes: { actor: raceActor, recipient: raceRecipient } });
const beforeRaceWrite = {
  actor: [...raceActor.variables],
  recipient: [...raceRecipient.variables],
};
assert.equal(evaluateTriggerBlock(required(interaction, "is_valid_showing_failures_only", "mount interaction"),
  raceActor, raceEnv), false, "a stale UI selection is rejected if the recipient acquires a knight army");
executeEffectSequence(required(interaction, "on_accept", "mount interaction"), raceActor, raceEnv);
assert.deepEqual([...raceActor.variables], beforeRaceWrite.actor, "failed on-accept recheck does not assign the rider");
assert.deepEqual([...raceRecipient.variables], beforeRaceWrite.recipient, "failed on-accept recheck does not assign the mount");
const acceptBlock = required(interaction, "on_accept", "mount interaction");
const acceptGuard = first(acceptBlock, "if");
const recipientGuard = first(required(acceptGuard.value, "limit", "mount accept guard"), "scope:recipient");
assert.ok(recipientGuard, "on_accept repeats the recipient checks");
assert.ok(containsNode(recipientGuard.value, node => node.key === "NOT" &&
  containsNode(node.value, child => child.key === "exists" && child.value === "knight_army")),
  "on_accept rechecks NOT exists=knight_army before setting either assignment");

const mountedDeployment = first(triggers.get("myv_is_wyvern_deployed_with_army"), "OR");
assert.ok(mountedDeployment, "deployment trigger keeps an OR of independent and mounted army paths");
assert.equal(mountedDeployment.value.length, 2, "only independent and original mounted deployment branches count");
assert.deepEqual(stableAst(mountedDeployment.value[1].value),
  stableAst(nestedPdxBody("mounted_body", fixture.mountedDeploymentBody, "frozen mounted deployment body")),
  "the original rider-based deployment body remains byte-for-byte equivalent as parsed PDX");
const soloOwner = makeCharacter("solo-knight-liege");
const armyLocation = { id: "solo-army-province" };
const soloDragon = candidateDragon("solo-deployed", {
  owner: soloOwner,
  knightArmy: { location: armyLocation },
});
assert.equal(runTrigger("mm_wyvern_is_independent_knight_deployed", soloDragon.dragon, makeEnvironment()), true,
  "a tamed dragon with its own knight_army.location is recognized as deployed");
assert.equal(runTrigger("myv_is_wyvern_deployed_with_army", soloDragon.dragon, makeEnvironment()), true,
  "the shared deployment trigger sees an independent dragon knight");
soloDragon.dragon.location = { id: "before-solo-sync" };
executeEffect("myv_sync_wyvern_deployed_army_location_effect", soloDragon.dragon, makeEnvironment());
assert.equal(soloDragon.dragon.location, armyLocation, "independent knight location follows its own knight_army.location");

const mountedLocation = { id: "mounted-army-province" };
const deployedRider = makeCharacter("mounted-rider", {
  traits: ["myv_wyvern_rider"],
  commandingArmy: { location: mountedLocation },
});
const mountedDragon = makeWyvern("mounted-deployed", 100, {
  traits: ["myv_wyvern_harmony"],
  employer: deployedRider,
  variables: { myv_wyvern_bonded_character: deployedRider },
});
mountedDragon.variables.set("myv_war_mount_rider", deployedRider);
deployedRider.variables.set("myv_war_mount", mountedDragon);
assert.equal(canServe(mountedDragon, deployedRider), false,
  "the same assigned dragon is unavailable for the solo knight branch");
assert.equal(runTrigger("myv_is_wyvern_deployed_with_army", mountedDragon, makeEnvironment()), true,
  "the original valid rider path still deploys the same dragon");
executeEffect("myv_sync_wyvern_deployed_army_location_effect", mountedDragon, makeEnvironment());
assert.equal(mountedDragon.location, mountedLocation, "mounted dragon location still follows the rider's army");

const maintenanceBody = armyEffects.get("myv_wyvern_tamed_maintenance_effect");
const nativeMaintenance = definitionFromText(fixture.nativeMaintenance,
  "myv_wyvern_tamed_maintenance_effect", "frozen native monthly maintenance");
assert.ok(maintenanceBody, "active tamed maintenance effect exists");
assert.deepEqual(normalizeMaintenanceBody(maintenanceBody), normalizeMaintenanceBody(nativeMaintenance),
  "monthly maintenance differs from the frozen native body only at the single deployment-aware home-return guard");
assertNoStableLedgerWrites(maintenanceBody);
const homeReturn = findHomeReturnGuard(maintenanceBody);
const home = { id: "lair-province" };
const homeTitle = { titleProvince: home };
const ledgerSnapshot = dragon => [
  variable(dragon, "myv_wyvern_stable_county"),
  variable(dragon, "myv_wyvern_stable_payer"),
  variable(dragon, "myv_wyvern_stable_satiety_debt"),
];
const ledgerOwner = makeCharacter("ledger-owner");
const idleHomeDragon = candidateDragon("idle-home-dragon", {
  owner: ledgerOwner,
  variables: {
    myv_wyvern_lair_barony: homeTitle,
    myv_wyvern_stable_county: "county-sentinel",
    myv_wyvern_stable_payer: ledgerOwner,
    myv_wyvern_stable_satiety_debt: 17,
  },
});
idleHomeDragon.dragon.location = { id: "away-from-home" };
const idleLedgerBefore = ledgerSnapshot(idleHomeDragon.dragon);
executeEffectSequence([homeReturn], idleHomeDragon.dragon, makeEnvironment());
assert.equal(idleHomeDragon.dragon.location, home, "an idle unstabled dragon still returns home during maintenance");
assert.deepEqual(ledgerSnapshot(idleHomeDragon.dragon), idleLedgerBefore,
  "ordinary monthly home return leaves every stable ledger field unchanged");
const deployedHomeDragon = candidateDragon("deployed-home-dragon", {
  owner: ledgerOwner,
  knightArmy: { location: armyLocation },
  variables: {
    myv_wyvern_lair_barony: homeTitle,
    myv_wyvern_stable_county: "county-sentinel",
    myv_wyvern_stable_payer: ledgerOwner,
    myv_wyvern_stable_satiety_debt: 23,
  },
});
deployedHomeDragon.dragon.location = armyLocation;
const deployedLedgerBefore = ledgerSnapshot(deployedHomeDragon.dragon);
executeEffectSequence([homeReturn], deployedHomeDragon.dragon, makeEnvironment());
assert.equal(deployedHomeDragon.dragon.location, armyLocation,
  "monthly home maintenance skips a deployed independent knight");
assert.deepEqual(ledgerSnapshot(deployedHomeDragon.dragon), deployedLedgerBefore,
  "deployed home-return skip leaves stable accounting intact");
const mountedHomeDragon = makeWyvern("mounted-home-dragon", 100, {
  traits: ["myv_wyvern_harmony"],
  employer: deployedRider,
  variables: {
    myv_wyvern_bonded_character: deployedRider,
    myv_wyvern_lair_barony: homeTitle,
    myv_war_mount_rider: deployedRider,
    myv_wyvern_stable_county: "county-sentinel",
    myv_wyvern_stable_payer: ledgerOwner,
    myv_wyvern_stable_satiety_debt: 31,
  },
});
deployedRider.variables.set("myv_war_mount", mountedHomeDragon);
mountedHomeDragon.location = mountedLocation;
executeEffectSequence([homeReturn], mountedHomeDragon, makeEnvironment());
assert.equal(mountedHomeDragon.location, mountedLocation,
  "existing mounted deployment also skips the monthly home-return guard");

console.log("v122 wyvern lifecycle/combat regression checks passed");

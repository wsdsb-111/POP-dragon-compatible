"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const modRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const triggerPath = path.join(modRoot, "common", "scripted_triggers", "mm_wyvern_dragon_forging.txt");
const effectPath = path.join(modRoot, "common", "scripted_effects", "mm_wyvern_dragon_forging.txt");
const modifierPath = path.join(modRoot, "common", "modifiers", "mm_wyvern_dragon_weapons.txt");
const affixEffectPath = path.join(modRoot, "common", "scripted_effects", "mm_wyvern_dragon_weapon_affixes.txt");
const eventPath = path.join(modRoot, "events", "mm_wyvern_dragon_forging_events.txt");
const decisionPath = path.join(modRoot, "common", "decisions", "mm_wyvern_dragon_forging.txt");
const fixturePath = path.join(projectRoot, "tests", "fixtures", "v115", "dragon-forging-artifacts.json");
const nativeModifierFixturePath = path.join(projectRoot, "tests", "fixtures", "v114", "native-artifact-modifiers.json");
const publicTriggerNames = ["mm_wyvern_sword_pair_valid_trigger", "mm_wyvern_bow_pair_valid_trigger"];
const publicEffectNames = ["mm_wyvern_forge_sword_effect", "mm_wyvern_forge_bow_effect"];
const selectMaterialsEffectName = "mm_wyvern_forge_select_materials_effect";
const createEffectName = "mm_wyvern_create_dragon_weapon_effect";
const forgedScopeName = "mm_wyvern_forged_dragon_weapon";
const swordScopes = ["mm_wyvern_sword_fang", "mm_wyvern_sword_fang_second", "mm_wyvern_sword_claw", "mm_wyvern_sword_horn"];
const bowScopes = ["mm_wyvern_bow_scale", "mm_wyvern_bow_scale_second", "mm_wyvern_bow_horn"];
const rarities = ["common", "masterwork", "famed", "illustrious"];
const rarityRank = new Map(rarities.map((rarity, index) => [rarity, index]));
const expectedStats = {
  sword: {
    prowess_no_portrait: 15,
    monthly_prestige: 0.8,
    monthly_dynasty_prestige: 0.8,
    heavy_infantry_damage_mult: 0.10,
    advantage: 3,
    heavy_infantry_toughness_mult: 0.08,
  },
  bow: {
    prowess_no_portrait: 5,
    archers_damage_mult: 0.12,
    archers_toughness_mult: 0.08,
    forest_advantage: 3,
    taiga_advantage: 3,
    jungle_advantage: 3,
    monthly_dynasty_prestige_mult: 0.05,
    monthly_prestige: 0.18,
  },
};
let triggerDefinitions = new Map();
let effectDefinitions = new Map();
let modifierDefinitions = new Map();

function tokenizePdx(source, label) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (/\s/.test(character)) {
      index++;
    } else if (character === "#") {
      while (index < source.length && source[index] !== "\n") index++;
    } else if (character === '"') {
      index++;
      let value = "";
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === "\\" && index < source.length) value += source[index++];
        else if (current === '"') {
          closed = true;
          break;
        } else value += current;
      }
      assert.ok(closed, label + " has an unterminated string");
      tokens.push(value);
    } else {
      const operator = source.slice(index).match(/^(?:>=|<=|!=|=|>|<)/);
      if (operator) {
        tokens.push(operator[0]);
        index += operator[0].length;
      } else if ("{}".includes(character)) {
        tokens.push(character);
        index++;
      } else {
        const start = index;
        while (index < source.length && !/[\s{}#"=<>!]/.test(source[index])) index++;
        assert.ok(index > start, label + " contains an invalid token at " + String(index));
        tokens.push(source.slice(start, index));
      }
    }
  }
  return tokens;
}

function parsePdxBlock(tokens, label, nested) {
  const result = [];
  while (tokens.index < tokens.values.length) {
    const key = tokens.values[tokens.index++];
    if (key === "}") {
      assert.ok(nested, label + " has an unmatched closing brace");
      return result;
    }
    assert.notEqual(key, "{", label + " has a block without a key");
    assert.notEqual(key, "=", label + " has a key without a name");
    const operator = tokens.values[tokens.index];
    if (!["=", ">=", "<=", "!=", ">", "<"].includes(operator)) {
      result.push({ key: null, operator: null, value: key });
      continue;
    }
    tokens.index++;
    const valueToken = tokens.values[tokens.index++];
    assert.notEqual(valueToken, undefined, label + " has a key without a value");
    assert.notEqual(valueToken, "}", label + " has a key without a value");
    result.push({
      key,
      operator,
      value: valueToken === "{" ? parsePdxBlock(tokens, label, true) : valueToken,
    });
  }
  assert.ok(!nested, label + " has an unclosed block");
  return result;
}

function parsePdxFile(filePath) {
  assert.ok(fs.existsSync(filePath), "missing PDX file: " + filePath);
  const source = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const tokens = { values: tokenizePdx(source, filePath), index: 0 };
  const ast = parsePdxBlock(tokens, filePath, false);
  assert.equal(tokens.index, tokens.values.length, filePath + " has trailing PDX tokens");
  return ast;
}

function values(block, key) {
  return block.filter(entry => entry.key === key).map(entry => entry.value);
}

function one(block, key, label) {
  const matches = values(block, key);
  assert.equal(matches.length, 1, label + " must contain one " + key + ", found " + matches.length);
  return matches[0];
}

function findDefinition(ast, key) {
  const matches = ast.filter(entry => entry.key === key && Array.isArray(entry.value));
  assert.equal(matches.length, 1, "PDX file must define " + key + " exactly once");
  return matches[0].value;
}

function nestedKeys(block, key, output = []) {
  for (const entry of block) {
    if (entry.key === key) output.push(entry);
    if (Array.isArray(entry.value)) nestedKeys(entry.value, key, output);
  }
  return output;
}

function scalar(entry, label) {
  assert.equal(typeof entry, "string", label + " must be a scalar PDX value");
  return entry;
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
assert.equal(fixture.owner, "root", "fixture inventory owner must be root");
const fixtureById = new Map(fixture.artifacts.map(item => [item.id, item]));
assert.equal(fixtureById.size, fixture.artifacts.length, "fixture artifact ids must be unique");
for (const item of fixture.artifacts) {
  assert.ok(rarityRank.has(item.rarity), item.id + " has an unsupported rarity");
  assert.ok(["pedestal", "wall_small", "miscellaneous", "helmet"].includes(item.slot), item.id + " has an unsupported artifact slot");
  assert.equal(typeof item.equipped, "boolean", item.id + " must declare equipment state");
  assert.ok(item.variables && typeof item.variables === "object" && !Array.isArray(item.variables),
    item.id + " must declare its artifact variables");
}

function makeState(itemIds = fixture.artifacts.map(item => item.id), options = {}) {
  const selected = new Set(itemIds);
  const artifacts = fixture.artifacts.filter(item => selected.has(item.id)).map(item => ({
    id: item.id,
    owner: item.owner,
    rarity: item.rarity,
    slot: item.slot,
    equipped: item.equipped,
    kind: item.kind,
    exists: true,
    variables: new Map(Object.entries(item.variables)),
    modifiers: new Set(),
    modifierAdds: [],
  }));
  assert.equal(artifacts.length, selected.size, "state references an unknown fixture artifact");
  const actor = {
    id: "root",
    alive: options.actorAlive !== false,
    isAi: false,
    traits: new Set(),
    variables: new Map(),
    artifacts,
  };
  const scopes = new Map([["root", actor]]);
  return {
    actor,
    artifacts,
    scopes,
    createdArtifacts: [],
    triggerEvents: [],
    effectCalls: [],
    destroyedArtifacts: [],
    orderedSelections: [],
    randomSelections: [],
    randomSeed: options.randomSeed ?? 1,
    createFailuresRemaining: options.createFailures ?? 0,
    suppressCreation: options.suppressCreation === true,
  };
}

function scaledExpectedStats(type, rarity) {
  const factor = rarity === "famed" ? 1.25 : (rarity === "illustrious" ? 1.5 : 1);
  return Object.fromEntries(Object.entries(expectedStats[type]).map(([field, value]) => [
    field,
    Number.isInteger(value) ? Math.ceil(value * factor) : value * factor,
  ]));
}

function assertStats(actual, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    assert.ok(Number.isFinite(actual[field]), label + " is missing fixed stat " + field);
    assert.ok(Math.abs(actual[field] - value) < 1e-9,
      label + " has wrong fixed stat " + field + ": expected " + value + ", got " + actual[field]);
  }
}

function resolveValue(value, current, state, parameters = {}) {
  if (typeof value !== "string") return value;
  if (value === "root") return state.actor;
  if (value === "this") return current;
  if (value.startsWith("scope:")) return state.scopes.get(value.slice(6));
  if (value.startsWith("var:")) return current.variables.get(value.slice(4));
  if (value === "yes") return true;
  if (value === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/\$([^$]+)\$/g, (placeholder, name) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder);
}

function isExistingScope(value) {
  return Boolean(value && value.exists !== false);
}

function parsePropertyValues(block) {
  const result = {};
  for (const entry of block) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(entry.value)) continue;
    result[entry.key] = Number(entry.value);
  }
  return result;
}

function addModifier(artifact, modifier, modifierDefinitions, label) {
  assert.ok(artifact && artifact.exists !== false, label + " has no live artifact scope");
  artifact.modifierAdds.push(modifier);
  artifact.modifiers.add(modifier);
  const definition = modifierDefinitions.get(modifier);
  if (definition) {
    for (const [field, value] of Object.entries(definition)) {
      artifact.stats[field] = (artifact.stats[field] || 0) + value;
    }
  }
}

function readModifierDefinitions(ast) {
  const definitions = new Map();
  for (const entry of ast) {
    if (typeof entry.key !== "string" || !Array.isArray(entry.value)) continue;
    definitions.set(entry.key, parsePropertyValues(entry.value));
  }
  return definitions;
}

function assertWeaponModifierMatrix(ast) {
  const definitions = readModifierDefinitions(ast);
  for (const type of ["sword", "bow"]) {
    for (const rarity of rarities) {
      const id = "mm_wyvern_" + type + "_" + rarity + "_modifier";
      const actual = definitions.get(id);
      assert.ok(actual, "missing fixed " + type + " modifier for " + rarity);
      const expected = scaledExpectedStats(type, rarity);
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(),
        type + " fixed stat fields must match at " + rarity);
      assertStats(actual, expected, type + " fixed modifier at " + rarity);
    }
  }
}

function fixtureNativeDefinitions() {
  const nativeFixture = JSON.parse(fs.readFileSync(nativeModifierFixturePath, "utf8"));
  const result = new Map();
  for (const declaration of nativeFixture.declarations) {
    result.set(declaration.id, Object.fromEntries(Object.entries(declaration.definition)
      .map(([field, value]) => [field, Number(value)])));
  }
  return result;
}

function assertEightUniqueSinglePropertyAffixPools(ast, nativeDefinitions) {
  const roll = findDefinition(ast, "mm_wyvern_roll_dragon_weapon_affix_effect");
  assert.ok(roll, "dragon weapon affix roll helper is missing");
  const lists = values(roll, "random_list").filter(Array.isArray);
  assert.equal(lists.length, 1, "dragon weapon affix roll must use one random list");
  const options = lists[0].filter(entry => /^\d+$/.test(String(entry.key)) && Array.isArray(entry.value));
  assert.equal(options.length, 8, "dragon weapon extras must draw from eight native single-property pools");
  const fixedFields = new Set([...Object.keys(expectedStats.sword), ...Object.keys(expectedStats.bow)]);
  const poolFields = new Set();

  for (const [index, option] of options.entries()) {
    const triggers = values(option.value, "trigger").filter(Array.isArray);
    assert.equal(triggers.length, 1, "affix pool " + String(index + 1) + " must guard duplicate modifiers");
    const forbidden = nestedKeys(triggers[0], "has_artifact_modifier").map(entry => entry.value).filter(value => typeof value === "string");
    assert.equal(forbidden.length, 2, "affix pool " + String(index + 1) + " must exclude both quality variants");
    const qualityIfs = values(option.value, "if").filter(Array.isArray).filter(branch => {
      const limits = values(branch, "limit").filter(Array.isArray);
      return limits.length === 1 && values(limits[0], "rarity").includes("illustrious");
    });
    assert.equal(qualityIfs.length, 1, "affix pool " + String(index + 1) + " must select an illustrious variant");
    const pairedElse = option.value[option.value.indexOf(option.value.find(entry => entry.key === "if" && entry.value === qualityIfs[0])) + 1];
    assert.ok(pairedElse && pairedElse.key === "else" && Array.isArray(pairedElse.value),
      "illustrious affix modifier must have a famed/common paired else");
    const highAdds = values(qualityIfs[0], "add_artifact_modifier").filter(value => typeof value === "string");
    const lowAdds = values(pairedElse.value, "add_artifact_modifier").filter(value => typeof value === "string");
    assert.equal(highAdds.length, 1, "each illustrious affix option adds one native modifier");
    assert.equal(lowAdds.length, 1, "each famed affix option adds one native modifier");
    assert.notEqual(highAdds[0], lowAdds[0], "quality variants must use separate native modifiers");
    const highDefinition = nativeDefinitions.get(highAdds[0]);
    const lowDefinition = nativeDefinitions.get(lowAdds[0]);
    assert.ok(highDefinition && lowDefinition, "extra modifiers must exist in the frozen native modifier fixture");
    assert.equal(Object.keys(highDefinition).length, 1, "illustrious extra modifiers must be single-property");
    assert.equal(Object.keys(lowDefinition).length, 1, "famed extra modifiers must be single-property");
    const field = Object.keys(highDefinition)[0];
    assert.equal(Object.keys(lowDefinition)[0], field, "paired quality variants must share one property field");
    assert.ok(!fixedFields.has(field), "extra affix category collides with fixed weapon attribute " + field);
    assert.ok(!poolFields.has(field), "extra affix pool repeats property field " + field);
    poolFields.add(field);
  }
  assert.equal(poolFields.size, 8, "the eight native extra pools must use eight distinct properties");
}

function assertAffixCountsAndRandomUniqueness(ast, nativeDefinitions) {
  const apply = findDefinition(ast, "mm_wyvern_apply_dragon_weapon_affixes_effect");
  const expectedCounts = {
    sword: { common: 0, masterwork: 1, famed: 2, illustrious: 4 },
    bow: { common: 0, masterwork: 0, famed: 1, illustrious: 2 },
  };
  const observedFields = new Set();

  for (const [type, qualities] of Object.entries(expectedCounts)) {
    for (const [rarity, count] of Object.entries(qualities)) {
      for (let seed = 1; seed <= 64; seed++) {
        const state = makeState([]);
        state.randomSeed = seed;
        const artifact = {
          id: "affix-fixture-" + type + "-" + rarity + "-" + String(seed),
          owner: state.actor.id,
          rarity,
          equipped: false,
          exists: true,
          variables: new Map([["mm_wyvern_weapon_kind", "flag:" + type]]),
          modifiers: new Set(),
          modifierAdds: [],
          stats: {},
        };
        state.artifacts.push(artifact);
        runEffectList(apply, artifact, state);
        assert.equal(artifact.modifierAdds.length, count,
          type + " " + rarity + " must receive exactly " + String(count) + " extra modifiers");
        assert.equal(new Set(artifact.modifierAdds).size, count,
          type + " " + rarity + " must not receive a duplicate modifier");
        const fields = artifact.modifierAdds.flatMap(modifier => {
          const definition = nativeDefinitions.get(modifier);
          assert.ok(definition, "random extra must use a frozen native modifier: " + modifier);
          assert.equal(Object.keys(definition).length, 1, "random extra must be single-property: " + modifier);
          return Object.keys(definition);
        });
        assert.equal(new Set(fields).size, fields.length,
          type + " " + rarity + " must not stack two rolls from one property category");
        fields.forEach(field => observedFields.add(field));

        const firstState = {
          modifiers: [...artifact.modifiers].sort(),
          modifierAdds: [...artifact.modifierAdds],
          seed: state.randomSeed,
        };
        runEffectList(apply, artifact, state);
        assert.deepEqual({
          modifiers: [...artifact.modifiers].sort(),
          modifierAdds: [...artifact.modifierAdds],
          seed: state.randomSeed,
        }, firstState, "generated marker must make repeated affix application idempotent");
      }
    }
  }
  assert.equal(observedFields.size, 8, "random runs must be able to select all eight affix properties");
}

function findForgingEvent(ast) {
  const matches = ast.filter(entry => entry.key && Array.isArray(entry.value)
    && values(entry.value, "type").includes("character_event")
    && values(entry.value, "option").some(Array.isArray));
  assert.equal(matches.length, 1, "forging events file must define exactly one popup event");
  return { id: matches[0].key, block: matches[0].value };
}

function findForgingDecision(ast) {
  const matches = ast.filter(entry => entry.key && Array.isArray(entry.value)
    && values(entry.value, "is_shown").some(Array.isArray)
    && values(entry.value, "effect").some(Array.isArray));
  assert.equal(matches.length, 1, "forging decisions file must define exactly one decision");
  return { id: matches[0].key, block: matches[0].value };
}

function optionEntries(event) {
  return values(event, "option").filter(Array.isArray);
}

function hasEffectCall(block, effectName) {
  return nestedKeys(block, effectName).some(entry => entry.value === "yes" || Array.isArray(entry.value));
}

function getForgeOptions(event) {
  const options = optionEntries(event);
  assert.equal(options.length, 3, "forging popup must have sword, bow, and cancel options");
  const sword = options.filter(option => hasEffectCall(option, publicEffectNames[0]));
  const bow = options.filter(option => hasEffectCall(option, publicEffectNames[1]));
  const cancel = options.filter(option => !hasEffectCall(option, publicEffectNames[0]) && !hasEffectCall(option, publicEffectNames[1]));
  assert.equal(sword.length, 1, "forging popup must have one sword option");
  assert.equal(bow.length, 1, "forging popup must have one bow option");
  assert.equal(cancel.length, 1, "forging popup must have one cancel option");
  return { sword: sword[0], bow: bow[0], cancel: cancel[0] };
}

function executeDecision(decision, state) {
  const shown = values(decision, "is_shown").find(Array.isArray);
  const valid = values(decision, "is_valid").find(Array.isArray);
  assert.ok(shown && valid, "forging decision must define shown and valid guards");
  if (!evaluateTrigger(shown, state.actor, state) || !evaluateTrigger(valid, state.actor, state)) return false;
  const effects = values(decision, "effect").filter(Array.isArray);
  assert.equal(effects.length, 1, "forging decision must have one effect");
  runEffectList(effects[0], state.actor, state);
  return true;
}

function executeEventImmediate(event, state) {
  const immediate = values(event, "immediate").filter(Array.isArray);
  assert.ok(immediate.length <= 1, "forging popup must have at most one immediate block");
  if (immediate.length) runEffectList(immediate[0], state.actor, state);
}

function executeEventOption(option, state) {
  runEffectList(option.filter(entry => !["name", "trigger", "custom_tooltip", "ai_chance", "show_as_unavailable"].includes(entry.key)),
    state.actor, state);
}

function eventOptionIsAvailable(option, state) {
  const trigger = values(option, "trigger").find(Array.isArray);
  return !trigger || evaluateTrigger(trigger, state.actor, state);
}

function executeEventAfter(event, state) {
  const after = values(event, "after").filter(Array.isArray);
  assert.ok(after.length <= 1, "forging popup must have at most one after block");
  if (after.length) runEffectList(after[0], state.actor, state);
}

function callEffect(name, state, parameters = {}) {
  const effect = effectDefinitions.get(name);
  assert.ok(effect, "missing scripted effect " + name);
  state.effectCalls.push(name);
  runEffectList(effect, state.actor, state, parameters);
}

function assertNotCrafted(state, label) {
  assert.equal(state.createdArtifacts.length, 0, label + " must not create a weapon");
  assert.equal(state.destroyedArtifacts.length, 0, label + " must not consume materials");
}

function assertCrafted(state, recipe, rarity, label) {
  assert.equal(state.createdArtifacts.length, 1, label + " must create one weapon");
  const weapon = state.scopes.get(forgedScopeName);
  assert.ok(weapon && weapon.exists, label + " must save its created weapon scope");
  assert.equal(weapon.rarity, rarity, label + " weapon rarity must be the lower material rarity");
  assert.equal(weapon.type, recipe === "sword" ? "sword" : "bow", label + " weapon type");
  const expectedScopes = recipe === "sword" ? swordScopes : bowScopes;
  assert.equal(state.destroyedArtifacts.length, expectedScopes.length,
    label + " must consume exactly all " + String(expectedScopes.length) + " recipe materials");
  const consumed = expectedScopes.map(scope => state.scopes.get(scope));
  assert.ok(consumed.every(artifact => artifact && !artifact.exists), label + " must consume its saved material scopes");
  assert.equal(new Set(consumed.map(artifact => artifact.id)).size, expectedScopes.length,
    label + " must consume distinct artifacts for every recipe slot");
  assert.deepEqual(state.destroyedArtifacts.slice().sort(), consumed.map(artifact => artifact.id).sort(),
    label + " must consume exactly the selected inputs and no substitutes");
  const expected = scaledExpectedStats(recipe, rarity);
  assertStats(weapon.stats, expected, label);
  const expectedExtras = recipe === "sword"
    ? { common: 0, masterwork: 1, famed: 2, illustrious: 4 }[rarity]
    : { common: 0, masterwork: 0, famed: 1, illustrious: 2 }[rarity];
  const actualExtras = Object.keys(weapon.stats).filter(field => !Object.prototype.hasOwnProperty.call(expectedStats[recipe], field));
  assert.equal(actualExtras.length, expectedExtras, label + " must have the requested number of extra attributes");
  assert.ok(Object.keys(weapon.stats).length <= 10, label + " may not exceed ten total attributes");
  assert.equal(new Set(weapon.modifierAdds).size, weapon.modifierAdds.length, label + " must not add a modifier twice");
  return weapon;
}

const triggerAst = parsePdxFile(triggerPath);
const effectAst = parsePdxFile(effectPath);
const affixAst = parsePdxFile(affixEffectPath);
const weaponModifierAst = parsePdxFile(modifierPath);
const eventAst = parsePdxFile(eventPath);
const decisionAst = parsePdxFile(decisionPath);
triggerDefinitions = new Map(triggerAst.filter(entry => entry.key && Array.isArray(entry.value))
  .map(entry => [entry.key, entry.value]));
effectDefinitions = new Map([...effectAst, ...affixAst].filter(entry => entry.key && Array.isArray(entry.value))
  .map(entry => [entry.key, entry.value]));
const nativeDefinitions = fixtureNativeDefinitions();
modifierDefinitions = new Map([...nativeDefinitions, ...readModifierDefinitions(weaponModifierAst)]);

for (const name of publicTriggerNames) assert.ok(triggerDefinitions.has(name), "missing public pair trigger " + name);
for (const name of publicEffectNames) assert.ok(effectDefinitions.has(name), "missing public forge effect " + name);
assert.ok(effectDefinitions.has(createEffectName), "shared dragon weapon create helper is missing");
assertWeaponModifierMatrix(weaponModifierAst);
assertEightUniqueSinglePropertyAffixPools(affixAst, nativeDefinitions);
assertAffixCountsAndRandomUniqueness(affixAst, nativeDefinitions);

const forgeEvent = findForgingEvent(eventAst);
const forgeDecision = findForgingDecision(decisionAst);
const forgeOptions = getForgeOptions(forgeEvent.block);
const selectMaterialsEffect = effectDefinitions.get(selectMaterialsEffectName);
assert.ok(selectMaterialsEffect, "popup material selection helper is missing");
assert.equal(nestedKeys(forgeEvent.block, selectMaterialsEffectName).filter(entry => entry.value === "yes").length, 1,
  "popup immediate must select exact materials once before choices are shown");
const eventRoutes = nestedKeys(forgeDecision.block, "trigger_event").map(entry => entry.value).filter(value => typeof value === "string");
assert.deepEqual(eventRoutes, [forgeEvent.id], "the single forging decision must open the forging popup event");

const selectionSelectors = nestedKeys(selectMaterialsEffect, "ordered_character_artifact")
  .map(entry => entry.value).filter(Array.isArray);
assert.ok(selectionSelectors.length >= swordScopes.length + bowScopes.length,
  "popup selection helper must bind both recipes' exact ingredient slots");
for (const selector of selectionSelectors) {
  assert.equal(values(selector, "order_by").find(value => typeof value === "string"), "artifact_rarity",
    "material selectors must order candidates by artifact rarity");
  assert.equal(values(selector, "max").find(value => typeof value === "string"), "1",
    "material selectors must save at most one artifact");
}
const selectedScopeNames = selectionSelectors.flatMap(selector => values(selector, "save_scope_as"))
  .filter(value => typeof value === "string");
for (const scope of [...swordScopes, ...bowScopes]) {
  assert.ok(selectedScopeNames.includes(scope), "popup selection helper must select exact scope " + scope);
}
assert.deepEqual([...new Set(selectedScopeNames)].sort(), [...swordScopes, ...bowScopes].sort(),
  "popup material selection must save only the seven recipe input scopes");

for (const [recipe, effectName, triggerName, scopes] of [
  ["sword", publicEffectNames[0], publicTriggerNames[0], swordScopes],
  ["bow", publicEffectNames[1], publicTriggerNames[1], bowScopes],
]) {
  const effect = effectDefinitions.get(effectName);
  const effectCalls = nestedKeys(effect, triggerName).filter(entry => entry.value === "yes");
  assert.equal(effectCalls.length, 1, recipe + " effect must guard with its recipe trigger");
  assert.equal(nestedKeys(effect, selectMaterialsEffectName).length, 0,
    recipe + " wrapper must revalidate popup inputs without selecting replacements");
  assert.equal(nestedKeys(effect, "ordered_character_artifact").length, 0,
    recipe + " wrapper must not search for replacement materials");
  const creationCalls = nestedKeys(effect, createEffectName).filter(entry => Array.isArray(entry.value));
  assert.equal(creationCalls.length, rarities.length,
    recipe + " must define one mutually exclusive create branch for each rarity");
  const createRarities = new Set();
  for (const [index, call] of creationCalls.entries()) {
    assert.equal(one(call.value, "TYPE", recipe + " create branch " + String(index + 1)), recipe,
      recipe + " create branch must use its own weapon type");
    const rarity = one(call.value, "RARITY", recipe + " create branch " + String(index + 1));
    assert.ok(rarityRank.has(rarity), recipe + " create branch has an invalid rarity " + rarity);
    assert.ok(!createRarities.has(rarity), recipe + " has duplicate create branches for " + rarity);
    createRarities.add(rarity);
  }
  assert.deepEqual([...createRarities].sort(), [...rarities].sort(),
    recipe + " create branches must cover common, masterwork, famed, and illustrious exactly once");
  const guard = values(effect, "if").find(Array.isArray);
  assert.ok(guard, recipe + " wrapper must guard the forge operation");
  const rarityBranches = guard.filter(entry => ["if", "else_if", "else"].includes(entry.key)
    && nestedKeys(entry.value, createEffectName).some(call => Array.isArray(call.value)));
  assert.equal(rarityBranches.length, rarities.length,
    recipe + " must have four mutually exclusive output-quality branches");
  const allowedInputsByOutput = {
    illustrious: ["illustrious"],
    famed: ["famed", "illustrious"],
    masterwork: ["masterwork", "famed", "illustrious"],
  };
  for (const branch of rarityBranches) {
    const createCall = nestedKeys(branch.value, createEffectName).find(call => Array.isArray(call.value));
    const outputRarity = one(createCall.value, "RARITY", recipe + " rarity condition");
    if (outputRarity === "common") {
      assert.equal(branch.key, "else", recipe + " common output must be the final fallback");
      continue;
    }
    assert.ok(["if", "else_if"].includes(branch.key), recipe + " qualified output must have a rarity condition");
    const limit = values(branch.value, "limit").find(Array.isArray);
    assert.ok(limit, recipe + " " + outputRarity + " output must have a limit");
    for (const scope of scopes) {
      const inputChecks = nestedKeys(limit, "scope:" + scope).filter(entry => Array.isArray(entry.value));
      assert.equal(inputChecks.length, 1,
        recipe + " " + outputRarity + " condition must check input " + scope + " exactly once");
      const allowedRarities = nestedKeys(inputChecks[0].value, "rarity")
        .map(entry => scalar(entry.value, recipe + " input rarity condition"))
        .sort();
      assert.deepEqual(allowedRarities, allowedInputsByOutput[outputRarity].slice().sort(),
        recipe + " " + outputRarity + " condition must apply its threshold to every input");
    }
  }
  const destroyedScopes = nestedKeys(effect, "destroy_artifact")
    .map(entry => entry.value).filter(value => typeof value === "string");
  for (const scope of scopes) {
    assert.equal(destroyedScopes.filter(value => value === "scope:" + scope).length, 1,
      recipe + " must consume selected material " + scope + " exactly once after creation");
  }
  assert.deepEqual(destroyedScopes.slice().sort(), scopes.map(scope => "scope:" + scope).sort(),
    recipe + " must consume only its exact selected inputs");
  assert.ok(hasEffectCall(forgeOptions[recipe], effectName), "popup must route the " + recipe + " choice to its public forge effect");
}

const createHelper = effectDefinitions.get(createEffectName);
assert.ok(nestedKeys(createHelper, "create_artifact").length >= 1, "shared helper must create a dragon weapon");
assert.ok(nestedKeys(createHelper, "clear_saved_scope").some(entry => entry.value === forgedScopeName),
  "shared helper must clear stale forged-weapon scope at entry");
assert.ok(nestedKeys(createHelper, "save_scope_as").some(entry => entry.value === forgedScopeName),
  "successful create must save the forged-weapon scope");


function resolveRarity(value, current, state, parameters) {
  const raw = resolveValue(value, current, state, parameters);
  if (typeof raw === "string" && rarityRank.has(raw)) return raw;
  return raw;
}

function compare(actual, operator, expected) {
  if (operator === "=") return actual === expected;
  if (operator === "!=") return actual !== expected;
  if (operator === ">=") return actual >= expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === "<") return actual < expected;
  throw new Error("unsupported PDX comparison operator " + operator);
}

function evaluateTrigger(block, current, state, parameters = {}) {
  return block.every(entry => evaluateTriggerEntry(entry, current, state, parameters));
}

function evaluateTriggerEntry(entry, current, state, parameters) {
  if (entry.key === "AND") return entry.value.every(child => evaluateTriggerEntry(child, current, state, parameters));
  if (entry.key === "OR") return entry.value.some(child => evaluateTriggerEntry(child, current, state, parameters));
  if (entry.key === "NOT") return !evaluateTrigger(entry.value, current, state, parameters);
  if (entry.key && entry.key.startsWith("scope:") && Array.isArray(entry.value)) {
    const scoped = state.scopes.get(entry.key.slice(6));
    return isExistingScope(scoped) && evaluateTrigger(entry.value, scoped, state, parameters);
  }
  if (entry.key === "exists") return isExistingScope(resolveValue(entry.value, current, state, parameters));
  if (entry.key === "is_alive") return Boolean(current.alive) === (resolveValue(entry.value, current, state, parameters) === true);
  if (entry.key === "is_equipped") return Boolean(current.equipped) === (resolveValue(entry.value, current, state, parameters) === true);
  if (entry.key === "is_ai") return Boolean(current.isAi) === (resolveValue(entry.value, current, state, parameters) === true);
  if (entry.key === "is_owned_by" || entry.key === "owner" || entry.key === "artifact_owner") {
    const expectedOwner = resolveValue(entry.value, current, state, parameters);
    return current.owner === state.actor.id && (expectedOwner === state.actor || expectedOwner === state.actor.id || expectedOwner === "root");
  }
  if (entry.key === "this") return current === resolveValue(entry.value, current, state, parameters);
  if (entry.key === "rarity") {
    const expected = resolveRarity(entry.value, current, state, parameters);
    if (rarityRank.has(current.rarity) && rarityRank.has(expected)) {
      return compare(rarityRank.get(current.rarity), entry.operator || "=", rarityRank.get(expected));
    }
    return compare(current.rarity, entry.operator || "=", expected);
  }
  if (entry.key === "artifact_slot_type" || entry.key === "slot") {
    return compare(current.slot, entry.operator || "=", resolveValue(entry.value, current, state, parameters));
  }
  if (entry.key === "has_variable" || entry.key === "has_artifact_flag") {
    return current.variables instanceof Map && current.variables.has(resolveValue(entry.value, current, state, parameters));
  }
  if (entry.key === "has_artifact_modifier") {
    return current.modifiers instanceof Set && current.modifiers.has(resolveValue(entry.value, current, state, parameters));
  }
  if (entry.key === "has_trait") {
    return current.traits instanceof Set && current.traits.has(resolveValue(entry.value, current, state, parameters));
  }
  if (entry.key === "any_character_artifact" || entry.key === "any_artifact") {
    const count = entry.value.find(child => child.key === "count");
    const filter = entry.value.filter(child => child.key !== "count");
    const matches = state.artifacts.filter(artifact => artifact.exists && artifact.owner === state.actor.id
      && evaluateTrigger(filter, artifact, state, parameters));
    return count ? compare(matches.length, count.operator || "=", Number(count.value)) : matches.length > 0;
  }
  if (entry.key === "custom_description") {
    return evaluateTrigger(entry.value.filter(child => child.key !== "text"), current, state, parameters);
  }
  if (entry.key && entry.key.startsWith("var:")) {
    const actual = current.variables.get(entry.key.slice(4));
    return compare(actual, entry.operator || "=", resolveValue(entry.value, current, state, parameters));
  }
  const scripted = triggerDefinitions.get(entry.key);
  if (scripted) {
    if (Array.isArray(entry.value)) {
      const local = Object.fromEntries(entry.value.filter(child => child.key)
        .map(child => [child.key, resolveValue(child.value, current, state, parameters)]));
      return evaluateTrigger(scripted, current, state, { ...parameters, ...local });
    }
    return resolveValue(entry.value, current, state, parameters) === true
      && evaluateTrigger(scripted, current, state, parameters);
  }
  throw new Error("finite forging trigger interpreter has no rule for " + String(entry.key));
}

function conditionBlock(branch) {
  const conditions = values(branch, "limit").filter(Array.isArray);
  assert.equal(conditions.length, 1, "effect branch must have one limit block");
  return conditions[0];
}

function runEffectList(block, current, state, parameters = {}) {
  let previous = null;
  for (const entry of block) {
    if (entry.key === "if") {
      const taken = runEffectBranch(entry.value, current, state, parameters);
      previous = { taken };
    } else if (entry.key === "else_if") {
      assert(previous, "else_if has no preceding if");
      const taken = !previous.taken && runEffectBranch(entry.value, current, state, parameters);
      previous.taken = previous.taken || taken;
    } else if (entry.key === "else") {
      assert(previous, "else has no preceding if");
      if (!previous.taken) runEffectList(entry.value, current, state, parameters);
      previous = null;
    } else {
      previous = null;
      runEffectEntry(entry, current, state, parameters);
    }
  }
}

function runEffectBranch(branch, current, state, parameters) {
  if (!evaluateTrigger(conditionBlock(branch), current, state, parameters)) return false;
  runEffectList(branch.filter(entry => entry.key !== "limit"), current, state, parameters);
  return true;
}

function orderedCharacterArtifacts(block, current, state, parameters) {
  const limit = values(block, "limit").find(Array.isArray);
  const orderBy = values(block, "order_by").find(value => typeof value === "string");
  const maximum = Number(values(block, "max").find(value => typeof value === "string") || state.artifacts.length);
  let matches = state.artifacts.filter(artifact => artifact.exists && artifact.owner === state.actor.id
    && (!limit || evaluateTrigger(limit, artifact, state, parameters)));
  if (orderBy === "artifact_rarity") {
    matches.sort((left, right) => rarityRank.get(right.rarity) - rarityRank.get(left.rarity));
  }
  matches = matches.slice(0, maximum);
  const saveScope = values(block, "save_scope_as").find(value => typeof value === "string");
  for (const artifact of matches) {
    if (saveScope) state.scopes.set(saveScope, artifact);
    const body = block.filter(entry => !["limit", "order_by", "max", "save_scope_as"].includes(entry.key));
    runEffectList(body, artifact, state, parameters);
  }
  state.orderedSelections.push({ current, saveScope, ids: matches.map(artifact => artifact.id), orderBy, maximum });
}

function executeRandomList(list, current, state, parameters) {
  const options = list.filter(entry => /^\d+(?:\.\d+)?$/.test(String(entry.key)) && Array.isArray(entry.value))
    .filter(entry => {
      const triggers = values(entry.value, "trigger").filter(Array.isArray);
      assert.ok(triggers.length <= 1, "random option must have at most one trigger");
      return !triggers.length || evaluateTrigger(triggers[0], current, state, parameters);
    });
  assert.ok(options.length, "random list has no eligible options");
  const total = options.reduce((sum, option) => sum + Number(option.key), 0);
  state.randomSeed = (Math.imul(state.randomSeed, 1664525) + 1013904223) >>> 0;
  let roll = (state.randomSeed / 0x100000000) * total;
  let selected = options[options.length - 1];
  for (const option of options) {
    roll -= Number(option.key);
    if (roll < 0) {
      selected = option;
      break;
    }
  }
  state.randomSelections.push(selected.key);
  runEffectList(selected.value.filter(entry => entry.key !== "trigger"), current, state, parameters);
}

function createArtifact(definition, current, state, parameters) {
  if (state.createFailuresRemaining > 0 || state.suppressCreation) {
    state.createFailuresRemaining = Math.max(0, state.createFailuresRemaining - 1);
    return null;
  }
  const valueOf = key => {
    const value = values(definition, key).find(candidate => typeof candidate === "string");
    return value === undefined ? undefined : resolveValue(value, current, state, parameters);
  };
  const artifact = {
    id: "forged_" + String(state.createdArtifacts.length + 1),
    owner: state.actor.id,
    creator: valueOf("creator"),
    name: valueOf("name"),
    description: valueOf("description"),
    type: valueOf("type"),
    visuals: valueOf("visuals"),
    rarity: valueOf("rarity"),
    slot: valueOf("slot") || "weapon",
    equipped: false,
    exists: true,
    variables: new Map(),
    modifiers: new Set(),
    modifierAdds: [],
    stats: {},
  };
  assert.ok(rarityRank.has(artifact.rarity), "created dragon weapon must use a supported rarity");
  state.createdArtifacts.push(artifact);
  state.artifacts.push(artifact);
  for (const modifier of values(definition, "modifier")) {
    if (typeof modifier === "string") addModifier(artifact, resolveValue(modifier, current, state, parameters), modifierDefinitions, "create_artifact");
    else if (Array.isArray(modifier)) {
      for (const nested of modifier) {
        if (nested.key === "add_artifact_modifier") {
          addModifier(artifact, resolveValue(nested.value, artifact, state, parameters), modifierDefinitions, "create_artifact");
        }
      }
    }
  }
  for (const modifier of values(definition, "add_artifact_modifier")) {
    addModifier(artifact, resolveValue(modifier, artifact, state, parameters), modifierDefinitions, "create_artifact");
  }
  const scope = values(definition, "save_scope_as").find(value => typeof value === "string");
  if (scope) state.scopes.set(scope, artifact);
  return artifact;
}

function runEffectEntry(entry, current, state, parameters) {
  if (entry.key === "hidden_effect" || entry.key === "show_as_tooltip") {
    runEffectList(entry.value, current, state, parameters);
    return;
  }
  if (entry.key === "root") {
    runEffectList(entry.value, state.actor, state, parameters);
    return;
  }
  if (entry.key && entry.key.startsWith("scope:") && Array.isArray(entry.value)) {
    const scoped = state.scopes.get(entry.key.slice(6));
    if (isExistingScope(scoped)) runEffectList(entry.value, scoped, state, parameters);
    return;
  }
  if (entry.key && entry.key.startsWith("var:") && Array.isArray(entry.value)) {
    const scoped = current.variables.get(entry.key.slice(4));
    if (isExistingScope(scoped)) runEffectList(entry.value, scoped, state, parameters);
    return;
  }
  if (entry.key === "save_scope_as") {
    state.scopes.set(resolveValue(entry.value, current, state, parameters), current);
    return;
  }
  if (entry.key === "clear_saved_scope") {
    state.scopes.delete(resolveValue(entry.value, current, state, parameters));
    return;
  }
  if (entry.key === "set_variable") {
    const name = scalar(values(entry.value, "name").find(value => typeof value === "string"), "set_variable.name");
    const value = values(entry.value, "value").find(candidate => typeof candidate === "string");
    current.variables.set(name, resolveValue(value, current, state, parameters));
    return;
  }
  if (entry.key === "set_artifact_flag" || entry.key === "add_artifact_flag") {
    current.variables.set(resolveValue(entry.value, current, state, parameters), true);
    return;
  }
  if (entry.key === "remove_artifact_flag") {
    current.variables.delete(resolveValue(entry.value, current, state, parameters));
    return;
  }
  if (entry.key === "ordered_character_artifact") {
    orderedCharacterArtifacts(entry.value, current, state, parameters);
    return;
  }
  if (entry.key === "create_artifact") {
    createArtifact(entry.value, current, state, parameters);
    return;
  }
  if (entry.key === "destroy_artifact") {
    const artifact = resolveValue(entry.value, current, state, parameters);
    if (artifact && artifact.exists !== false) {
      artifact.exists = false;
      state.destroyedArtifacts.push(artifact.id);
    }
    return;
  }
  if (entry.key === "add_artifact_modifier") {
    addModifier(current, resolveValue(entry.value, current, state, parameters), modifierDefinitions, "add_artifact_modifier");
    return;
  }
  if (entry.key === "remove_artifact_modifier") {
    current.modifiers.delete(resolveValue(entry.value, current, state, parameters));
    return;
  }
  if (entry.key === "random_list") {
    executeRandomList(entry.value, current, state, parameters);
    return;
  }
  if (entry.key === "trigger_event") {
    state.triggerEvents.push(resolveValue(entry.value, current, state, parameters));
    return;
  }
  if (entry.key === "send_interface_toast" || entry.key === "add_artifact_history") return;
  const scripted = effectDefinitions.get(entry.key);
  if (scripted) {
    const local = Array.isArray(entry.value)
      ? Object.fromEntries(entry.value.filter(child => child.key)
        .map(child => [child.key, resolveValue(child.value, current, state, parameters)]))
      : {};
    state.effectCalls.push(entry.key);
    runEffectList(scripted, current, state, { ...parameters, ...local });
    return;
  }
  if (["add_gold", "add_prestige", "add_piety", "add_opinion", "change_variable", "change_gold"].includes(entry.key)) return;
  if (["name", "description", "type", "visuals", "creator", "rarity", "slot", "custom_tooltip", "ai_chance", "title", "artifact", "location"].includes(entry.key)) return;
  throw new Error("finite forging effect interpreter has no rule for " + String(entry.key));
}

function openForgingPopup(state, label) {
  const previousEvents = state.triggerEvents.length;
  const previousSelections = state.effectCalls.filter(name => name === selectMaterialsEffectName).length;
  assert.equal(executeDecision(forgeDecision.block, state), true, label + " must pass decision guards");
  assert.deepEqual(state.triggerEvents.slice(previousEvents), [forgeEvent.id], label + " decision must open the expected popup once");
  executeEventImmediate(forgeEvent.block, state);
  assert.equal(state.effectCalls.filter(name => name === selectMaterialsEffectName).length - previousSelections, 1,
    label + " popup must select materials once before any forge wrapper runs");
}

function forgeFromPopup(state, recipe, label) {
  const option = forgeOptions[recipe];
  assert.equal(eventOptionIsAvailable(option, state), true, label + " choice must be enabled");
  executeEventOption(option, state);
  const scopes = recipe === "sword" ? swordScopes : bowScopes;
  const inputRanks = scopes.map(scope => rarityRank.get(state.scopes.get(scope).rarity));
  return assertCrafted(state, recipe, rarities[Math.min(...inputRanks)], label);
}

function assertPopupScopesCleared(state, label) {
  executeEventAfter(forgeEvent.block, state);
  const tempMaterialScopes = ["a", "b", "c", "d", "e", "f", "g"]
    .map(suffix => "mm_wyvern_forge_material_" + suffix);
  for (const name of [...swordScopes, ...bowScopes, ...tempMaterialScopes, forgedScopeName]) {
    assert.equal(state.scopes.has(name), false, label + " must clear temporary scope " + name);
  }
}

function itemId(type, rarity, second = false) {
  return "typed_" + type + (second ? "_second" : "") + "_" + rarity;
}

function forEachRarityTuple(length, callback, prefix = []) {
  if (prefix.length === length) {
    callback(prefix.slice());
    return;
  }
  for (const rarity of rarities) forEachRarityTuple(length, callback, [...prefix, rarity]);
}

function recipeIds(recipe, quality) {
  return recipe === "sword"
    ? [itemId("fang", quality[0]), itemId("fang", quality[1], true), itemId("claw", quality[2]), itemId("horn", quality[3])]
    : [itemId("scale", quality[0]), itemId("scale", quality[1], true), itemId("horn", quality[2])];
}

for (const [recipe, inputCount] of [["sword", 4], ["bow", 3]]) {
  forEachRarityTuple(inputCount, quality => {
    const ids = recipeIds(recipe, quality);
    const state = makeState(ids);
    const label = recipe + " " + quality.join("/");
    openForgingPopup(state, label);
    const scopes = recipe === "sword" ? swordScopes : bowScopes;
    assert.deepEqual(scopes.map(scope => state.scopes.get(scope)?.id).sort(), ids.slice().sort(),
      label + " must bind the exact distinct same-kind inputs and all remaining ingredients");
    const repeatedScopes = scopes.slice(0, 2);
    const selectedRanks = repeatedScopes.map(scope => rarityRank.get(state.scopes.get(scope).rarity)).sort((left, right) => right - left);
    const expectedRanks = quality.slice(0, 2).map(rarity => rarityRank.get(rarity)).sort((left, right) => right - left);
    assert.deepEqual(selectedRanks, expectedRanks,
      label + " must select the highest available repeated-kind inputs without assuming tie order");
    const expectedRarity = rarities[Math.min(...quality.map(item => rarityRank.get(item)))];
    const weapon = forgeFromPopup(state, recipe, label);
    assert.equal(weapon.rarity, expectedRarity, label + " quality must be the lowest of all recipe inputs");
    assertPopupScopesCleared(state, label);
  });
}

// Each selector chooses the highest-rarity typed item; untyped court trophies never fill an unknown category.
{
  const state = makeState([
    "typed_fang_common", "typed_fang_illustrious", "typed_fang_second_common", "typed_fang_second_masterwork",
    "typed_claw_common", "typed_claw_masterwork", "typed_claw_famed",
    "typed_horn_common", "typed_horn_famed", "legacy_pedestal_illustrious",
  ]);
  openForgingPopup(state, "typed-priority and ordered selection");
  assert.equal(state.scopes.get(swordScopes[0]).id, "typed_fang_illustrious",
    "first typed fang must select its highest-rarity item");
  assert.equal(state.scopes.get(swordScopes[1]).id, "typed_fang_second_masterwork",
    "second fang must select the next-highest distinct typed item");
  assert.equal(state.scopes.get(swordScopes[2]).id, "typed_claw_famed",
    "claw selector must choose its highest-rarity typed item");
  assert.equal(state.scopes.get(swordScopes[3]).id, "typed_horn_famed",
    "typed horn must fill the horn slot instead of guessing from an untyped pedestal");
  forgeFromPopup(state, "sword", "typed-priority and ordered selection");
  assert.equal(state.artifacts.find(artifact => artifact.id === "legacy_pedestal_illustrious").exists, true,
    "unknown untyped pedestal must remain unused");
  assertPopupScopesCleared(state, "typed-priority and ordered selection");
}

// Bow selection must also bind the highest-rarity two scales and highest horn, ignoring extra lower-tier candidates.
{
  const state = makeState([
    "typed_scale_illustrious", "typed_scale_second_famed", "typed_scale_common", "typed_scale_second_common",
    "typed_horn_common", "typed_horn_illustrious",
  ]);
  openForgingPopup(state, "bow ordered selection");
  assert.equal(state.scopes.get(bowScopes[0]).id, "typed_scale_illustrious");
  assert.equal(state.scopes.get(bowScopes[1]).id, "typed_scale_second_famed");
  assert.equal(state.scopes.get(bowScopes[2]).id, "typed_horn_illustrious");
  forgeFromPopup(state, "bow", "bow ordered selection");
  assertPopupScopesCleared(state, "bow ordered selection");
}

// Untyped legacy pedestal trophies do not satisfy any recipe category.
{
  for (const ids of [
    ["legacy_pedestal_illustrious"],
    ["legacy_pedestal_common", "legacy_pedestal_illustrious"],
    ["typed_fang_common", "typed_fang_second_common", "typed_claw_common", "legacy_pedestal_illustrious"],
    ["typed_scale_common", "typed_scale_second_common", "legacy_pedestal_illustrious"],
  ]) {
    const state = makeState(ids);
    assert.equal(executeDecision(forgeDecision.block, state), false,
      "unknown untyped pedestal must not be guessed as a recipe material: " + ids.join(", "));
    assert.deepEqual(state.triggerEvents, [], "invalid untyped recipe must not open the popup");
  }
}

// Source-tagged native fang and native scale flags remain supported; old head display pieces are not recipe materials.
{
  const legacyFang = makeState([
    "legacy_native_fang", "typed_fang_common", "typed_claw_famed", "typed_horn_masterwork",
  ]);
  openForgingPopup(legacyFang, "native source-tagged fang");
  assert.equal(legacyFang.scopes.get(swordScopes[0]).id, "legacy_native_fang",
    "source-tagged native miscellaneous fang remains eligible");
  assert.equal(legacyFang.scopes.get(swordScopes[1]).id, "typed_fang_common",
    "legacy and typed fang inputs must still be distinct");
  forgeFromPopup(legacyFang, "sword", "native source-tagged fang");
  assertPopupScopesCleared(legacyFang, "native source-tagged fang");

  const legacyScale = makeState([
    "native_scale_flag", "typed_scale_common", "typed_horn_famed",
  ]);
  openForgingPopup(legacyScale, "native scale flag");
  assert.equal(legacyScale.scopes.get(bowScopes[0]).id, "native_scale_flag",
    "native scale flag remains eligible for the scale category");
  assert.equal(legacyScale.scopes.get(bowScopes[1]).id, "typed_scale_common",
    "native and typed scale inputs must be distinct");
  forgeFromPopup(legacyScale, "bow", "native scale flag");
  assertPopupScopesCleared(legacyScale, "native scale flag");

  const oldHead = makeState(["legacy_head_wall_small", "typed_scale_common", "typed_scale_second_common"]);
  assert.equal(executeDecision(forgeDecision.block, oldHead), false,
    "legacy head court artifact must not substitute for the new horn requirement");
}

// The popup may share one horn scope across alternative recipes, but the selected branch consumes it once.
{
  const state = makeState([
    "typed_fang_common", "typed_fang_second_common", "typed_claw_common",
    "typed_scale_common", "typed_scale_second_common", "typed_horn_illustrious",
  ]);
  openForgingPopup(state, "alternative recipes share one horn");
  assert.equal(state.scopes.get(swordScopes[3]).id, "typed_horn_illustrious");
  assert.equal(state.scopes.get(bowScopes[2]).id, "typed_horn_illustrious",
    "both alternatives may preview the same horn artifact");
  assert.equal(eventOptionIsAvailable(forgeOptions.sword, state), true);
  assert.equal(eventOptionIsAvailable(forgeOptions.bow, state), true);
  forgeFromPopup(state, "sword", "alternative recipes share one horn");
  assert.equal(eventOptionIsAvailable(forgeOptions.bow, state), false,
    "after sword consumes the shared horn, bow must no longer be a valid stale choice");
  executeEventOption(forgeOptions.bow, state);
  assert.equal(state.createdArtifacts.length, 1, "one popup can create only the selected recipe");
  assert.equal(state.destroyedArtifacts.length, swordScopes.length, "shared horn is consumed once with the selected recipe");
  for (const id of ["typed_scale_common", "typed_scale_second_common"]) {
    assert.equal(state.artifacts.find(artifact => artifact.id === id).exists, true,
      "unselected bow materials remain untouched");
  }
  assertPopupScopesCleared(state, "alternative recipes share one horn");
}

for (const invalidIds of [
  ["typed_eye_famed"],
  ["typed_fang_common", "typed_fang_second_common", "typed_claw_common"],
  ["typed_fang_common", "typed_claw_common", "typed_horn_common"],
  ["typed_scale_common", "typed_scale_second_common"],
  ["typed_scale_common", "typed_horn_common"],
  ["typed_fang_common", "typed_claw_common", "typed_horn_common", "native_scale_flag"],
  ["typed_scale_common", "typed_scale_second_common", "native_scale_flag"],
  ["equipped_typed_fang", "typed_fang_second_common", "typed_claw_common", "typed_horn_common"],
  ["typed_fang_common", "typed_fang_second_common", "other_owner_typed_claw", "typed_horn_common"],
  ["typed_fang_common", "typed_fang_second_common", "unmarked_pedestal", "typed_horn_common"],
  ["typed_scale_common", "typed_scale_second_common", "legacy_head_wall_small"],
  ["legacy_native_blood", "typed_fang_common", "typed_claw_common", "typed_horn_common"],
  ["typed_head_common", "legacy_head_wrong_slot"],
]) {
  const state = makeState(invalidIds);
  assert.equal(executeDecision(forgeDecision.block, state), false,
    "invalid materials must not satisfy a recipe: " + invalidIds.join(", "));
  assert.deepEqual(state.triggerEvents, [], "invalid materials must not open the popup");
}

// Recipe options cannot cross-consume the other recipe's ingredients.
for (const [validRecipe, invalidRecipe, ids] of [
  ["sword", "bow", recipeIds("sword", ["common", "common", "common", "common"])],
  ["bow", "sword", recipeIds("bow", ["common", "common", "common"])],
]) {
  const state = makeState(ids);
  openForgingPopup(state, validRecipe + " materials only");
  assert.equal(eventOptionIsAvailable(forgeOptions[invalidRecipe], state), false,
    invalidRecipe + " option must be disabled without its own ingredients");
  executeEventOption(forgeOptions[invalidRecipe], state);
  assertNotCrafted(state, invalidRecipe + " cannot consume " + validRecipe + " ingredients");
  assert.ok(state.artifacts.filter(artifact => !artifact.id.startsWith("forged_")).every(artifact => artifact.exists),
    "cross-recipe attempt must leave all inputs intact");
  executeEventOption(forgeOptions[validRecipe], state);
  assert.equal(state.createdArtifacts.length, 1, validRecipe + " option must still work after rejected cross-recipe attempt");
  assertPopupScopesCleared(state, validRecipe + " materials only");
}

// The popup binds every exact input; stale ownership, equipment, existence, and material identity cannot trigger replacement.
function richRecipeInventory(recipe) {
  return recipe === "sword"
    ? ["typed_fang_illustrious", "typed_fang_second_famed", "typed_fang_common", "typed_fang_second_common",
      "typed_claw_illustrious", "typed_claw_common", "typed_horn_illustrious", "typed_horn_common"]
    : ["typed_scale_illustrious", "typed_scale_second_famed", "typed_scale_common", "typed_scale_second_common",
      "typed_horn_illustrious", "typed_horn_common"];
}

const staleMutations = [
  ["transferred", artifact => { artifact.owner = "other"; }],
  ["equipped", artifact => { artifact.equipped = true; }],
  ["destroyed", artifact => { artifact.exists = false; }],
  ["expired", artifact => { artifact.expired = true; artifact.exists = false; }],
  ["wrong material", artifact => { artifact.variables.set("mm_wyvern_material_kind", "flag:eye"); }],
];
for (const recipe of ["sword", "bow"]) {
  const scopes = recipe === "sword" ? swordScopes : bowScopes;
  for (let selectedIndex = 0; selectedIndex < scopes.length; selectedIndex += 1) {
    for (const [labelSuffix, mutate] of staleMutations) {
      const state = makeState(richRecipeInventory(recipe));
      const label = "stale " + recipe + " " + scopes[selectedIndex] + " " + labelSuffix;
      openForgingPopup(state, label);
      const stale = state.scopes.get(scopes[selectedIndex]);
      assert.ok(stale, label + " must bind a concrete artifact");
      const selectedIds = scopes.map(scope => state.scopes.get(scope).id);
      assert.equal(new Set(selectedIds).size, scopes.length, label + " must start with distinct inputs");
      const selectionCount = state.orderedSelections.length;
      const helperCallCount = state.effectCalls.filter(name => name === selectMaterialsEffectName).length;
      mutate(stale);
      assert.equal(eventOptionIsAvailable(forgeOptions[recipe], state), false, label + " must disable its recipe option");
      executeEventOption(forgeOptions[recipe], state);
      assertNotCrafted(state, label + " choice");
      assert.equal(state.orderedSelections.length, selectionCount, label + " must not select replacement materials");
      assert.equal(state.effectCalls.filter(name => name === selectMaterialsEffectName).length, helperCallCount,
        label + " must not rerun popup material selection");
      for (const candidate of state.artifacts.filter(artifact => !selectedIds.includes(artifact.id))) {
        assert.equal(candidate.exists, true, label + " must leave every unselected fallback untouched");
      }
      assertPopupScopesCleared(state, label);
    }
  }
}

// Failed create, cancellation, and repeated clicks are checked with every ingredient in both recipes.
for (const [recipe, quality] of [["sword", ["common", "masterwork", "famed", "illustrious"]],
  ["bow", ["common", "masterwork", "illustrious"]]]) {
  const ids = recipeIds(recipe, quality);
  const failed = makeState(ids);
  const label = recipe + " failed create";
  openForgingPopup(failed, label);
  failed.suppressCreation = true;
  executeEventOption(forgeOptions[recipe], failed);
  assertNotCrafted(failed, label);
  assert.ok(failed.artifacts.filter(artifact => ids.includes(artifact.id)).every(artifact => artifact.exists),
    label + " must preserve every ingredient");
  assertPopupScopesCleared(failed, label);

  failed.suppressCreation = false;
  openForgingPopup(failed, recipe + " retry after create failure");
  forgeFromPopup(failed, recipe, recipe + " retry after create failure");
  assertPopupScopesCleared(failed, recipe + " retry after create failure");

  const repeated = makeState(ids);
  openForgingPopup(repeated, recipe + " repeated click");
  executeEventOption(forgeOptions[recipe], repeated);
  assert.equal(repeated.createdArtifacts.length, 1, recipe + " first click must create one weapon");
  assert.equal(repeated.destroyedArtifacts.length, ids.length, recipe + " first click consumes every ingredient once");
  executeEventOption(forgeOptions[recipe], repeated);
  assert.equal(repeated.createdArtifacts.length, 1, recipe + " second click must not create another weapon");
  assert.equal(repeated.destroyedArtifacts.length, ids.length, recipe + " second click must not consume more materials");
  assertPopupScopesCleared(repeated, recipe + " repeated click");

  const cancelled = makeState(ids);
  openForgingPopup(cancelled, recipe + " cancel choice");
  executeEventOption(forgeOptions.cancel, cancelled);
  assertNotCrafted(cancelled, recipe + " cancel choice");
  assert.ok(cancelled.artifacts.filter(artifact => ids.includes(artifact.id)).every(artifact => artifact.exists),
    recipe + " cancellation must preserve every input");
  assertPopupScopesCleared(cancelled, recipe + " cancel choice");

  const dead = makeState(ids, { actorAlive: false });
  assert.equal(executeDecision(forgeDecision.block, dead), false,
    "dead root must not open the " + recipe + " forging popup");
}

console.log("Wyvern v1.1.5 forging: PASS (320 min-rarity combinations, <=10 distinct stats, typed and native legacy inputs, exact 4/3 consumption, stale/failure/cancel/repeat paths; finite engine model)");

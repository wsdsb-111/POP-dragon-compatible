"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const modRoot = path.join(root, "patches", "wyvern-capture", "mod");
const trophyEffectsPath = path.join(modRoot, "common", "scripted_effects", "mm_wyvern_trophies.txt");
const affixEffectsPath = path.join(modRoot, "common", "scripted_effects", "mm_wyvern_trophy_affixes.txt");
const onActionsPath = path.join(modRoot, "common", "on_action", "zzzz_mm_wyvern_capture_on_actions.txt");
const captureSourcesPath = path.join(root, "patches", "wyvern-capture", "sources.json");
const nativeFixturePath = path.join(root, "tests", "fixtures", "v117", "original-slay-create-trophy.txt");
const materialsFixturePath = path.join(root, "tests", "fixtures", "v117", "original-material-states.json");

function tokenizePdx(source, label) {
  const tokens = [];
  for (let index = source.charCodeAt(0) === 0xfeff ? 1 : 0; index < source.length;) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
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
      assert.ok(closed, label + " has an unterminated quoted token");
      tokens.push({ type: "scalar", value });
    } else if (character === "{") {
      tokens.push({ type: "open", value: character });
      index += 1;
    } else if (character === "}") {
      tokens.push({ type: "close", value: character });
      index += 1;
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
      assert.ok(valueToken, label + " has a key with no value");
      assert.notEqual(valueToken.type, "close", label + " has a key with no value");
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
  const entries = parseEntries(false);
  assert.equal(cursor, tokens.length, label + " has trailing PDX tokens");
  return { kind: "block", entries };
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

function oneScalar(value, key, label) {
  return scalar(one(value, key, label), label + "." + key);
}

function namedBlock(value, name, label) {
  return block(one(value, name, label), label + "." + name);
}

function canonical(value) {
  if (value.kind === "scalar") return ["scalar", value.value];
  return value.entries.map(entry => [entry.key, entry.operator, canonical(entry.value)]);
}

function containsValue(value, expected) {
  if (value.kind === "scalar") return value.value === expected;
  return value.entries.some(entry => containsValue(entry.value, expected));
}

function readNativeSource(fixtureSource, fixture, sourcesManifest) {
  const record = sourcesManifest.sourceFiles.find(source => source.path === fixture.sourcePath);
  assert.ok(record, "capture sources must record the upstream Wyvern effect source");
  assert.equal(record.sha256, fixture.sourceSha256,
    "frozen material fixture SHA must match capture source provenance");
  const explicitWorkshopRoot = Object.prototype.hasOwnProperty.call(process.env, "WYVERN_WORKSHOP_DIR");
  const workshopRoot = explicitWorkshopRoot ? process.env.WYVERN_WORKSHOP_DIR : sourcesManifest.sourceRoots.workshop;
  assert.ok(!explicitWorkshopRoot || workshopRoot,
    "WYVERN_WORKSHOP_DIR is explicitly set but empty; refusing to use the frozen native fixture");
  const nativePath = path.join(workshopRoot, ...fixture.sourcePath.split("/"));
  const nativeExists = fs.existsSync(nativePath);
  assert.ok(!explicitWorkshopRoot || nativeExists,
    "WYVERN_WORKSHOP_DIR is explicitly set but the native source is missing: " + nativePath);
  if (!nativeExists) return "frozen";

  const nativeBytes = fs.readFileSync(nativePath);
  const nativeSha = crypto.createHash("sha256").update(nativeBytes).digest("hex");
  assert.equal(nativeSha, fixture.sourceSha256, "installed upstream Wyvern effect SHA differs from frozen fixture");
  const fixtureAst = parsePdx(fixtureSource, nativeFixturePath);
  const nativeAst = parsePdx(nativeBytes.toString("utf8"), nativePath);
  assert.deepEqual(
    canonical(namedBlock(nativeAst, "myv_slay_create_trophy_effect", "installed upstream effects")),
    canonical(namedBlock(fixtureAst, "myv_slay_create_trophy_effect", "frozen upstream fixture")),
    "installed original loot effect AST must match its frozen excerpt"
  );
  return "live";
}

function artifactOutput(createBlock, label) {
  const modifiers = entries(createBlock, "modifier").map(entry => scalar(entry.value, label + ".modifier"));
  return {
    name: oneScalar(createBlock, "name", label),
    description: oneScalar(createBlock, "description", label),
    type: oneScalar(createBlock, "type", label),
    visuals: oneScalar(createBlock, "visuals", label),
    rarity: oneScalar(createBlock, "rarity", label),
    modifiers,
    creator: oneScalar(createBlock, "creator", label),
    decaying: oneScalar(createBlock, "decaying", label),
  };
}

function branchSizeLimit(branch, label) {
  const limit = namedBlock(branch, "limit", label);
  const target = namedBlock(limit, "scope:myv_slay_wyvern_target", label + ".limit");
  const size = entries(target, "var:myv_wyvern_size");
  assert.equal(size.length, 1, label + " must test wyvern size exactly once");
  assert.equal(size[0].operator, ">=", label + " must use a minimum size bound");
  return Number(scalar(size[0].value, label + ".size"));
}

function assertNativeLootFixture(originalAst, fixture) {
  const effect = namedBlock(originalAst, "myv_slay_create_trophy_effect", "original effects");
  const randomList = namedBlock(effect, "random_list", "original loot effect");
  const weighted = randomList.entries.filter(entry => entry.key && /^\d+$/.test(entry.key));
  assert.deepEqual(weighted.map(entry => entry.key).sort((a, b) => Number(a) - Number(b)), ["15", "20", "65"],
    "original loot must retain the 65/20/15 fang/scale/blood distribution");
  const byWeight = new Map(weighted.map(entry => [entry.key, block(entry.value, "loot weight " + entry.key)]));

  const fangBranches = [
    { branch: "if", minSize: 240 },
    { branch: "else_if", minSize: 150 },
    { branch: "else", minSize: null },
  ];
  const fangBucket = byWeight.get("65");
  for (const condition of fangBranches) {
    const branch = namedBlock(fangBucket, condition.branch, "fang size branch");
    if (condition.minSize === null) {
      assert.equal(entries(branch, "limit").length, 0, "small fang fallback must have no size limit");
    } else {
      assert.equal(branchSizeLimit(branch, "fang " + String(condition.minSize)), condition.minSize,
        "fang size threshold is wrong");
    }
    const create = namedBlock(branch, "create_artifact", "fang create_artifact");
    const output = artifactOutput(create, "fang " + String(condition.minSize));
    const fixtureCase = fixture.rawMaterialCases.find(item => item.material === "fang"
      && (condition.minSize === null ? item.size < 150 : item.size === condition.minSize));
    assert.ok(fixtureCase, "material fixture is missing a fang size case");
    assert.deepEqual(output, {
      name: fixtureCase.name,
      description: fixtureCase.description,
      type: "miscellaneous",
      visuals: fixtureCase.visuals,
      rarity: fixtureCase.rarity,
      modifiers: fixtureCase.baseModifiers,
      creator: "root",
      decaying: "no",
    }, "native fang material output differs from the frozen case " + fixtureCase.id);
  }

  for (const [weight, material] of [["20", "scale"], ["15", "blood"]]) {
    const bucket = byWeight.get(weight);
    const create = namedBlock(bucket, "create_artifact", material + " create_artifact");
    const fixtureCase = fixture.rawMaterialCases.find(item => item.material === material);
    assert.ok(fixtureCase, "material fixture is missing " + material);
    assert.deepEqual(artifactOutput(create, material), {
      name: fixtureCase.name,
      description: fixtureCase.description,
      type: "miscellaneous",
      visuals: fixtureCase.visuals,
      rarity: fixtureCase.rarity,
      modifiers: fixtureCase.baseModifiers,
      creator: "root",
      decaying: "no",
    }, "native " + material + " material output differs from fixture");
    const trophyScope = namedBlock(bucket, "scope:myv_wyvern_trophy", material + " native flag");
    const setVariable = entries(trophyScope, "set_variable").map(entry => block(entry.value, "native material flag"));
    assert.equal(setVariable.length, 1, material + " must retain its original native material marker");
    const nativeFlag = fixtureCase.nativeVariables;
    assert.equal(Object.keys(nativeFlag).length, 1, material + " fixture must contain one native flag");
    assert.equal(oneScalar(setVariable[0], "name", "native material flag"), Object.keys(nativeFlag)[0]);
    assert.equal(oneScalar(setVariable[0], "value", "native material flag"), Object.values(nativeFlag)[0]);
  }
  assert.equal(containsValue(effect, "myv_wyvern_legendary"), false,
    "original raw-material rarity must not depend on the legendary trait");
}

const sourcesManifest = JSON.parse(fs.readFileSync(captureSourcesPath, "utf8"));
const materialsFixture = JSON.parse(fs.readFileSync(materialsFixturePath, "utf8"));
const nativeFixtureSource = fs.readFileSync(nativeFixturePath, "utf8");
assert.match(nativeFixtureSource, new RegExp("^# source_path = " + materialsFixture.sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "m"),
  "upstream loot fixture must pin its source path");
assert.match(nativeFixtureSource, new RegExp("^# source_sha256 = " + materialsFixture.sourceSha256 + "$", "m"),
  "upstream loot fixture must pin its full source SHA-256");
const nativeFixtureAst = parsePdx(nativeFixtureSource, nativeFixturePath);
const nativeSourceMode = readNativeSource(nativeFixtureSource, materialsFixture, sourcesManifest);
assertNativeLootFixture(nativeFixtureAst, materialsFixture);

const trophyEffectsAst = parsePdx(fs.readFileSync(trophyEffectsPath, "utf8"), trophyEffectsPath);
const affixEffectsAst = parsePdx(fs.readFileSync(affixEffectsPath, "utf8"), affixEffectsPath);
const onActionsAst = parsePdx(fs.readFileSync(onActionsPath, "utf8"), onActionsPath);
const sourceMaterialEffect = namedBlock(trophyEffectsAst, "mm_wyvern_source_original_material_effect", "trophy effects");
const applyAffixesEffect = namedBlock(affixEffectsAst, "mm_wyvern_apply_trophy_affixes_effect", "affix effects");
const rollAffixEffect = namedBlock(affixEffectsAst, "mm_wyvern_roll_trophy_affix_effect", "affix effects");
const gameStartHook = namedBlock(onActionsAst, "on_game_start_after_lobby", "on actions");
const requiredMigrationNames = ["mm_wyvern_legacy_trophy_affixes", "mm_wyvern_legacy_material_affixes"];
const helpers = new Map([
  ["mm_wyvern_source_original_material_effect", sourceMaterialEffect],
  ["mm_wyvern_apply_trophy_affixes_effect", applyAffixesEffect],
  ["mm_wyvern_roll_trophy_affix_effect", rollAffixEffect],
]);

function resolve(value, current, state) {
  const raw = scalar(value, "script reference");
  if (raw === "root") return state.root;
  if (raw === "this") return current;
  if (raw.startsWith("scope:")) return state.scopes.get(raw.slice(6));
  if (raw.startsWith("flag:")) return raw;
  if (raw === "yes") return true;
  if (raw === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function evaluateTrigger(trigger, current, state) {
  return trigger.entries.every(entry => evaluateTriggerEntry(entry, current, state));
}

function evaluateTriggerEntry(entry, current, state) {
  const expected = entry.value.kind === "scalar" ? resolve(entry.value, current, state) : undefined;
  if (entry.key === "AND") return block(entry.value, "AND trigger").entries.every(child => evaluateTriggerEntry(child, current, state));
  if (entry.key === "OR") return block(entry.value, "OR trigger").entries.some(child => evaluateTriggerEntry(child, current, state));
  if (entry.key === "NOT") return !evaluateTrigger(block(entry.value, "NOT trigger"), current, state);
  if (entry.key === "exists") return Boolean(expected && expected.exists !== false);
  if (entry.key.startsWith("scope:") && entry.value.kind === "block") {
    const scoped = state.scopes.get(entry.key.slice(6));
    return Boolean(scoped) && evaluateTrigger(block(entry.value, "scoped trigger"), scoped, state);
  }
  if (entry.key.startsWith("var:")) {
    const actual = current.variables.get(entry.key.slice(4));
    if (entry.operator === ">=") return Number(actual) >= Number(expected);
    if (entry.operator === "<=") return Number(actual) <= Number(expected);
    if (entry.operator === ">") return Number(actual) > Number(expected);
    if (entry.operator === "<") return Number(actual) < Number(expected);
    return actual === expected;
  }
  if (entry.key === "has_variable") return current.variables.has(expected);
  if (entry.key === "has_artifact_modifier") return current.modifiers.has(expected);
  if (entry.key === "rarity") return current.rarity === expected;
  if (entry.key === "artifact_slot_type" || entry.key === "artifact_type") return current.slot === expected;
  throw new Error("v117 finite trigger interpreter has no rule for " + String(entry.key));
}

function effectBlocks(entry, label) {
  return block(entry.value, label);
}

function executeConditionalChain(entriesList, startIndex, current, state) {
  const chain = [];
  let index = startIndex;
  chain.push(entriesList[index]);
  while (index + 1 < entriesList.length && ["else_if", "else"].includes(entriesList[index + 1].key)) {
    index += 1;
    chain.push(entriesList[index]);
  }
  let chosen = false;
  for (const branch of chain) {
    const branchBlock = effectBlocks(branch, "conditional effect");
    const limits = entries(branchBlock, "limit");
    const allowed = branch.key === "else" || (limits.length === 1 && evaluateTrigger(block(limits[0].value, "effect limit"), current, state));
    if (!chosen && allowed) {
      chosen = true;
      runEffectList(branchBlock, current, state);
    }
  }
  return index;
}

function runRandomList(randomList, current, state) {
  const outcomes = randomList.entries.filter(entry => entry.key && /^\d+$/.test(entry.key) && entry.value.kind === "block");
  const eligible = outcomes.filter(outcome => {
    const blockValue = block(outcome.value, "random outcome");
    const triggers = entries(blockValue, "trigger");
    assert.ok(triggers.length <= 1, "random outcome may have at most one trigger");
    return triggers.length === 0 || evaluateTrigger(block(triggers[0].value, "random outcome trigger"), current, state);
  });
  assert.ok(eligible.length > 0, "random_list must have an eligible outcome");
  runEffectList(block(eligible[0].value, "selected random outcome"), current, state);
}

function runEffectList(effectList, current, state) {
  for (let index = 0; index < effectList.entries.length; index += 1) {
    const entry = effectList.entries[index];
    if (entry.key === "if") {
      index = executeConditionalChain(effectList.entries, index, current, state);
      continue;
    }
    if (entry.key === "else_if" || entry.key === "else" || entry.key === "limit" || entry.key === "trigger") continue;
    if (entry.key?.startsWith("scope:") && entry.value.kind === "block") {
      const scoped = state.scopes.get(entry.key.slice(6));
      assert.ok(scoped, "effect scope is missing: " + entry.key);
      runEffectList(block(entry.value, "scoped effect " + entry.key), scoped, state);
      continue;
    }
    if (entry.key === "set_variable") {
      const command = block(entry.value, "set_variable");
      const name = oneScalar(command, "name", "set_variable");
      current.variables.set(name, resolve(one(command, "value", "set_variable"), current, state));
      continue;
    }
    if (entry.key === "save_scope_as") {
      state.scopes.set(scalar(entry.value, "save_scope_as"), current);
      continue;
    }
    if (entry.key === "set_artifact_name") {
      current.name = scalar(entry.value, "set_artifact_name");
      continue;
    }
    if (entry.key === "set_artifact_description") {
      current.description = scalar(entry.value, "set_artifact_description");
      continue;
    }
    if (entry.key === "remove_artifact_modifier") {
      current.modifiers.delete(scalar(entry.value, "remove_artifact_modifier"));
      continue;
    }
    if (entry.key === "add_artifact_modifier") {
      current.modifiers.add(scalar(entry.value, "add_artifact_modifier"));
      continue;
    }
    if (entry.key === "random_list") {
      runRandomList(block(entry.value, "random_list"), current, state);
      continue;
    }
    if (entry.key === "every_player") {
      for (const player of state.players) runEffectList(block(entry.value, "every_player"), player, state);
      continue;
    }
    if (entry.key === "every_character_artifact") {
      const iterator = block(entry.value, "every_character_artifact");
      const limits = entries(iterator, "limit");
      assert.ok(limits.length <= 1, "artifact iterator may have at most one limit");
      for (const artifact of current.artifacts) {
        if (limits.length === 0 || evaluateTrigger(block(limits[0].value, "artifact iterator limit"), artifact, state)) {
          runEffectList(iterator, artifact, state);
        }
      }
      continue;
    }
    if (entry.key === "mm_wyvern_source_original_material_effect"
      || entry.key === "mm_wyvern_apply_trophy_affixes_effect"
      || entry.key === "mm_wyvern_roll_trophy_affix_effect") {
      const helper = helpers.get(entry.key);
      state.effectCalls.push(entry.key);
      runEffectList(helper, current, state);
      continue;
    }
    if (["add_artifact_history", "send_interface_toast"].includes(entry.key)) continue;
    if (entry.key === "reforge_artifact") {
      const reforge = block(entry.value, "legacy slot conversion");
      const type = one(reforge, "type", "legacy slot conversion");
      current.slot = scalar(type, "legacy slot type");
      continue;
    }
    throw new Error("v117 finite effect interpreter has no rule for " + String(entry.key));
  }
}

function createArtifact(caseData, owner) {
  return {
    id: caseData.id,
    owner,
    slot: caseData.slot || "miscellaneous",
    rarity: caseData.rarity,
    name: caseData.name,
    description: caseData.description,
    variables: new Map(Object.entries(caseData.variables || caseData.nativeVariables || {})),
    modifiers: new Set(caseData.modifiers || caseData.baseModifiers || []),
    artifacts: [],
    exists: true,
  };
}

function newWorldState(players, source) {
  const rootCharacter = players[0];
  return {
    root: rootCharacter,
    players,
    scopes: new Map([
      ["root", rootCharacter],
      ["myv_slay_wyvern_target", source],
    ]),
    effectCalls: [],
  };
}

function assertAffixResults(artifact, baseModifiers, label) {
  const poolBlock = namedBlock(affixEffectsAst, "mm_wyvern_roll_trophy_affix_effect", "affix effects");
  const randomList = namedBlock(poolBlock, "random_list", "affix roll helper");
  const choices = randomList.entries.filter(entry => entry.key && /^\d+$/.test(entry.key) && entry.value.kind === "block");
  const categoryByModifier = new Map();
  for (let index = 0; index < choices.length; index += 1) {
    const choice = block(choices[index].value, "affix choice");
    const trigger = namedBlock(choice, "trigger", "affix choice");
    const not = namedBlock(trigger, "NOT", "affix choice trigger");
    const or = namedBlock(not, "OR", "affix category trigger");
    const variants = entries(or, "has_artifact_modifier").map(entry => scalar(entry.value, "affix modifier trigger"));
    assert.equal(variants.length, 2, "every affix category must exclude its two existing tiers");
    for (const variant of variants) categoryByModifier.set(variant, index);
  }
  const original = new Set(baseModifiers);
  for (const modifier of original) assert.ok(artifact.modifiers.has(modifier), label + " lost native base modifier " + modifier);
  const added = [...artifact.modifiers].filter(modifier => !original.has(modifier) && categoryByModifier.has(modifier));
  const expectedCount = artifact.rarity === "illustrious" ? 4 : 3;
  assert.equal(added.length, expectedCount, label + " must gain three affixes or four when illustrious");
  assert.equal(new Set(added.map(modifier => categoryByModifier.get(modifier))).size, expectedCount,
    label + " must not draw the same affix category twice");
  assert.equal(artifact.variables.get("mm_wyvern_trophy_affixes_generated"), 1,
    label + " must persist the idempotence marker");
  return added;
}

function assertNewMaterialPath() {
  for (const caseData of materialsFixture.rawMaterialCases) {
    const artifact = createArtifact(caseData, "root");
    const dragon = {
      id: "dragon_" + caseData.id,
      traits: new Set(caseData.sourceTraits),
      variables: new Map(caseData.size === null ? [] : [["myv_wyvern_size", caseData.size]]),
      exists: true,
    };
    const actor = { id: "root", traits: new Set(), variables: new Map(), artifacts: [] };
    const state = newWorldState([actor], dragon);
    state.scopes.set("myv_wyvern_trophy", artifact);
    runEffectList(sourceMaterialEffect, actor, state);

    assert.equal(artifact.rarity, caseData.rarity, caseData.id + " must preserve original rarity");
    assert.equal(artifact.name, "mm_wyvern_material_" + caseData.material + "_name",
      caseData.id + " must set the source-specific material name");
    assert.equal(artifact.description, "mm_wyvern_material_" + caseData.material + "_desc",
      caseData.id + " must set the source-specific material description");
    assert.equal(artifact.variables.get("mm_wyvern_trophy_source"), dragon,
      caseData.id + " must preserve its source dragon reference");
    assert.equal(artifact.variables.get("mm_wyvern_material_kind"), "flag:" + caseData.material,
      caseData.id + " must retain its material kind");
    for (const [name, value] of Object.entries(caseData.nativeVariables)) {
      assert.equal(artifact.variables.get(name), value, caseData.id + " must preserve native flag " + name);
    }
    assertAffixResults(artifact, caseData.baseModifiers, "new " + caseData.id);
    assert.equal(state.effectCalls.filter(name => name === "mm_wyvern_apply_trophy_affixes_effect").length, 1,
      caseData.id + " annotation path must invoke the affix helper exactly once");
  }
}

function snapshot(artifact) {
  return {
    name: artifact.name,
    description: artifact.description,
    rarity: artifact.rarity,
    slot: artifact.slot,
    modifiers: [...artifact.modifiers].sort(),
    variables: [...artifact.variables.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

function registeredGameStartMigrations() {
  const onActions = block(one(gameStartHook, "on_actions", "game start hook"), "game start on_actions");
  const hookNames = onActions.entries.filter(entry => entry.key === null)
    .map(entry => scalar(entry.value, "game start hook name"));
  for (const name of requiredMigrationNames) {
    assert.equal(hookNames.filter(hookName => hookName === name).length, 1,
      "game start must register exactly one " + name + " child");
  }
  assert.equal(new Set(hookNames).size, hookNames.length, "game start must not register a migration child twice");
  return hookNames.map(name => {
    const child = namedBlock(onActionsAst, name, "on actions");
    return { name, effect: block(one(child, "effect", name), name + " effect") };
  });
}

function assertRawMaterialMigrationShape() {
  const migration = namedBlock(onActionsAst, "mm_wyvern_legacy_material_affixes", "on actions");
  const effect = block(one(migration, "effect", "raw material migration"), "raw material migration effect");
  const player = block(one(effect, "every_player", "raw material migration"), "raw material migration every_player");
  const iterator = block(one(player, "every_character_artifact", "raw material migration"), "raw material artifact iterator");
  const limits = entries(iterator, "limit");
  assert.equal(limits.length, 1, "raw-material migration must put eligibility checks on each artifact");
  const limit = block(limits[0].value, "raw material migration limit");
  assert.ok(entries(limit, "has_variable").some(entry => scalar(entry.value, "raw migration source marker") === "mm_wyvern_trophy_source"),
    "raw-material migration must require this mod's source marker");
  assert.ok(entries(limit, "NOT").some(entry => entries(block(entry.value, "raw migration NOT"), "has_variable")
    .some(child => scalar(child.value, "raw migration generated marker") === "mm_wyvern_trophy_affixes_generated")),
  "raw-material migration must skip artifacts already upgraded");
  assert.ok(entries(limit, "artifact_slot_type").some(entry => scalar(entry.value, "raw migration slot") === "miscellaneous"),
    "raw-material migration must be restricted to miscellaneous artifacts");
  const raritySet = entries(limit, "OR").map(entry => entries(block(entry.value, "raw migration OR"), "rarity")
    .map(child => scalar(child.value, "raw migration rarity")).sort().join(","));
  assert.ok(raritySet.includes("common,famed,illustrious,masterwork"),
    "raw-material migration must cover only common through illustrious rarity tiers");
  const materialOr = entries(limit, "OR").map(entry => block(entry.value, "raw migration OR"))
    .find(candidate => entries(candidate, "has_variable").some(child => scalar(child.value, "native material flag") === "myv_wyvern_scale_material")
      && entries(candidate, "has_variable").some(child => scalar(child.value, "native material flag") === "myv_wyvern_blood_material"));
  assert.ok(materialOr, "raw-material migration must recognize native scale and blood flags");
  assert.deepEqual(entries(materialOr, "var:mm_wyvern_material_kind")
    .map(entry => scalar(entry.value, "typed material kind")).sort(),
  ["flag:blood", "flag:fang", "flag:scale"], "raw-material migration must recognize only the three supported typed kinds");
  assert.equal(entries(iterator, "mm_wyvern_apply_trophy_affixes_effect").length, 1,
    "raw-material migration must call the established helper once per eligible artifact");
  assert.equal(entries(effect, "every_character").length, 0, "raw-material migration must not scan every character");
  assert.equal(entries(effect, "every_in_global_list").length, 0, "raw-material migration must not scan global lists");
}

function invokeGameStart(state) {
  const migrations = registeredGameStartMigrations();
  const world = { id: "world", variables: new Map(), artifacts: [] };
  for (const migration of migrations) runEffectList(migration.effect, world, state);
}

function assertLegacyMaterialMigration() {
  const players = [{ id: "root", variables: new Map(), artifacts: [] }];
  const otherArtifacts = [];
  for (const data of materialsFixture.legacyArtifacts) {
    const owner = data.playerOwned ? players[0].id : "other";
    const artifact = createArtifact(data, owner);
    if (data.playerOwned) players[0].artifacts.push(artifact);
    else otherArtifacts.push(artifact);
  }
  const state = newWorldState(players, null);
  state.otherArtifacts = otherArtifacts;
  const allArtifacts = [...players[0].artifacts, ...otherArtifacts];
  const before = new Map(allArtifacts.map(artifact => [artifact.id, snapshot(artifact)]));

  invokeGameStart(state);
  for (const data of materialsFixture.legacyArtifacts) {
    const artifact = allArtifacts.find(item => item.id === data.id);
    assert.ok(artifact, "legacy fixture artifact is missing: " + data.id);
    if (data.shouldUpgrade && data.playerOwned) {
      assertAffixResults(artifact, data.modifiers.filter(modifier => modifier !== "artifact_placeholder_modifier"),
        "migrated " + data.id);
      assert.equal(artifact.name, data.name, data.id + " migration must preserve its existing name");
      assert.equal(artifact.description, data.description, data.id + " migration must preserve its existing description");
      assert.equal(artifact.variables.get("mm_wyvern_trophy_source"), data.variables.mm_wyvern_trophy_source,
        data.id + " migration must preserve source");
      for (const [name, value] of Object.entries(data.variables)) {
        assert.equal(artifact.variables.get(name), value, data.id + " migration must preserve variable " + name);
      }
      if (data.modifiers.includes("artifact_placeholder_modifier")) {
        assert.equal(artifact.modifiers.has("artifact_placeholder_modifier"), false,
          "the established affix helper should still remove only its placeholder modifier");
      }
    } else {
      assert.deepEqual(snapshot(artifact), before.get(data.id),
        data.id + " must not be modified by the migration");
    }
  }

  const afterFirstPass = new Map(allArtifacts.map(artifact => [artifact.id, snapshot(artifact)]));
  invokeGameStart(state);
  for (const artifact of allArtifacts) {
    assert.deepEqual(snapshot(artifact), afterFirstPass.get(artifact.id),
      artifact.id + " must remain unchanged on a repeated on_game_start_after_lobby");
  }
}

assertNewMaterialPath();
assertRawMaterialMigrationShape();
assertLegacyMaterialMigration();
console.log("Wyvern v1.1.7 material affixes: PASS (upstream base materials, live/frozen source, new loot path, legacy migration, preservation, and idempotence)");

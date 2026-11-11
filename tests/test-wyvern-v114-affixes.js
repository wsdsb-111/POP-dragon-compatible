"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const captureRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const affixPath = path.join(captureRoot, "common", "scripted_effects", "mm_wyvern_trophy_affixes.txt");
const trophyPath = path.join(captureRoot, "common", "scripted_effects", "mm_wyvern_trophies.txt");
const onActionPath = path.join(captureRoot, "common", "on_action", "zzzz_mm_wyvern_capture_on_actions.txt");
const applyEffectName = "mm_wyvern_apply_trophy_affixes_effect";
const rollEffectName = "mm_wyvern_roll_trophy_affix_effect";
const marker = "mm_wyvern_trophy_affixes_generated";
const oldFixedModifier = "artifact_monthly_minor_prestige_1_modifier";
const placeholderModifier = "artifact_placeholder_modifier";
const affixMetadataPath = path.join(projectRoot, "artwork", "wyvern-trophies", "affixes.json");
const nativeModifierFixturePath = path.join(projectRoot, "tests", "fixtures", "v114", "native-artifact-modifiers.json");
const nativeModifierMetadata = JSON.parse(fs.readFileSync(affixMetadataPath, "utf8"));
const nativeModifierFixture = JSON.parse(fs.readFileSync(nativeModifierFixturePath, "utf8"));
let nativeModifierSource = "unknown";

function tokenizePdx(text, label) {
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (character === "\"") {
      index += 1;
      let value = "";
      let closed = false;
      while (index < text.length) {
        const current = text[index++];
        if (current === "\\" && index < text.length) value += text[index++];
        else if (current === "\"") {
          closed = true;
          break;
        } else value += current;
      }
      assert.ok(closed, label + " has an unterminated string");
      tokens.push(value);
    } else if ("{}=".includes(character)) {
      tokens.push(character);
      index += 1;
    } else {
      const start = index;
      while (index < text.length && !/[\s{}=#"]/.test(text[index])) index += 1;
      assert.ok(index > start, label + " contains an invalid token at " + String(index));
      tokens.push(text.slice(start, index));
    }
  }
  return tokens;
}

function parsePdxBlock(tokens, label, nested) {
  const entries = [];
  while (tokens.index < tokens.values.length) {
    const token = tokens.values[tokens.index++];
    if (token === "}") {
      assert.ok(nested, label + " has an unmatched closing brace");
      return entries;
    }
    assert.notEqual(token, "{", label + " has a block without a key");
    assert.notEqual(token, "=", label + " has a key without a name");
    if (tokens.values[tokens.index] === "=") {
      tokens.index += 1;
      const valueToken = tokens.values[tokens.index++];
      assert.notEqual(valueToken, undefined, label + " has a key without a value");
      assert.notEqual(valueToken, "}", label + " has a key without a value");
      entries.push({
        key: token,
        value: valueToken === "{" ? parsePdxBlock(tokens, label, true) : valueToken,
      });
    } else {
      entries.push({ key: null, value: token });
    }
  }
  assert.ok(!nested, label + " has an unclosed block");
  return entries;
}

function parsePdxFile(filePath) {
  assert.ok(fs.existsSync(filePath), "missing PDX file: " + filePath);
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const tokens = { values: tokenizePdx(text, filePath), index: 0 };
  const ast = parsePdxBlock(tokens, filePath, false);
  assert.equal(tokens.index, tokens.values.length, filePath + " has trailing tokens");
  return ast;
}

function values(block, key) {
  return block.filter((entry) => entry.key === key).map((entry) => entry.value);
}

function firstScalar(block, key) {
  return values(block, key).find((value) => typeof value === "string");
}

function findDefinition(entries, key) {
  return entries.find((entry) => entry.key === key && Array.isArray(entry.value))?.value;
}

function containsKey(block, key) {
  return block.some((entry) => entry.key === key || (Array.isArray(entry.value) && containsKey(entry.value, key)));
}

function containsScalar(block, key, expected) {
  return block.some((entry) =>
    (entry.key === key && entry.value === expected)
    || (Array.isArray(entry.value) && containsScalar(entry.value, key, expected)));
}

function findBlocks(block, key, output) {
  for (const entry of block) {
    if (entry.key === key && Array.isArray(entry.value)) output.push(entry.value);
    if (Array.isArray(entry.value)) findBlocks(entry.value, key, output);
  }
  return output;
}

function numericModifierDefinition(entries, modifier, label) {
  const matches = entries.filter((entry) => entry.key === modifier && Array.isArray(entry.value));
  assert.equal(matches.length, 1, label + " must define " + modifier + " exactly once");
  const definition = matches[0].value;
  assert.ok(definition.length > 0, label + " must give " + modifier + " a definition");
  const valuesByKey = {};
  for (const entry of definition) {
    assert.ok(typeof entry.key === "string", label + " has a non-numeric declaration in " + modifier);
    assert.ok(typeof entry.value === "string" && /^-?\d+(?:\.\d+)?$/.test(entry.value),
      label + " has a non-numeric modifier value in " + modifier + ": " + String(entry.key));
    assert.ok(!Object.prototype.hasOwnProperty.call(valuesByKey, entry.key),
      label + " repeats modifier field " + entry.key + " in " + modifier);
    valuesByKey[entry.key] = entry.value;
  }
  return Object.fromEntries(Object.entries(valuesByKey).sort(([left], [right]) => left.localeCompare(right)));
}

function fixtureModifierDefinition(declaration) {
  assert.ok(declaration && typeof declaration.id === "string", "fixture declaration must have an id");
  assert.ok(declaration.definition && typeof declaration.definition === "object" && !Array.isArray(declaration.definition),
    "fixture declaration must have one numeric definition object: " + declaration.id);
  const definition = {};
  for (const [key, value] of Object.entries(declaration.definition)) {
    assert.ok(/^[A-Za-z0-9_]+$/.test(key), "fixture has an invalid modifier field in " + declaration.id);
    assert.ok(typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value),
      "fixture has a non-numeric value in " + declaration.id + ": " + key);
    definition[key] = value;
  }
  assert.ok(Object.keys(definition).length > 0, "fixture definition cannot be empty: " + declaration.id);
  return Object.fromEntries(Object.entries(definition).sort(([left], [right]) => left.localeCompare(right)));
}

function assertNativeArtifactModifiers(modifierIds, fixture = nativeModifierFixture) {
  const sourcePath = "game/common/modifiers/00_artifact_modifiers.txt";
  assert.equal(nativeModifierMetadata.source, sourcePath, "affixes.json must pin the native modifier source path");
  assert.equal(fixture.sourcePath, nativeModifierMetadata.source, "frozen modifier fixture must use affixes.json source path");
  assert.equal(fixture.sourceSha256, nativeModifierMetadata.sourceSha256,
    "frozen modifier fixture SHA must match affixes.json source SHA");
  assert.match(fixture.sourceSha256, /^[a-f0-9]{64}$/, "native modifier source SHA must be a full lowercase SHA-256");

  const expectedIds = new Set([...modifierIds, placeholderModifier, oldFixedModifier]);
  assert.equal(fixture.declarations.length, expectedIds.size, "frozen fixture must contain all 24 pool modifiers plus the placeholder and old fixed modifier");
  const fixtureById = new Map();
  for (const declaration of fixture.declarations) {
    assert.ok(/^artifact_[A-Za-z0-9_]+_modifier$/.test(declaration.id),
      "fixture contains a non-native artifact modifier id: " + String(declaration.id));
    assert.ok(!fixtureById.has(declaration.id), "fixture repeats modifier id: " + declaration.id);
    fixtureById.set(declaration.id, fixtureModifierDefinition(declaration));
  }
  assert.deepEqual([...fixtureById.keys()].sort(), [...expectedIds].sort(),
    "frozen fixture IDs must exactly match the affix pool, placeholder, and legacy fixed modifier");

  const explicitGameDir = Object.prototype.hasOwnProperty.call(process.env, "CK3_GAME_DIR");
  const nativeGameRoot = explicitGameDir
    ? process.env.CK3_GAME_DIR
    : "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
  assert.ok(!explicitGameDir || nativeGameRoot,
    "CK3_GAME_DIR is explicitly set but empty; refusing to use the frozen modifier fixture");
  const nativePath = path.join(nativeGameRoot, "common", "modifiers", "00_artifact_modifiers.txt");
  const nativeExists = fs.existsSync(nativePath);
  assert.ok(!explicitGameDir || nativeExists,
    "CK3_GAME_DIR is explicitly set but the native artifact modifier source is missing: " + nativePath);

  if (nativeExists) {
    const nativeBytes = fs.readFileSync(nativePath);
    const nativeSha256 = crypto.createHash("sha256").update(nativeBytes).digest("hex");
    assert.equal(nativeSha256, fixture.sourceSha256, "installed CK3 native modifier source must match the frozen full-file SHA");
    const nativeEntries = parsePdxFile(nativePath);
    for (const modifier of expectedIds) {
      const nativeDefinition = numericModifierDefinition(nativeEntries, modifier, "installed CK3 source");
      assert.deepEqual(nativeDefinition, fixtureById.get(modifier),
        "installed CK3 definition must match the frozen declaration for " + modifier);
    }
    nativeModifierSource = "live";
    return "live";
  }

  nativeModifierSource = "frozen";
  return "frozen";
}

function assertRejectedNativeModifierFixtures(modifierIds) {
  const missingModifier = {
    ...nativeModifierFixture,
    declarations: nativeModifierFixture.declarations.slice(1),
  };
  assert.throws(() => assertNativeArtifactModifiers(modifierIds, missingModifier),
    /frozen fixture must contain all 24 pool modifiers/,
    "native modifier validator must reject a fixture missing one declaration");

  const wrongSourceSha = {
    ...nativeModifierFixture,
    sourceSha256: "0".repeat(64),
  };
  assert.throws(() => assertNativeArtifactModifiers(modifierIds, wrongSourceSha),
    /frozen modifier fixture SHA must match affixes\.json source SHA/,
    "native modifier validator must reject a fixture with a different source SHA");
}

function directModifierAdds(block) {
  return values(block, "add_artifact_modifier").filter((value) => typeof value === "string");
}

function directOptionTrigger(option, label) {
  const triggers = values(option, "trigger").filter(Array.isArray);
  assert.equal(triggers.length, 1, label + " must have exactly one trigger");
  const trigger = triggers[0];
  assert.deepEqual(trigger.map((entry) => entry.key).sort(), ["NOT"], label + " trigger must negate the affix-pair check");
  const notBlocks = values(trigger, "NOT").filter(Array.isArray);
  assert.equal(notBlocks.length, 1, label + " trigger must use NOT { OR = {...} }");
  assert.deepEqual(notBlocks[0].map((entry) => entry.key).sort(), ["OR"], label + " NOT block must contain one OR");
  const orBlocks = values(notBlocks[0], "OR").filter(Array.isArray);
  assert.equal(orBlocks.length, 1, label + " must forbid both modifiers from the same category");
  const forbidden = values(orBlocks[0], "has_artifact_modifier").filter((value) => typeof value === "string").sort();
  assert.equal(forbidden.length, 2, label + " must check the low and high variant");
  assert.equal(new Set(forbidden).size, 2, label + " repeats a forbidden modifier");
  return forbidden;
}

function directRarityBranch(option, label) {
  const ifEntries = option.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.key === "if" && Array.isArray(entry.value));
  const matches = ifEntries.filter(({ entry }) => {
    const limit = values(entry.value, "limit").find(Array.isArray);
    return limit && firstScalar(limit, "rarity") === "illustrious";
  });
  assert.equal(matches.length, 1, label + " must have one illustrious branch");
  const { entry, index } = matches[0];
  const highAdds = directModifierAdds(entry.value);
  assert.equal(highAdds.length, 1, label + " illustrious branch must add exactly one modifier");
  const paired = option[index + 1];
  assert.ok(paired && paired.key === "else" && Array.isArray(paired.value),
    label + " illustrious branch must be paired with an else");
  const lowAdds = directModifierAdds(paired.value);
  assert.equal(lowAdds.length, 1, label + " famed branch must add exactly one modifier");
  assert.notEqual(highAdds[0], lowAdds[0], label + " low and high affixes must differ");
  assert.equal(directModifierAdds(option).length, 0, label + " must add modifiers only inside the rarity branches");
  return { high: highAdds[0], low: lowAdds[0] };
}

function assertApplyHelper(applyEffect) {
  const guardCandidates = values(applyEffect, "if").filter(Array.isArray).filter((block) => {
    const limit = values(block, "limit").find(Array.isArray);
    return limit && values(limit, "NOT").filter(Array.isArray)
      .some((notBlock) => containsScalar(notBlock, "has_variable", marker));
  });
  assert.equal(guardCandidates.length, 1, "apply helper must have one not-yet-generated marker guard");
  const guard = guardCandidates[0];
  const removes = values(guard, "remove_artifact_modifier").filter((value) => typeof value === "string");
  assert.equal(removes.filter((id) => id === placeholderModifier).length, 1,
    "apply helper must remove the create_artifact placeholder");
  assert.equal(removes.filter((id) => id === oldFixedModifier).length, 1,
    "apply helper must remove the old fixed prestige modifier");
  assert.equal(removes.length, 2, "apply helper must remove only the placeholder and legacy fixed modifier");

  const unconditionalRolls = values(guard, rollEffectName).filter((value) => value === "yes");
  assert.equal(unconditionalRolls.length, 3, "each eligible artifact must roll exactly three famed affixes");
  const rareBranches = values(guard, "if").filter(Array.isArray).filter((block) => {
    const limit = values(block, "limit").find(Array.isArray);
    return limit && firstScalar(limit, "rarity") === "illustrious";
  });
  assert.equal(rareBranches.length, 1, "only illustrious artifacts may receive a fourth roll");
  assert.equal(values(rareBranches[0], rollEffectName).filter((value) => value === "yes").length, 1,
    "illustrious branch must make exactly one additional roll");

  const markerSets = values(guard, "set_variable").filter(Array.isArray)
    .filter((variable) => firstScalar(variable, "name") === marker);
  assert.equal(markerSets.length, 1, "apply helper must set its generated marker once");
  assert.equal(firstScalar(markerSets[0], "value"), "1", "generated marker must be set to 1");
  const markerIndex = guard.findIndex((entry) => entry.key === "set_variable" && Array.isArray(entry.value)
    && firstScalar(entry.value, "name") === marker);
  const finalRollIndex = guard.reduce((latest, entry, index) => {
    if ((entry.key === rollEffectName && entry.value === "yes")
      || (entry.key === "if" && Array.isArray(entry.value)
        && values(entry.value, rollEffectName).includes("yes"))) return index;
    return latest;
  }, -1);
  assert.ok(markerIndex > finalRollIndex, "generated marker must be written after all affix rolls");
  assert.equal(applyEffect.length, 1, "all apply-helper effects must stay inside the marker guard");
}

function assertCreationHooks(trophyEntries) {
  const createEffect = findDefinition(trophyEntries, "mm_wyvern_create_decorative_trophy_set_effect");
  assert.ok(createEffect, "decorative trophy creation effect is missing");
  const artifacts = values(createEffect, "create_artifact").filter(Array.isArray);
  assert.equal(artifacts.length, 1, "only the head must be a new decorative court trophy");
  const scopes = values(createEffect, "scope:mm_wyvern_trophy").filter(Array.isArray);
  assert.equal(scopes.length, artifacts.length, "each created trophy must enter its own artifact scope");
  const createdKinds = new Set();

  for (const [index, artifact] of artifacts.entries()) {
    const kind = firstScalar(artifact, "visuals");
    assert.match(kind || "", /^mm_wyvern_trophy_(fang|eye|scale|head|claw)$/);
    assert.ok(!createdKinds.has(kind), kind + " must be created only once in the trophy set");
    createdKinds.add(kind);
    const modifiers = values(artifact, "modifier").filter((value) => typeof value === "string");
    assert.deepEqual(modifiers, [placeholderModifier], kind + " must use only the native placeholder at creation");
    assert.ok(!modifiers.includes(oldFixedModifier), kind + " must not retain the old fixed prestige modifier");
    const helperCalls = values(scopes[index], applyEffectName);
    assert.equal(helperCalls.length, 1, kind + " must call the affix helper exactly once in its artifact scope");
    assert.equal(helperCalls[0], "yes", kind + " must call the public apply helper");
  }
  assert.deepEqual([...createdKinds], ["mm_wyvern_trophy_head"]);
}

function optionModel(randomList) {
  const options = randomList.filter((entry) => /^\d+$/.test(entry.key) && Array.isArray(entry.value));
  assert.equal(options.length, 12, "affix roll must have exactly twelve weighted options");
  const weights = options.map((entry) => Number(entry.key));
  assert.ok(weights.every((weight) => Number.isFinite(weight) && weight > 0), "all affix weights must be positive");
  assert.equal(new Set(weights).size, 1, "all twelve affix categories must have equal weight");

  const modeled = options.map((entry, index) => {
    const label = "affix option " + String(index + 1);
    const forbidden = directOptionTrigger(entry.value, label);
    const pair = directRarityBranch(entry.value, label);
    assert.deepEqual(new Set(forbidden), new Set([pair.low, pair.high]),
      label + " must prohibit rerolling either modifier in its own category");
    return { weight: weights[index], low: pair.low, high: pair.high, label };
  });
  assert.equal(new Set(modeled.map((option) => option.low)).size, 12, "low affix variants must be category-unique");
  assert.equal(new Set(modeled.map((option) => option.high)).size, 12, "high affix variants must be category-unique");
  const allIds = modeled.flatMap((option) => [option.low, option.high]);
  assert.equal(new Set(allIds).size, 24, "each affix category must have a unique low/high modifier pair");
  assertNativeArtifactModifiers(allIds);
  return modeled;
}

function nextRandom(context) {
  context.seed = (Math.imul(context.seed, 1664525) + 1013904223) >>> 0;
  return context.seed / 0x100000000;
}

function evaluateCondition(block, state) {
  return block.every((entry) => {
    if (entry.key === "NOT" && Array.isArray(entry.value)) return !evaluateCondition(entry.value, state);
    if (entry.key === "AND" && Array.isArray(entry.value)) return evaluateCondition(entry.value, state);
    if (entry.key === "OR" && Array.isArray(entry.value)) {
      return entry.value.some((child) => evaluateCondition([child], state));
    }
    if (entry.key === "has_variable" && typeof entry.value === "string") return state.variables.has(entry.value);
    if (entry.key === "has_artifact_modifier" && typeof entry.value === "string") return state.modifiers.has(entry.value);
    if (entry.key === "rarity" && typeof entry.value === "string") return state.rarity === entry.value;
    assert.fail("bounded affix model encountered unsupported trigger " + String(entry.key));
  });
}

function executeEffects(block, state, definitions) {
  let previousIf = null;
  for (const entry of block) {
    if (entry.key === "if" && Array.isArray(entry.value)) {
      const limit = values(entry.value, "limit").find(Array.isArray);
      const allowed = !limit || evaluateCondition(limit, state);
      previousIf = allowed;
      if (allowed) executeEffects(entry.value.filter((child) => child.key !== "limit"), state, definitions);
    } else if (entry.key === "else" && Array.isArray(entry.value)) {
      assert.notEqual(previousIf, null, "bounded affix model found an else without a preceding if");
      if (!previousIf) executeEffects(entry.value, state, definitions);
      previousIf = null;
    } else {
      previousIf = null;
      executeEffect(entry, state, definitions);
    }
  }
}

function executeEffect(entry, state, definitions) {
  if (entry.key === "remove_artifact_modifier" && typeof entry.value === "string") {
    state.modifiers.delete(entry.value);
    return;
  }
  if (entry.key === "add_artifact_modifier" && typeof entry.value === "string") {
    state.modifiers.add(entry.value);
    return;
  }
  if (entry.key === "set_variable" && Array.isArray(entry.value)) {
    const name = firstScalar(entry.value, "name");
    assert.ok(name, "bounded affix model needs a named variable");
    state.variables.add(name);
    return;
  }
  if (entry.key === "random_list" && Array.isArray(entry.value)) {
    const eligible = entry.value.filter((option) => /^\d+$/.test(option.key) && Array.isArray(option.value))
      .filter((option) => {
        const trigger = values(option.value, "trigger").find(Array.isArray);
        return !trigger || evaluateCondition(trigger, state);
      });
    assert.ok(eligible.length > 0, "affix random_list has no eligible category");
    const totalWeight = eligible.reduce((total, option) => total + Number(option.key), 0);
    let choice = nextRandom(state) * totalWeight;
    const selected = eligible.find((option) => (choice -= Number(option.key)) < 0) || eligible[eligible.length - 1];
    executeEffects(selected.value.filter((child) => child.key !== "trigger"), state, definitions);
    return;
  }
  if (entry.key === rollEffectName && (entry.value === "yes" || Array.isArray(entry.value))) {
    executeEffects(definitions.roll, state, definitions);
    return;
  }
  if (entry.key === "trigger" || entry.key === "limit") return;
  assert.fail("bounded affix model encountered unsupported effect " + String(entry.key));
}

function runAndAssertScenarios(applyEffect, definitions, options) {
  for (const rarity of ["famed", "illustrious"]) {
    const expectedAffixCount = rarity === "illustrious" ? 4 : 3;
    for (let seed = 1; seed <= 64; seed += 1) {
      const state = {
        rarity,
        modifiers: new Set([placeholderModifier, oldFixedModifier]),
        variables: new Set(),
        seed,
      };
      executeEffects(applyEffect, state, definitions);
      assert.ok(state.variables.has(marker), rarity + " roll must set the per-artifact generated marker");
      assert.ok(!state.modifiers.has(placeholderModifier), rarity + " roll must remove placeholder modifier");
      assert.ok(!state.modifiers.has(oldFixedModifier), rarity + " roll must remove legacy fixed modifier");

      const selected = options.flatMap((option) => {
        const hasLow = state.modifiers.has(option.low);
        const hasHigh = state.modifiers.has(option.high);
        assert.ok(!(hasLow && hasHigh), "one category must not receive both rarity variants");
        return hasLow || hasHigh ? [{ option, hasLow, hasHigh }] : [];
      });
      assert.equal(selected.length, expectedAffixCount, rarity + " artifact must receive exactly " + String(expectedAffixCount) + " unique affixes");
      assert.equal(new Set(selected.map((item) => item.option.low)).size, expectedAffixCount,
        rarity + " artifact must not receive a duplicate affix category");
      for (const item of selected) {
        assert.equal(item.hasHigh, rarity === "illustrious", "affix variant must match artifact rarity");
      }

      const afterFirstCall = {
        modifiers: [...state.modifiers].sort(),
        variables: [...state.variables].sort(),
        seed: state.seed,
      };
      executeEffects(applyEffect, state, definitions);
      assert.deepEqual({
        modifiers: [...state.modifiers].sort(),
        variables: [...state.variables].sort(),
        seed: state.seed,
      }, afterFirstCall, "repeated apply-helper invocation must neither reroll nor consume randomness");
    }
  }
}

function assertOwnedMigration(onActionAst) {
  const start = findDefinition(onActionAst, "on_game_start_after_lobby");
  assert.ok(start, "legacy affix migration must be attached to on_game_start_after_lobby");
  const startChildren = values(start, "on_actions").filter(Array.isArray);
  assert.equal(startChildren.length, 1, "game-start hook must register one migration child");
  const registeredNames = startChildren[0].filter((entry) => entry.key === null).map((entry) => entry.value);

  const migrationName = "mm_wyvern_legacy_trophy_affixes";
  const migration = findDefinition(onActionAst, migrationName);
  assert.ok(migration, "the existing court-trophy migration child must remain defined");
  assert.ok(registeredNames.includes(migrationName), "migration child must be registered by on_game_start_after_lobby");
  const effects = findDefinition(migration, "effect");
  assert.ok(effects, "migration child must run through its effect block");
  assert.equal(containsKey(migration, "every_character"), false,
    "migration must not scan every character in the world");
  assert.equal(containsKey(migration, "every_in_global_list"), false,
    "migration must not scan a global character or artifact list");

  const playerBlocks = values(effects, "every_player").filter(Array.isArray);
  assert.equal(playerBlocks.length, 1, "migration must iterate only player characters");
  const artifactBlocks = values(playerBlocks[0], "every_character_artifact").filter(Array.isArray);
  assert.equal(artifactBlocks.length, 1, "migration must inspect player-owned character artifacts");
  const artifact = artifactBlocks[0];
  const limits = values(artifact, "limit").filter(Array.isArray);
  assert.equal(limits.length, 1, "migration must put all eligibility checks on each artifact");
  const limit = limits[0];
  assert.ok(values(limit, "has_variable").includes("mm_wyvern_trophy_source"),
    "migration must select only this mod's source-tagged trophies");
  assert.ok(values(limit, "NOT").filter(Array.isArray)
    .some((notBlock) => values(notBlock, "has_variable").includes(marker)),
  "migration must skip artifacts already carrying the generated marker");
  const rarityOptions = values(limit, "OR").filter(Array.isArray)
    .some((orBlock) => values(orBlock, "rarity").sort().join(",") === "famed,illustrious");
  assert.ok(rarityOptions, "migration must restrict upgrades to famed or illustrious artifacts");
  const slotOptions = values(limit, "OR").filter(Array.isArray)
    .some((orBlock) => values(orBlock, "artifact_slot_type").sort().join(",") === "pedestal,wall_small");
  assert.ok(slotOptions, "migration must restrict upgrades to pedestal and wall_small court artifacts");
  assert.equal(values(artifact, applyEffectName).filter((value) => value === "yes").length, 1,
    "migration must apply the helper only to artifacts that passed the local filter");

  const deathHook = findDefinition(onActionAst, "on_death");
  assert.ok(deathHook, "existing wyvern captor-death hook must be preserved");
  const deathChildren = values(deathHook, "on_actions").filter(Array.isArray);
  assert.ok(deathChildren.some((children) => children.some((entry) =>
    entry.key === null && entry.value === "mm_wyvern_capture_captor_death_release")),
  "migration registration must not replace the existing captor-death hook");
}

const affixAst = parsePdxFile(affixPath);
const applyEffect = findDefinition(affixAst, applyEffectName);
const rollEffect = findDefinition(affixAst, rollEffectName);
assert.ok(applyEffect, "artifact-scope affix apply helper is missing");
assert.ok(rollEffect, "affix random roll helper is missing");
assertApplyHelper(applyEffect);
assertCreationHooks(parsePdxFile(trophyPath));
const randomLists = values(rollEffect, "random_list").filter(Array.isArray);
assert.equal(randomLists.length, 1, "roll helper must contain exactly one random_list");
const options = optionModel(randomLists[0]);
assertRejectedNativeModifierFixtures(options.flatMap((option) => [option.low, option.high]));
runAndAssertScenarios(applyEffect, { roll: rollEffect }, options);
assertOwnedMigration(parsePdxFile(onActionPath));

console.log("PASS wyvern trophy affix counts, uniqueness, native ids (source=" + nativeModifierSource
  + "), marker idempotency, creation hooks, and owned migration");

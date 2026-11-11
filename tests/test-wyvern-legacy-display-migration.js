"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const modRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const onActionRoot = path.join(modRoot, "common", "on_action");
const migrationName = "mm_wyvern_legacy_trophy_display_types";
const sourceVariable = "mm_wyvern_trophy_source";
const kindVariable = "mm_wyvern_material_kind";

function tokenizePdx(text, label) {
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (/\s/.test(character)) index += 1;
    else if (character === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (character === '"') {
      index += 1;
      let value = "";
      let closed = false;
      while (index < text.length) {
        const current = text[index++];
        if (current === "\\" && index < text.length) value += text[index++];
        else if (current === '"') {
          closed = true;
          break;
        } else value += current;
      }
      assert.ok(closed, label + " has an unterminated quoted string");
      tokens.push(value);
    } else if ("{}=".includes(character)) {
      tokens.push(character);
      index += 1;
    } else {
      const start = index;
      while (index < text.length && !/[\s{}=#"]/.test(text[index])) index += 1;
      assert.ok(index > start, label + " has an invalid token at " + String(index));
      tokens.push(text.slice(start, index));
    }
  }
  return tokens;
}

function parseBlock(tokens, label, nested) {
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
      const value = tokens.values[tokens.index++];
      assert.notEqual(value, undefined, label + " has a key without a value");
      assert.notEqual(value, "}", label + " has a key without a value");
      entries.push({ key: token, value: value === "{" ? parseBlock(tokens, label, true) : value });
    } else entries.push({ key: null, value: token });
  }
  assert.ok(!nested, label + " has an unclosed block");
  return entries;
}

function parsePdxText(text, label) {
  const tokens = { values: tokenizePdx(text.replace(/^\uFEFF/, ""), label), index: 0 };
  const ast = parseBlock(tokens, label, false);
  assert.equal(tokens.index, tokens.values.length, label + " has trailing tokens");
  return ast;
}

function parsePdxFile(filePath) {
  assert.ok(fs.existsSync(filePath), "missing migration PDX file: " + filePath);
  return parsePdxText(fs.readFileSync(filePath, "utf8"), filePath);
}

function values(block, key) {
  return block.filter((entry) => entry.key === key).map((entry) => entry.value);
}

function firstScalar(block, key) {
  return values(block, key).find((value) => typeof value === "string");
}

function findDefinition(block, name) {
  return block.find((entry) => entry.key === name && Array.isArray(entry.value))?.value;
}

function allPdxFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...allPdxFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".txt")) output.push(fullPath);
  }
  return output;
}

function containsScalar(entries, target) {
  return entries.some((entry) => entry.value === target
    || (Array.isArray(entry.value) && containsScalar(entry.value, target)));
}

const parsedFiles = allPdxFiles(onActionRoot).map((filePath) => ({ filePath, ast: parsePdxFile(filePath) }));
const definitions = [];
for (const file of parsedFiles) {
  const definition = findDefinition(file.ast, migrationName);
  if (definition) definitions.push(definition);
}
assert.equal(definitions.length, 1, "the legacy display migration must have one on_action definition");

let gameStartBlock = null;
for (const { ast } of parsedFiles) {
  const candidate = findDefinition(ast, "on_game_start_after_lobby");
  if (candidate) {
    assert.equal(gameStartBlock, null, "on_game_start_after_lobby must not be multiply defined in the migration source set");
    gameStartBlock = candidate;
  }
}
assert.ok(gameStartBlock, "migration must be registered under on_game_start_after_lobby");
assert.ok(containsScalar(gameStartBlock, migrationName),
  "on_game_start_after_lobby must call the legacy display migration");

function evaluateTrigger(entries, artifact, mode = "AND") {
  const results = entries.map((entry) => {
    if (entry.key === "OR" || entry.key === "AND") {
      assert.ok(Array.isArray(entry.value), entry.key + " trigger must be a block");
      return evaluateTrigger(entry.value, artifact, entry.key);
    }
    if (entry.key === "NOT") {
      assert.ok(Array.isArray(entry.value), "NOT trigger must be a block");
      return !evaluateTrigger(entry.value, artifact, "AND");
    }
    if (entry.key === "has_variable") {
      assert.equal(typeof entry.value, "string", "finite migration model supports scalar has_variable only");
      return artifact.variables.has(entry.value);
    }
    if (entry.key && entry.key.startsWith("var:")) {
      return artifact.variables.get(entry.key.slice(4)) === entry.value;
    }
    if (entry.key === "artifact_slot_type" || entry.key === "artifact_type") return artifact.type === entry.value;
    if (entry.key === "visuals") return artifact.visuals === entry.value;
    if (entry.key === "rarity") return artifact.rarity === entry.value;
    if (entry.key === "has_artifact_modifier") return artifact.modifiers.includes(entry.value);
    if (entry.key === "is_player") return artifact.isPlayer === (entry.value === "yes");
    if (entry.key === "is_ai") return artifact.isAi === (entry.value === "yes");
    assert.fail("finite migration model does not implement trigger " + String(entry.key));
  });
  return mode === "OR" ? results.some(Boolean) : results.every(Boolean);
}

function executeEffect(entries, context, execution) {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.key === "effect") {
      assert.ok(Array.isArray(entry.value), "effect body must be a block");
      executeEffect(entry.value, context, execution);
    } else if (entry.key === "every_player") {
      assert.ok(Array.isArray(entry.value), "every_player body must be a block");
      for (const player of context.players) {
        const limit = values(entry.value, "limit").find(Array.isArray);
        if (!limit || evaluateTrigger(limit, player)) {
          executeEffect(entry.value.filter((child) => child.key !== "limit"), { ...context, player }, execution);
        }
      }
    } else if (entry.key === "every_character_artifact") {
      assert.ok(context.player, "every_character_artifact requires player scope");
      assert.ok(Array.isArray(entry.value), "every_character_artifact body must be a block");
      for (const artifact of context.player.artifacts) {
        const limit = values(entry.value, "limit").find(Array.isArray);
        if (!limit || evaluateTrigger(limit, artifact)) {
          executeEffect(entry.value.filter((child) => child.key !== "limit"), { ...context, artifact }, execution);
        }
      }
    } else if (entry.key === "if") {
      let matched = false;
      let branchIndex = index;
      while (branchIndex < entries.length) {
        const branch = entries[branchIndex];
        if (branchIndex !== index && !["else_if", "else"].includes(branch.key)) break;
        assert.ok(Array.isArray(branch.value), "conditional body must be a block");
        const limit = values(branch.value, "limit").find(Array.isArray);
        assert.ok(branch.key === "else" || limit, "conditional branch must declare a limit");
        if (!matched && (branch.key === "else" || evaluateTrigger(limit, context.artifact || context.player || context))) {
          executeEffect(branch.value.filter((child) => child.key !== "limit"), context, execution);
          matched = true;
        }
        branchIndex += 1;
        if (branch.key === "else") break;
      }
      index = branchIndex - 1;
    } else if (["else", "else_if"].includes(entry.key)) {
      assert.fail("unpaired else in migration effect");
    } else if (entry.key === "reforge_artifact") {
      assert.ok(context.artifact, "reforge_artifact requires an artifact scope");
      assert.ok(Array.isArray(entry.value), "reforge_artifact must be a block");
      const type = firstScalar(entry.value, "type");
      const visuals = firstScalar(entry.value, "visuals");
      assert.ok(type, "reforge_artifact must explicitly set an artifact type");
      context.artifact.type = type;
      if (visuals) context.artifact.visuals = visuals;
      execution.reforgeCount += 1;
      execution.reforgedIds.push(context.artifact.id);
    } else if (entry.key === "set_variable") {
      assert.ok(context.artifact, "set_variable in migration must use artifact scope");
      assert.ok(Array.isArray(entry.value), "set_variable must be a block");
      const name = firstScalar(entry.value, "name");
      const value = firstScalar(entry.value, "value");
      assert.ok(name && value, "migration set_variable must supply name and value");
      context.artifact.variables.set(name, value);
    } else if (entry.key === "remove_variable") {
      assert.ok(context.artifact, "remove_variable in migration must use artifact scope");
      const name = Array.isArray(entry.value) ? firstScalar(entry.value, "name") : entry.value;
      assert.ok(name, "remove_variable must identify a variable");
      context.artifact.variables.delete(name);
    } else {
      assert.fail("finite migration model does not implement effect " + String(entry.key));
    }
  }
}

function artifact(id, kind, type, source = true) {
  const variables = new Map();
  if (source) variables.set(sourceVariable, "source_dragon");
  if (kind !== null) variables.set(kindVariable, "flag:" + kind);
  return {
    id,
    type,
    visuals: "mm_wyvern_trophy_" + String(kind),
    rarity: "famed",
    variables,
    modifiers: ["artifact_placeholder_modifier", "artifact_mm_wyvern_affix_famed_health"],
    history: [{ type: "created", actor: "root" }],
  };
}

function snapshot(artifactValue) {
  return {
    id: artifactValue.id,
    type: artifactValue.type,
    visuals: artifactValue.visuals,
    rarity: artifactValue.rarity,
    variables: [...artifactValue.variables.entries()].sort(([left], [right]) => left.localeCompare(right)),
    modifiers: [...artifactValue.modifiers],
    history: artifactValue.history.map((entry) => ({ ...entry })),
  };
}

const head = artifact("head", "head", "wall_small");
const fang = artifact("fang", "fang", "pedestal");
const scale = artifact("scale", "scale", "pedestal");
const claw = artifact("claw", "claw", "pedestal");
const eye = artifact("eye", "eye", "pedestal");
const noSourceHead = artifact("no-source-head", "head", "wall_small", false);
const unknownKind = artifact("unknown-kind", "wing", "wall_small");
unknownKind.visuals = "mm_wyvern_trophy_head";
const unclassified = artifact("unclassified", null, "pedestal");
const nonPlayerHead = artifact("non-player-head", "head", "wall_small");
const player = { id: "player", isPlayer: true, isAi: false, variables: new Map(), artifacts: [head, fang, scale, claw, eye, noSourceHead, unknownKind, unclassified] };
const nonPlayer = { id: "npc", isPlayer: false, isAi: true, variables: new Map(), artifacts: [nonPlayerHead] };
const originalObjects = new Map([...player.artifacts, ...nonPlayer.artifacts].map((value) => [value.id, value]));
const baseline = new Map([...originalObjects].map(([id, value]) => [id, snapshot(value)]));
const migration = definitions[0];
const run = () => {
  const execution = { reforgeCount: 0, reforgedIds: [] };
  executeEffect(migration, { players: [player] }, execution);
  return execution;
};

const firstRun = run();
assert.equal(firstRun.reforgeCount, 5, "first migration must reforge only the five known source-tagged displays");
assert.deepEqual([...firstRun.reforgedIds].sort(), ["claw", "eye", "fang", "head", "scale"]);
assert.equal(player.artifacts.length, 8, "migration must retain the player's artifact instances");
assert.equal(head.type, "pedestal", "legacy wall_small head must become a pedestal artifact");
assert.equal(head.visuals, "mm_wyvern_trophy_head", "head migration must retain the original head visual");
for (const oldDisplay of [fang, scale, claw, eye]) {
  assert.equal(oldDisplay.type, "miscellaneous", oldDisplay.id + " legacy display must become a personal miscellaneous artifact");
  assert.equal(oldDisplay.visuals, baseline.get(oldDisplay.id).visuals,
    oldDisplay.id + " migration must preserve the artifact visual");
}
assert.equal(noSourceHead.variables.has(sourceVariable), false, "source-free control must remain source-free");
assert.equal(noSourceHead.type, "wall_small", "artifact without source provenance must not migrate");
assert.equal(unknownKind.type, "wall_small", "unknown material kinds must not be inferred");
assert.equal(unclassified.type, "pedestal", "source-tagged artifact without a material kind must not migrate");
assert.equal(nonPlayerHead.type, "wall_small", "migration must not scan non-player characters");

for (const [id, original] of originalObjects) {
  const current = player.artifacts.find((value) => value.id === id) || nonPlayer.artifacts.find((value) => value.id === id);
  assert.strictEqual(current, original, id + " migration must preserve the existing artifact instance");
  assert.deepEqual(current.modifiers, baseline.get(id).modifiers, id + " migration must preserve modifiers");
  assert.deepEqual(current.history.map((entry) => ({ ...entry })), baseline.get(id).history,
    id + " migration must preserve artifact history");
  assert.equal(current.variables.get(sourceVariable), baseline.get(id).variables.find(([key]) => key === sourceVariable)?.[1],
    id + " migration must preserve its source tag");
  assert.equal(current.variables.get(kindVariable), baseline.get(id).variables.find(([key]) => key === kindVariable)?.[1],
    id + " migration must preserve its material kind");
}

const afterFirstRun = new Map([...originalObjects].map(([id, value]) => [id, snapshot(value)]));
const secondRun = run();
assert.equal(secondRun.reforgeCount, 0, "a repeated on_action must not reforge already migrated artifacts again");
for (const [id, original] of afterFirstRun) {
  const current = player.artifacts.find((value) => value.id === id) || nonPlayer.artifacts.find((value) => value.id === id);
  assert.deepEqual(snapshot(current), original, id + " must remain unchanged after a repeated migration");
}

console.log("Wyvern legacy display migration: PASS (finite AST execution preserves instance/modifiers, converts only tagged known displays, and is idempotent)");

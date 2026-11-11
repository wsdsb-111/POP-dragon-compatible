"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "v130", "royal-kings-contract.json"), "utf8"));
const patchesRoot = path.join(root, "patches");
const kingsRoot = path.join(patchesRoot, "wyvern-kings", "mod");
const captureRoot = path.join(patchesRoot, "wyvern-capture", "mod");
const bloodlineRoot = path.join(patchesRoot, "wyvern-bloodline", "mod");
const operators = new Set(["?=", ">=", "<=", "!=", "==", "=", ">", "<"]);

function walkFiles(directory, extension = ".txt") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath, extension) : entry.name.endsWith(extension) ? [entryPath] : [];
  });
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
      assert.ok(closed, label + " has an unterminated quoted token");
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
      if (!operators.has(operator)) {
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
  assert.equal(index, tokens.length, label + " has trailing tokens");
  return nodes;
}

function readPdx(filePath) {
  assert.ok(fs.existsSync(filePath), "missing PDX file " + path.relative(root, filePath));
  return parsePdx(fs.readFileSync(filePath, "utf8"), path.relative(root, filePath));
}

function definitionMap(nodes) {
  return new Map(nodes.filter(node => Array.isArray(node.value)).map(node => [node.key, node.value]));
}

function first(nodes, key) {
  return (nodes || []).find(node => node.key === key);
}

function all(nodes, key) {
  return (nodes || []).filter(node => node.key === key);
}

function required(nodes, key, label) {
  const node = first(nodes, key);
  assert.ok(node, label + " is missing " + key);
  return node.value;
}

function scalar(nodes, key, label) {
  const value = required(nodes, key, label);
  assert.equal(typeof value, "string", label + " expected scalar " + key);
  return value;
}

function walkNodes(nodes, predicate, output = []) {
  for (const node of nodes || []) {
    if (predicate(node)) output.push(node);
    if (Array.isArray(node.value)) walkNodes(node.value, predicate, output);
  }
  return output;
}

function contains(nodes, key, expected) {
  return walkNodes(nodes, node => node.key === key && node.value === expected).length > 0;
}

function countCalls(nodes, name) {
  return walkNodes(nodes, node => node.key === name).length;
}

function characterBootstrap(id) {
  const node = walkNodes(bootstrap, child => child.key === "character:" + id)[0];
  return node?.value;
}

function check(condition, message) {
  assert.ok(condition, message);
}

const effectFiles = walkFiles(path.join(kingsRoot, "common", "scripted_effects"));
const triggerFiles = walkFiles(path.join(kingsRoot, "common", "scripted_triggers"));
const valueFiles = walkFiles(path.join(kingsRoot, "common", "script_values"));
const effects = new Map(effectFiles.flatMap(file => [...definitionMap(readPdx(file))]));
const triggers = new Map(triggerFiles.flatMap(file => [...definitionMap(readPdx(file))]));
const values = new Map(valueFiles.flatMap(file => [...definitionMap(readPdx(file))]));
const decisions = definitionMap(readPdx(path.join(kingsRoot, "common", "decisions", "mm_royal_awakening.txt")));
const traits = definitionMap(readPdx(path.join(kingsRoot, "common", "traits", "mm_royal_traits.txt")));
const bootstrap = effects.get("mm_royal_bootstrap_effect");
assert.ok(bootstrap, "royal bootstrap effect is present");

function localizations() {
  const result = { english: new Map(), chinese: new Map() };
  const files = walkFiles(path.join(kingsRoot, "localization"), ".yml");
  assert.ok(files.length > 0, "royal name and title localizations are present");
  for (const file of files) {
    const language = file.includes(path.join("localization", "english")) ? "english" : "chinese";
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/^\s*([^:#\s]+):\d+\s+"((?:\\.|[^"\\])*)"/gm)) {
      result[language].set(match[1], match[2].replace(/\\n/g, "\n"));
    }
  }
  return result;
}

const loc = localizations();
assert.equal(new Set(fixture.characters.map(character => character.id)).size, 10,
  "the frozen royal roster has ten unique character IDs");
assert.equal(fixture.characters.filter(character => character.awake).length, fixture.awakenedCount,
  "fixture records exactly four initially awake characters");
assert.equal(fixture.characters.filter(character => !character.awake).length, fixture.torpidCount,
  "fixture records exactly six initially torpid characters");

const historyRelative = fixture.historyPath;
const historyCopies = walkFiles(patchesRoot).filter(file =>
  file.replace(patchesRoot + path.sep, "").replace(/\\/g, "/").endsWith("/mod/" + historyRelative));
assert.deepEqual(historyCopies.map(file => path.relative(root, file).replace(/\\/g, "/")),
  ["patches/wyvern-kings/mod/" + historyRelative],
  "the compatibility package has one complete final history overlay for the native character file");
const historyNodes = readPdx(path.join(kingsRoot, ...historyRelative.split("/")));
const history = new Map(historyNodes.filter(node => fixture.characters.some(character => character.id === node.key))
  .map(node => [node.key, node.value]));
assert.equal(history.size, 10, "the replacement history contains all ten fixed royal IDs");
for (const character of fixture.characters) {
  const state = history.get(character.id);
  assert.ok(state, "history contains royal ID " + character.id);
  assert.equal(scalar(state, "name", character.key + " history name"), character.name,
    character.key + " uses its exact stable name localization key");
  assert.equal(first(state, "female")?.value === "yes" ? "female" : "male", character.sex,
    character.key + " has the exact requested sex");
  const historyTraits = all(state, "trait").map(node => node.value);
  if (character.role === "black") assert.ok(historyTraits.includes("mm_royal_black_emperor"));
  else if (character.role === "white") assert.ok(historyTraits.includes("mm_royal_white_empress"));
  else assert.ok(historyTraits.includes("mm_royal_dragon_king"), character.key + " starts as a royal king");
  assert.equal(historyTraits.includes("mm_royal_torpor"), true,
    character.key + " starts asleep under the v1310 ritual contract");
  assert.ok(historyTraits.includes("myv_wyvern_legendary"), character.key + " retains the native legendary body");
  assert.equal(first(state, "father")?.value, character.twin ? "99001309" : undefined, character.key + " has the specified father only for twins");
  assert.equal(first(state, "mother")?.value, character.twin ? "99001310" : undefined, character.key + " has the specified mother only for twins");
  check(loc.english.get(character.name) === character.englishName, character.key + " English name resolves exactly");
  assert.equal(loc.chinese.get(character.name), character.chineseName, character.key + " Chinese name resolves exactly");
  check(loc.english.has(character.nickname), character.key + " has a dedicated English nickname localization");
  assert.equal(loc.chinese.get(character.nickname), character.chineseNickname,
    character.key + " has the exact requested Chinese title/nickname");
  const identity = characterBootstrap(character.id);
  assert.ok(identity, "bootstrap initializes royal ID " + character.id);
  assert.equal(all(identity, "give_nickname").length, character.nickname ? 1 : 0,
    character.key + " gets one fixed nickname exactly once");
  assert.equal(first(identity, "give_nickname")?.value, character.nickname,
    character.key + " is wired to its own fixed nickname");
}

const relationDefs = definitionMap(readPdx(path.join(kingsRoot, "common", "scripted_relations", "mm_royal_relations.txt")));
assert.equal(scalar(relationDefs.get("mm_dragon_creator"), "corresponding", "creator relation"), "mm_dragon_creation");
assert.equal(scalar(relationDefs.get("mm_dragon_creation"), "corresponding", "creation relation"), "mm_dragon_creator");
assert.equal(scalar(relationDefs.get("mm_dragon_twin"), "corresponding", "twin relation"), "mm_dragon_twin");
for (const character of fixture.characters.filter(entry => entry.twin)) {
  const identity = characterBootstrap(character.id);
  const twin = all(identity, "set_variable").find(node => first(node.value, "name")?.value === "mm_royal_twin")?.value;
  assert.ok(twin, character.key + " initializes its twin variable");
  assert.equal(scalar(twin, "name", character.key + " twin variable"), "mm_royal_twin");
  assert.equal(scalar(twin, "value", character.key + " twin value"), "character:" + character.twin,
    character.key + " stores the exact twin ID");
  assert.equal(all(identity, "set_relation_mm_dragon_twin").filter(node => node.value === "character:" + character.twin).length, 1,
    character.key + " has one explicit symmetric twin relation");
}
for (const edge of fixture.creators) {
  const identity = characterBootstrap(edge.creation);
  assert.ok(identity, "creation relation has a concrete creation character");
  assert.equal(all(identity, "set_relation_mm_dragon_creator").filter(node => node.value === "character:" + edge.creator).length, 1,
    "creator relation connects " + edge.creator + " to creation " + edge.creation);
}
assert.equal(countCalls(bootstrap, "set_father") + countCalls(bootstrap, "set_mother"), 0,
  "bootstrap does not rewrite biological parentage declared in history");

const nicknameDefs = definitionMap(readPdx(path.join(kingsRoot, "common", "nicknames", "mm_royal_nicknames.txt")));
for (const pair of fixture.pairs) {
  assert.equal(loc.chinese.get(pair.fusionName), pair.chineseFusionName, pair.fusion + " has its exact Chinese fusion name");
  check(nicknameDefs.has(pair.fusionNickname), pair.fusion + " fusion nickname is defined");
  assert.equal(loc.chinese.get(pair.fusionNickname), pair.chineseFusionNickname,
    pair.fusion + " has its exact Chinese fusion title");
}
for (const [traitName, trait] of traits) {
  if (!traitName.startsWith("mm_royal_")) continue;
  const icon = first(trait, "icon")?.value;
  assert.ok(icon, traitName + " names its trait icon");
  if (Array.isArray(icon)) {
    const iconPaths = walkNodes(icon, node => node.key === "desc" && typeof node.value === "string")
      .map(node => node.value);
    assert.ok(iconPaths.length > 0, traitName + " dynamic icon exposes at least one DDS path");
    for (const iconPath of iconPaths) {
      assert.match(iconPath, /\.dds$/i, traitName + " dynamic icon paths are DDS files");
      const file = iconPath.startsWith("gfx/interface/")
        ? path.join(kingsRoot, iconPath)
        : path.join(kingsRoot, "gfx", "interface", "icons", "traits", iconPath);
      assert.ok(fs.existsSync(file), traitName + " dynamic icon DDS exists at " + iconPath);
    }
  } else {
    assert.equal(typeof icon, "string", traitName + " fixed icon remains a string path");
    assert.ok(fs.existsSync(path.join(kingsRoot, "gfx", "interface", "icons", "traits", icon)),
      traitName + " fixed icon placeholder is present at its referenced path");
  }
}

const modules = JSON.parse(fs.readFileSync(path.join(root, "modules.json"), "utf8"));
const moduleIds = modules.map(module => module.id);
const kingsIndex = moduleIds.indexOf("wyvern-kings");
assert.ok(kingsIndex >= 0, "wyvern-kings is registered as a compatibility module");
assert.ok(kingsIndex > moduleIds.indexOf("wyvern-bloodline"),
  "wyvern-kings is loaded after bloodline so its single historical override is final");
assert.equal(modules[kingsIndex].source, "patches/wyvern-kings/mod");
const compatibility = JSON.parse(fs.readFileSync(path.join(root, "compatibility.json"), "utf8"));
assert.equal(compatibility.version, "1.3.22", "the assembled compatibility version includes royal physical profiles and age-linked mass");

function evaluateTrigger(nodes, current, world, previous = null, scopes = {}) {
  function resolve(text, scope = current) {
    if (text === "root" || text === "this") return scope;
    if (text === "prev") return previous;
    if (text.startsWith("character:")) return world.characters.get(text.slice(10));
    if (text.startsWith("scope:")) {
      const [scopeName, ...rest] = text.slice(6).split(".");
      let target = scopes[scopeName];
      for (const part of rest) target = target?.variables.get(part) ?? target?.[part];
      return target;
    }
    if (text.startsWith("var:")) {
      const [name, ...rest] = text.slice(4).split(".");
      let target = scope?.variables.get(name);
      for (const part of rest) target = target?.variables.get(part) ?? target?.[part];
      return target;
    }
    if (text === "yes") return true;
    if (text === "no") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
  }
  function same(left, right) {
    if (left && typeof left === "object" && "id" in left) left = left.id;
    if (right && typeof right === "object" && "id" in right) right = right.id;
    return left === right || String(left) === String(right);
  }
  function compare(left, operator, right) {
    if (operator === "=" || operator === "==" || operator === "?=") return same(left, right);
    if (operator === "!=") return !same(left, right);
    if (operator === ">=") return Number(left) >= Number(right);
    if (operator === "<=") return Number(left) <= Number(right);
    if (operator === ">") return Number(left) > Number(right);
    if (operator === "<") return Number(left) < Number(right);
    throw new Error("Unsupported trigger operator " + operator);
  }
  function run(block, scope, prev, localScopes) {
    for (const node of block || []) {
      if (node.operator === null) continue;
      if (node.key === "AND") {
        if (!run(node.value, scope, prev, localScopes)) return false;
      } else if (node.key === "OR") {
        if (!node.value.some(child => run([child], scope, prev, localScopes))) return false;
      } else if (node.key === "NOT") {
        if (run(node.value, scope, prev, localScopes)) return false;
      } else if (node.key === "trigger_if") {
        const limit = first(node.value, "limit")?.value || [];
        const branches = node.value.filter(child => child.key !== "limit");
        if (run(limit, scope, prev, localScopes) && !run(branches, scope, prev, localScopes)) return false;
      } else if (node.key === "trigger_else") {
        if (!run(node.value, scope, prev, localScopes)) return false;
      } else if (node.key.startsWith("character:") && Array.isArray(node.value)) {
        const target = resolve(node.key, scope);
        if (!target || !run(node.value, target, scope, localScopes)) return false;
      } else if (node.key.startsWith("scope:") && Array.isArray(node.value)) {
        const target = resolve(node.key, scope);
        if (!target || !run(node.value, target, scope, localScopes)) return false;
      } else if (node.key.startsWith("var:") && Array.isArray(node.value)) {
        const target = resolve(node.key, scope);
        if (!target || !run(node.value, target, scope, localScopes)) return false;
      } else if (/^mm_creed_controls_[a-z_]+_holy_site_trigger$/.test(node.key)) {
        const controlled = world.holySiteControl.get(node.key) ?? true;
        if (!compare(controlled, node.operator, resolve(node.value, scope))) return false;
      } else if (triggers.has(node.key)) {
        if (!run(triggers.get(node.key), scope, prev, localScopes)) return false;
      } else if (Array.isArray(node.value) && node.key === "any_relation") {
        const relationType = first(node.value, "type")?.value;
        const candidates = relationType === "myv_bonded_wyvern"
          ? [...(scope.bonded || [])].map(id => world.characters.get(id)).filter(Boolean)
          : [];
        if (!candidates.some(target => run(node.value.filter(child => child.key !== "type"), target, scope, localScopes))) return false;
      } else if (node.key === "has_trait") {
        if (!scope.traits.has(node.value)) return false;
      } else if (node.key === "has_character_flag") {
        if (!scope.flags.has(Array.isArray(node.value) ? scalar(node.value, "flag", "flag block") : node.value)) return false;
      } else if (node.key === "has_global_variable") {
        if (!world.globals.has(node.value)) return false;
      } else if (node.key === "has_relation_myv_bonded_wyvern") {
        const target = resolve(node.value, scope);
        if (!target || !scope.bonded?.has(target.id)) return false;
      } else if (node.key === "has_relation_myv_wyvern_bonded_character") {
        const target = resolve(node.value, scope);
        if (!target || !scope.bondedBy?.has(target.id)) return false;
      } else if (node.key === "has_relation_mm_dragon_twin") {
        const target = resolve(node.value, scope);
        if (!target || !scope.twins?.has(target.id)) return false;
      } else if (node.key === "exists") {
        if (resolve(node.value, scope) === undefined || resolve(node.value, scope) === null) return false;
      } else if (["is_alive", "is_adult", "is_imprisoned", "is_incapable", "is_ai", "myv_is_wyvern"].includes(node.key)) {
        const currentValue = node.key === "is_alive" ? scope.alive : scope[node.key];
        if (!compare(currentValue, node.operator, resolve(node.value, scope))) return false;
      } else if (node.key === "has_trait_xp" || node.key === "is_available_quick" || node.key === "is_knight_permitted") {
        continue;
      } else if (node.key === "type") {
        continue;
      } else if (node.key === "gold" || node.key === "prestige" || node.key === "piety" || node.key.startsWith("var:")) {
        const value = node.key.startsWith("var:") ? resolve(node.key, scope) : scope[node.key];
        if (!compare(value, node.operator, resolve(node.value, scope))) return false;
      } else if (["mm_royal_throne"].includes(node.key)) {
        if (!compare(scope.variables.get(node.key), node.operator, resolve(node.value, scope))) return false;
      } else if (node.key === "always") {
        if (node.value === "no") return false;
      } else if (node.key === "limit") {
        if (!run(node.value, scope, prev, localScopes)) return false;
      } else {
        throw new Error("Finite trigger executor does not support " + node.key);
      }
    }
    return true;
  }
  return run(nodes, current, previous, scopes);
}

function buildWorld() {
  const characters = new Map();
  for (const spec of fixture.characters) {
    const state = history.get(spec.id);
    const fixedTraits = all(state, "trait").map(node => node.value);
    const traitsForState = new Set(fixedTraits);
    const variables = new Map();
    const identity = characterBootstrap(spec.id);
    for (const node of all(identity, "set_variable")) {
      const block = node.value;
      if (first(block, "name")?.value === "mm_royal_twin") {
        variables.set("mm_royal_twin", first(block, "value").value.slice(10));
      }
      if (first(block, "name")?.value === "mm_royal_throne") {
        variables.set("mm_royal_throne", Number(first(block, "value").value));
      }
    }
    characters.set(spec.id, {
      id: spec.id,
      alive: true,
      is_adult: true,
      is_imprisoned: false,
      is_incapable: false,
      is_ai: false,
      myv_is_wyvern: true,
      female: spec.sex === "female",
      gold: 0,
      prestige: 0,
      piety: 0,
      traits: traitsForState,
      flags: new Set(["mm_royal_fixed_identity"]),
      variables,
      bonded: new Set(),
      bondedBy: new Set(),
      twins: new Set([spec.twin].filter(Boolean)),
      name: spec.name,
      nickname: spec.nickname,
      death: null,
      modifiers: new Set(),
    });
  }
  for (const spec of fixture.characters.filter(entry => entry.twin)) {
    characters.get(spec.id).variables.set("mm_royal_twin", spec.twin);
    characters.get(spec.id).twins.add(spec.twin);
  }
  return { characters, globals: new Set(["mm_royal_catalog_initialized"]), holySiteControl: new Map(), calls: [] };
}

const player = {
  id: "player",
  alive: true,
  is_adult: true,
  is_imprisoned: false,
  is_incapable: false,
  is_ai: false,
  myv_is_wyvern: false,
  gold: 20000,
  prestige: 20000,
  piety: 20000,
  traits: new Set(),
  flags: new Set(),
  variables: new Map(),
  bonded: new Set(),
  bondedBy: new Set(),
  twins: new Set(),
  modifiers: new Set(),
};

function context(world, current = player, extraScopes = {}) {
  return { world, current, previous: null, scopes: { actor: player, ...extraScopes }, random: [], calls: [] };
}

function evalValueText(text, scope, env) {
  if (text === "yes") return true;
  if (text === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("character:")) return env.world.characters.get(text.slice(10));
  if (text.startsWith("scope:")) return env.scopes[text.slice(6)];
  if (text.startsWith("var:")) return scope.variables.get(text.slice(4));
  return text;
}

function effectTrigger(block, current, env) {
  return evaluateTrigger(block, current, env.world, env.previous, env.scopes);
}

function executeEffects(nodes, current, env, options = {}) {
  let previousCondition = null;
  for (let index = 0; index < (nodes || []).length; index += 1) {
    const node = nodes[index];
    if (node.key === "if" || node.key === "else_if" || node.key === "else") {
      const chain = [node];
      let cursor = index + 1;
      while (cursor < nodes.length && ["else_if", "else"].includes(nodes[cursor].key)) chain.push(nodes[cursor++]);
      let selected = false;
      for (const branch of chain) {
        const limit = first(branch.value, "limit")?.value || [];
        const ok = branch.key === "else" || effectTrigger(limit, current, env);
        if (ok && !selected) {
          executeEffects(branch.value.filter(child => child.key !== "limit"), current, env, options);
          selected = true;
        }
      }
      index = cursor - 1;
      previousCondition = selected;
      continue;
    }
    if (node.key === "random_list") {
      const roll = env.random.shift() ?? 1;
      let cumulative = 0;
      for (const branch of node.value) {
        cumulative += Number(branch.key);
        if (roll <= cumulative) {
          executeEffects(branch.value, current, env, options);
          break;
        }
      }
      previousCondition = null;
      continue;
    }
    if (node.key.startsWith("character:") && Array.isArray(node.value)) {
      const target = env.world.characters.get(node.key.slice(10));
      if (target) executeEffects(node.value, target, env, options);
      previousCondition = null;
      continue;
    }
    if (node.key.startsWith("scope:") && Array.isArray(node.value)) {
      const target = env.scopes[node.key.slice(6)];
      if (target) {
        const old = env.previous;
        env.previous = current;
        executeEffects(node.value, target, env, options);
        env.previous = old;
      }
      previousCondition = null;
      continue;
    }
    if (options.onCall && options.onCall(node.key, current, env)) {
      previousCondition = null;
      continue;
    }
    // These new physical effects are executed against real script values and
    // successor fixtures in v135. This older harness tests throne transactions.
    if (["mm_royal_repair_profile_effect", "mm_royal_apply_physical_profile_effect"].includes(node.key)) {
      previousCondition = null;
      continue;
    }
    if (effects.has(node.key)) {
      executeEffects(effects.get(node.key), current, env, options);
      previousCondition = null;
      continue;
    }
    if (node.key === "add_gold" || node.key === "add_prestige" || node.key === "add_piety") {
      const property = node.key.slice(4);
      current[property] += Number(node.value);
      previousCondition = null;
      continue;
    }
    if (node.key === "add_character_flag") {
      current.flags.add(Array.isArray(node.value) ? scalar(node.value, "flag", "add flag") : node.value);
      previousCondition = null;
      continue;
    }
    if (node.key === "remove_character_flag") {
      current.flags.delete(node.value);
      previousCondition = null;
      continue;
    }
    if (node.key === "add_trait") {
      current.traits.add(node.value);
      previousCondition = null;
      continue;
    }
    if (node.key === "remove_trait") {
      current.traits.delete(node.value);
      previousCondition = null;
      continue;
    }
    if (node.key === "set_variable" && Array.isArray(node.value)) {
      const name = scalar(node.value, "name", "set_variable");
      current.variables.set(name, evalValueText(scalar(node.value, "value", "set_variable"), current, env));
      previousCondition = null;
      continue;
    }
    if (node.key === "set_global_variable" && Array.isArray(node.value)) {
      env.world.globals.add(scalar(node.value, "name", "set global"));
      previousCondition = null;
      continue;
    }
    if (node.key === "remove_variable") {
      current.variables.delete(node.value);
      previousCondition = null;
      continue;
    }
    if (node.key === "set_name") {
      current.name = node.value;
      previousCondition = null;
      continue;
    }
    if (node.key === "give_nickname") {
      current.nickname = node.value;
      previousCondition = null;
      continue;
    }
    if (node.key === "death" && Array.isArray(node.value)) {
      current.alive = false;
      current.death = {
        reason: first(node.value, "death_reason")?.value,
        killer: evalValueText(first(node.value, "killer")?.value, current, env)?.id,
      };
      previousCondition = null;
      continue;
    }
    if (["myv_refresh_wyvern_prowess_effect", "mm_royal_queue_daily_effect", "trigger_event"].includes(node.key)) {
      previousCondition = null;
      continue;
    }
    if (node.key === "limit") continue;
    throw new Error("Finite effect executor does not support " + node.key);
  }
  return previousCondition;
}

// v136 changes only tooltip presentation. The new group compares the unwrapped
// predicates to frozen v135 files and executes the actual wrapped predicates.
function unwrapTooltips(nodes) {
  return nodes.flatMap(node => node.key === "custom_tooltip" ? node.value.filter(child => child.key !== "text") : [node]);
}

function runWake(spec, world, mutateAfterValidation) {
  player.gold = 20000;
  player.prestige = 20000;
  player.piety = 20000;
  const decision = decisions.get(spec.decision);
  assert.ok(decision, "awakening decision exists: " + spec.decision);
  const valid = unwrapTooltips(required(decision, "is_valid", spec.decision));
  const effectBody = required(decision, "effect", spec.decision);
  const action = first(effectBody, "if")?.value;
  const effectLimit = first(action, "limit")?.value;
  assert.ok(effectLimit, spec.decision + " revalidates its full guard before payment");
  assert.deepEqual(effectLimit, valid, spec.decision + " repeats its full is_valid guard immediately before payment");
  const targetCheck = first(valid, "character:" + spec.target)?.value;
  assert.ok(targetCheck, spec.decision + " targets the exact fixed character ID");
  assert.equal(scalar(targetCheck, "is_alive", spec.decision + " target"), "yes");
  assert.ok(all(targetCheck, "has_trait").some(node => node.value === "mm_royal_torpor"),
    spec.decision + " requires the target to remain torpid");
  if (spec.bondedTwin) {
    assert.ok(all(valid, "has_relation_myv_bonded_wyvern").some(node => node.value === "character:" + spec.bondedTwin),
      spec.decision + " requires the player to remain bonded to the awake twin");
  }
  const cost = fixture.awakeningCosts[spec.cost];
  for (const resource of ["gold", "prestige", "piety"]) {
    assert.ok(all(valid, resource).some(node => node.operator === ">=" && Number(node.value) === cost[resource]),
      spec.decision + " requires exact " + resource + " availability");
    const spend = walkNodes(effectBody, node => node.key === "add_" + resource);
    assert.equal(spend.length, 1, spec.decision + " spends " + resource + " exactly once");
    assert.equal(Number(spend[0].value), -cost[resource], spec.decision + " spends the configured " + resource + " cost");
  }
  const worldContext = context(world);
  assert.equal(evaluateTrigger(valid, player, world, null, worldContext.scopes), true,
    spec.decision + " evaluates true for a live, bonded, qualified player and an eligible target");
  if (mutateAfterValidation) mutateAfterValidation(world);
  const before = [player.gold, player.prestige, player.piety];
  executeEffects(effectBody, player, worldContext);
  if (mutateAfterValidation) {
    assert.deepEqual([player.gold, player.prestige, player.piety], before,
      spec.decision + " charges nothing when the target changes after preflight");
    return;
  }
  assert.deepEqual([player.gold, player.prestige, player.piety],
    before.map((value, index) => value - [cost.gold, cost.prestige, cost.piety][index]),
    spec.decision + " applies each exact cost once");
  const target = world.characters.get(spec.target);
  assert.ok(!target.traits.has("mm_royal_torpor"), spec.decision + " awakens the same target ID");
  assert.ok(target.flags.has("mm_royal_awakened"), spec.decision + " marks the same target as awakened");
  const afterPayment = [player.gold, player.prestige, player.piety];
  executeEffects(effectBody, player, worldContext);
  assert.deepEqual([player.gold, player.prestige, player.piety], afterPayment,
    spec.decision + " cannot charge again after its target is awake");
}

for (const spec of fixture.awakenings.filter(entry => entry.cost === "pair")) {
  const world = buildWorld();
  player.bonded.add(spec.bondedTwin);
  world.characters.get(spec.bondedTwin).bondedBy.add(player.id);
  runWake(spec, world);
  player.bonded.clear();
  world.characters.get(spec.bondedTwin).bondedBy.clear();
}
{
  const world = buildWorld();
  for (const pair of fixture.pairs) {
    for (const id of pair.members) {
      const member = world.characters.get(id);
      member.traits.delete("mm_royal_torpor");
      player.bonded.add(id);
      member.bondedBy.add(player.id);
    }
  }
  runWake(fixture.awakenings.find(entry => entry.cost === "white"), world);
  player.bonded.clear();
}
{
  const world = buildWorld();
  for (const pair of fixture.pairs) world.globals.add("mm_royal_" + pair.throne + "_united");
  const bondedKing = world.characters.get("99001001");
  bondedKing.traits.delete("mm_royal_dragon_king");
  bondedKing.traits.add("mm_royal_complete");
  bondedKing.traits.delete("mm_royal_torpor");
  bondedKing.bondedBy.add(player.id);
  player.bonded.add(bondedKing.id);
  const white = world.characters.get("99001310");
  white.traits.delete("mm_royal_torpor");
  runWake(fixture.awakenings.find(entry => entry.cost === "black"), world);
  player.bonded.clear();
}
{
  const spec = fixture.awakenings.find(entry => entry.cost === "pair");
  const world = buildWorld();
  player.bonded.add(spec.bondedTwin);
  world.characters.get(spec.bondedTwin).bondedBy.add(player.id);
  runWake(spec, world, currentWorld => currentWorld.characters.get(spec.target).alive = false);
  player.bonded.clear();
  world.characters.get(spec.bondedTwin).bondedBy.clear();
}

{
  const spec = fixture.awakenings.find(entry => entry.cost === "pair");
  const world = buildWorld();
  player.bonded.add(spec.bondedTwin);
  world.characters.get(spec.bondedTwin).bondedBy.add(player.id);
  const valid = unwrapTooltips(required(decisions.get(spec.decision), "is_valid", spec.decision));
  const site = valid.find(node => /^mm_creed_controls_[a-z_]+_holy_site_trigger$/.test(node.key));
  assert.ok(site, "awakening retains its holy site guard");
  world.holySiteControl.set(site.key, false);
  assert.equal(evaluateTrigger(valid, player, world, null, context(world).scopes), false, "lost holy site blocks awakening");
  world.holySiteControl.set(site.key, true);
  runWake(spec, world, currentWorld => currentWorld.holySiteControl.set(site.key, false));
  player.bonded.clear();
  world.characters.get(spec.bondedTwin).bondedBy.clear();
}

const whiteDecision = decisions.get("mm_royal_wake_white_empress_decision");
const whiteValid = unwrapTooltips(required(whiteDecision, "is_valid", "white awakening"));
const whiteOrBranches = walkNodes(whiteValid, node => node.key === "OR");
for (const pair of fixture.pairs) {
  const [left, right] = pair.members.map(id => id);
  const united = "mm_royal_" + pair.throne + "_united";
  const pairRequirement = whiteOrBranches.find(or => contains(or.value, "has_global_variable", united));
  assert.ok(pairRequirement,
    "white empress may awaken when the " + pair.throne + " throne is already united");
  check(walkNodes(pairRequirement.value, node => node.key === "AND").some(and => {
    const ids = walkNodes(and.value, child => child.key.startsWith("character:")).map(child => child.key.slice(10));
    const torporNot = walkNodes(and.value, child => child.key === "NOT" && contains(child.value, "has_trait", "mm_royal_torpor"));
    return ids.includes(left) && ids.includes(right) && contains(and.value, "is_alive", "yes") && torporNot.length >= 2;
  }), "white empress may awaken when both " + pair.throne + " twins are alive and awake");
}
const blackWake = decisions.get("mm_royal_wake_black_emperor_decision");
const blackValid = unwrapTooltips(required(blackWake, "is_valid", "black awakening"));
check(contains(blackValid, "mm_royal_all_thrones_united", "yes"),
  "black emperor requires every throne to be united");
check(contains(blackValid, "character:99001310", "") || walkNodes(blackValid, node => node.key === "character:99001310").length > 0,
  "black emperor condition refers to the existing white empress ID");

const devour = definitionMap(readPdx(path.join(kingsRoot, "common", "character_interactions", "mm_royal_devour.txt")));
const devourInteraction = devour.get("mm_royal_command_devour_interaction");
assert.ok(devourInteraction, "explicit twin-devour interaction exists");
const pairReady = triggers.get("mm_royal_pair_ready_for_devour");
assert.ok(pairReady, "devour interaction uses a scripted eligibility trigger");
check(contains(pairReady, "is_alive", "yes"), "devour rechecks that both twins are alive");
check(contains(pairReady, "has_trait", "mm_royal_dragon_king"), "devour only accepts unmerged royal twins");
assert.ok(walkNodes(pairReady, node => node.key === "var:mm_royal_twin").length > 0,
  "devour eligibility checks the stored reciprocal twin ID");
check(contains(pairReady, "has_relation_myv_wyvern_bonded_character", "scope:actor"),
  "devour requires the player to be bonded to each twin");
assert.ok(walkNodes(pairReady, node => node.key === "has_relation_myv_wyvern_bonded_character" &&
  node.value === "scope:actor").length >= 2, "devour rechecks the bond on both twins");
assert.ok(walkNodes(pairReady, node => node.key === "NOT" &&
  contains(node.value, "has_trait", "mm_royal_torpor")).length >= 2,
"devour excludes both torpid twins");
assert.equal(countCalls(first(devourInteraction, "on_accept")?.value, "mm_royal_pair_ready_for_devour"), 1,
  "devour revalidates its pair immediately on acceptance");
const onAccept = first(devourInteraction, "on_accept").value;
for (let throne = 1; throne <= 4; throne += 1) {
  const pair = fixture.pairs[throne - 1];
  const unitedFlag = "mm_royal_" + pair.throne + "_united";
  const branch = walkNodes(onAccept, node => node.key === "if" && Array.isArray(node.value))
    .find(node => {
      const limit = first(node.value, "limit")?.value || [];
      const throneMatch = walkNodes(limit, node => node.key === "var:mm_royal_throne" && node.value === String(throne)).length > 0;
      return throneMatch &&
        walkNodes(limit, node => node.key === "has_global_variable" && node.value === unitedFlag).length > 0;
    });
  assert.ok(branch, pair.throne + " has a one-time fusion branch gated by its own throne");
  const branchBody = branch.value;
  const limit = first(branchBody, "limit").value;
  assert.ok(walkNodes(limit, node => node.key === "NOT" && contains(node.value, "has_global_variable", unitedFlag)).length > 0,
    pair.throne + " fusion branch cannot run twice");
  assert.equal(all(branchBody, "set_global_variable").filter(node => first(node.value, "name")?.value === unitedFlag).length, 1,
    pair.throne + " fusion marks only its own throne united");
  assert.ok(all(branchBody, "remove_trait").some(node => node.value === "mm_royal_dragon_king"));
  assert.ok(all(branchBody, "add_trait").some(node => node.value === "mm_royal_complete"));
  assert.ok(all(branchBody, "set_name").some(node => node.value === pair.fusionName));
  assert.ok(all(branchBody, "give_nickname").some(node => node.value === pair.fusionNickname));
  assert.equal(all(branchBody, "set_variable").filter(node => first(node.value, "name")?.value === "mm_royal_consumed_twin").length, 1,
    pair.throne + " records the actual consumed twin on the survivor");
  const death = walkNodes(branchBody, node => node.key === "death");
  assert.equal(death.length, 1, pair.throne + " fusion executes exactly one true death");
  assert.equal(first(death[0].value, "death_reason")?.value, "death_mm_royal_devoured");
  assert.equal(first(death[0].value, "killer")?.value, "scope:mm_royal_survivor");
}
assert.equal(countCalls(onAccept, "create_character"), 0, "fusion preserves a survivor ID and never creates a replacement character");

function runFusion(pair, throneNumber, world) {
  const unitedFlag = "mm_royal_" + pair.throne + "_united";
  if (world.globals.has(unitedFlag)) return false;
  const survivor = world.characters.get(pair.members[0]);
  const victim = world.characters.get(pair.members[1]);
  survivor.variables.set("mm_royal_throne", throneNumber);
  survivor.variables.set("mm_royal_twin", victim.id);
  const branch = walkNodes(onAccept, node => node.key === "if" && Array.isArray(node.value))
    .find(node => walkNodes(first(node.value, "limit")?.value || [], child =>
      child.key === "var:mm_royal_throne" && child.value === String(throneNumber)).length > 0);
  assert.ok(branch, pair.throne + " parsed fusion branch is executable");
  const beforeSurvivorId = survivor.id;
  const oldVictimId = victim.id;
  const beforeGlobal = new Set(world.globals);
  const env = context(world, survivor, { mm_royal_survivor: survivor, mm_royal_victim: victim });
  executeEffects([branch], survivor, env);
  if (!world.globals.has(unitedFlag)) {
    assert.deepEqual(world.globals, beforeGlobal, pair.throne + " wrong branch cannot mutate the throne");
    return false;
  }
  assert.equal(survivor.id, beforeSurvivorId, pair.throne + " fusion preserves the chosen survivor ID");
  assert.equal(victim.id, oldVictimId, pair.throne + " victim keeps the same historical ID");
  assert.equal(victim.alive, false, pair.throne + " victim receives a real death");
  assert.equal(victim.death.reason, "death_mm_royal_devoured");
  assert.equal(victim.death.killer, survivor.id);
  assert.ok(survivor.traits.has("mm_royal_complete"));
  assert.ok(!survivor.traits.has("mm_royal_dragon_king"));
  assert.equal(survivor.name, pair.fusionName);
  assert.equal(survivor.nickname, pair.fusionNickname);
  assert.equal(survivor.variables.get("mm_royal_consumed_twin"), victim);
  return true;
}

for (let index = 0; index < fixture.pairs.length; index += 1) {
  const pair = fixture.pairs[index];
  const world = buildWorld();
  for (const id of pair.members) {
    const member = world.characters.get(id);
    member.traits.delete("mm_royal_torpor");
    member.bondedBy.add(player.id);
  }
  const survivor = world.characters.get(pair.members[0]);
  const victim = world.characters.get(pair.members[1]);
  survivor.bonded = new Set([player.id]);
  victim.bonded = new Set([player.id]);
  player.bonded.add(survivor.id);
  player.bonded.add(victim.id);
  assert.equal(runFusion(pair, index + 1, world), true, pair.throne + " executes its exact fusion branch");
  assert.equal(runFusion(pair, index + 1, world), false, pair.throne + " cannot fuse a second time");
  player.bonded.clear();
}
{
  const pair = fixture.pairs[0];
  const world = buildWorld();
  const survivor = world.characters.get(pair.members[0]);
  survivor.variables.set("mm_royal_throne", 2);
  const before = new Set(world.globals);
  const env = context(world, survivor, {
    mm_royal_survivor: survivor,
    mm_royal_victim: world.characters.get(pair.members[1]),
  });
  const wrongBranch = walkNodes(onAccept, node => node.key === "if" && Array.isArray(node.value))
    .find(node => walkNodes(first(node.value, "limit")?.value || [], child => child.key === "var:mm_royal_throne" && child.value === "1").length > 0);
  executeEffects([wrongBranch], survivor, env);
  assert.deepEqual(world.globals, before, "a twin from another throne cannot trigger the wrong fusion");
}

const combatEffects = new Map(walkFiles(path.join(kingsRoot, "common", "scripted_effects"))
  .flatMap(file => [...definitionMap(readPdx(file))]));
const woundEntries = [
  ["myv_apply_aerial_wyvern_wound_effect", "mm_royal_native_aerial_wound_effect", "scope:myv_aerial_wound_target"],
  ["myv_slay_apply_targeted_wound_effect", "mm_royal_native_targeted_wound_effect", "scope:myv_slay_wyvern_target"],
  ["myv_apply_aerial_crash_injuries_effect", "mm_royal_native_crash_injuries_effect", null],
  ["myv_apply_wyvern_random_battle_injury_effect", "mm_royal_native_battle_injury_effect", null],
];
for (const [entry, native, subjectScope] of woundEntries) {
  const stormWrapper = entry === "myv_apply_aerial_crash_injuries_effect" ? null : combatEffects.get(entry);
  const wrapper = stormWrapper ? combatEffects.get(entry + "_after_storm_effect") : combatEffects.get(entry);
  if (stormWrapper) {
    const stormGate = first(stormWrapper, "if")?.value || [];
    const stormLimit = first(stormGate, "limit")?.value || [];
    assert.ok(contains(stormLimit, "rite", "rite:mm_dragon_sky"), entry + " restricts the additional roll to sky rite");
    if (subjectScope) assert.equal(walkNodes(stormLimit, node => node.key === subjectScope).length, 1);
    const stormRoll = first(stormGate, "random_list")?.value || [];
    assert.deepEqual(stormRoll.map(node => Number(node.key)), [20, 80]);
    assert.equal(countCalls(stormRoll[0].value, entry + "_after_storm_effect"), 0);
    assert.equal(countCalls(stormRoll[1].value, entry + "_after_storm_effect"), 1);
    assert.equal(countCalls(first(stormWrapper, "else").value, entry + "_after_storm_effect"), 1);
  }
  const nativeBody = combatEffects.get(native);
  assert.ok(wrapper, "wound entry wraps " + entry);
  assert.ok(nativeBody, "original wound body remains under " + native);
  const rolls = walkNodes(wrapper, node => node.key === "random_list");
  assert.equal(rolls.length, 1, entry + " makes exactly one complete block roll per hit");
  const branches = rolls[0].value;
  assert.deepEqual(branches.map(node => [Number(node.key), node.value]), [[70, branches[0].value], [30, branches[1].value]],
    entry + " uses an exact 70/30 immune/apply split");
  const gate = first(wrapper, "if")?.value;
  const limit = first(gate, "limit")?.value || [];
  assert.ok(subjectScope ? contains(limit, subjectScope, "") || walkNodes(limit, node => node.key === subjectScope).length === 1
    : contains(limit, "mm_royal_is_emperor", "yes"), entry + " gates only the intended royal target");
  assert.ok(contains(limit, "mm_royal_is_emperor", "yes"), entry + " grants complete immunity only to black/white emperors");
  assert.equal(countCalls(branches[0].value, native), 0, entry + " 70% branch never applies the original wound");
  assert.equal(countCalls(branches[1].value, native), 1, entry + " 30% branch applies the original wound once");
  const observed = [];
  for (const [emperor, roll, expectedCalls] of [[true, 1, 0], [true, 100, 1], [false, 1, 1]]) {
    const currentWorld = buildWorld();
    const dragon = currentWorld.characters.get("99001309");
    dragon.traits.delete("mm_royal_torpor");
    dragon.traits.delete("mm_royal_black_emperor");
    if (emperor) dragon.traits.add("mm_royal_black_emperor");
    const env = context(currentWorld, subjectScope ? player : dragon, {
      myv_aerial_wound_target: dragon,
      myv_slay_wyvern_target: dragon,
    });
    env.random.push(roll);
    let nativeCalls = 0;
    executeEffects(wrapper, env.current, env, {
      onCall(name) {
        if (name === native) {
          nativeCalls += 1;
          return true;
        }
        return false;
      },
    });
    assert.equal(nativeCalls, expectedCalls, entry + " actual parsed effect executes the native wound " + expectedCalls + " times");
    observed.push(nativeCalls);
  }
  assert.deepEqual(observed, [0, 1, 1]);
}

const recovery = combatEffects.get("mm_royal_native_recovery_effect");
assert.ok(recovery, "native injury recovery remains available for royal and ordinary dragons");
const woundTracks = [
  "myv_wyvern_wound_left_eye", "myv_wyvern_wound_right_eye",
  "myv_wyvern_wound_left_wing", "myv_wyvern_wound_right_wing",
  "myv_wyvern_wound_left_hindleg", "myv_wyvern_wound_right_hindleg", "myv_wyvern_tail_injury",
];
const dailyDecrements = walkNodes(recovery, node => node.key === "add_trait_xp" && Array.isArray(node.value) &&
  first(node.value, "value")?.value === "-1");
assert.equal(dailyDecrements.length, woundTracks.length, "daily recovery decrements each of seven native injury tracks once");
for (const track of woundTracks) {
  const matching = track === "myv_wyvern_tail_injury"
    ? dailyDecrements.filter(node => !first(node.value, "track") &&
      first(node.value, "trait")?.value === "myv_wyvern_tail_injury")
    : dailyDecrements.filter(node => first(node.value, "track")?.value === track);
  assert.equal(matching.length, 1,
  "daily recovery decrements " + track + " exactly once");
}
const dailyEvent = definitionMap(readPdx(path.join(kingsRoot, "events", "mm_royal_events.txt"))).get("mm_royal.0001");
const dailyBody = required(dailyEvent, "immediate", "royal daily recovery event");
assert.equal(countCalls(dailyBody, "mm_royal_native_recovery_effect"), 1,
  "daily queued event runs preserved native recovery exactly once for each live royal");
check(contains(dailyBody, "mm_royal_is_king", "yes"), "daily recovery includes torpid living kings");
const monthlyRecovery = combatEffects.get("myv_wyvern_monthly_combat_injury_recovery_effect");
assert.ok(monthlyRecovery, "ordinary monthly recovery wrapper is registered");
const monthlyGate = first(first(monthlyRecovery, "if")?.value || [], "limit")?.value || [];
assert.ok(contains(monthlyGate, "mm_royal_is_king", "no"),
  "monthly recovery explicitly excludes royal characters, preventing double healing");
assert.equal(countCalls(monthlyRecovery, "mm_royal_native_recovery_effect"), 1,
  "ordinary monthly recovery calls the preserved backend once");

const royalTriggerChecks = [
  [triggers.get("myv_is_living_wild_wyvern"), "living wild dragon trigger", true],
  [triggers.get("mm_wyvern_can_serve_as_knight"), "independent knight eligibility", true],
  [triggers.get("mm_dragon_stable_mother_valid_trigger"), "stable mother eligibility", true],
  [triggers.get("mm_dragon_stable_pair_valid_trigger"), "stable father eligibility", true],
  [triggers.get("mm_dragon_human_pair_valid_trigger"), "human-form breeding eligibility", true],
  [triggers.get("myv_is_personally_bonded_tamed_wyvern"), "bonded rider/human eligibility", true],
];
for (const [trigger, label] of royalTriggerChecks) {
  assert.ok(trigger, label + " is available for torpor review");
  check(walkNodes(trigger, node => node.key === "NOT" && contains(node.value, "has_trait", "mm_royal_torpor")).length > 0,
    label + " excludes torpid dragons");
}
for (const [interactionFile, names] of [
  [path.join(kingsRoot, "common", "character_interactions", "zzzzzzzz_mm_royal_availability.txt"),
    ["myv_attempt_slay_wyvern_interaction", "myv_set_wyvern_war_mount_interaction", "myv_ride_wyvern_interaction", "mm_wyvern_toggle_human_form_interaction"]],
]) {
  const interactionDefs = definitionMap(readPdx(interactionFile));
  for (const name of names) {
    const interaction = interactionDefs.get(name);
    assert.ok(interaction, "torpor protected interaction exists: " + name);
    const shown = required(interaction, "is_shown", name);
    const valid = first(interaction, "is_valid_showing_failures_only")?.value || [];
    const accepted = first(interaction, "on_accept")?.value || [];
    check(contains(shown, "mm_royal_torpor", "mm_royal_torpor") ||
      walkNodes(shown, node => node.key === "NOT" && contains(node.value, "has_trait", "mm_royal_torpor")).length > 0,
    name + " hides torpid targets");
    check(walkNodes(valid, node => node.key === "NOT" && contains(node.value, "has_trait", "mm_royal_torpor")).length > 0 ||
      walkNodes(shown, node => node.key === "NOT" && contains(node.value, "has_trait", "mm_royal_torpor")).length > 0,
    name + " rejects torpid targets at validation");
    check(walkNodes(accepted, node => node.key === "NOT" && contains(node.value, "has_trait", "mm_royal_torpor")).length > 0 ||
      name === "myv_attempt_slay_wyvern_interaction",
    name + " rechecks torpor on acceptance");
  }
}
const monthly = definitionMap(readPdx(path.join(kingsRoot, "common", "on_action", "zzzzzzzz_mm_royal_monthly.txt")))
  .get("myv_wyvern_monthly_pulse");
assert.ok(monthly, "native monthly pulse is overlaid rather than replaced with an unsupported global pulse");
check(walkNodes(monthly, node => node.key === "NOT" &&
  contains(node.value, "has_trait", "mm_royal_torpor")).length > 0,
"monthly dragon iteration excludes torpid kings from hunger and normal wild activity");
const torporRecall = walkNodes(monthly, node => node.key === "if" &&
  contains(node.value, "mm_royal_is_king", "yes") &&
  contains(node.value, "has_trait", "mm_royal_torpor"))[0];
check(torporRecall && contains(torporRecall.value, "is_travelling", "yes") &&
  contains(torporRecall.value, "can_cancel", "yes") &&
  contains(torporRecall.value, "cancel_travel_plan", "yes"),
"torpor repair cancels an existing travel plan only through the native cancellation guard");
check(contains(torporRecall.value, "remove_character_flag", "myv_wyvern_roaming") &&
  contains(torporRecall.value, "has_variable", "myv_wyvern_lair_barony") &&
  walkNodes(torporRecall.value, node => node.key === "set_location").length > 0 &&
  contains(torporRecall.value, "location", "scope:mm_royal_torpor_lair") &&
  contains(torporRecall.value, "stick_to_location", "yes"),
"torpid kings return to the existing lair and clear stale roaming state");
const monthlyHunger = combatEffects.get("myv_wyvern_monthly_hunger_effect");
check(walkNodes(monthlyHunger, node => node.key === "NOT" && contains(node.value, "has_trait", "mm_royal_torpor")).length > 0,
  "the native monthly hunger effect independently blocks torpid dragons");
const torporTrait = traits.get("mm_royal_torpor");
assert.ok(torporTrait, "torpor is an independent trait");
assert.equal(scalar(torporTrait, "incapacitating", "torpor"), "yes");
assert.equal(scalar(torporTrait, "can_have_children", "torpor"), "no");
assert.equal(scalar(torporTrait, "disables_combat_leadership", "torpor"), "yes");
assert.equal(walkFiles(path.join(kingsRoot, "common", "on_action"))
  .filter(file => /on_daily_pulse/.test(fs.readFileSync(file, "utf8"))).length, 0,
"royal recovery does not invent a global daily pulse");
const dailyQueue = effects.get("mm_royal_queue_daily_effect");
assert.ok(dailyQueue, "royal recovery uses an explicit per-character delayed queue");
const queuedFlag = walkNodes(dailyQueue, node => node.key === "add_character_flag" && Array.isArray(node.value));
assert.equal(queuedFlag.length, 1);
assert.equal(scalar(queuedFlag[0].value, "flag", "daily queue flag"), "mm_royal_daily_queued");
assert.equal(scalar(queuedFlag[0].value, "days", "daily queue lifetime"), "2");
const delayedEvent = walkNodes(dailyQueue, node => node.key === "trigger_event" && Array.isArray(node.value));
assert.equal(delayedEvent.length, 1);
assert.equal(scalar(delayedEvent[0].value, "id", "queued recovery event"), "mm_royal.0001");
assert.equal(scalar(delayedEvent[0].value, "days", "recovery interval"), "1");
const queueTargets = walkNodes(bootstrap, node => node.key === "mm_royal_queue_daily_effect").length;
assert.equal(queueTargets, 10, "bootstrap seeds one delayed recovery chain per fixed royal ID");

const royalPower = values.get("mm_royal_power_cap");
assert.ok(royalPower, "canonical royal power cap is defined");
for (const tier of fixture.tiers) {
  const matching = walkNodes(royalPower, node => node.key === "has_trait" && node.value === tier.trait).length;
  assert.equal(matching, 1, tier.trait + " has a unique canonical power tier");
  check(walkNodes(royalPower, node => node.key === "value" && Number(node.value) === tier.power).length === 1,
    tier.trait + " has the exact " + tier.power + " power cap");
  const trait = traits.get(tier.trait);
  assert.ok(trait, tier.trait + " trait exists");
  assert.equal(Number(scalar(trait, "prowess", tier.trait)), tier.prowess);
  assert.equal(Number(scalar(trait, "health", tier.trait)), tier.health);
  for (const flag of ["is_immortal", "immortal_visuals", "immortal_incapability", "immune_to_disease"]) {
    assert.ok(all(trait, "flag").some(node => node.value === flag), tier.trait + " retains " + flag);
  }
  assert.equal(scalar(trait, "immortal", tier.trait), "yes", tier.trait + " is ageless");
  assert.equal(Number(scalar(trait, "elderly_health", tier.trait)), 666);
  assert.equal(first(trait, "epidemic_resistance"), undefined,
    tier.trait + " does not add a second +100 epidemic resistance on top of the legendary body");
}
const speciesTraits = definitionMap(readPdx(path.join(captureRoot, "common", "traits", "zzzzz_mm_wyvern_species_health.txt")));
assert.equal(Number(scalar(speciesTraits.get("myv_wyvern_legendary"), "epidemic_resistance", "legendary body")), 100,
  "the native legendary body provides the sole +100 epidemic resistance source");
const supportTraits = definitionMap(readPdx(path.join(kingsRoot, "common", "modifiers", "mm_royal_army_support.txt")));
for (let index = 0; index < fixture.tiers.length; index += 1) {
  const expected = fixture.tiers[index];
  const modifier = supportTraits.get("mm_royal_support_" + (index + 1));
  assert.ok(modifier, "support modifier exists for tier " + (index + 1));
  for (const field of ["movement_speed", "enemy_hard_casualty_modifier", "max_combat_roll", "siege_phase_time", "advantage"]) {
    assert.equal(Number(scalar(modifier, field, "support tier " + (index + 1))), expected[field],
      "support tier " + (index + 1) + " uses exact " + field);
  }
}
const targetPower = values.get("myv_wyvern_target_prowess");
assert.ok(targetPower, "royal power routes through the native canonical dragon target power");
const royalPath = first(first(targetPower, "if")?.value || [], "if")?.value;
assert.ok(royalPath, "canonical target power has a royal branch");
const royalPowerNodes = royalPath;
const royalCapBeforeHunger = royalPowerNodes.findIndex(node => node.key === "max" && node.value === "mm_royal_power_cap");
const hungerAfterCap = royalPowerNodes.findIndex((node, index) => index > royalCapBeforeHunger &&
  node.key === "multiply" && node.value === "mm_wyvern_hunger_power_multiplier");
assert.ok(royalCapBeforeHunger >= 0 && hungerAfterCap > royalCapBeforeHunger,
  "canonical royal power applies hunger after the tiered base/cap calculation");
assert.equal(royalPowerNodes.filter(node => node.key === "multiply" && node.value === "mm_wyvern_hunger_power_multiplier").length, 1,
  "royal hunger is applied exactly once");
const royalSupport = effects.get("mm_royal_refresh_army_support_effect");
assert.ok(royalSupport, "army support refresh is defined");
for (let tier = 1; tier <= 4; tier += 1) {
  const block = walkNodes(royalSupport, node => node.key === "add_character_modifier" && Array.isArray(node.value) &&
    first(node.value, "modifier")?.value === "mm_royal_support_" + tier);
  assert.equal(block.length, 1, "army support selects tier " + tier + " exactly once");
  const expectedTrait = fixture.tiers[tier - 1].trait;
  const matchingIf = walkNodes(royalSupport, node => node.key === "if" && Array.isArray(node.value))
    .find(node => contains(first(node.value, "limit")?.value || [], "has_trait", expectedTrait));
  assert.ok(matchingIf, "tier " + tier + " support is keyed by its exact royal trait");
  const modifiers = walkNodes(matchingIf.value, node => node.key === "add_character_modifier");
  assert.equal(modifiers.length, 1, "tier " + tier + " removes all prior support and adds one level");
  const supportGuard = walkNodes(matchingIf.value, node => node.key === "if")
    .map(node => first(node.value, "limit")?.value || [])
    .find(limit => contains(limit, "is_alive", "yes"));
  assert.ok(supportGuard, "tier " + tier + " support rechecks a living commander");
  for (let higher = tier + 1; higher <= 4; higher += 1) {
    assert.ok(walkNodes(supportGuard, node => node.key === "NOT" &&
      contains(node.value, "has_character_modifier", "mm_royal_support_" + higher)).length > 0,
    "lower tier " + tier + " cannot cover higher tier " + higher + " in the same army");
  }
  for (let lowerOrEqual = 1; lowerOrEqual <= 4; lowerOrEqual += 1) {
    assert.ok(walkNodes(matchingIf.value, node => node.key === "remove_character_modifier")
      .some(node => node.value === "mm_royal_support_" + lowerOrEqual),
    "tier " + tier + " clears old modifier " + lowerOrEqual + " before applying the highest available level");
  }
}

const nativeLegendaryHatch = definitionMap(readPdx(path.join(bloodlineRoot, "common", "scripted_effects", "zzzzz_mm_dragon_native_eggs.txt")))
  .get("myv_hatch_wyvern_egg_effect");
assert.ok(nativeLegendaryHatch, "native egg hatch path remains in the active bloodline module");
const legendaryEggBranch = walkNodes(nativeLegendaryHatch, node => node.key === "if" && Array.isArray(node.value))
  .find(node => contains(first(node.value, "limit")?.value || [], "var:mm_dragon_legendary_egg", "yes"));
assert.ok(legendaryEggBranch, "legendary egg branch grants the inheritance origin on hatch");
const branchText = JSON.stringify(legendaryEggBranch);
assert.ok(branchText.includes("mm_wyvern_legendary_origin"), "lineage child receives the established legendary-origin trait");
for (const status of ["mm_royal_dragon_king", "mm_royal_complete", "mm_royal_black_emperor", "mm_royal_white_empress", "mm_royal_torpor"]) {
  assert.ok(!branchText.includes(status), "offspring never inherits royal status " + status);
}
const hatchDefinitions = [bloodlineRoot, kingsRoot].flatMap(directory => walkFiles(path.join(directory, "common/scripted_effects"), ".txt")
  .filter(file => definitionMap(readPdx(file)).has("myv_hatch_wyvern_egg_effect")));
assert.deepEqual(hatchDefinitions, [path.join(bloodlineRoot, "common/scripted_effects/zzzzz_mm_dragon_native_eggs.txt")],
  "bloodline owns the one canonical hatch override; optional kings uses the creation-source hook");
assert.equal(effects.has("myv_hatch_wyvern_egg_effect"), false, "kings never hides the canonical hatch with a stale second copy");
const finalHatch = nativeLegendaryHatch;
const finalLegendaryBranch = walkNodes(finalHatch, node => node.key === "if" && Array.isArray(node.value)
  && contains(first(node.value, "limit")?.value || [], "var:mm_dragon_legendary_egg", "yes"))[0];
assert.ok(finalLegendaryBranch, "final hatch override keeps legendary bloodline inheritance");
check(JSON.stringify(finalLegendaryBranch).includes("mm_wyvern_legendary_origin"),
  "final assembled hatch logic grants only the legendary-origin bloodline");
for (const status of ["mm_royal_dragon_king", "mm_royal_complete", "mm_royal_black_emperor", "mm_royal_white_empress", "mm_royal_torpor"]) {
  assert.ok(!JSON.stringify(finalLegendaryBranch).includes(status),
    "final hatch logic does not grant named royal status " + status);
}
for (const sourceFile of walkFiles(bloodlineRoot, ".txt")) {
  const source = fs.readFileSync(sourceFile, "utf8");
  assert.doesNotMatch(source, /add_trait\s*=\s*mm_royal_(?:dragon_king|complete|black_emperor|white_empress|torpor)\b/,
    path.relative(root, sourceFile) + " does not grant a royal title to descendants");
}

console.log("v1.3.0 dragon king finite-PDX regression checks passed");

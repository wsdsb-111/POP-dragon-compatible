"use strict";
// Deterministic finite arithmetic over the actual native MTTH and added script
// values. It does not emulate CK3's runtime or third-party custom factions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v1311-finite-helper");
const h = createHarness([]);
const game = process.env.CK3_GAME_DIR || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
const hanfan = process.env.CK3_HANFAN_MOD_DIR || "D:/SteamLibrary/steamapps/workshop/content/1158310/2592094512";
const root = path.resolve(__dirname, "..");
const override = path.join(root, "patches/dragon-creed/mod/common/factions/zzzzzz_mm_v1312_factions.txt");
const valuesFile = path.join(root, "patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_faction_values.txt");
const modifiersFile = path.join(game, "common/scripted_modifiers/00_faction_modifiers.txt");
const factionDir = path.join(game, "common/factions");
const read = file => fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
const parse = file => h.parsePdx(read(file), file);
const nativeFiles = fs.readdirSync(factionDir).filter(n => n.endsWith(".txt") && !n.startsWith("_")).map(n => path.join(factionDir, n));
nativeFiles.push(path.join(hanfan, "common/factions/hanfan_factions.txt"));
const original = new Map();
const originalSource = new Map();
for (const file of nativeFiles) for (const node of parse(file)) {
  if (!Array.isArray(node.value) || !node.value.some(x => x.key === "discontent_progress")) continue;
  assert.ok(!original.has(node.key), "duplicate native or supported faction " + node.key);
  original.set(node.key, node);
  originalSource.set(node.key, read(file));
}
const changed = new Map(parse(override).filter(n => Array.isArray(n.value)).map(n => [n.key, n]));
assert.equal(original.size, 14, "12 native and two supported Hanfan factions are covered");
assert.deepEqual([...changed.keys()].sort(), [...original.keys()].sort());
function rawBlock(text, name) {
  const match = new RegExp(`^${name}\\s*=\\s*\\{`, "m").exec(text);
  assert.ok(match);
  let depth = 0, quoted = false, comment = false, escaped = false;
  for (let i = text.indexOf("{", match.index); i < text.length; i++) {
    const c = text[i];
    if (comment) { if (c === "\n") comment = false; continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === "#") comment = true;
    else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(match.index, i + 1);
  }
  throw new Error("unclosed faction " + name);
}
const addition = /\t\t# v1\.3\.12: subtract 40% of positive final progress only\.\r?\n\t\tmodifier = \{\r?\n\t\t\tfaction_target = \{[^\r\n]*\r?\n\t\t\tadd = [^\r\n]*\r?\n\t\t\tdesc = mm_creed_faction_resistance\r?\n\t\t\}\r?\n/g;
for (const name of original.keys()) {
  const body = rawBlock(read(override), name);
  addition.lastIndex = 0;
  assert.equal([...body.matchAll(addition)].length, 1, name + " has exactly one addition");
  addition.lastIndex = 0;
  assert.equal(body.replace(addition, ""), rawBlock(originalSource.get(name), name), name + " preserves original bytes");
}
const val = new Map(parse(valuesFile).map(n => [n.key, n.value]));
const common = parse(modifiersFile).find(n => n.key === "common_discontent_progress_modifier").value;
const strip = v => JSON.parse(JSON.stringify(v));
function condition(node, ctx) {
  if (node.key === "faction_power") return node.operator === ">" ? ctx.power > ctx.threshold : ctx.power < ctx.threshold;
  if (node.key === "faction_target" || node.key === "top_participant_group:dynastic_cycle") return node.value.every(x => condition(x, ctx));
  if (node.key === "can_vassals_be_attacked") return ctx.border;
  if (node.key === "ep3_restored_rome_hard_mode_trigger") return ctx.rome;
  if (node.key === "has_participant_group_parameter") return ctx.dynastic;
  throw new Error("unsupported modifier condition " + node.key);
}
function number(raw, ctx) {
  if (Array.isArray(raw)) return calc(raw, ctx);
  if (raw === "base_discontent_progress") return 3;
  if (raw === "faction_discontent_for_extra_power") return ctx.extra;
  if (raw === "@base_peasant_discontent_progress") return 2;
  if (val.has(raw)) return calc(val.get(raw), ctx);
  assert.ok(Number.isFinite(Number(raw)), "unsupported value " + raw);
  return Number(raw);
}
function calc(nodes, ctx) {
  let result = 0;
  for (const node of nodes) {
    if (node.key === "value" || node.key === "base") result = number(node.value, ctx);
    else if (node.key === "add") result += number(node.value, ctx);
    else if (node.key === "subtract") result -= number(node.value, ctx);
    else if (node.key === "multiply") result *= number(node.value, ctx);
    else if (node.key === "min") result = Math.max(result, number(node.value, ctx));
    else if (node.key === "max") result = Math.min(result, number(node.value, ctx));
    else if (node.key === "if") {
      const limit = node.value.find(x => x.key === "limit");
      if (limit.value.every(x => condition(x, ctx))) {
        for (const effect of node.value.filter(x => x.key !== "limit")) {
          if (effect.key === "add") result += number(effect.value, ctx);
          else if (effect.key === "subtract") result -= number(effect.value, ctx);
          else throw new Error("unsupported conditional " + effect.key);
        }
      }
    } else if (node.key === "common_discontent_progress_modifier") result += mtth(common, ctx);
    else if (node.key === "modifier") {
      const conditions = node.value.filter(x => !["add", "desc"].includes(x.key));
      if (conditions.every(x => condition(x, ctx))) result += number(node.value.find(x => x.key === "add").value, ctx);
    } else throw new Error("unsupported arithmetic " + node.key);
  }
  return result;
}
function mtth(nodes, ctx) { return calc(nodes, ctx); }
const scenarios = [];
for (const power of [79, 80, 100]) for (const border of [false, true]) for (const dynastic of [false, true]) for (const rome of [false, true]) scenarios.push({ power, threshold: 80, extra: 3, border, dynastic, rome });
for (const [name, native] of original) {
  const patch = changed.get(name);
  const a = native.value.find(n => n.key === "discontent_progress");
  const b = patch.value.find(n => n.key === "discontent_progress");
  assert.deepEqual(strip(patch.value.filter(n => n !== b)), strip(native.value.filter(n => n !== a)), name + " preserves all other faction content");
  assert.deepEqual(strip(b.value.slice(0, -1)), strip(a.value), name + " preserves native progress calculation");
  const last = b.value.at(-1);
  assert.equal(last.key, "modifier");
  const target = last.value.find(n => n.key === "faction_target");
  assert.ok(target && descendant(target.value, "rite_has_tenet").some(n => n.value === "mm_tenet_earth_third"));
  assert.ok(descendant(target.value, "rite").some(n => n.value === "rite:mm_dragon_earth"));
  const reduction = last.value.find(n => n.key === "add").value;
  for (const ctx of scenarios) {
    const before = mtth(a.value, ctx);
    function targetMatches(nodes, targetState) {
      return nodes.every(node => {
        if (node.key === "faith") return targetState.faith === node.value;
        if (node.key === "rite" && !Array.isArray(node.value)) return targetState.rite === node.value;
        if (node.key === "rite") return targetMatches(node.value, targetState);
        if (node.key === "rite_has_tenet") return targetState.tenets.includes(node.value);
        throw new Error("unsupported target condition " + node.key);
      });
    }
    const earth = { faith: "faith:mm_dragon_creed", rite: "rite:mm_dragon_earth", tenets: ["mm_tenet_earth_third"] };
    const after = before + (targetMatches(target.value, earth) ? number(reduction, ctx) : 0);
    assert.ok(Math.abs(after - (before > 0 ? before * 0.6 : before)) < 1e-9, `${name}: ${JSON.stringify(ctx)} raw=${before}, actual=${after}`);
    for (const other of [{ ...earth, faith: "faith:other" }, { ...earth, rite: "rite:mm_dragon_fire" }, { ...earth, tenets: [] }]) {
      assert.equal(before + (targetMatches(target.value, other) ? number(reduction, ctx) : 0), before, "unqualified target keeps native progress");
    }
  }
}
function descendant(nodes, key) { return nodes.flatMap(n => [...(n.key === key ? [n] : []), ...(Array.isArray(n.value) ? descendant(n.value, key) : [])]); }
console.log("v1.3.12 native and Hanfan faction progress finite checks passed");

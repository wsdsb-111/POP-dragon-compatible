"use strict";
// Finite evaluation of the copied native value and added vassal condition, not a CK3 engine test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v1311-finite-helper");
const h = createHarness([]);
const game = process.env.CK3_GAME_DIR || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
const nativeFile = path.join(game, "common/script_values/02_religion_values.txt");
const patchFile = path.join(__dirname, "../patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_religion_values.txt");
const name = "demand_conversion_tenet_impact";
const native = h.parsePdx(fs.readFileSync(nativeFile, "utf8"), nativeFile).find(n => n.key === name).value;
const patch = h.parsePdx(fs.readFileSync(patchFile, "utf8"), patchFile).find(n => n.key === name).value;
assert.deepEqual(JSON.parse(JSON.stringify(patch.slice(0, native.length))), JSON.parse(JSON.stringify(native)), "all native calculations remain intact");
assert.equal(patch.length, native.length + 1);
function condition(node, c) {
  if (node.key === "NOT") return !node.value.every(child => condition(child, c));
  if (node.key === "exists") return node.value === "scope:actor" && !!c.actor;
  if (node.key === "is_vassal_or_below_of") return !!c.actor && c.lieges.includes(c.actor);
  if (node.key === "rite") {
    if (Array.isArray(node.value)) return node.value.every(child => condition(child, c));
    return c.rite === node.value;
  }
  if (node.key === "rite_has_parameter") return c.parameters.includes(node.value);
  if (node.key === "rite_has_tenet") return c.tenets.includes(node.value);
  throw new Error("unsupported condition " + node.key);
}
function evaluate(nodes, c) {
  let value = 0;
  for (const node of nodes) {
    if (node.key === "value") value = Number(node.value);
    else if (node.key === "if") {
      const limit = node.value.find(child => child.key === "limit");
      if (limit.value.every(child => condition(child, c))) {
        for (const child of node.value.filter(child => child.key !== "limit")) {
          assert.equal(child.key, "add"); value += Number(child.value);
        }
      }
    } else throw new Error("unsupported value node " + node.key);
  }
  return value;
}
const actor = {};
const earth = { actor, lieges: [actor], rite: "rite:mm_dragon_earth", tenets: ["mm_tenet_earth_third"], parameters: [] };
assert.equal(evaluate(patch, earth), -20);
assert.equal(evaluate(patch, { ...earth, actor: null }), 0);
assert.equal(evaluate(patch, { ...earth, lieges: [] }), 0);
assert.equal(evaluate(patch, { ...earth, rite: "rite:mm_dragon_white" }), 0);
assert.equal(evaluate(patch, { ...earth, tenets: [] }), 0);
assert.equal(evaluate(patch, { ...earth, parameters: ["tenet_adaptive_conversion_resistance"] }), -40);
assert.equal(evaluate(native, { ...earth, parameters: ["tenet_adaptive_conversion_resistance"] }), -20);
console.log("v1.3.12 targeted vassal demand conversion finite checks passed");
const cbNativeFile = path.join(game, "common/casus_belli_types/00_religious_war.txt");
const cbPatchFile = path.join(__dirname, "../patches/dragon-creed/mod/common/casus_belli_types/zzzzzz_mm_v1312_religious_wars.txt");
const cbNativeText = fs.readFileSync(cbNativeFile, "utf8").replace(/^\uFEFF/, "");
const cbPatchText = fs.readFileSync(cbPatchFile, "utf8").replace(/^\uFEFF/, "");
const cbNames = ["minor_religious_war", "religious_war", "major_religious_war"];
function textBlock(text, name) {
  const match = new RegExp(`^${name}\\s*=\\s*\\{`, "m").exec(text);
  assert.ok(match, `missing ${name}`);
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
  throw new Error("unclosed " + name);
}
const insertion = /\t\t\t# v1\.3\.12: final piety exemption[^\r\n]*\r?\n\t\t\tif = \{\r?\n\t\t\t\tlimit = \{\r?\n\t\t\t\t\tscope:attacker = \{[^\r\n]*\r?\n\t\t\t\t\tscope:defender = \{[^\r\n]*\r?\n\t\t\t\t\}\r?\n\t\t\t\tvalue = 0\r?\n\t\t\t\}\r?\n/g;
function descendant(nodes, key) { return nodes.flatMap(node => [...(node.key === key ? [node] : []), ...(Array.isArray(node.value) ? descendant(node.value, key) : [])]); }
function costBody(text, cb) {
  const top = h.parsePdx(text, cb).find(n => n.key === cb).value;
  const cost = top.find(n => n.key === "cost");
  return cost.value.find(n => n.key === "piety").value;
}
function literalValue(node) {
  const value = Array.isArray(node.value) ? node.value.find(n => n.key === "value").value : node.value;
  if (value === "accolade_piety_reduction_value") return 0.5;
  if (value === "accolade_piety_reduction_value_high") return 0.5;
  if (["common_cb_piety_cost_multiplier", "holy_war_cb_piety_cost_multiplier"].includes(value)) return 1;
  assert.ok(Number.isFinite(Number(value)), "unsupported executed value " + value);
  return Number(value);
}
function branchMatches(node, ctx) {
  const limit = node.value.find(n => n.key === "limit");
  const params = descendant(limit.value, "accolade_parameter");
  if (params.length) return ctx.accolade && params[0].value === "acclaimed_knight_piety_from_battle";
  if (descendant(limit.value, "rite_has_doctrine").some(n => n.value === "mm_doctrine_black")) {
    const atk = limit.value.find(n => n.key === "scope:attacker");
    const def = limit.value.find(n => n.key === "scope:defender");
    assert.ok(atk && def);
    const acceptable = descendant(def.value, "rite").filter(n => !Array.isArray(n.value)).map(n => n.value);
    return ctx.attackerFaith === "faith:mm_dragon_creed" && ctx.attackerRite === "rite:mm_dragon_black" && ctx.doctrine && ctx.defenderFaith === "faith:mm_dragon_creed" && acceptable.includes(ctx.defenderRite);
  }
  return false; // Other native discounts do not apply in these controlled fixtures.
}
function piety(nodes, ctx, initial = 0) {
  let result = initial;
  for (const node of nodes) {
    if (node.key === "if") { if (branchMatches(node, ctx)) result = piety(node.value.filter(n => n.key !== "limit"), ctx, result); }
    else if (node.key === "add") result += literalValue(node);
    else if (node.key === "multiply") result *= literalValue(node);
    else if (node.key === "divide") result /= literalValue(node);
    else if (node.key === "value") result = literalValue(node);
    else if (node.key === "min") result = Math.max(result, literalValue(node));
    else throw new Error("unsupported cost operation " + node.key);
  }
  return result;
}
const eligible = { accolade: true, attackerFaith: "faith:mm_dragon_creed", attackerRite: "rite:mm_dragon_black", doctrine: true, defenderFaith: "faith:mm_dragon_creed", defenderRite: "rite:mm_dragon_white" };
for (const name of cbNames) {
  const original = textBlock(cbNativeText, name), changed = textBlock(cbPatchText, name);
  insertion.lastIndex = 0;
  const matches = [...changed.matchAll(insertion)];
  assert.equal(matches.length, 1, name + " has one final exemption");
  insertion.lastIndex = 0;
  assert.equal((changed.match(/mm_v1312_is_valid_religious_war_target_trigger/g) || []).length, 1, name + " has one reviewed target extension");
  assert.equal(changed.replace(insertion, "").replace('mm_v1312_is_valid_religious_war_target_trigger', 'is_valid_religious_war_target_trigger'), original, name + " retains exact original body outside the reviewed target and cost changes");
  const oldCost = costBody(original, name), newCost = costBody(changed, name);
  assert.ok(descendant(oldCost, "min").length > 0, name + " has original minimum cost");
  assert.equal(newCost.at(-1).key, "if", "exemption is the final cost operation");
  assert.ok(piety(oldCost, eligible) > 0);
  assert.equal(piety(newCost, eligible), 0, "exemption follows native minimum");
  for (const variation of [{ attackerRite: "rite:mm_dragon_white" }, { doctrine: false }, { defenderRite: "rite:mm_dragon_black" }, { defenderFaith: "faith:other" }]) {
    const scenario = { ...eligible, ...variation };
    assert.equal(piety(newCost, scenario), piety(oldCost, scenario), "outside target: original cost stays intact");
  }
}
console.log("v1.3.12 original religious CB body and final cost finite checks passed");
const conversionNativeFile = path.join(game, "common/script_values/99_court_chaplain_values.txt");
const conversionPatchFile = path.join(__dirname, "../patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_conversion_factors.txt");
const factorName = "court_chaplain_conversion_factors";
const nativeFactor = h.parsePdx(fs.readFileSync(conversionNativeFile, "utf8"), conversionNativeFile).find(n => n.key === factorName).value;
const newFactor = h.parsePdx(fs.readFileSync(conversionPatchFile, "utf8"), conversionPatchFile).find(n => n.key === factorName).value;
assert.deepEqual(JSON.parse(JSON.stringify(newFactor.slice(0, nativeFactor.length))), JSON.parse(JSON.stringify(nativeFactor)), "conversion value retains every native operation");
assert.equal(newFactor.length, nativeFactor.length + 1);
const bonus = newFactor.at(-1);
assert.equal(bonus.key, "if");
const bonusMultiply = bonus.value.find(n => n.key === "multiply");
assert.equal(Number(bonusMultiply.value.find(n => n.key === "value").value), 1.5);
function resolveScope(raw, ctx) {
  if (!raw.startsWith("scope:")) return raw;
  return raw.slice(6).split(".").reduce((obj, key) => obj?.[key], ctx);
}
function testBonus(node, ctx, current = null) {
  if (node.key === "AND") return node.value.every(child => testBonus(child, ctx, current));
  if (node.key === "OR") return node.value.some(child => testBonus(child, ctx, current));
  if (node.key === "exists") return resolveScope(node.value, ctx) != null;
  if (node.key === "scope:councillor_liege" || node.key === "scope:county.holder") {
    const scoped = resolveScope(node.key, ctx);
    return !!scoped && node.value.every(child => testBonus(child, ctx, scoped));
  }
  if (node.key === "faith" || (node.key === "rite" && !Array.isArray(node.value))) return current?.[node.key] === node.value;
  if (node.key === "rite") return node.value.every(child => testBonus(child, ctx, current));
  if (node.key === "rite_has_doctrine") return current?.doctrines.includes(node.value);
  if (node.key === "mm_creed_controls_baghdad_holy_site_trigger") return current?.holySites.includes("baghdad");
  if (node.key === "mm_creed_controls_sagami_holy_site_trigger") return current?.holySites.includes("sagami");
  if (node.key === "this") return current === resolveScope(node.value, ctx);
  if (node.key === "is_vassal_or_below_of") return current?.lieges.includes(resolveScope(node.value, ctx));
  if (node.key === "scope:county.faith" || node.key === "scope:county.rite") {
    const left = resolveScope(node.key, ctx), right = resolveScope(node.value, ctx);
    return node.operator === "!=" ? left !== right : left === right;
  }
  throw new Error("unsupported conversion condition " + node.key);
}
const factorLimit = bonus.value.find(n => n.key === "limit").value;
const makesBonus = ctx => factorLimit.every(node => testBonus(node, ctx));
const conversionRuler = { faith: "faith:mm_dragon_creed", rite: "rite:mm_dragon_black", doctrines: ["mm_doctrine_black"], holySites: ["baghdad"], lieges: [] };
const conversionVassal = { lieges: [conversionRuler] };
const conversion = { councillor_liege: conversionRuler, county: { holder: conversionVassal, faith: "faith:other", rite: "rite:other" } };
assert.equal(makesBonus(conversion), true);
assert.equal(makesBonus({ ...conversion, county: { ...conversion.county, holder: conversionRuler } }), true);
assert.equal(makesBonus({ ...conversion, county: { ...conversion.county, holder: { lieges: [] } } }), false);
assert.equal(makesBonus({ ...conversion, county: { ...conversion.county, faith: conversionRuler.faith, rite: conversionRuler.rite } }), false);
assert.equal(makesBonus({ ...conversion, county: { ...conversion.county, faith: conversionRuler.faith, rite: "rite:mm_dragon_fire" } }), true);
assert.equal(makesBonus({ ...conversion, councillor_liege: { ...conversionRuler, holySites: [] } }), false);
const whiteRuler = { ...conversionRuler, rite: "rite:mm_dragon_white", doctrines: ["mm_doctrine_white"], holySites: ["sagami"] };
assert.equal(makesBonus({ councillor_liege: whiteRuler, county: { ...conversion.county, holder: whiteRuler } }), true);
assert.equal(makesBonus({ councillor_liege: { ...whiteRuler, holySites: ["baghdad"] }, county: { ...conversion.county, holder: whiteRuler } }), false);
assert.equal(makesBonus({ councillor_liege: conversionRuler, county: { ...conversion.county, holder: null } }), false);
console.log("v1.3.12 conversion factor finite checks passed");

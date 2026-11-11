"use strict";

// Independent adversarial fixtures. PDX bodies run through finite primitives,
// not the CK3 engine.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const game = process.env.CK3_GAME_DIR || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
const mod = path.join(root, "patches/dragon-creed/mod");
const helperPath = path.join(__dirname, "wyvern-v1311-finite-helper.js");

function readMod(relative) {
  return fs.readFileSync(path.join(mod, relative), "utf8").replace(/\r\n/g, "\n");
}
function readNative(relative) {
  return fs.readFileSync(path.join(game, relative), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
function only(nodes, key) {
  const found = nodes.filter(node => node.key === key);
  assert.equal(found.length, 1, "expected one " + key);
  return found[0];
}
function descendants(nodes, key) {
  return nodes.flatMap(node => [
    ...(node.key === key ? [node] : []),
    ...(Array.isArray(node.value) ? descendants(node.value, key) : [])
  ]);
}

// Add only missing native primitives to the existing finite adapter in memory.
let adapter = fs.readFileSync(helperPath, "utf8");
function insertBefore(needle, code) {
  assert.ok(adapter.includes(needle), "finite adapter anchor exists");
  adapter = adapter.replace(needle, code + "\n" + needle);
}
insertBefore('      if (key === "can_add_hook")', [
  '      if (key === "has_activity_type") return current.activityType === operand;',
  '      if (key === "ep1_character_had_or_has_inspiration_type_trigger") return current.inspirationType === scalar(operand, "TYPE", key);'
].join("\n"));
insertBefore('      if (key === "add_hook")', [
  '      if (key === "change_spiritual_fulfillment") { current.fulfillment = (current.fulfillment || 0) + Number(operand); return; }',
  '      if (key === "add_legitimacy") { current.legitimacy = (current.legitimacy || 0) + Number(operand); return; }',
  '      if (key === "save_scope_value_as") {',
  '        const value = first(operand, "value").value;',
  '        env.scopes[scalar(operand, "name", key)] = Array.isArray(value) ? computedValue(value, current, env, parameters) : atom(value, current, env, parameters);',
  '        return;',
  '      }'
].join("\n"));
const setVariableNeedle = '      if (key === "set_variable" && Array.isArray(first(operand, "value")?.value)) {';
assert.ok(adapter.includes(setVariableNeedle));
adapter = adapter.replace(setVariableNeedle,
  '      if (key === "set_variable" && !Array.isArray(operand)) { current.vars.set(operand, true); return; }\n' + setVariableNeedle);
const compiled = new Module(helperPath, module);
compiled.filename = helperPath;
compiled.paths = module.paths;
compiled._compile(adapter, helperPath);
const harness = compiled.exports.createHarness(["dragon-creed"]);

// Actual patched quality PDX, with failed-roll invariance and high-wealth edges.
{
  assert.ok(readMod("common/scripted_effects/zzzz_mm_v1312_quality.txt").includes("scope:quality add = scope:wealth"));
  assert.match(readNative("common/artifacts/features/00_features.txt"), /VALUE = scope:wealth MIN = 40 MAX = 999/);

  function trial(quality, wealth, succeeds) {
    const sponsor = harness.character("sponsor");
    sponsor.rite = { id: "mm_dragon_fire" };
    const smith = harness.character("smith");
    smith.inspirationType = "weapon";
    const env = harness.environment({
      scopes: {
        quality, wealth, owner: sponsor, inspiration_owner: smith, inspiration_sponsor: sponsor,
        weapon_type: "flag:sword", smith
      },
      randomChoices: [succeeds]
    });
    harness.run("mm_v1312_fire_equipment_quality_effect", sponsor, env);
    return { quality: env.scopes.quality, wealth: env.scopes.wealth, rolls: env.randomRolls.length };
  }
  const failed = trial(20, 20, false);
  assert.equal(failed.rolls, 1);
  assert.deepEqual([failed.quality, failed.wealth], [20, 20]);

  for (const [quality, wealth] of [[0, 150], [20, 120], [100, 999]]) {
    const result = trial(quality, wealth, true);
    assert.equal(result.rolls, 0, "real native sum >= 130 must not roll");
    assert.deepEqual([result.quality, result.wealth], [quality, wealth]);
  }
  for (const [quality, wealth] of [[10, 110], [0, 120]]) {
    const result = trial(quality, wealth, true);
    assert.equal(result.rolls, 1);
    assert.equal(result.quality + result.wealth, 130, "successful promotion reaches threshold by minimum increment");
    assert.equal(result.wealth, wealth);
  }
}

// Evaluate the actual mod values against the installed native faction formula.
{
  const nativeDefs = new Map(harness.parsePdx(readNative("common/script_values/00_faction_values.txt"), "native faction values").map(n => [n.key, n.value]));
  const modDefs = new Map(harness.parsePdx(readMod("common/script_values/zzzzzz_mm_dragon_v1312_faction_values.txt"), "mod faction values").map(n => [n.key, n.value]));
  const base = Number(nativeDefs.get("base_discontent_progress"));
  assert.equal(base, 3);

  function compare(left, operator, right) {
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    if (operator === "<=") return left <= right;
    if (operator === "=" || operator === "?=") return left === right;
    throw new Error("unsupported faction comparison " + operator);
  }
  function condition(nodes, ctx) {
    return nodes.every(node => {
      if (node.key === "faction_power") return compare(ctx.power, node.operator, ctx.threshold);
      if (node.key === "faction_target") {
        const group = node.value.find(child => child.key === "top_participant_group:dynastic_cycle");
        return !!group && descendants(group.value, "has_participant_group_parameter")
          .some(p => p.value === "dynastic_cycle_more_peasant_factions") && ctx.dynasticPeasant;
      }
      throw new Error("unsupported faction condition " + node.key);
    });
  }
  function value(name, ctx) {
    function evaluate(nodes, initial, stack) {
      let result = initial;
      const number = raw => {
        if (Array.isArray(raw)) return evaluate(raw, 0, stack);
        const literal = Number(raw);
        if (Number.isFinite(literal)) return literal;
        if (raw === "faction_power") return ctx.power;
        if (raw === "faction_power_threshold") return ctx.threshold;
        if (raw === "base_discontent_progress") return base;
        if (stack.includes(raw)) throw new Error("cyclic faction value " + raw);
        const expression = modDefs.has(raw) ? modDefs.get(raw) : nativeDefs.get(raw);
        if (expression === undefined) throw new Error("missing faction value " + raw);
        return Array.isArray(expression) ? evaluate(expression, 0, [...stack, raw]) : Number(expression);
      };
      for (const node of nodes) {
        if (node.key === "value") result = number(node.value);
        else if (node.key === "add") result += number(node.value);
        else if (node.key === "subtract") result -= number(node.value);
        else if (node.key === "multiply") result *= number(node.value);
        else if (node.key === "divide") result /= number(node.value);
        else if (node.key === "round") result = Math.round(result);
        else if (node.key === "min") result = Math.max(result, number(node.value));
        else if (node.key === "max") result = Math.min(result, number(node.value));
        else if (node.key === "if") {
          const limit = only(node.value, "limit");
          if (condition(limit.value, ctx)) result = evaluate(node.value.filter(n => n.key !== "limit"), result, stack);
        } else throw new Error("unsupported faction value operation " + node.key);
      }
      return result;
    }
    const expression = modDefs.get(name);
    assert.ok(Array.isArray(expression), "mod value exists: " + name);
    return evaluate(expression, 0, [name]);
  }

  const positive = { power: 100, threshold: 80, dynasticPeasant: true };
  assert.equal(value("mm_creed_faction_raw_common", positive), 6, "native base 3 plus native extra-power 3");
  const rawHanfan = value("mm_creed_faction_raw_hanfan", positive);
  const reduction = value("mm_creed_faction_reduction_hanfan", positive);
  assert.equal(rawHanfan, 8, "native dynastic-cycle +2 belongs to reduction basis");
  assert.equal(Math.round((rawHanfan + reduction) * 10) / 10, 4.8, "only 40% of final positive progress is removed");

  const negative = { power: 79, threshold: 80, dynasticPeasant: true };
  assert.equal(value("mm_creed_faction_raw_hanfan", negative), -1, "native -3 progress plus Hanfan +2");
  assert.ok(value("mm_creed_faction_reduction_hanfan", negative) === 0, 'PDX zero has no JavaScript signed-zero distinction');
  assert.equal(value("mm_creed_faction_raw_hanfan", negative) + value("mm_creed_faction_reduction_hanfan", negative), -1);
}

// Evaluate the actual final piety branch for a nonqualifying war and a control.
{
  const nativeDefs = new Map(harness.parsePdx(readNative("common/casus_belli_types/00_religious_war.txt"), "native CBs").map(n => [n.key, n.value]));
  const patchDefs = new Map(harness.parsePdx(readMod("common/casus_belli_types/zzzzzz_mm_v1312_religious_wars.txt"), "patched CBs").map(n => [n.key, n.value]));
  const nativePiety = only(only(nativeDefs.get("minor_religious_war"), "cost").value, "piety").value;
  const patchPiety = only(only(patchDefs.get("minor_religious_war"), "cost").value, "piety").value;
  const exemption = patchPiety.find(n => n.key === "if" && descendants(n.value, "rite_has_doctrine").length > 0);
  assert.ok(exemption);

  function matches(nodes, character) {
    return nodes.every(node => {
      if (node.key === "faith") return character.faith === node.value;
      if (node.key === "rite") return Array.isArray(node.value) ? matches(node.value, character) : character.rite === node.value;
      if (node.key === "rite_has_doctrine") return character.doctrines.has(node.value);
      if (node.key === "OR") return node.value.some(child => matches([child], character));
      throw new Error("unsupported CB predicate " + node.key);
    });
  }
  function exemptionMatches(ctx) {
    const limit = only(exemption.value, "limit").value;
    return limit.every(node => {
      if (node.key === "scope:attacker") return matches(node.value, ctx.attacker);
      if (node.key === "scope:defender") return matches(node.value, ctx.defender);
      throw new Error("unsupported exemption scope " + node.key);
    });
  }
  function cost(nodes, ctx) {
    let result = 0;
    const number = raw => {
      if (Array.isArray(raw)) return Number(only(raw, "value").value);
      if (raw === "common_cb_piety_cost_multiplier" || raw === "holy_war_cb_piety_cost_multiplier") return 1;
      const literal = Number(raw);
      if (Number.isFinite(literal)) return literal;
      throw new Error("unsupported controlled CB value " + raw);
    };
    for (const node of nodes) {
      if (node.key === "add") result += number(node.value);
      else if (node.key === "multiply") result *= number(node.value);
      else if (node.key === "divide") result /= number(node.value);
      else if (node.key === "min") result = Math.max(result, number(node.value));
      else if (node.key === "if") {
        // Fixture disables native church, accolade and incited discounts.
        if (node === exemption && exemptionMatches(ctx)) {
          for (const effect of node.value.filter(n => n.key !== "limit")) {
            if (effect.key === "value") result = number(effect.value);
            else throw new Error("unsupported exemption effect " + effect.key);
          }
        }
      } else throw new Error("unsupported controlled CB operation " + node.key);
    }
    return result;
  }
  const whiteAgainstOther = {
    attacker: { faith: "faith:mm_dragon_creed", rite: "rite:mm_dragon_white", doctrines: new Set(["mm_doctrine_white"]) },
    defender: { faith: "faith:other", rite: "rite:other", doctrines: new Set() }
  };
  const blackAgainstOther = {
    attacker: { faith: "faith:mm_dragon_creed", rite: "rite:mm_dragon_black", doctrines: new Set(["mm_doctrine_black"]) },
    defender: { faith: "faith:other", rite: "rite:other", doctrines: new Set() }
  };
  const blackAgainstDragonWhite = {
    attacker: { faith: "faith:mm_dragon_creed", rite: "rite:mm_dragon_black", doctrines: new Set(["mm_doctrine_black"]) },
    defender: { faith: "faith:mm_dragon_creed", rite: "rite:mm_dragon_white", doctrines: new Set() }
  };
  assert.equal(cost(nativePiety, whiteAgainstOther), 100, "native positive base with standard multipliers");
  assert.equal(cost(patchPiety, whiteAgainstOther), 100, "nonqualifying holy war keeps native positive cost");
  assert.equal(cost(patchPiety, blackAgainstOther), 100, "attacker qualification alone is insufficient");
  assert.equal(cost(patchPiety, blackAgainstDragonWhite), 0);
}

// Repeated participant-level funeral completion callbacks share activity state.
{
  const host = harness.character("funeral-host", { age: 54, piety: 0, prestige: 0 });
  host.rite = { id: "mm_dragon_earth" };
  host.legitimacy = 0;
  const activity = harness.character("funeral-activity");
  activity.activityType = "activity_funeral";
  const env = harness.environment({ scopes: { host, activity } });
  harness.run("mm_v1312_earth_funeral_reward_effect", host, env);
  const first = {
    piety: host.piety, prestige: host.prestige, legitimacy: host.legitimacy,
    fulfillment: host.fulfillment, modifiers: [...host.modifiers].sort()
  };
  assert.ok(first.piety > 0 || first.prestige > 0 || first.legitimacy > 0, "first callback pays actual reward");
  harness.run("mm_v1312_earth_funeral_reward_effect", host, env);
  assert.deepEqual({
    piety: host.piety, prestige: host.prestige, legitimacy: host.legitimacy,
    fulfillment: host.fulfillment, modifiers: [...host.modifiers].sort()
  }, first, "same activity pays only once");
  assert.equal(activity.vars.get("mm_v1312_earth_funeral_rewarded"), true);
}

console.log("v1.3.12 independent adversarial finite checks passed (not a CK3 engine result)");

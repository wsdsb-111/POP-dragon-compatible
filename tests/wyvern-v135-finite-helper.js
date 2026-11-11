"use strict";

// Reuse the established finite PDX syntax/primitive harness, never its fixtures
// or expected outcomes. This is deliberately not a CK3 engine emulator.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness(modules) {
  const baseline = fs.readFileSync(path.join(__dirname, "test-wyvern-v120-bloodline.js"), "utf8");
  const boundary = baseline.indexOf("const interactionFile =");
  assert.ok(boundary > 0, "the reusable v120 finite harness boundary is explicit");
  const context = { require, __dirname, console, process: { env: process.env } };
  vm.createContext(context);
  vm.runInContext(baseline.slice(0, boundary) + `
    const primitiveEffect = executeEffectNode;
    const primitiveTrigger = evaluateTriggerNode;
    const primitiveAtom = atom;
    const primitivePath = resolvePath;
    const scriptValues = new Map();
    scriptedEffects.clear();
    scriptedTriggers.clear();
    for (const [name, definition] of nativeTriggerDefinitions) scriptedTriggers.set(name, definition);
    function scoped(target, current, env, callback) {
      env.previous ||= [];
      env.previous.push(current);
      try { return callback(target); } finally { env.previous.pop(); }
    }
    function computedValue(name, current, env, parameters) {
      const definition = Array.isArray(name) ? name : scriptValues.get(name);
      if (!Array.isArray(definition)) return atom(definition, current, env, parameters);
      let result = 0;
      const number = value => Number(Array.isArray(value) ? computedValue(value, current, env, parameters) : atom(value, current, env, parameters));
      function apply(nodes) {
        let matched = false;
        for (const node of nodes) {
          if (node.key === "value") result = number(node.value);
          else if (node.key === "add") result += number(node.value);
          else if (node.key === "subtract") result -= number(node.value);
          else if (node.key === "multiply") result *= number(node.value);
          else if (node.key === "divide") result /= number(node.value);
          else if (node.key === "min") result = Math.max(result, number(node.value));
          else if (node.key === "max") result = Math.min(result, number(node.value));
          else if (node.key === "round") result = Math.round(result);
          else if (["if", "else_if", "else"].includes(node.key)) {
            if (node.key === "if") matched = false;
            const limit = first(node.value, "limit");
            if (!matched && (!limit || evaluateTriggerBlock(limit.value, current, env, parameters))) {
              apply(node.value.filter(n => n.key !== "limit")); matched = true;
            }
          } else throw new Error("unsupported finite script value node " + node.key);
        }
      }
      apply(definition);
      return result;
    }
    resolvePath = function(raw, current, env, parameters = {}) {
      if (typeof raw !== "string") return raw;
      if (raw === "root") return env.root;
      if (raw === "artifact_owner") return current?.owner;
      if (raw === "location" || raw.startsWith("location.")) return raw.split(".").reduce((v, key) => v?.[key], current);
      if (raw === "prev") return (env.previous || []).at(-1);
      if (raw.startsWith("global_var:")) return env.globalVars.get(raw.slice(11));
      if (["mother", "father", "real_father", "holder"].includes(raw)) return property(current, raw);
      if (raw.startsWith("character:")) return env.characters?.get(raw.slice(10));
      const dotted = /^(.*)\\.([^.]+)$/.exec(raw);
      if (dotted && scriptValues.has(dotted[2])) return computedValue(dotted[2], resolvePath(dotted[1], current, env, parameters), env, parameters);
      return primitivePath(raw, current, env, parameters);
    };
    atom = function(raw, current, env, parameters = {}) {
      if (raw === "current_year") return env.year;
      if (raw === "current_month") return env.month;
      if (raw === "age") return current.age;
      if (typeof raw === "string" && raw.startsWith("global_var:")) return resolvePath(raw, current, env, parameters);
      if (raw === "root" || raw === "prev" || (typeof raw === "string" && raw.startsWith("character:"))) return resolvePath(raw, current, env, parameters);
      if (scriptValues.has(raw)) return computedValue(raw, current, env, parameters);
      return primitiveAtom(raw, current, env, parameters);
    };
    function scopedKey(key) { return ["root", "prev", "holder", "mother", "father", "real_father", "location", "location.county"].includes(key) || /^(?:scope:|var:|global_var:|character:|\\$)/.test(key); }
    evaluateTriggerNode = function(node, current, env, parameters = {}) {
      const { key, value: operand, operator } = node;
      if (key === "always") return operand === "yes";
      if (key === "is_immortal") return Boolean(current.immortal) === (operand === "yes");
      if (key === "has_trait_with_flag") return Boolean(current.traitFlags?.has(operand));
      if (key === "has_council_position") return Boolean(current.councilPositions?.has(operand));
      if (key === "any_parent" || key === "any_child") {
        const candidates = key === "any_parent" ? [...new Set([current.mother, current.father].filter(Boolean))] : (current.children || []);
        const count = first(operand, "count");
        const matches = candidates.filter(target => scoped(target, current, env, value => evaluateTriggerBlock(operand.filter(n => !["count", "even_if_dead"].includes(n.key)), value, env, parameters)));
        return count ? compare(matches.length, count.operator, atom(count.value, current, env, parameters)) : matches.length > 0;
      }
      if (key === "custom_tooltip") return evaluateTriggerBlock(operand.filter(n => n.key !== "text"), current, env, parameters);
      if (key === "has_relation_myv_bonded_wyvern") return (current.relations?.get("myv_bonded_wyvern") || new Set()).has(atom(operand, current, env, parameters));
      if (key === "any_relation") return [...(current.relations?.get(scalar(operand, "type", key)) || [])].some(target => scoped(target, current, env, value => evaluateTriggerBlock(operand.filter(n => n.key !== "type"), value, env, parameters)));
      if (key === "current_year" || key === "current_month") return compare(key === "current_year" ? env.year : env.month, operator, atom(operand, current, env, parameters));
      if (key === "has_game_rule") return env.gameRules.has(operand);
      if (key === "this") return compare(current, operator, atom(operand, current, env, parameters));
      if (key === "any_neighboring_county") return (current.neighbors || []).some(target => scoped(target, current, env, value => evaluateTriggerBlock(operand, value, env, parameters)));
      if (key === "has_relation_mm_dragon_twin") return (current.relations?.get("mm_dragon_twin") || new Set()).has(atom(operand, current, env, parameters));
      if (key === "portrait_has_trait_trigger") return current.traits.has(atom(scalar(operand, "TRAIT", key), current, env, parameters));
      if (key === "is_spouse_of" || ["has_relation_lover", "has_relation_soulmate", "has_relation_friend"].includes(key)) {
        const relation = key === "is_spouse_of" ? "spouse" : key.slice("has_relation_".length);
        return (current.relations.get(relation) || new Set()).has(atom(operand, current, env, parameters));
      }
      if (scriptValues.has(key)) return compare(computedValue(key, current, env, parameters), operator, atom(operand, current, env, parameters));
      if (scopedKey(key)) {
        const target = resolvePath(key, current, env, parameters);
        if (!Array.isArray(operand)) return compare(target, operator, atom(operand, current, env, parameters));
        return target !== undefined && scoped(target, current, env, value => evaluateTriggerBlock(operand, value, env, parameters));
      }
      if (key === "has_variable_list") return current.variableLists.has(operand) && current.variableLists.get(operand).length > 0;
      if (key === "is_adult") return (current.age >= 18) === (operand === "yes");
      if (key === "has_character_modifier") return current.modifiers.has(operand);
      if (key === "has_trait_xp") {
        const amount = first(operand, "value");
        return compare(current.xp.get(scalar(operand, "track", "track XP")) || 0, amount.operator, atom(amount.value, current, env, parameters));
      }
      if (key === "death_reason") return compare(current.deathReason, operator, operand);
      if (["gold", "piety", "prestige"].includes(key)) return compare(current[key], operator, atom(operand, current, env, parameters));
      if (key === "has_global_variable") return env.globalVars.has(operand);
      if (key === "has_global_variable_list") return (env.globalLists.get(operand) || []).length > 0;
      if (key === "any_county") return env.counties.some(target => scoped(target, current, env, value => evaluateTriggerBlock(operand, value, env, parameters)));
      if (key === "any_in_list") {
        const variable = first(operand, "variable");
        const global = first(operand, "global_variable");
        const list = global ? env.globalLists.get(global.value) : current.variableLists.get(variable.value);
        return (list || []).some(target => scoped(target, current, env, value => evaluateTriggerBlock(operand.filter(n => !["variable", "global_variable"].includes(n.key)), value, env, parameters)));
      }
      return primitiveTrigger(node, current, env, parameters);
    };
    executeEffectNode = function(node, current, env, parameters = {}) {
      const { key, value: operand } = node;
      if (key === "save_temporary_scope_as") { env.scopes[operand] = current; return; }
      if (key === "random_list") { env.listRolls++; return primitiveEffect(node, current, env, parameters); }
      if (key === "set_global_variable" || key === "change_global_variable") {
        const name = scalar(operand, "name", key);
        env.globalVars.set(name, key === "set_global_variable" ? atom(scalar(operand, "value", key), current, env, parameters) : Number(env.globalVars.get(name) || 0) + Number(atom(scalar(operand, "add", key), current, env, parameters)));
        return;
      }
      if (key === "remove_global_variable") { env.globalVars.delete(operand); return; }
      if (key === "clear_global_variable_list") { env.globalLists.delete(operand); return; }
      if (key === "clear_saved_scope") { delete env.scopes[operand]; return; }
      if (key === "random_in_global_list" || key === "every_in_global_list") {
        const limit = first(operand, "limit");
        const list = [...(env.globalLists.get(scalar(operand, "variable", key)) || [])]
          .filter(target => !limit || scoped(target, current, env, value => evaluateTriggerBlock(limit.value, value, env, parameters)));
        const targets = key === "every_in_global_list" ? list : list.length ? [list[Math.min(Math.max(Number(nextRandomChoice(env, "list")), 0), list.length - 1)]] : [];
        for (const target of targets) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => !["variable", "limit"].includes(n.key)), value, env, parameters));
        return;
      }
      if (key === "while") {
        const limit = first(operand, "limit");
        let iterations = 0;
        while (evaluateTriggerBlock(limit.value, current, env, parameters)) {
          assert.ok(++iterations <= 10000, "finite while exceeded its execution safety bound");
          executeEffectSequence(operand.filter(n => n.key !== "limit"), current, env, parameters);
        }
        return;
      }
      if (key === "ordered_in_global_list") {
        const limit = first(operand, "limit");
        const order = scalar(operand, "order_by", key);
        const candidates = [...(env.globalLists.get(scalar(operand, "variable", key)) || [])]
          .filter(target => !limit || scoped(target, current, env, value => evaluateTriggerBlock(limit.value, value, env, parameters)))
          .sort((a, b) => Number(property(b, order)) - Number(property(a, order)));
        const target = candidates[Number(scalar(operand, "position", key))];
        if (target) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => !["variable", "limit", "order_by", "position"].includes(n.key)), value, env, parameters));
        return;
      }
      if (key === "death") { current.alive = false; current.deathReason = scalar(operand, "death_reason", key); env.deaths.push(current); return; }
      if (["random_county", "random_county_province", "random_ruler"].includes(key)) {
        const list = key === "random_county" ? env.counties : key === "random_ruler" ? env.rulers : current.provinces;
        const limit = first(operand, "limit");
        const target = (list || []).find(value => !limit || scoped(value, current, env, next => evaluateTriggerBlock(limit.value, next, env, parameters)));
        if (target) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => n.key !== "limit"), value, env, parameters));
        return;
      }
      if (key === "set_location") { current.location = atom(operand, current, env, parameters); return; }
      if (key === "set_mother" || key === "set_father") { current[key.slice(4)] = atom(operand, current, env, parameters); return; }
      if (key === "create_dynasty") { current.dynasty = "independent-dynasty-" + (++env.dynastyCount); return; }
      if (key === "create_character") {
        const originalSex = env.creationFemale;
        const gender = first(operand, "gender");
        if (gender) env.creationFemale = gender.value === "female";
        const age = first(operand, "age");
        if (age && Array.isArray(age.value)) {
          const [low, high] = age.value.map(item => Number(item.value));
          assert.ok(Number.isInteger(env.creationAge) && env.creationAge >= low && env.creationAge <= high, "finite creation age within actual script range");
          const adapted = { ...node, value: operand.map(item => item === age ? { ...item, value: String(env.creationAge) } : item) };
          try { return primitiveEffect(adapted, current, env, parameters); } finally { env.creationFemale = originalSex; }
        }
        try { return primitiveEffect(node, current, env, parameters); } finally { env.creationFemale = originalSex; }
      }
      if (key === "set_variable" && Array.isArray(first(operand, "value")?.value)) {
        const value = first(operand, "value").value;
        scriptValues.set("qa_v134_inline_value", value);
        try { current.vars.set(scalar(operand, "name", key), computedValue("qa_v134_inline_value", current, env, parameters)); }
        finally { scriptValues.delete("qa_v134_inline_value"); }
        return;
      }
      if (key === "change_variable") {
        const name = scalar(operand, "name", key);
        const add = first(operand, "add");
        const subtract = first(operand, "subtract");
        assert.ok(!!add !== !!subtract, "finite change_variable needs one add or subtract");
        current.vars.set(name, Number(current.vars.get(name) || 0) + Number(atom((add || subtract).value, current, env, parameters)) * (subtract ? -1 : 1));
        return;
      }
      if (key === "random") {
        const chance = Number(atom(scalar(operand, "chance", "random chance"), current, env, parameters));
        const success = nextRandomChoice(env, "chance");
        env.randomRolls.push({ chance, success });
        if (success) executeEffectSequence(operand.filter(child => child.key !== "chance"), current, env, parameters);
        return;
      }
      if (scopedKey(key)) {
        const target = resolvePath(key, current, env, parameters);
        if (target !== undefined && Array.isArray(operand)) scoped(target, current, env, value => executeEffectSequence(operand, value, env, parameters));
        return;
      }
      if (key === "every_in_list") {
        const variable = first(operand, "variable");
        const global = first(operand, "global_variable");
        const list = global ? env.globalLists.get(global.value) : current.variableLists.get(variable.value);
        for (const target of [...(list || [])]) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => !["variable", "global_variable", "limit"].includes(n.key)), value, env, parameters));
        return;
      }
      if (key === "add_trait_xp") {
        const track = first(operand, "track")?.value || scalar(operand, "trait", "trait XP");
        current.xp.set(track, (current.xp.get(track) || 0) + Number(atom(scalar(operand, "value", "track XP"), current, env, parameters)));
        return;
      }
      if (key.startsWith("add_") && ["gold", "piety", "prestige", "stress"].includes(key.slice(4))) {
        let amount = Array.isArray(operand) ? Number(atom(scalar(operand, "value", key), current, env, parameters)) : Number(atom(operand, current, env, parameters));
        if (Array.isArray(operand) && first(operand, "multiply")) amount *= Number(atom(first(operand, "multiply").value, current, env, parameters));
        current[key.slice(4)] += amount;
        env.payments.push({ resource: key.slice(4), amount });
        return;
      }
      if (key === "add_character_modifier") { current.modifiers.add(Array.isArray(operand) ? scalar(operand, "modifier", key) : operand); return; }
      if (key === "remove_character_modifier") { current.modifiers.delete(operand); return; }
      if (key === "add_to_global_variable_list" || key === "remove_list_global_variable") {
        const name = scalar(operand, "name", key);
        const target = atom(scalar(operand, "target", key), current, env, parameters);
        const list = env.globalLists.get(name) || [];
        if (key === "add_to_global_variable_list") { if (!list.includes(target)) list.push(target); env.globalLists.set(name, list); }
        else env.globalLists.set(name, list.filter(value => value !== target));
        return;
      }
      if (key === "change_first_name") { current.name = atom(scalar(operand, "template_character", key), current, env, parameters).name; return; }
      if (key === "give_nickname") { current.nickname = operand; return; }
      if (/^(?:set|remove)_relation_/.test(key)) {
        const relation = key.replace(/^(?:set|remove)_relation_/, "");
        const target = atom(operand, current, env, parameters);
        const list = current.relations.get(relation) || new Set();
        if (key.startsWith("set_")) list.add(target); else list.delete(target);
        current.relations.set(relation, list);
        return;
      }
      if (key === "trigger_event") { env.events.push(operand); return; }
      if (key === "send_interface_toast") { env.toasts.push(operand); return; }
      if (env.stubs.has(key)) { env.calls.push({ effect: key, current }); return; }
      return primitiveEffect(node, current, env, parameters);
    };
    globalThis.api = { parsePdx, first, all, scalar, scriptedEffects, scriptedTriggers, scriptValues,
      character(id, options = {}) { const result = makeCharacter(id, options); Object.assign(result, {name: options.name || id, xp: new Map(Object.entries(options.xp || {})), modifiers: new Set(options.modifiers || []), relations: new Map(), gold: options.gold ?? 5000, piety: options.piety ?? 5000, prestige: options.prestige ?? 5000, stress: options.stress ?? 0, deathReason: options.deathReason}); return result; },
      environment(options = {}) { return Object.assign(makeEnvironment(options), {root: options.root, year: options.year ?? 1066, month: options.month ?? 1, gameRules: new Set(options.gameRules || []), previous: [], events: [], toasts: [], payments: [], calls: [], stubs: new Set(options.stubs || []), listRolls: 0, globalVars: new Map(), characters: new Map(), counties: options.counties || [], rulers: options.rulers || [], dynastyCount: 0, deaths: []}); },
      value(name, current, env, parameters = {}) { env.root ||= current; return computedValue(name, current, env, parameters); },
      run(name, current, env, parameters = {}) { env.root ||= current; executeEffectDefinition(name, current, env, parameters); },
      trigger(name, current, env, parameters = {}) { env.root ||= current; return runTriggerDefinition(name, current, env, parameters); }
    };
  `, context, { filename: "v132-finite-harness", timeout: 10000 });
  const api = context.api;
  const root = path.resolve(__dirname, "..");
  for (const moduleName of modules) {
    for (const [folder, destination] of [["scripted_effects", api.scriptedEffects], ["scripted_triggers", api.scriptedTriggers], ["script_values", api.scriptValues]]) {
      const directory = path.join(root, "patches", moduleName, "mod", "common", folder);
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".txt")).sort()) {
        for (const node of api.parsePdx(fs.readFileSync(path.join(directory, file), "utf8"), file)) destination.set(node.key, node.value);
      }
    }
  }
  return api;
}

module.exports = { createHarness };

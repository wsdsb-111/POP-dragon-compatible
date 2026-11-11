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
    const primitiveCreateCharacter = mockCreateCharacter;
    mockCreateCharacter = function(fields, current, env, parameters) {
      const child = primitiveCreateCharacter(fields.filter(node => node.key !== "after_creation"), current, env, parameters);
      const houseField = first(fields, "dynasty_house");
      if (houseField) {
        const house = atom(houseField.value, current, env, parameters);
        assert.ok(house && house.dynasty, "explicit native dynasty_house requires an existing House scope");
        child.house = house;
        child.dynasty = house.dynasty;
      }
      const after = first(fields, "after_creation");
      if (after) executeEffectSequence(after.value, child, env, parameters);
      return child;
    };
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
      const definition = scriptValues.get(name);
      if (!Array.isArray(definition)) return atom(definition, current, env, parameters);
      let result = 0;
      function apply(nodes) {
        for (const node of nodes) {
          if (node.key === "value") result = Number(atom(node.value, current, env, parameters));
          else if (node.key === "add") result += Number(atom(node.value, current, env, parameters));
          else if (node.key === "multiply") result *= Number(atom(node.value, current, env, parameters));
          else if (node.key === "if") {
            const limit = first(node.value, "limit");
            if (!limit || evaluateTriggerBlock(limit.value, current, env, parameters)) apply(node.value.filter(n => n.key !== "limit"));
          } else throw new Error("unsupported finite script value node " + node.key);
        }
      }
      apply(definition);
      return result;
    }
    resolvePath = function(raw, current, env, parameters = {}) {
      if (typeof raw !== "string") return raw;
      if (raw === "root") return env.root;
      if (raw === "prev") return (env.previous || []).at(-1);
      if (raw.startsWith("global_var:")) return env.globalVars.get(raw.slice(11));
      if (["mother", "father", "real_father", "holder", "house", "location"].includes(raw)) return property(current, raw);
      if (raw.startsWith("character:")) return env.characters?.get(raw.slice(10));
      const dotted = /^(.*)\\.([^.]+)$/.exec(raw);
      if (dotted && scriptValues.has(dotted[2])) return computedValue(dotted[2], resolvePath(dotted[1], current, env, parameters), env, parameters);
      return primitivePath(raw, current, env, parameters);
    };
    atom = function(raw, current, env, parameters = {}) {
      if (raw === "current_year") return env.year;
      if (["mother", "father", "real_father", "holder", "house", "location"].includes(raw)) return resolvePath(raw, current, env, parameters);
      if (typeof raw === "string" && raw.startsWith("global_var:")) return resolvePath(raw, current, env, parameters);
      if (raw === "root" || raw === "prev" || (typeof raw === "string" && raw.startsWith("character:"))) return resolvePath(raw, current, env, parameters);
      if (scriptValues.has(raw)) return computedValue(raw, current, env, parameters);
      return primitiveAtom(raw, current, env, parameters);
    };
    function scopedKey(key) { return ["root", "prev", "holder", "mother", "father", "real_father"].includes(key) || /^(?:scope:|var:|global_var:|character:|\\$)/.test(key); }
    evaluateTriggerNode = function(node, current, env, parameters = {}) {
      const { key, value: operand, operator } = node;
      if (key === "always") return operand === "yes";
      if (key === "this") return compare(current, operator, atom(operand, current, env, parameters));
      if (key === "portrait_has_trait_trigger") return current.traits.has(atom(scalar(operand, "TRAIT", key), current, env, parameters));
      if (key === "is_spouse_of" || ["has_relation_lover", "has_relation_soulmate"].includes(key)) {
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
      if (key === "has_global_variable_list") return env.globalLists.has(operand);
      if (key === "is_target_in_global_variable_list") return (env.globalLists.get(scalar(operand, "name", key)) || []).includes(atom(scalar(operand, "target", key), current, env, parameters));
      if (key === "any_character_artifact") return (current.artifacts || []).some(target => !target.destroyed && target.owner === current && scoped(target, current, env, value => evaluateTriggerBlock(operand, value, env, parameters)));
      if (key === "any_county") return env.counties.some(target => scoped(target, current, env, value => evaluateTriggerBlock(operand, value, env, parameters)));
      if (key === "any_living_character") return [...env.characters.values()].some(target => target.alive && scoped(target, current, env, value => evaluateTriggerBlock(operand, value, env, parameters)));
      if (key === "any_in_list" || key === "any_in_global_list") {
        assert.ok(!first(operand, "global_variable"), "CK3 list iterators do not accept a global_variable selector");
        const variable = first(operand, "variable");
        assert.ok(variable, "finite persistent list iterator requires a variable selector");
        const list = key === "any_in_global_list" ? env.globalLists.get(variable.value) : current.variableLists.get(variable.value);
        return (list || []).some(target => scoped(target, current, env, value => evaluateTriggerBlock(operand.filter(n => n.key !== "variable"), value, env, parameters)));
      }
      return primitiveTrigger(node, current, env, parameters);
    };
    executeEffectNode = function(node, current, env, parameters = {}) {
      const { key, value: operand } = node;
      if (key === "every_living_character") {
        const limit = first(operand, "limit");
        for (const target of env.characters.values()) if (target.alive && (!limit || scoped(target, current, env, value => evaluateTriggerBlock(limit.value, value, env, parameters)))) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => n.key !== "limit"), value, env, parameters));
        return;
      }
      if (key === "set_character_rite") { current.rite = atom(operand, current, env, parameters); return; }
      if (key === "set_immortal_age") { current.immortalAge = Number(atom(operand, current, env, parameters)); return; }
      if (key === "remove_list_variable") {
        const name = scalar(operand, "name", key);
        const target = atom(scalar(operand, "target", key), current, env, parameters);
        current.variableLists.set(name, (current.variableLists.get(name) || []).filter(value => value !== target));
        return;
      }
      if (key === "set_character_faith") { current.faith = atom(operand, current, env, parameters); return; }
      if (["every_player", "every_child", "every_courtier_or_guest"].includes(key)) {
        const candidates = key === "every_player" ? (env.players || []) : key === "every_child" ? (current.children || []) : [...(current.courtiers || [])];
        const limit = first(operand, "limit");
        for (const target of candidates) if (!limit || scoped(target, current, env, value => evaluateTriggerBlock(limit.value, value, env, parameters))) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => n.key !== "limit"), value, env, parameters));
        return;
      }
      if (key === "set_global_variable" || key === "change_global_variable") {
        const name = scalar(operand, "name", key);
        env.globalVars.set(name, key === "set_global_variable" ? atom(scalar(operand, "value", key), current, env, parameters) : Number(env.globalVars.get(name) || 0) + Number(atom(scalar(operand, "add", key), current, env, parameters)));
        return;
      }
      if (key === "remove_global_variable") { env.globalVars.delete(operand); return; }
      if (key === "clear_global_variable_list") { env.globalLists.set(operand, []); return; }
      if (key === "clear_saved_scope") { delete env.scopes[operand]; return; }
      if (key === "random_in_global_list" || key === "every_in_global_list") {
        const limit = first(operand, "limit");
        const list = [...(env.globalLists.get(scalar(operand, "variable", key)) || [])]
          .filter(target => !limit || scoped(target, current, env, value => evaluateTriggerBlock(limit.value, value, env, parameters)));
        const targets = key === "every_in_global_list" ? list : list.length ? [list[Math.min(Math.max(Number(nextRandomChoice(env, "list")), 0), list.length - 1)]] : [];
        for (const target of targets) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => !["variable", "limit"].includes(n.key)), value, env, parameters));
        return;
      }
      if (key === "random_character_artifact") {
        const limit = first(operand, "limit");
        const candidates = (current.artifacts || []).filter(target => !target.destroyed && target.owner === current
          && (!limit || scoped(target, current, env, value => evaluateTriggerBlock(limit.value, value, env, parameters))));
        const index = Math.min(Math.max(Number(nextRandomChoice(env, "list")), 0), candidates.length - 1);
        const target = candidates[index];
        if (target) scoped(target, current, env, value => executeEffectSequence(operand.filter(n => n.key !== "limit"), value, env, parameters));
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
      if (key === "create_dynasty") {
        current.dynasty = "independent-dynasty-" + (++env.dynastyCount);
        current.house = { id: "house-" + env.dynastyCount, dynasty: current.dynasty };
        (env.houseOwners ||= new Map()).set(current.house, current);
        current.namingBlockedAtCreation = current.vars.has("block_dynamic_dynasty_naming");
        return;
      }
      if (key === "house" && Array.isArray(operand)) {
        assert.ok(current.house, "a House scope must exist before entering it");
        scoped(current.house, current, env, value => executeEffectSequence(operand, value, env, parameters));
        return;
      }
      if (key === "set_house_name_from_dynasty") {
        current.nameSource = operand === "dynasty" ? current.dynasty : atom(operand, current, env, parameters);
        const owner = env.houseOwners?.get(current);
        if (owner) owner.houseNameSource = current.nameSource;
        return;
      }
      if (key === "set_house") {
        const house = atom(operand, current, env, parameters);
        assert.ok(house && house.dynasty, "set_house requires an existing House scope");
        current.house = house;
        current.dynasty = house.dynasty;
        return;
      }
      if (key === "set_mother") { current.mother = atom(operand, current, env, parameters); return; }
      if (key === "set_father") { current.father = atom(operand, current, env, parameters); return; }
      if (key === "create_character") {
        const originalSex = env.creationFemale;
        const gender = first(operand, "gender");
        if (gender) env.creationFemale = gender.value === "female";
        try { return primitiveEffect(node, current, env, parameters); } finally { env.creationFemale = originalSex; }
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
        const track = scalar(operand, "track", "track XP");
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
      if (key === "debug_log") { (env.logs ||= []).push(operand); return; }
      if (key === "custom_tooltip" && typeof operand === "string") return;
      if (key === "trigger_event") { env.events.push(operand); return; }
      if (key === "send_interface_toast") { env.toasts.push(operand); return; }
      if (env.stubs.has(key)) { env.calls.push({ effect: key, current }); return; }
      return primitiveEffect(node, current, env, parameters);
    };
    globalThis.api = { parsePdx, first, all, scalar, scriptedEffects, scriptedTriggers, scriptValues,
      character(id, options = {}) { const result = makeCharacter(id, options); Object.assign(result, {name: options.name || id, rite: options.rite || null, xp: new Map(Object.entries(options.xp || {})), modifiers: new Set(options.modifiers || []), relations: new Map(), artifacts: [], gold: options.gold ?? 5000, piety: options.piety ?? 5000, prestige: options.prestige ?? 5000, stress: options.stress ?? 0, deathReason: options.deathReason}); return result; },
      environment(options = {}) { return Object.assign(makeEnvironment(options), {root: options.root, year: options.year ?? 1066, previous: [], events: [], toasts: [], payments: [], calls: [], stubs: new Set(options.stubs || []), globalVars: new Map(), characters: new Map(), counties: options.counties || [], rulers: options.rulers || [], dynastyCount: 0, deaths: []}); },
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

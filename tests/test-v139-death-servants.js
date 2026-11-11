"use strict";
// Executes shipping PDX with a finite harness. Engine side effects and selection
// are explicitly stubbed; this cannot establish CK3 runtime behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const helperPath = path.join(__dirname, 'wyvern-v135-finite-helper.js');
let helper = fs.readFileSync(helperPath, 'utf8');
// Script macro replacement used in the stress-check flag names.
helper = helper.replace('const { key, value: operand, operator } = node;', `const { key, operator } = node;
      let operand = node.value;
      if (key === "has_character_flag" && typeof operand === "string") operand = operand.replace(/\\$STAGE\\$/g, parameters.STAGE);`);
helper = helper.replace('const { key, value: operand } = node;', `const { key, value: operand } = node;
      if (key === "add_character_flag") {
        const name = (Array.isArray(operand) ? scalar(operand, "flag", key) : operand).replace(/\\$STAGE\\$/g, parameters.STAGE);
        current.flags.add(name); return;
      }`);
helper = helper.replace('if (raw === "root") return env.root;', 'if (raw === "player_heir") return current.player_heir; if (raw === "root") return env.root;');
helper = helper.replace('function scopedKey(key) { return [', 'function scopedKey(key) { return ["player_heir", ');
helper = helper.replace('return primitiveTrigger(node, current, env, parameters);', `
      if (["is_courtier", "is_guest", "is_pool_guest", "is_traveling"].includes(key)) return Boolean(current[key]) === (operand === "yes");
      return primitiveTrigger(node, current, env, parameters);`);
helper = helper.replace('if (env.stubs.has(key))', `
      if (key === "random_neighboring_province") {
        const target = (current.neighbors || [])[0];
        if (target) scoped(target, current, env, x => executeEffectSequence(operand.filter(n => n.key !== "limit"), x, env, parameters));
        return;
      }
      if (key === "random_living_character") {
        const limit = first(operand, "limit");
        const target = (env.candidates || []).find(c => scoped(c, current, env, x => evaluateTriggerBlock(limit.value, x, env, parameters)));
        if (target) scoped(target, current, env, x => executeEffectSequence(operand.filter(n => n.key !== "limit"), x, env, parameters));
        return;
      }
      if (env.stubs.has(key))`);
const compiled = new Module(helperPath, module); compiled.filename = helperPath; compiled.paths = module.paths; compiled._compile(helper, helperPath);
const h = compiled.exports.createHarness(['wyvern-bloodline', 'wyvern-kings', 'dragon-death-servants']);
const matrix = [[5,10,15,100],[3,6,9,25],[2,4,6,15],[1,2,3,5]];
for (let lineage = 1; lineage <= 4; lineage++) for (let stage = 1; stage <= 4; stage++) {
  const c = h.character('case', { traits: [`mm_dragon_lineage_${lineage}`], vars: { mm_ds_stress_stage: stage } });
  c.rite = 'rite:mm_dragon_black';
  assert.equal(h.value('mm_ds_mutation_chance', c, h.environment()), matrix[lineage-1][stage-1], `${lineage}/${stage} non-white`);
  c.rite = 'rite:mm_dragon_white';
  assert.equal(h.value('mm_ds_mutation_chance', c, h.environment()), matrix[lineage-1][stage-1] * 0.5, `${lineage}/${stage} white`);
}
for (const trait of ['mm_dragon_half','mm_dragon_black_blood','mm_dragon_death_servant']) {
 const c = h.character(trait, { traits: ['mm_dragon_lineage_1', trait] });
 assert.equal(h.trigger('mm_ds_susceptible_trigger', c, h.environment()), false, trait);
}
// Exercise actual trigger definitions for kings and dragons with fixture traits.
for (const trait of ['mm_royal_dragon_king','myv_wyvern']) {
 const c = h.character(trait, { traits: ['mm_dragon_lineage_1', trait] });
 assert.equal(h.trigger('mm_ds_susceptible_trigger', c, h.environment()), false, trait);
}
for (let stage = 1; stage <= 4; stage++) {
 const c = h.character('repeated', { traits: ['mm_dragon_lineage_2'] });
 const e = h.environment({ randomChoices: [false, false], stubs: ['mm_ds_transform_effect'] });
 h.run('mm_ds_stress_check_effect', c, e, { STAGE: stage });
 h.run('mm_ds_stress_check_effect', c, e, { STAGE: stage });
 assert.equal(e.randomRolls.length, 1, 'one roll per stage per day');
 assert.equal(e.randomRolls[0].chance, matrix[1][stage-1]);
 assert.equal(c.vars.has('mm_ds_stress_stage'), false);
 c.flags.clear();
 h.run('mm_ds_stress_check_effect', c, e, { STAGE: stage });
 assert.equal(e.randomRolls.length, 2, 'next day can roll again');
}
{
 const c = h.character('mutation', { ai: true, traits: ['mm_dragon_lineage_3'] });
 const e = h.environment({ randomChoices: [true] });
 h.run('mm_ds_stress_check_effect', c, e, { STAGE: 2 });
 assert.ok(c.traits.has('mm_dragon_death_servant'));
 assert.equal(h.trigger('mm_ds_susceptible_trigger', c, e), false);
 c.flags.clear();
 h.run('mm_ds_stress_check_effect', c, e, { STAGE: 2 });
 assert.equal(e.randomRolls.length, 1, 'converted subject never rolls again');
 assert.equal(e.globalLists.get('mm_ds_living_servants').length, 1);
 assert.equal(e.events.length, 1);
}

{
 const county = { id: 'county' };
 const attacker = h.character('attacker', { ai: true, location: { county }, traits: ['mm_dragon_death_servant'] });
 const ruler = h.character('ruler', { ai: true, isRuler: true, location: { county } });
 const wanderer = h.character('wanderer', { ai: true, location: { county }, traits: ['mm_dragon_half'] });
 const player = h.character('player', { location: { county } });
 const env = h.environment({ scopes: { mm_ds_attacker: attacker }, stubs: ['mm_ds_duel_effect'] });
 env.candidates = [player, ruler, wanderer];
 h.run('mm_ds_choose_victim_effect', attacker, env);
 assert.equal(env.scopes.mm_ds_victim, wanderer, 'wanderer preferred and player excluded');
 assert.equal(env.calls[0].effect, 'mm_ds_duel_effect', 'strong opponent duels');
 assert.equal(wanderer.alive, true);
 env.candidates = [player, ruler]; env.calls.length = 0;
 h.run('mm_ds_choose_victim_effect', attacker, env);
 assert.equal(env.scopes.mm_ds_victim, ruler, 'local AI fallback');
 assert.equal(ruler.alive, false, 'ordinary target dies');
 assert.equal(player.alive, true);
}
{
 const interactions = h.parsePdx(fs.readFileSync(path.join(__dirname, '../patches/dragon-death-servants/mod/common/character_interactions/mm_dragon_death_servants.txt'), 'utf8'));
 h.scriptedEffects.set('qa_hunt', h.first(interactions[0].value, 'on_accept').value);
 const county = { id: 'hunt' }, hunter = h.character('ordinary-hunter', { location: { county } });
 const servant = h.character('servant', { ai: true, location: { county }, traits: ['mm_dragon_death_servant'] });
 const env = h.environment({ scopes: { actor: hunter, recipient: servant }, stubs: ['mm_ds_duel_effect'] });
 h.run('qa_hunt', hunter, env);
 assert.equal(env.calls.length, 1); assert.equal(env.calls[0].effect, 'mm_ds_duel_effect');
 assert.equal(hunter.alive, true, 'normal player enters duel, not instant kill');
}

for (let roll = 0; roll < 3; roll++) {
 const county = { id: 'home' }, destination = { county: { id: 'neighbor' } };
 const c = h.character('daily', { ai: true, location: { county, neighbors: [destination] }, traits: ['mm_dragon_death_servant'] });
 const env = h.environment({ randomChoices: [{ type: 'list', index: roll }], stubs: ['mm_ds_choose_victim_effect', 'start_travel_plan'] });
 h.run('mm_ds_daily_rampage_effect', c, env);
 assert.equal(env.calls.filter(x => x.effect === 'mm_ds_choose_victim_effect').length, roll + 1);
 assert.equal(env.calls.filter(x => x.effect === 'start_travel_plan').length, 1);
 assert.equal(env.scopes.mm_ds_destination, destination);
 assert.ok(c.flags.has('mm_ds_roam_cooldown'));
}
{
 const move = h.scriptedEffects.get('mm_ds_daily_rampage_effect');
 const source = fs.readFileSync(path.join(__dirname, '../patches/dragon-death-servants/mod/common/scripted_effects/mm_dragon_death_servants.txt'), 'utf8');
 assert.match(source, /start_travel_plan\s*=\s*\{\s*destination\s*=\s*scope:mm_ds_destination\s+return_trip\s*=\s*no\s+on_arrival_destinations\s*=\s*last\s*\}/);
 assert.doesNotMatch(source, /travel_speed|set_location|teleport/);
 assert.ok(move);
}

{
 const player = h.character('player-ruler', { isRuler: true, traits: ['mm_dragon_lineage_1'] });
 const heir = h.character('heir'); player.player_heir = heir;
 const env = h.environment({ stubs: ['depose', 'set_player_character'] });
 h.run('mm_ds_transform_effect', player, env);
 assert.equal(env.scopes.mm_ds_player_successor, heir);
 assert.equal(env.calls.map(x => x.effect).join(','), 'depose,set_player_character');
 assert.ok(player.alive && player.traits.has('mm_dragon_death_servant'));
 // Stubs establish requested order only, never prove native succession or control.
}


console.log('death servants finite checks passed');

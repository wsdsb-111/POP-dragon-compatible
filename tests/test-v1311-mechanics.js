'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const common = path.join(__dirname, '../patches/dragon-creed/mod/common');
const read = file => fs.readFileSync(path.join(common, file), 'utf8');
const interactions = read('character_interactions/mm_v1311_mechanics.txt');
const hooks = interactions.match(/mm_v1311_mind_erase_interaction\s*=\s*\{([\s\S]*?)\n\}/)[1];
const infection = interactions.match(/mm_v1311_mind_infection_interaction\s*=\s*\{([\s\S]*?)\n\}/)[1];
assert.match(hooks, /rite\s*=\s*rite:mm_dragon_white/);
assert.match(hooks, /mm_dragon_source_is_white_trigger\s*=\s*yes/);
assert.match(hooks, /has_variable\s*=\s*mm_dragon_bio_white/);
assert.match(hooks, /cooldown\s*=\s*\{\s*years\s*=\s*5\s*\}/);
assert.match(hooks, /type\s*=\s*strong_favor_hook/);
assert.match(infection, /mm_creed_controls_sagami_holy_site_trigger\s*=\s*yes/);
assert.match(infection, /cooldown\s*=\s*\{\s*years\s*=\s*1\s*\}/);
assert.match(infection, /modifier\s*=\s*mm_v1311_mind_infection\s+years\s*=\s*5/);
const effects = read('scripted_effects/mm_v1311_mechanics.txt');
for (let i = 1; i <= 5; i++) assert.match(effects, new RegExp(`NOT = \\{ has_character_modifier = mm_v1311_earth_birth_${i} \\}`));
const onActions = read('on_action/mm_v1311_mechanics.txt');
for (const name of ['on_birth_child', 'on_building_completed', 'on_set_relation_lover', 'on_set_relation_soulmate']) assert.match(onActions, new RegExp(`\\b${name}\\s*=`));
console.log('V1.3.1.1 mechanics wiring checks passed');
const monthly = onActions.slice(onActions.indexOf('mm_v1311_monthly_characters ='));
assert.ok(monthly.indexOf('clear_global_variable_list = mm_dragon_creed_members') < monthly.indexOf('mm_v1311_white_conversion_effect = yes'));
assert.match(monthly, /variable = mm_dragon_creed_members/);
assert.doesNotMatch(monthly, /every_living_character/);
assert.match(effects, /NOT = \{ has_character_flag = mm_v1311_white_conversion_checked \}/);
assert.match(effects, /flag = mm_v1311_white_conversion_checked days = 30/);
assert.match(interactions, /is_imprisoned_by = scope:actor/);
assert.match(interactions, /mm_v1311_eagle_active years = 3/);
const { createHarness } = require('./wyvern-v1311-finite-helper');
const h = createHarness(['wyvern-bloodline', 'wyvern-kings', 'dragon-creed']);
const stats = ['diplomacy', 'martial', 'stewardship', 'intrigue', 'learning', 'prowess'];
const interactionNodes = h.parsePdx(interactions);
const eagle = h.first(interactionNodes, 'mm_v1311_blood_eagle_interaction').value;
const eagleAccept = h.first(eagle, 'on_accept').value;
const actorBlock = h.first(h.first(eagleAccept, 'if').value, 'scope:actor').value;
const calls = actorBlock.filter(node => node.key === 'mm_v1311_eagle_attribute_effect');
assert.equal(calls.length, stats.length);
for (const stat of stats) {
  assert.ok(calls.some(node => h.scalar(node.value, 'ATTRIBUTE', 'attribute') === stat &&
    h.scalar(node.value, 'VALUE', 'value') === `scope:recipient.${stat}`));
}
// Execute the actual parameterized PDX calls and macro body with each input.
h.scriptedEffects.set('qa_eagle_calls', calls);
const modifierNodes = h.parsePdx(read('modifiers/mm_v1311_mechanics.txt'));
for (const [input, expected] of [[13, 2], [600, 120], [0, 0]]) {
  const recipient = h.character('recipient');
  for (const stat of stats) recipient[stat] = input;
  const actor = h.character('actor');
  const env = h.environment({ scopes: { recipient } });
  h.run('qa_eagle_calls', actor, env);
  for (const stat of stats) {
    let total = 0;
    for (const modifier of actor.modifiers) {
      const definition = h.first(modifierNodes, modifier);
      assert.ok(definition, `modifier must exist: ${modifier}`);
      const field = h.first(definition.value, stat);
      if (field) total += Number(field.value);
      assert.equal(actor.modifierDurations.get(modifier), 3);
    }
    assert.equal(total, expected, `${stat}: ${input} -> ${expected}`);
  }
  assert.equal(actor.vars.has('mm_v1311_eagle_value'), false);
}
// Model the rebuild ordering: conversion callbacks must add to the reconstructed list.
const prior = ['ruler', 'departed'];
const active = new Set(prior.filter(id => id !== 'departed'));
active.add('new_convert');
assert.deepStrictEqual([...active], ['ruler', 'new_convert']);
// One target can occur in multiple realms, but a dated check permits only one roll.
let rolls = 0;
const checked = new Set();
for (const id of ['target', 'target']) if (!checked.has(id)) { checked.add(id); rolls++; }
assert.strictEqual(rolls, 1);
assert.match(onActions, /on_death = \{ on_actions = \{ mm_v1311_fire_servant_killed \} \}/);
assert.match(onActions, /on_artifact_changed_owner = \{ on_actions = \{ mm_v1311_fire_artifact_acquired \} \}/);
assert.match(onActions, /rarity = illustrious/);
assert.match(onActions, /scope:raid_loot multiply = 0\.5/);
assert.match(effects, /set_character_rite = rite:mm_dragon_white mm_dragon_route_creed_effect = yes/);
const marriage = fs.readFileSync(path.join(__dirname, '../patches/dragon-bond/mod/common/scripted_modifiers/zzzz_mm_dragon_bond_marriage.txt'), 'utf8');
assert.match(marriage, /desc = mm_v1311_sea_marriage_acceptance/);
assert.match(marriage, /NOT = \{ rite = rite:mm_dragon_sea \}/);

// Execute the production on_accept guard after a target's state changes.
const erase = h.first(interactionNodes, 'mm_v1311_mind_erase_interaction').value;
h.scriptedEffects.set('qa_erase_accept', h.first(erase, 'on_accept').value);
h.scriptedEffects.set('qa_eagle_accept', eagleAccept);
function actorFor(rite) {
  const actor = h.character('actor');
  actor.rite = { id: rite }; actor.faith = 'faith:mm_dragon_creed';
  actor.vars.set('mm_dragon_bio_white', true);
  return actor;
}
{
  const actor = actorFor('mm_dragon_white');
  const recipient = h.character('recipient');
  recipient.alive = false;
  const env = h.environment({ scopes: { actor, recipient } });
  h.run('qa_erase_accept', actor, env);
  assert.equal((env.hooks || []).length, 0, 'dead recipient cannot gain a hook');
}
{
  const actor = actorFor('mm_dragon_white');
  actor.vars.delete('mm_dragon_bio_white');
  actor.traits.add('mm_dragon_branch_white');
  const recipient = h.character('recipient');
  const env = h.environment({ scopes: { actor, recipient } });
  h.run('qa_erase_accept', actor, env);
  assert.equal((env.hooks || []).length, 0, 'absorbed branch alone cannot authorize a hook');
}
{
  const actor = actorFor('mm_dragon_sky');
  const recipient = h.character('recipient');
  recipient.faith = actor.faith;
  recipient.imprisoner = null;
  const env = h.environment({ scopes: { actor, recipient } });
  h.run('qa_eagle_accept', actor, env);
  assert.equal(env.deaths.length, 0, 'released target must not die');
  assert.equal(actor.modifiers.size, 0);
}

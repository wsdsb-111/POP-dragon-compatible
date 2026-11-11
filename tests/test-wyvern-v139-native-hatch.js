'use strict';
const assert = require('node:assert/strict');
const { createHarness } = require('./wyvern-v134-finite-helper');
const h = createHarness(['wyvern-bloodline', 'wyvern-kings', 'wyvern-ascension', 'dragon-culture']);
for (const parentThrone of [1, 2, 3, 4, 0]) {
  const mother = h.character('mother', { female: true, traits: ['myv_wyvern'], vars: { mm_royal_creation_throne: parentThrone } });
  const father = h.character('father', { traits: ['myv_wyvern'], vars: { mm_royal_creation_throne: parentThrone } });
  const owner = h.character('owner'); owner.location = { culture: 'coptic' };
  const egg = h.character('egg', { vars: { myv_wyvern_egg_mother: mother, myv_wyvern_egg_father: father, myv_wyvern_egg_color: 2 } }); egg.owner = owner;
  const env = h.environment({root: egg, stubs: ['myv_roll_wyvern_coordination_effect', 'myv_roll_wyvern_color_effect', 'mm_dragon_register_true_dragon_origins_effect', 'mm_dragon_assign_regional_identity_effect', 'myv_apply_wyvern_identity_effect', 'myv_refresh_wyvern_prowess_effect', 'myv_wyvern_tamed_maintenance_effect', 'myv_enforce_wyvern_population_game_rule_effect']});
  h.run('myv_hatch_wyvern_egg_effect', egg, env);
  const baby = env.createdCharacters[0];
  assert.equal(baby.mother, mother); assert.equal(baby.father, father);
  const calls = Array.from(env.calls.filter(c => c.effect === 'mm_dragon_register_true_dragon_origins_effect' || c.effect === 'mm_dragon_assign_regional_identity_effect'));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].effect, 'mm_dragon_register_true_dragon_origins_effect');
  assert.equal(calls[1].effect, 'mm_dragon_assign_regional_identity_effect');
  for (const call of calls) { assert.equal(call.mother, mother); assert.equal(call.father, father); }
  assert.ok(!owner.flags.has('mm_dragon_native_hatch_in_progress'));
}
console.log('v139 native hatch defers origin and identity until parents are assigned');
const trigger = text => h.parsePdx('qa = { ' + text + ' }', 'qa')[0].value;
h.scriptedTriggers.set('myv_is_wyvern', trigger('always = yes'));
h.scriptedTriggers.set('mm_royal_is_king', trigger('always = no'));
h.scriptedTriggers.set('mm_dragon_is_true_dragon_parent_trigger', trigger('has_trait = myv_wyvern'));
for (const parentThrone of [1, 2, 3, 4, 0]) {
  const mom = h.character('parent', { traits: ['myv_wyvern'], vars: { mm_royal_creation_throne: parentThrone } });
  const child = h.character('child', { traits: ['myv_wyvern'], flags: ['mm_royal_newly_created'] }); child.mother = mom;
  const env = h.environment({root: child}); env.globalVars.set('mm_royal_catalog_initialized', true);
  for (const id of ['99001001','99001305','99001002','99001306','99001003','99001307','99001304','99001308']) env.characters.set(id, h.character(id));
  h.run('mm_royal_assign_creation_effect', child, env);
  assert.equal(child.vars.get('mm_royal_creation_throne'), parentThrone || undefined, 'never choose a random founder for a parented hatchling');
}
console.log('v139 hatchling creation founder follows parent without random assignment');
for (const parentThrone of [1, 2, 3, 4, 0]) {
  const dad = h.character('father-only', { traits: ['myv_wyvern'], vars: { mm_royal_creation_throne: parentThrone } });
  const child = h.character('child', { traits: ['myv_wyvern'], flags: ['mm_royal_newly_created'] }); child.father = dad;
  const env = h.environment({root: child}); env.globalVars.set('mm_royal_catalog_initialized', true);
  for (const id of ['99001001','99001305','99001002','99001306','99001003','99001307','99001304','99001308']) env.characters.set(id, h.character(id));
  h.run('mm_royal_assign_creation_effect', child, env);
  assert.equal(child.vars.get('mm_royal_creation_throne'), parentThrone || undefined, 'father-only hatch follows father');
}
console.log('v139 father-only hatchling founder follows father');

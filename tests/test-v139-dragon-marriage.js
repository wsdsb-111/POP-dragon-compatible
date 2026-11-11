"use strict";
// Finite script execution, not CK3 engine verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const helperPath = path.join(__dirname, 'wyvern-v135-finite-helper.js');
let source = fs.readFileSync(helperPath, 'utf8');
source = source.replace('return primitiveTrigger(node, current, env, parameters);', `
      if (key === "has_relation_myv_wyvern_rider") return (current.relations.get("myv_wyvern_rider") || new Set()).has(atom(operand, current, env, parameters));
      if (key === "has_relation_myv_wyvern_bonded_character") return (current.relations.get("myv_wyvern_bonded_character") || new Set()).has(atom(operand, current, env, parameters));
      if (key === "has_trait_with_flag") return current.traitFlags?.has(operand) || false;
      return primitiveTrigger(node, current, env, parameters);`);
source = source.replace('scalar(operand, "track", "track XP")', '(first(operand, "track")?.value || scalar(operand, "trait", "trait XP"))');
const mod = new Module(helperPath, module); mod.filename = helperPath; mod.paths = module.paths; mod._compile(source, helperPath);
const h = mod.exports.createHarness(['wyvern-bloodline', 'dragon-bond']);
function pair(dragonOptions = {}, humanOptions = {}) {
 const dragon = h.character('dragon', { age: 50, traits: ['myv_wyvern_tamed'], flags: ['mm_wyvern_human_form'], ...dragonOptions });
 const human = h.character('human', { age: 30, ...humanOptions });
 dragon.vars.set('myv_wyvern_bonded_character', human); dragon.bondedCharacter = human;
 dragon.relations.set('myv_wyvern_bonded_character', new Set([human]));
 return { dragon, human, env: h.environment({ scopes: { secondary_actor: dragon, secondary_recipient: human } }) };
}
{
 const { dragon, human, env } = pair();
 assert.equal(h.trigger('mm_dragon_bond_marriage_pair_trigger', dragon, env), true);
 [env.scopes.secondary_actor, env.scopes.secondary_recipient] = [human, dragon];
 assert.equal(h.trigger('mm_dragon_bond_marriage_pair_trigger', dragon, env), true);
 dragon.flags.delete('mm_wyvern_human_form');
 assert.equal(h.trigger('mm_dragon_bond_marriage_pair_trigger', dragon, env), false);
 dragon.flags.add('mm_wyvern_human_form'); human.age = 15;
 assert.equal(h.trigger('mm_dragon_bond_marriage_pair_trigger', dragon, env), false);
 human.age = 30; dragon.relations.clear();
 assert.equal(h.trigger('mm_dragon_bond_marriage_pair_trigger', dragon, env), false);
 dragon.relations.set('myv_wyvern_bonded_character', new Set([human])); dragon.vars.set('myv_wyvern_bonded_character', h.character('different'));
 assert.equal(h.trigger('mm_dragon_bond_marriage_pair_trigger', dragon, env), false);
}
for (const trait of ['myv_wyvern_tamed','mm_dragon_half','mm_dragon_lineage_4','mm_dragon_black_blood']) {
 const c = h.character(trait, { traits: [trait] });
 assert.equal(h.trigger('mm_dragon_bond_blood_trigger', c, h.environment()), true, trait);
}
assert.equal(h.trigger('mm_dragon_bond_blood_trigger', h.character('human'), h.environment()), false);
{
 const { dragon, env } = pair(); dragon.is_clergy = false;
 assert.equal(h.trigger('can_marry_common_trigger', dragon, env), true);
 dragon.flags.delete('mm_wyvern_human_form');
 assert.equal(h.trigger('can_marry_common_trigger', dragon, env), false);
 dragon.flags.add('mm_wyvern_human_form'); dragon.age = 12;
 assert.equal(h.trigger('can_marry_common_trigger', dragon, env), false);
 dragon.age = 40; dragon.traitFlags = new Set(['can_not_marry']);
 assert.equal(h.trigger('can_marry_common_trigger', dragon, env), false, 'unrelated trait still forbids marriage');
 dragon.traitFlags.clear(); dragon.vars.set('can_not_marry', true);
 assert.equal(h.trigger('can_marry_common_trigger', dragon, env), false, 'native variable still forbids marriage');
}
// Existing saves and freshly established bonds must grow without a rider link.
{
 const h2 = h;
 const first = pair(); const second = pair();
 h2.scriptedTriggers.set('myv_is_living_wyvern', h2.parsePdx('test = { is_alive = yes }')[0].value);
 const nativePulse = h2.parsePdx(fs.readFileSync(path.join(__dirname, '../patches/dragon-bond/mod/common/on_action/mm_dragon_bond_on_actions.txt'), 'utf8'));
 h2.scriptedEffects.set('qa_month', h2.first(nativePulse.find(n => n.key === 'mm_dragon_bond_monthly_pulse').value, 'effect').value);
 const env = h2.environment({ stubs: ['myv_wyvern_harmony_integrity_effect', 'myv_refresh_wyvern_prowess_effect'] });
 env.globalLists.set('myv_living_wyverns', [first.dragon, second.dragon]);
 h2.scriptedTriggers.set('qa_check', h2.parsePdx('x = { myv_is_living_wyvern = yes exists = var:myv_wyvern_bonded_character var:myv_wyvern_bonded_character = { is_alive = yes } has_relation_myv_wyvern_bonded_character = var:myv_wyvern_bonded_character }')[0].value);
 for (const condition of ['myv_is_living_wyvern = yes', 'exists = var:myv_wyvern_bonded_character', 'var:myv_wyvern_bonded_character = { is_alive = yes }', 'has_relation_myv_wyvern_bonded_character = var:myv_wyvern_bonded_character']) { h2.scriptedTriggers.set('qa_one', h2.parsePdx('x = { ' + condition + ' }')[0].value); assert.equal(h2.trigger('qa_one', first.dragon, env), true, condition); }
 h2.run('qa_month', first.dragon, env);
 assert.ok(first.dragon.traits.has('myv_wyvern_harmony'));
 assert.ok(first.dragon.flags.has('mm_dragon_bond_unridden_harmony'));
 assert.equal(first.dragon.xp.get('myv_wyvern_harmony'), 2);
 assert.equal(second.dragon.xp.get('myv_wyvern_harmony'), 2);
 assert.equal(first.dragon.relations.has('myv_wyvern_rider'), false);
 second.dragon.relations.clear();
 h2.run('qa_month', first.dragon, env);
 assert.equal(first.dragon.xp.get('myv_wyvern_harmony'), 4);
 assert.equal(second.dragon.xp.get('myv_wyvern_harmony'), 2, 'other dragon progress is isolated');
}

{
 const { dragon, human } = pair();
 const interaction = h.parsePdx(fs.readFileSync(path.join(__dirname, '../patches/wyvern-bloodline/mod/common/character_interactions/mm_dragon_breeding.txt'), 'utf8'))[0];
 const accept = h.first(interaction.value, 'ai_accept').value;
 const tiers = accept.filter(n => n.key === 'modifier' && h.first(n.value, 'add')?.value === '10');
 assert.equal(tiers.length, 4);
 const env = h.environment({ scopes: { actor: human, recipient: dragon } });
 for (const [xp, expected] of [[0,0],[25,1],[50,2],[75,3],[100,4]]) {
   dragon.xp.set('myv_wyvern_harmony', xp);
   let count = 0;
   for (const tier of tiers) { h.scriptedTriggers.set('qa_tier', tier.value.filter(n => n.key !== 'add')); if (h.trigger('qa_tier', dragon, env)) count++; }
   assert.equal(count, expected, `never ridden tier at ${xp}`);
 }
 assert.equal(dragon.relations.has('myv_wyvern_rider'), false);
 env.scopes.actor = h.character('unrelated');
 h.scriptedTriggers.set('qa_tier', tiers[0].value.filter(n => n.key !== 'add'));
 assert.equal(h.trigger('qa_tier', dragon, env), false);
}

{
 const dragon = h.character('fresh', { traits: ['myv_wyvern_tamed'] });
 const human = h.character('keeper');
 const env = h.environment({ stubs: ['myv_begin_wyvern_rider_record_effect'] });
 h.run('myv_establish_wyvern_keeper_bond_effect', human, env, { KEEPER: human, WYVERN: dragon });
 assert.equal(dragon.vars.get('myv_wyvern_bonded_character'), human);
 assert.ok(dragon.traits.has('myv_wyvern_harmony'));
 assert.ok(dragon.flags.has('mm_dragon_bond_unridden_harmony'));
 assert.equal(dragon.relations.has('myv_wyvern_rider'), false);
 h.run('myv_migrate_wyvern_harmony_effect', dragon, env);
 assert.equal(dragon.relations.has('myv_wyvern_rider'), false);
 assert.equal(env.calls.length, 0, 'load migration must not invent a ride');
}
console.log('dragon bond finite checks passed');

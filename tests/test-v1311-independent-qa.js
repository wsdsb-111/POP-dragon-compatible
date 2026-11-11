'use strict';

// Independent adversarial fixtures. The interpreter is finite and does not
// model CK3 loading, scheduling, cooldowns, or the native list implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v1311-finite-helper');
const root = path.resolve(__dirname, '..');
const h = createHarness(['wyvern-bloodline', 'wyvern-kings', 'dragon-creed']);
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const interactions = h.parsePdx(read('patches/dragon-creed/mod/common/character_interactions/mm_v1311_mechanics.txt'));
for (const [alias, name] of [['qa_erase', 'mm_v1311_mind_erase_interaction'], ['qa_eagle', 'mm_v1311_blood_eagle_interaction']]) {
  const interaction = h.first(interactions, name);
  assert.ok(interaction, `missing interaction ${name}`);
  h.scriptedEffects.set(alias, h.first(interaction.value, 'on_accept').value);
}
function rite(id, tenets = []) { return { id, tenets: new Set(tenets) }; }
function execute(name, actor, recipient) {
  const env = h.environment({ scopes: { actor, recipient } });
  h.run(name, actor, env);
  return env;
}

// Two biological origins are legitimate: retain the already selected later
// branch rather than implicitly privileging the first branch in file order.
for (const chosen of ['earth', 'sea', 'sky', 'white']) {
  const c = h.character(`multi-${chosen}`, {
    faith: 'faith:mm_dragon_creed', traits: ['mm_dragon_lineage_2'],
    vars: { mm_dragon_bio_fire: true, [`mm_dragon_bio_${chosen}`]: true }
  });
  c.rite = rite(`mm_dragon_${chosen}`);
  const env = h.environment();
  h.run('mm_dragon_route_creed_effect', c, env);
  h.run('mm_dragon_route_creed_effect', c, env);
  assert.equal(c.rite.id, `mm_dragon_${chosen}`, 'legitimate current rite survives');
  assert.equal((env.globalLists.get('mm_dragon_creed_members') || []).filter(x => x === c).length, 1, 'repeat registration does not duplicate');
}

// Visible branch projection from an absorbed source is not a biological origin.
{
  const c = h.character('absorber', {
    faith: 'faith:mm_dragon_creed', traits: ['mm_dragon_lineage_2', 'mm_dragon_branch_white'],
    vars: { mm_dragon_bio_fire: true, mm_dragon_absorbed_white: true }
  });
  c.rite = rite('mm_dragon_white');
  const env = h.environment();
  h.run('mm_dragon_route_creed_effect', c, env);
  assert.equal(c.rite.id, 'mm_dragon_fire', 'absorbed white cannot authorize white rite');
  c.rite = rite('mm_dragon_white');
  const target = h.character('target');
  assert.equal((execute('qa_erase', c, target).hooks || []).length, 0, 'absorption cannot authorize mind erasure');
  c.vars.set('mm_dragon_bio_white', true);
  const positive = execute('qa_erase', c, target);
  assert.equal((positive.hooks || []).length, 1, 'biological white origin is a positive control');
}

function birth(mother, father, choices) {
  const child = h.character('child');
  const env = h.environment({ root: child, scopes: { mother, real_father: father }, randomChoices: choices });
  h.run('mm_dragon_inherit_natural_blood_effect', child, env);
  return { child, env };
}
function parent(id, trait, founder = false) {
  const p = h.character(id, { traits: [trait] });
  p.rite = founder ? rite('mm_dragon_black', ['mm_tenet_black_second']) : rite('mm_dragon_sea');
  return p;
}
// The legacy black-blood parent distribution remains five equal choices.
for (let i = 0; i < 5; i++) {
  const { child, env } = birth(parent('m', 'mm_dragon_black_blood'), parent('f', 'mm_dragon_lineage_2'), [{ type: 'list', index: i }]);
  assert.deepEqual(Array.from(env.listWeights[0]), [20, 20, 20, 20, 20]);
  assert.ok(child.traits.has(['mm_dragon_black_blood', 'mm_dragon_lineage_1', 'mm_dragon_lineage_2', 'mm_dragon_lineage_3', 'mm_dragon_lineage_4'][i]));
  assert.equal(env.randomRolls.length, 0, 'non-founder receives no extra upgrade roll');
}
// Force mutation success and leave no second choice: accidental 25% roll must
// fail the finite runner rather than silently replacing the mutation result.
{
  const { child, env } = birth(parent('m', 'mm_dragon_lineage_3', true), parent('f', 'mm_dragon_lineage_3'), [{ type: 'chance', success: true }]);
  assert.ok(child.traits.has('mm_dragon_black_blood'));
  assert.deepEqual(Array.from(env.randomRolls, r => r.chance), [20]);
}
{
  const { child, env } = birth(parent('m', 'mm_dragon_black_blood', true), parent('f', 'mm_dragon_lineage_3'), [{ type: 'list', index: 0 }]);
  assert.ok(child.traits.has('mm_dragon_black_blood'));
  assert.equal(env.randomRolls.length, 0, 'inherited black result cannot be overwritten');
}

// Recheck after opening the interaction: releasing or converting the prisoner
// prevents all side effects, including the three-year attribute modifiers.
for (const change of ['released', 'converted']) {
  const actor = h.character('sky');
  actor.faith = 'faith:mm_dragon_creed'; actor.rite = rite('mm_dragon_sky');
  const victim = h.character(change);
  victim.faith = change === 'converted' ? 'faith:other' : actor.faith;
  victim.imprisoner = change === 'released' ? null : actor;
  const env = execute('qa_eagle', actor, victim);
  assert.equal(env.deaths.length, 0, `${change}: no death`);
  assert.equal(actor.modifiers.size, 0, `${change}: no reward`);
}

// Capture is independently selectable. Bloodline selection intentionally
// brings culture/creed through the builder's existing integration closure.
{
  const bare = createHarness(['wyvern-capture']);
  const c = bare.character('standalone', { faith: 'faith:other' });
  const env = bare.environment();
  bare.run('mm_creed_award_dragon_victory_effect', c, env);
  assert.equal(c.faith, 'faith:other');
  assert.equal(env.globalLists.size, 0);
  for (const trigger of ['mm_creed_is_founder_trigger', 'mm_creed_is_death_servant_trigger', 'mm_creed_has_biological_blood_trigger', 'mm_creed_earth_return_eligible_trigger']) {
    assert.equal(bare.trigger(trigger, c, env), false, trigger);
  }
  const common = path.join(root, 'patches/wyvern-capture/mod/common');
  function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.txt') ? [path.join(dir, entry.name)] : []);
  }
  for (const file of files(common)) {
    const code = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.replace(/#.*/, '')).join('\n');
    assert.doesNotMatch(code, /\b(?:rite:mm_dragon_(?:black|white|fire|earth|sea|sky)|faith:mm_dragon_creed|mm_tenet_black_second|mm_creed_is_dragon_faith_trigger)\b/, `standalone creed dependency: ${path.relative(root, file)}`);
  }
  assert.match(read('scripts/build-package.js'), /if \(selected\.has\("wyvern-bloodline"\)\) select\("dragon-culture"\)/);
  const modules = JSON.parse(read('modules.json'));
  assert.ok(modules.find(m => m.id === 'dragon-culture').requires.includes('dragon-creed'));
}
console.log('v1.3.11 independent finite adversarial fixtures passed; CK3 engine not exercised');

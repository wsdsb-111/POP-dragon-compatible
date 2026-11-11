const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const effects = read('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_lineage.txt');
const eggs = read('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_half_eggs.txt');
const route = read('patches/dragon-creed/mod/common/scripted_effects/mm_dragon_creed_routing.txt');
const onAction = read('patches/dragon-creed/mod/common/on_action/mm_dragon_creed_migration.txt');
const modifier = read('patches/wyvern-bloodline/mod/common/modifiers/mm_dragon_diluted_blood.txt');
assert.doesNotMatch(effects, /random_list = \{\s*60 = \{[^\n]+value = 6[^\n]+\}\s*35 = \{[^\n]+value = 1[^\n]+\}\s*35 = \{[^\n]+value = 2[^\n]+\}\s*35 = \{[^\n]+value = 3[^\n]+\}\s*35 = \{[^\n]+value = 4[^\n]+\}/, 'black parents no longer use the retired five-result roll');
assert.match(effects, /chance = 20 set_variable = \{ name = mm_dragon_lineage_generation value = 6/);
assert.match(effects, /chance = mm_dragon_black_mutation_chance/);
assert.match(effects, /var:mm_dragon_lineage_generation != 6[\s\S]*?chance = 25/);
assert.match(effects, /mm_dragon_stronger_parent_generation subtract = 2/);
assert.match(effects, /mm_dragon_stronger_parent_generation < 1/);
assert.match(effects, /mm_dragon_is_true_dragon_parent_trigger = yes[\s\S]*?set_variable = \{ name = mm_dragon_lineage_generation value = 0/);
assert.match(effects, /scope:mother = \{ rite = rite:mm_dragon_black[\s\S]*?scope:real_father = \{ mm_dragon_has_inheritable_blood_trigger = no mm_dragon_is_true_dragon_parent_trigger = no/);
assert.match(eggs, /mm_dragon_diluted_blood_modifier/);
assert.match(eggs, /mm_dragon_route_creed_hook_effect = yes/);
for (const attribute of ['diplomacy', 'martial', 'stewardship', 'intrigue', 'learning', 'prowess']) assert.match(modifier, new RegExp(`${attribute} = -1`));
const branches = ['fire', 'earth', 'sea', 'sky', 'black', 'white'];
for (const branch of branches) {
  assert.match(route, new RegExp(`exists = rite:mm_dragon_legacy_${branch}`));
  const current = route.indexOf(`rite = rite:mm_dragon_${branch}`);
  const fallback = route.indexOf(`limit = { OR = { mm_dragon_source_is_${branch}_trigger`);
  assert.ok(current >= 0 && fallback > current, `${branch}: current valid rite first`);
  assert.ok(route.slice(0, fallback).includes(`has_variable = mm_dragon_bio_${branch}`));
}
const firstFallback = route.indexOf('limit = { OR = { mm_dragon_source_is_fire_trigger');
assert.ok(branches.every(b => route.indexOf(`rite = rite:mm_dragon_${b}`) < firstFallback), 'all matching current rites precede ancestry fallback');
assert.doesNotMatch(route, /faith = faith:mm_dragon_(?:fire|earth|sea|sky|black|white)\b/);
const oracleImmunityGate = route.match(/^\s*limit = \{ has_character_flag = mm_relic_forced_white_rite NOR = \{[^\n]+/m)?.[0] || '';
assert.ok(oracleImmunityGate.includes('mm_dragon_absorbed_black') && oracleImmunityGate.includes('mm_dragon_absorbed_white'));
assert.doesNotMatch(route.replace(oracleImmunityGate, ''), /mm_dragon_absorbed_/, 'acquired power never selects an ordinary rite; imperial blood only gates oracle immunity');
assert.match(onAction, /mm_dragon_inherit_natural_blood_effect = yes mm_dragon_route_creed_effect = yes/);


// Execute the actual inheritance script with deterministic random outcomes. This
// finite harness covers these cases only; it is not the CK3 engine.
const { createHarness } = require('./wyvern-v1311-finite-helper');
const h = createHarness(['wyvern-bloodline', 'wyvern-kings']);
const gradeTraits = ['mm_dragon_half', 'mm_dragon_lineage_1', 'mm_dragon_lineage_2', 'mm_dragon_lineage_3', 'mm_dragon_lineage_4', 'mm_dragon_black_blood'];
function parent(id, trait, founder = false, tenet = true) {
  const result = h.character(id, { traits: trait ? [trait] : [] });
  result.rite = { id: founder ? 'mm_dragon_black' : 'mm_dragon_fire', tenets: new Set(founder && tenet ? ['mm_tenet_black_second'] : []) };
  return result;
}
function birth(mother, father, choices) {
  const child = h.character('child');
  const scopes = {};
  if (mother) scopes.mother = mother;
  if (father) scopes.real_father = father;
  const env = h.environment({ root: child, scopes, randomChoices: choices });
  h.run('mm_dragon_inherit_natural_blood_effect', child, env);
  return { child, env, grades: gradeTraits.filter(trait => child.traits.has(trait)) };
}
const chance = success => ({ type: 'chance', success });
const singleBlackBaseline = [
  ['mm_dragon_half', 'mm_dragon_lineage_1'],
  ['mm_dragon_lineage_1', 'mm_dragon_lineage_2'],
  ['mm_dragon_lineage_2', 'mm_dragon_lineage_3'],
  ['mm_dragon_lineage_3', 'mm_dragon_lineage_4'],
  ['mm_dragon_lineage_4', null],
  [null, 'mm_dragon_lineage_4']
];
for (const [otherTrait, expectedTrait] of singleBlackBaseline) {
  for (const blackRole of ['mother', 'father']) {
    const other = () => parent('other-parent', otherTrait);
    const parents = black => blackRole === 'mother'
      ? [black, other()]
      : [other(), black];
    const blackParent = () => parent('black-parent', 'mm_dragon_black_blood');
    const failedMutation = birth(...parents(blackParent()), [chance(false)]);
    assert.deepEqual(failedMutation.grades, expectedTrait ? [expectedTrait] : [], `${blackRole} black parent + ${otherTrait || 'ordinary'} keeps the other parent's baseline`);
    assert.deepEqual(Array.from(failedMutation.env.randomRolls, roll => roll.chance), [10]);

    const mutated = birth(...parents(blackParent()), [chance(true)]);
    assert.deepEqual(mutated.grades, ['mm_dragon_black_blood'], `${blackRole} black parent + ${otherTrait || 'ordinary'} can mutate to black`);
    assert.deepEqual(Array.from(mutated.env.randomRolls, roll => roll.chance), [10]);
  }
}
const doubleBlack = birth(
  parent('black-mother', 'mm_dragon_black_blood', true),
  parent('black-father', 'mm_dragon_black_blood', true),
  [chance(true), chance(true)]
);
assert.deepEqual(doubleBlack.grades, ['mm_dragon_black_blood'], 'two black parents always produce black blood');
assert.equal(doubleBlack.env.randomRolls.length, 0, 'double-black inheritance is guaranteed and bypasses mutation and founder upgrade rolls');

const founderBlackMutation = birth(
  parent('founder-black-mother', 'mm_dragon_black_blood', true),
  parent('mixed-father', 'mm_dragon_lineage_3'),
  [chance(true), chance(true)]
);
assert.deepEqual(founderBlackMutation.grades, ['mm_dragon_black_blood'], 'a successful black mutation remains black with founder doctrine');
assert.deepEqual(Array.from(founderBlackMutation.env.randomRolls, roll => roll.chance), [20], 'founder mutation chance applies, while the non-black tier-up roll cannot replace black blood');
const upgraded = birth(parent('mother', 'mm_dragon_lineage_3', true), parent('father', 'mm_dragon_lineage_3'), [chance(false), chance(true)]);
assert.deepEqual(upgraded.grades, ['mm_dragon_lineage_2'], 'B+B upgrades to A');
assert.deepEqual(Array.from(upgraded.env.randomRolls, roll => roll.chance), [20, 25]);
const noUpgrade = birth(parent('mother', 'mm_dragon_lineage_3', true), parent('father', 'mm_dragon_lineage_3'), [chance(false), chance(false)]);
assert.deepEqual(noUpgrade.grades, ['mm_dragon_lineage_4'], 'failed upgrade keeps ordinary C');
const capped = birth(parent('mother', 'mm_dragon_lineage_1', true), parent('father', 'mm_dragon_lineage_2'), [chance(false), chance(true)]);
assert.deepEqual(capped.grades, ['mm_dragon_lineage_1'], 'upgrade caps at S');
const blackParentUpgrade = birth(parent('mother', 'mm_dragon_black_blood', true), parent('father', 'mm_dragon_lineage_3'), [chance(false), chance(true)]);
assert.deepEqual(blackParentUpgrade.grades, ['mm_dragon_lineage_1'], 'failed black mutation preserves the founder tier-up cap at S');
const diluted = birth(parent('mother', 'mm_dragon_lineage_3', true), parent('father', null), [chance(false), chance(false)]);
assert.ok(diluted.child.modifiers.has('mm_dragon_diluted_blood_modifier'));
const missing = birth(parent('mother', 'mm_dragon_lineage_3', true), null, [chance(false), chance(false)]);
assert.ok(!missing.child.modifiers.has('mm_dragon_diluted_blood_modifier'));
for (const royal of [false, true]) {
  const dragon = parent('dragon', royal ? 'mm_royal_dragon_king' : 'myv_wyvern_tamed', true);
  if (royal) dragon.traits.add('myv_wyvern_legendary');
  const direct = birth(dragon, parent('human', 'mm_dragon_black_blood', true), []);
  assert.deepEqual(direct.grades, [royal ? 'mm_dragon_half' : 'mm_dragon_lineage_1']);
  assert.equal(direct.env.listRolls, 0);
  assert.equal(direct.env.randomRolls.length, 0);
}
for (const trait of ['myv_wyvern', 'myv_wyvern_tamed', 'mm_royal_dragon_king', 'mm_royal_black_emperor', 'mm_royal_white_empress']) {
  for (const role of ['mother', 'father']) {
    const royal = trait.startsWith('mm_royal_');
    const dragon = parent('unchanged-dragon-parent', trait, true);
    if (royal) dragon.traits.add('myv_wyvern_legendary');
    const mixed = parent('mixed-human-parent', 'mm_dragon_lineage_2', true);
    const direct = birth(role === 'mother' ? dragon : mixed, role === 'father' ? dragon : mixed, []);
    assert.deepEqual(direct.grades, [royal ? 'mm_dragon_half' : 'mm_dragon_lineage_1'], 'mixed inheritance changes do not replace the direct dragon-parent path');
    assert.equal(direct.env.listRolls, 0);
    assert.equal(direct.env.randomRolls.length, 0);
  }
}
// Native dragon egg selection is separate from human mixed-blood inheritance.
const nativeEggs = read('patches/wyvern-bloodline/mod/common/scripted_effects/zzzzz_mm_dragon_native_eggs.txt');
assert.doesNotMatch(nativeEggs, /mm_dragon_black_mutation_chance|mm_dragon_inherit_natural_blood_effect|mm_dragon_black_blood/);
assert.match(eggs, /var:mm_dragon_frozen_birth_generation = 1 var:mm_dragon_frozen_birth_generation = 6/);
// The startup route registers every current adherent, including non-dragon
// adherents, and repeat/conversion calls cannot duplicate or add outsiders.
const routing = createHarness(['wyvern-bloodline', 'wyvern-kings', 'dragon-creed']);
const registryEnv = routing.environment();
const believer = routing.character('ordinary-believer', { faith: 'faith:mm_dragon_creed' });
const outsider = routing.character('outsider', { faith: 'faith:other' });
const dragon = routing.character('dragon', { faith: 'faith:other', traits: ['myv_wyvern_tamed'], vars: { mm_dragon_bio_fire: true } });
routing.run('mm_dragon_route_creed_effect', believer, registryEnv);
routing.run('mm_dragon_route_creed_effect', believer, registryEnv);
routing.run('mm_dragon_route_creed_effect', outsider, registryEnv);
routing.run('mm_dragon_route_creed_effect', dragon, registryEnv);
assert.deepEqual(Array.from(registryEnv.globalLists.get('mm_dragon_creed_members')), [believer, dragon]);
assert.equal(dragon.faith, 'faith:mm_dragon_creed');
assert.equal(outsider.faith, 'faith:other');
console.log('v1.3.11 lineage finite and static checks passed');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v1311-finite-helper');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const h = createHarness(['wyvern-bloodline', 'wyvern-kings', 'dragon-creed']);
const branches = ['fire', 'earth', 'sea', 'sky', 'black', 'white'];
const rites = h.parsePdx(read('patches/dragon-creed/mod/common/religion/rite_types/mm_dragon_creed.txt'), 'rites');
const riteTypes = new Map(branches.map(branch => {
  const id = `mm_dragon_${branch}`;
  const definition = rites.find(node => node.key === id).value;
  return [id, { faith: 'faith:' + h.first(definition, 'faith').value, tenets: Array.from(h.first(definition, 'tenets').value, node => node.key), doctrines: Array.from(h.first(definition, 'doctrines').value, node => node.key) }];
}));
function blood(id, branch, trait = 'mm_dragon_lineage_2') {
  return h.character(id, { traits: [trait], vars: { [`mm_dragon_bio_${branch}`]: true }, faith: 'faith:catholic' });
}
// An old save can have the old split parent and no current rite instances.
// Conversion in this finite model adopts the selected rite's parent faith.
const env = h.environment({ rites: new Map(), riteTypes });
const fire = blood('existing-mixed-fire', 'fire');
h.run('mm_dragon_route_creed_effect', fire, env);
assert.equal(env.rites.size, 6);
assert.equal(env.calls.filter(call => call.effect === 'create_rite_from_type').length, 6);
assert.equal(fire.rite.id, 'mm_dragon_fire');
assert.equal(fire.faith, 'faith:mm_dragon_creed');
h.run('mm_dragon_route_creed_effect', fire, env);
assert.equal(env.calls.filter(call => call.effect === 'create_rite_from_type').length, 6, 'repeat routing never duplicates rite objects');
assert.equal(env.globalLists.get('mm_dragon_blood_members').length, 1, 'mixed blood registry is idempotent');
env.rites.get('mm_dragon_sea').faith = 'faith:former_sea';
const sea = blood('saved-mixed-sea', 'sea');
h.run('mm_dragon_route_creed_effect', sea, env);
assert.equal(sea.faith, 'faith:mm_dragon_creed', 'setting a rite cannot restore its former independent faith');
assert.equal(env.calls.filter(call => call.effect === 'set_parent_faith').length, 1);
h.run('mm_dragon_route_creed_effect', sea, env);
assert.equal(env.calls.filter(call => call.effect === 'set_parent_faith').length, 1, 'parent binding is not repeated for every member');
for (const grade of ['mm_dragon_half', 'mm_dragon_lineage_1', 'mm_dragon_lineage_2', 'mm_dragon_lineage_3', 'mm_dragon_lineage_4', 'mm_dragon_black_blood']) {
  for (const branch of branches) {
    const character = blood(`${grade}-${branch}`, branch, grade);
    h.run('mm_dragon_route_creed_effect', character, env);
    assert.equal(character.rite.id, `mm_dragon_${branch}`);
    assert.equal(character.faith, 'faith:mm_dragon_creed');
  }
}
const multi = blood('mixed-multiple', 'fire');
multi.vars.set('mm_dragon_bio_sea', true);
multi.rite = env.rites.get('mm_dragon_sea');
h.run('mm_dragon_route_creed_effect', multi, env);
assert.equal(multi.rite.id, 'mm_dragon_sea', 'retain any biologically valid branch already chosen');
const absorbed = blood('absorbed-is-not-origin', 'earth');
absorbed.vars.set('mm_dragon_absorbed_fire', true);
absorbed.rite = env.rites.get('mm_dragon_fire');
h.run('mm_dragon_route_creed_effect', absorbed, env);
assert.equal(absorbed.rite.id, 'mm_dragon_earth');
const ordinary = h.character('ordinary', { faith: 'faith:catholic', vars: { mm_dragon_absorbed_sea: true } });
h.run('mm_dragon_route_creed_effect', ordinary, env);
assert.equal(ordinary.faith, 'faith:catholic');
assert.ok(!env.globalLists.get('mm_dragon_blood_members').includes(ordinary));
const unknown = h.character('unknown-origin', { traits: ['mm_dragon_lineage_3'], faith: 'faith:catholic' });
h.run('mm_dragon_route_creed_effect', unknown, env);
assert.equal(unknown.faith, 'faith:mm_dragon_creed');
assert.ok(unknown.flags.has('mm_dragon_creed_origin_unknown'));

const actionText = read('patches/dragon-creed/mod/common/on_action/mm_dragon_creed_migration.txt');
const actions = h.parsePdx(actionText, 'migration');
const monthly = h.first(actions.find(node => node.key === 'mm_dragon_creed_monthly_v1311').value, 'effect').value;
h.scriptedEffects.set('test_monthly_route', monthly);
fire.faith = 'faith:catholic';
h.run('test_monthly_route', fire, env);
assert.equal(fire.faith, 'faith:mm_dragon_creed', 'monthly repair includes a mixed human outside the native living wyvern list');
assert.match(actionText, /mm_v1313_repair_saved_creed_effect = yes[\s\S]*every_living_character/);
assert.match(actionText, /on_character_created/);
assert.equal((actionText.match(/every_living_character/g) || []).length, 1, 'no monthly world scan');
const repair = read('patches/dragon-creed/mod/common/scripted_effects/mm_v1313_faith_repair.txt');
for (const branch of branches) {
  assert.ok(repair.includes(`exists = faith:mm_dragon_${branch}`));
  assert.ok(repair.includes(`exists = rite:mm_dragon_legacy_${branch}`));
  assert.ok(repair.includes(`set_county_rite = rite:mm_dragon_${branch}`));
}
assert.ok(repair.includes('include_derived = no'));
assert.equal((repair.match(/set_character_faith = faith:mm_dragon_creed set_character_rite/g) || []).length, 6, 'legacy non-blood adherents migrate both faith and rite');
assert.ok(repair.includes('remove_rite_doctrine = doctrine_funeral_stoic'));
assert.ok(repair.includes('add_rite_doctrine = mm_doctrine_funeral_sea'));
assert.doesNotMatch(repair, /\b(?:remove_doctrine|add_doctrine) =/);
// Global filename order must leave the active bridge after the optional no-op.
const definitions = [];
for (const module of ['wyvern-bloodline', 'dragon-creed']) {
  const directory = path.join(root, 'patches', module, 'mod/common/scripted_effects');
  for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.txt'))) {
    for (const node of h.parsePdx(fs.readFileSync(path.join(directory, file), 'utf8'), file)) {
      if (node.key === 'mm_dragon_route_creed_hook_effect') definitions.push({ file, value: node.value });
    }
  }
}
definitions.sort((a, b) => a.file.localeCompare(b.file, 'en'));
assert.equal(definitions.at(-1).value[0].key, 'mm_dragon_route_creed_effect');
const lineage = read('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_lineage.txt');
assert.match(lineage, /mm_dragon_route_creed_hook_effect = yes/);
const seeds = read('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_lineage_initialization.txt');
assert.equal((seeds.match(/mm_dragon_route_creed_hook_effect = yes/g) || []).length, 2);
console.log('v1.3.13 runtime-object routing finite checks passed (CK3 engine acceptance remains separate)');

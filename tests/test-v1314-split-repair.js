'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v1311-finite-helper');
const root = path.resolve(__dirname, '..');
const h = createHarness(['wyvern-bloodline', 'wyvern-kings', 'dragon-creed']);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const branches = ['black', 'white', 'fire', 'earth', 'sea', 'sky'];
const types = h.parsePdx(read('patches/dragon-creed/mod/common/religion/rite_types/mm_dragon_creed.txt'), 'rites');
const env = h.environment();
for (const branch of branches) {
  const rite = env.rites.get(`mm_dragon_${branch}`);
  const definition = types.find(type => type.key === rite.id).value;
  rite.tenets = new Set(Array.from(h.first(definition, 'tenets').value, item => item.key));
  rite.doctrines = new Set([`mm_doctrine_${branch === 'black' ? 'white' : 'black'}`]);
  rite.faith = 'faith:old_split';
}
const before = h.character('unaffected-catholic-founder', { faith: 'faith:catholic' });
h.run('mm_v1313_ensure_rites_effect', before, env);
assert.equal(before.faith, 'faith:catholic', 'ensure does not convert the character used to create missing rite objects');
for (const branch of branches) {
  const rite = env.rites.get(`mm_dragon_${branch}`);
  assert.equal(rite.faith, 'faith:mm_dragon_creed');
  assert.deepEqual([...rite.doctrines], [`mm_doctrine_${branch}`], 'restore stripped special doctrine and remove the wrong one');
}
const calls = env.calls.length;
h.run('mm_v1313_ensure_rites_effect', before, env);
assert.equal(env.calls.length, calls, 'stable bindings do not reparent again');
for (const branch of branches) {
  const splitFaith = `faith:dynamic_split_${branch}`;
  env.faithReligions.set(splitFaith, 'religion:mm_dragon_creed_religion');
  for (const kind of ['character', 'county']) {
    const target = h.character(`${kind}-${branch}`, { faith: splitFaith });
    target.rite = { id: `dynamic_${branch}`, tenets: new Set(env.rites.get(`mm_dragon_${branch}`).tenets) };
    h.run(`mm_v1314_migrate_split_${kind}_effect`, target, env);
    assert.equal(target.faith, 'faith:mm_dragon_creed');
    assert.equal(target.rite.id, `mm_dragon_${branch}`, 'keep the matching branch rather than assigning every split follower to the main rite');
    h.run(`mm_v1314_migrate_split_${kind}_effect`, target, env);
    assert.equal(target.rite.id, `mm_dragon_${branch}`, 'second repair remains unchanged');
  }
}
env.faithReligions.set('faith:catholic', 'religion:christianity_religion');
for (const kind of ['character', 'county']) {
  const foreign = h.character(`foreign-${kind}`, { faith: 'faith:catholic' });
  foreign.rite = { id: 'foreign-with-copied-tenet', tenets: new Set(['mm_tenet_fire']) };
  h.run(`mm_v1314_migrate_split_${kind}_effect`, foreign, env);
  assert.equal(foreign.faith, 'faith:catholic', 'a foreign religion is never converted just because a tenet key matches');
  assert.equal(foreign.rite.id, 'foreign-with-copied-tenet');
  const unrelated = h.character(`unrelated-${kind}`, { faith: 'faith:unrelated_dragon_custom' });
  env.faithReligions.set(unrelated.faith, 'religion:mm_dragon_creed_religion');
  unrelated.rite = { id: 'unrelated-custom-rite', tenets: new Set(['tenet_ancestor_worship']) };
  h.run(`mm_v1314_migrate_split_${kind}_effect`, unrelated, env);
  assert.equal(unrelated.faith, 'faith:unrelated_dragon_custom', 'unmatched custom doctrines do not pick an arbitrary dragon branch');
}
const effects = h.scriptedEffects.get('mm_v1314_refresh_doctrine_modifiers_effect');
assert.ok(effects);
const raw = JSON.stringify(effects);
assert.doesNotMatch(raw, /change_spiritual_fulfillment|add_gold|add_prestige|add_piety|add_legitimacy/, 'read-time modifier projection must never replay rewards');
console.log('v1.3.14 split character/county migration and stripped doctrine repair finite checks passed; no CK3 engine result claimed');

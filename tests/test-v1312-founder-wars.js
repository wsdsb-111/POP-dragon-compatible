'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v1311-finite-helper');
const h = createHarness(['dragon-creed']);
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const def = h.scriptedTriggers.get('mm_v1312_is_valid_religious_war_target_trigger');
assert.ok(def);
function check(nodes, character, target, nativeAllowed) {
  return nodes.every(n => {
    if (n.key === 'OR') return n.value.some(v => check([v], character, target, nativeAllowed));
    if (n.key === 'AND') return check(n.value, character, target, nativeAllowed);
    if (n.key === 'is_valid_religious_war_target_trigger') return nativeAllowed;
    if (n.key === '$TARGET$') return check(n.value, target, target, nativeAllowed);
    if (n.key === 'faith') return character.faith === n.value;
    if (n.key === 'rite' && !Array.isArray(n.value)) return character.rite === n.value;
    if (n.key === 'rite') return check(n.value, character, target, nativeAllowed);
    if (n.key === 'rite_has_doctrine') return character.doctrines.includes(n.value);
    throw new Error('unsupported finite war predicate ' + n.key);
  });
}
const black = { faith: 'faith:mm_dragon_creed', rite: 'rite:mm_dragon_black', doctrines: ['mm_doctrine_black'] };
for (const branch of ['fire', 'earth', 'sea', 'sky', 'white']) {
  const target = { faith: black.faith, rite: `rite:mm_dragon_${branch}`, doctrines: [] };
  assert.equal(check(def, black, target, false), true);
  assert.equal(check(def, target, black, false), false, 'reverse direction keeps native restriction');
  assert.equal(check(def, { ...black, doctrines: [] }, target, false), false);
  assert.equal(check(def, black, { ...target, faith: 'faith:other' }, false), false);
}
assert.equal(check(def, black, black, false), false, 'own rite is excluded');
assert.equal(check(def, { ...black, rite: 'rite:custom' }, black, true), true, 'every original allowed target remains allowed');
const cb = read('patches/dragon-creed/mod/common/casus_belli_types/zzzzzz_mm_v1312_religious_wars.txt');
assert.equal((cb.match(/mm_v1312_is_valid_religious_war_target_trigger = \{ TARGET = scope:defender \}/g) || []).length, 3);
assert.equal((cb.match(/(?:^|\s)is_valid_religious_war_target_trigger = \{/g) || []).length, 0);
console.log('v1.3.12 founder target extension finite checks passed; all other CB checks are preserved separately');

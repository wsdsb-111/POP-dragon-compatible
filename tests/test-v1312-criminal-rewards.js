'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../patches/dragon-creed/mod/common/on_action/mm_v1312_criminal_rewards.txt'), 'utf8');
const helperPath = path.join(__dirname, 'wyvern-v1311-finite-helper.js');
let helper = fs.readFileSync(helperPath, 'utf8');
function insertBefore(needle, addition) {
  assert.ok(helper.includes(needle), `helper boundary: ${needle}`);
  helper = helper.replace(needle, addition + '\n' + needle);
}
insertBefore('      if (raw === "root") return env.root;', '      if (raw === "root.dynasty") return env.root?.dynasty;');
insertBefore('      if (key === "can_add_hook")', `      if (key === "has_imprisonment_reason") return current.imprisonReasons?.has(atom(operand, current, env, parameters)) === true;
      if (key === "has_any_criminal_trait_in_rite_trigger") return current.criminalForRites?.has(atom(scalar(operand, "RITE", key), current, env, parameters)) === true;`);
insertBefore('      if (key === "add_hook")', `      if (key === "dynasty" && Array.isArray(operand)) { scoped(current.dynasty, current, env, next => executeEffectSequence(operand, next, env, parameters)); return; }
      if (key === "add_dynasty_prestige") { current.prestige += Number(operand); return; }
      if (key === "change_spiritual_fulfillment") { current.fulfillment = (current.fulfillment || 0) + Number(operand); return; }`);
const compiled = new Module(helperPath, module);
compiled.filename = helperPath; compiled.paths = module.paths; compiled._compile(helper, helperPath);
const h = compiled.exports.createHarness(['dragon-creed']);
const definitions = h.parsePdx(source);
const hook = h.first(definitions, 'on_death');
assert.ok(JSON.stringify(hook.value).includes('mm_v1312_fire_dynasty_criminal_killed'));
const effect = h.first(h.first(definitions, 'mm_v1312_fire_dynasty_criminal_killed').value, 'effect').value;
h.scriptedEffects.set('qa_criminal_death', effect);
function check({ sameDynasty = true, reason = false, traitCrime = false, servant = false, rite = 'mm_dragon_fire', killerPresent = true, samePerson = false, expected = 0 }) {
  const dynasty = { prestige: 0 }, otherDynasty = { prestige: 0 };
  const victim = h.character('victim', { traits: servant ? ['mm_dragon_death_servant'] : [] });
  const killer = samePerson ? victim : h.character('killer');
  killer.dynasty = dynasty; victim.dynasty = sameDynasty ? dynasty : otherDynasty;
  killer.rite = { id: rite }; killer.imprisonReasons = new Set(reason ? [victim] : []);
  victim.criminalForRites = new Set(traitCrime ? [killer.rite] : []);
  const env = h.environment({ root: victim, scopes: killerPresent ? { killer } : {} });
  h.run('qa_criminal_death', victim, env);
  assert.equal(dynasty.prestige, expected);
  assert.equal(killer.fulfillment || 0, expected ? 10 : 0);
}
check({ reason: true, expected: 200 });
check({ traitCrime: true, expected: 200 });
check({ reason: true, traitCrime: true, expected: 200 });
check({});
check({ reason: true, sameDynasty: false });
check({ reason: true, servant: true });
check({ reason: true, rite: 'mm_dragon_white' });
check({ reason: true, killerPresent: false });
check({ reason: true, samePerson: true });
console.log('V1.3.12 dynasty criminal reward checks passed');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'patches/dragon-creed/mod/common/scripted_effects/zzzz_mm_v1312_activity_rewards.txt');
const patched = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
const nativeDir = 'D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/scripted_effects';
function definition(text, name) {
  text = text.replace(/\r\n/g, '\n');
  const start = text.indexOf(`${name} = {`);
  assert.ok(start >= 0, `missing ${name}`);
  let depth = 0, quoted = false, comment = false;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') comment = false;
    else if (comment) continue;
    else if (ch === '"' && text[i - 1] !== '\\') quoted = !quoted;
    else if (!quoted && ch === '#') comment = true;
    else if (!quoted && ch === '{') depth++;
    else if (!quoted && ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}
for (const [file, name, tail] of [
  ['00_romance_effects.txt', 'had_sex_with_effect', '\t# V1.3.12: both participants are saved by the original effect.\n\tmm_v1312_sea_sex_reward_effect = yes\n'],
  ['pam_effects.txt', 'pam_vows_of_poverty_host_completion_piety_effect', '\t# V1.3.12: activity-owned deduplication is independent of the poverty vow.\n\tmm_v1312_earth_funeral_reward_effect = yes\n']
]) {
  const actual = definition(patched, name);
  assert.ok(actual.endsWith(tail + '}'), `exact appended tail for ${name}`);
  const original = definition(fs.readFileSync(path.join(nativeDir, file), 'utf8'), name);
  assert.equal(actual.slice(0, -tail.length - 1) + '}', original, `unmodified native body of ${name}`);
}

// Adapt the finite harness locally for activity type, spiritual fulfillment and legitimacy.
// This executes the actual appended PDX effect bodies, not the native CK3 engine.
const helperPath = path.join(__dirname, 'wyvern-v1311-finite-helper.js');
let helper = fs.readFileSync(helperPath, 'utf8');
// The base adapter assumes set_variable is a block; CK3 also allows a bare flag name.
const variableNeedle = '      if (key === "set_variable" && Array.isArray(first(operand, "value")?.value)) {';
assert.ok(helper.includes(variableNeedle));
helper = helper.replace(variableNeedle, '      if (key === "set_variable" && !Array.isArray(operand)) { current.vars.set(operand, true); return; }\n' + variableNeedle);

const triggerNeedle = '      if (key === "can_add_hook")';
assert.ok(helper.includes(triggerNeedle));
helper = helper.replace(triggerNeedle, '      if (key === "has_activity_type") return current.activityType === operand;\n' + triggerNeedle);
const effectNeedle = '      if (key === "add_hook")';
assert.ok(helper.includes(effectNeedle));
helper = helper.replace(effectNeedle, `      if (key === "change_spiritual_fulfillment") { current.fulfillment = (current.fulfillment || 0) + Number(operand); return; }
      if (key === "add_legitimacy") { current.legitimacy = (current.legitimacy || 0) + Number(operand); return; }
` + effectNeedle);
const compiled = new Module(helperPath, module);
compiled.filename = helperPath; compiled.paths = module.paths; compiled._compile(helper, helperPath);
const h = compiled.exports.createHarness(['dragon-creed']);
function character(id, rite, alive = true, age = 30) {
  const c = h.character(id, { alive, age, piety: 0, prestige: 0 });
  c.rite = { id: rite }; c.fulfillment = 0; c.legitimacy = 0;
  return c;
}
function runSex(a, b) {
  const env = h.environment({ scopes: { had_sex_root_character: a, had_sex_with_effect_partner: b } });
  h.run('mm_v1312_sea_sex_reward_effect', a, env);
}
{
  const a = character('a', 'mm_dragon_sea'), b = character('b', 'mm_dragon_sea');
  runSex(a, b); assert.equal(a.fulfillment, 5); assert.equal(b.fulfillment, 5);
}
{
  const a = character('a', 'mm_dragon_sea'), b = character('b', 'mm_dragon_white');
  runSex(a, b); assert.equal(a.fulfillment, 5); assert.equal(b.fulfillment, 0);
}
for (const [same, alive, age] of [[true, true, 30], [false, false, 30], [false, true, 12]]) {
  const a = character('a', 'mm_dragon_sea'), b = same ? a : character('b', 'mm_dragon_sea', alive, age);
  runSex(a, b); assert.equal(a.fulfillment, 0); assert.equal(b.fulfillment, 0);
}
function runFuneral(host, activity, caller = host) {
  const env = h.environment({ scopes: { host, activity } });
  h.run('mm_v1312_earth_funeral_reward_effect', caller, env);
}
{
  const host = character('host', 'mm_dragon_earth');
  const activity = character('activity', 'none'); activity.activityType = 'activity_funeral';
  runFuneral(host, activity); runFuneral(host, activity);
  assert.equal(host.prestige, 150); assert.equal(host.piety, 150); assert.equal(host.legitimacy, 100);
  assert.ok(host.modifiers.has('mm_v1311_earth_birth_1'));
  assert.ok(!host.modifiers.has('mm_v1311_earth_birth_2'));
  assert.ok(activity.vars.has('mm_v1312_earth_funeral_rewarded'));
}
for (const [rite, type, callerIsHost] of [
  ['mm_dragon_earth', 'activity_feast', true],
  ['mm_dragon_sea', 'activity_funeral', true],
  ['mm_dragon_earth', 'activity_funeral', false]
]) {
  const host = character('host', rite), activity = character('activity', 'none'); activity.activityType = type;
  runFuneral(host, activity, callerIsHost ? host : character('guest', 'mm_dragon_earth'));
  assert.equal(host.prestige, 0); assert.equal(host.piety, 0); assert.equal(host.legitimacy, 0);
  assert.equal(activity.vars.has('mm_v1312_earth_funeral_rewarded'), false);
}
console.log('V1.3.12 activity rewards checks passed');

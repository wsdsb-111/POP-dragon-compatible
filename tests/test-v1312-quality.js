'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const native = fs.readFileSync('D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/scripted_effects/00_ep1_artifact_creation_effects.txt', 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(root, 'patches/dragon-creed/mod/common/scripted_effects/zzzz_mm_v1312_quality.txt'), 'utf8').replace(/\r\n/g, '\n');
function definition(text, name) {
  const start = text.indexOf(`${name} = {`); assert.ok(start >= 0);
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
const suffix = '\t# V1.3.12: after native quality and wealth have been determined.\n\tmm_v1312_fire_equipment_quality_effect = yes\n';
const actual = definition(source, 'get_artifact_wealth_effect');
assert.ok(actual.endsWith(suffix + '}'));
assert.equal(actual.slice(0, -suffix.length - 1) + '}', definition(native, 'get_artifact_wealth_effect'));
assert.match(native, /get_artifact_quality_effect = yes\s+get_artifact_wealth_effect = yes/);
const defines = fs.readFileSync('D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/defines/00_defines.txt', 'utf8');
for (const [name, n] of [['MASTERWORK', 50], ['FAMED', 130], ['ILLUSTRIOUS', 180]]) assert.match(defines, new RegExp(`ARTIFACT_THRESHOLD_${name}\\s*=\\s*${n}\\b`));

const helperPath = path.join(__dirname, 'wyvern-v1311-finite-helper.js');
let helper = fs.readFileSync(helperPath, 'utf8');
function insertBefore(needle, code) { assert.ok(helper.includes(needle)); helper = helper.replace(needle, code + '\n' + needle); }
insertBefore('      if (key === "can_add_hook")', `      if (key === "ep1_character_had_or_has_inspiration_type_trigger") return current.inspirationType === scalar(operand, "TYPE", key);`);
insertBefore('      if (key === "add_hook")', `      if (key === "save_scope_value_as") {
        const value = first(operand, "value").value;
        env.scopes[scalar(operand, "name", key)] = Array.isArray(value) ? computedValue(value, current, env, parameters) : atom(value, current, env, parameters);
        return;
      }`);
const compiled = new Module(helperPath, module); compiled.filename = helperPath; compiled.paths = module.paths; compiled._compile(helper, helperPath);
const h = compiled.exports.createHarness(['dragon-creed']);
function trial({ quality = 20, wealth = 20, fire = true, success = true, type = 'weapon', equalOwner = true, adventurer = false } = {}) {
  const sponsor = h.character('sponsor'); sponsor.rite = { id: fire ? 'mm_dragon_fire' : 'mm_dragon_white' };
  const maker = h.character('maker'); maker.inspirationType = type;
  const owner = equalOwner ? sponsor : h.character('owner');
  const scopes = { quality, wealth, owner, inspiration_owner: maker, inspiration_sponsor: sponsor };
  if (adventurer) scopes.adventurer = h.character('adventurer');
  if (type === 'weapon') { scopes.weapon_type = 'flag:sword'; scopes.smith = maker; }
  else if (type === 'armor') { scopes.armor_type = 'flag:armor'; scopes.smith = maker; }
  else if (type === 'bow') { scopes.bow_type = 'flag:bow'; scopes.bowyer = maker; }
  const env = h.environment({ scopes, randomChoices: [success] });
  h.run('mm_v1312_fire_equipment_quality_effect', owner, env);
  const result = { quality: env.scopes.quality, wealth: env.scopes.wealth, rolls: env.randomRolls.length, env, owner };
  return result;
}
for (const type of ['weapon', 'armor', 'bow']) {
  let r = trial({ type, quality: 20, wealth: 20 }); assert.equal(r.quality, 30); assert.equal(r.wealth, 20);
  r = trial({ type, quality: 50, wealth: 40 }); assert.equal(r.quality, 90); assert.equal(r.wealth, 40);
}
assert.equal(trial({ success: false }).quality, 20);
assert.equal(trial({ quality: 80, wealth: 60 }).quality, 80);
assert.equal(trial({ quality: 95, wealth: 90 }).quality, 95);
assert.equal(trial({ fire: false }).quality, 20);
assert.equal(trial({ equalOwner: false }).quality, 20);
assert.equal(trial({ adventurer: true }).quality, 20);
for (const [quality, wealth, expectedQuality, expectedWealth] of [
  [49, 0, 50, 0], [50, 0, 100, 30], [100, 29, 100, 30], [100, 30, 100, 30], [0, 0, 50, 0], [51, 29, 100, 30]
]) {
  const r = trial({ quality, wealth });
  assert.equal(r.quality, expectedQuality);
  assert.equal(r.wealth, expectedWealth);
}
const once = trial(); h.run('mm_v1312_fire_equipment_quality_effect', once.owner, once.env);
assert.equal(once.env.randomRolls.length, 1); assert.equal(once.env.scopes.quality, 30);
let promotions = 0;
for (let i = 0; i < 100; i++) {
  const r = trial({ success: i < 30 });
  assert.equal(r.env.randomRolls[0].chance, 30);
  if (r.quality !== 20) promotions++;
}
assert.equal(promotions, 30);
for (const [quality, wealth] of [[0, 150], [150, 0], [20, 120], [100, 999]]) {
  const r = trial({ quality, wealth });
  assert.equal(r.rolls, 0, 'native high score must not be reclassified after clamping');
  assert.equal(r.quality, quality); assert.equal(r.wealth, wealth);
}
for (const [quality, wealth, expectedQuality] of [[10, 110, 20], [0, 120, 10]]) {
  const r = trial({ quality, wealth });
  assert.equal(r.quality, expectedQuality);
  assert.equal(r.wealth, wealth);
  assert.equal(r.quality + r.wealth, 130, 'raw native wealth needs only the minimum promotion');
}
console.log('V1.3.12 equipment quality checks passed');

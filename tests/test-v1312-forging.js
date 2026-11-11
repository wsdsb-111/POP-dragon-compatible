'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const nativePath = 'D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/inspirations/00_inspirations.txt';
const changed = read(path.join(root, 'patches/dragon-creed/mod/common/inspirations/zzzz_mm_v1312_forging.txt')).trim();
const vanilla = read(nativePath);
function definition(text, name) {
  const start = text.indexOf(`${name} = {`);
  assert.ok(start >= 0);
  let depth = 0, quote = false, comment = false;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    const c = text[i];
    if (c === '\n') comment = false;
    else if (comment) continue;
    else if (c === '"' && text[i - 1] !== '\\') quote = !quote;
    else if (!quote && c === '#') comment = true;
    else if (!quote && c === '{') depth++;
    else if (!quote && c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unterminated inspiration');
}
const inserted = '\t\t# V1.3.12: optional additional fire-rite progress after native monthly effects.\n\t\tmm_v1312_fire_weapon_monthly_effect = yes\n';
assert.equal(changed.split(inserted).length, 2);
assert.equal(changed.replace(inserted, ''), definition(vanilla, 'weapon_inspiration'));
assert.match(changed, /progress_chance\s*=\s*75/);

// Adapt only the primitives this fixture needs; actual handler body comes from disk.
const helperPath = path.join(__dirname, 'wyvern-v1311-finite-helper.js');
let helper = fs.readFileSync(helperPath, 'utf8');
function insertBefore(needle, text) {
  assert.ok(helper.includes(needle), `helper boundary ${needle}`);
  helper = helper.replace(needle, text + '\n' + needle);
}
insertBefore('      if (raw === "root") return env.root;', '      if (raw === "inspiration") return current.inspiration;');
insertBefore('      if (key === "can_add_hook")', `      if (key === "has_inspiration_type") return current.inspirationType === operand;
      if (key === "ep1_is_sponsor_valid_inspiration_basic") return current.sponsorValid === true;`);
insertBefore('      if (key === "add_hook")', '      if (key === "change_inspiration_progress") { current.inspiration_progress += Number(operand); return; }');
const compiled = new Module(helperPath, module); compiled.filename = helperPath; compiled.paths = module.paths; compiled._compile(helper, helperPath);
const h = compiled.exports.createHarness(['dragon-creed']);
function trial(options = {}) {
  const sponsor = h.character('sponsor', { alive: options.sponsorAlive !== false });
  sponsor.rite = { id: options.rite || 'mm_dragon_fire' };
  const owner = h.character('owner', { alive: options.ownerAlive !== false });
  const inspiration = h.character('inspiration');
  inspiration.inspirationType = options.type || 'weapon_inspiration';
  inspiration.inspiration_progress = options.progress ?? 0;
  inspiration.sponsorValid = options.sponsorValid !== false;
  owner.inspiration = options.detached ? undefined : inspiration;
  const env = h.environment({ scopes: { inspiration, inspiration_owner: owner, inspiration_sponsor: sponsor }, randomChoices: [options.roll ?? true] });
  h.run('mm_v1312_fire_weapon_monthly_effect', inspiration, env);
  return { progress: inspiration.inspiration_progress, rolls: env.randomRolls };
}
assert.equal(trial().progress, 1);
assert.equal(trial({ roll: false }).progress, 0);
for (const options of [{ rite: 'mm_dragon_white' }, { ownerAlive: false }, { sponsorAlive: false }, { type: 'armor_inspiration' }, { progress: 10 }, { detached: true }, { sponsorValid: false }]) {
  const result = trial(options);
  assert.equal(result.progress, options.progress ?? 0);
  assert.equal(result.rolls.length, 0);
}
let additional = 0;
for (let i = 0; i < 100; i++) {
  const result = trial({ roll: i < 30 });
  assert.equal(result.rolls[0].chance, 30);
  additional += result.progress;
}
assert.equal(additional, 30);
assert.equal((75 + additional) / 75, 1.4, 'expected monthly progress rate before completion');
console.log('V1.3.12 forging checks passed');

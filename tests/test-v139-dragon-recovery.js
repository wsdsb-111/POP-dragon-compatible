const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const text = read('patches/dragon-recovery/mod/common/scripted_effects/zzzzzzzzzzzz_mm_dragon_recovery.txt');
function block(text, name) {
  const start = text.indexOf(name + ' = {'); assert.ok(start >= 0, name); let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) { if (text[i] === '{') depth++; if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1); }
  throw Error(name);
}
const original = block(read('patches/wyvern-kings/mod/common/scripted_effects/zzzzzzzz_mm_royal_combat_effects.txt'), 'mm_royal_native_recovery_effect');
function withoutStormBonus(effect, rate) {
  const marker = '    if = {\n        limit = { rite = rite:mm_dragon_sky }\n';
  const start = effect.indexOf(marker);
  assert.ok(start >= 0 && effect.indexOf(marker, start + 1) < 0, 'one sky recovery block');
  const endMarker = '        }\n    }\n';
  const end = effect.indexOf(endMarker, start);
  assert.ok(end >= 0, 'closed sky recovery block');
  const actual = effect.slice(start, end + endMarker.length);
  const originalTrackLines = effect.slice(end + endMarker.length).split('\n').filter(line =>
    line.includes('has_trait_xp') && line.includes('add_trait_xp') && line.includes(`value = -${rate} }`));
  assert.equal(originalTrackLines.length, 7, 'seven preserved native recovery tracks');
  const bonusLines = originalTrackLines.map(line => line.replace(`value = -${rate} }`, 'value = -1 }')).join('\n');
  const expected = `    if = {
        limit = { rite = rite:mm_dragon_sky }
        if = { limit = { NOT = { has_variable = mm_creed_recovery_remainder } } set_variable = { name = mm_creed_recovery_remainder value = 0 } }
        change_variable = { name = mm_creed_recovery_remainder add = ${rate} }
        if = {
            limit = { var:mm_creed_recovery_remainder >= 10 }
            change_variable = { name = mm_creed_recovery_remainder subtract = 10 }
${bonusLines}
        }
    }
`;
  assert.equal(actual, expected, 'exact reviewed recovery bonus, tracks and integer remainder');
  return effect.slice(0, start) + effect.slice(end + endMarker.length);
}
const royal = withoutStormBonus(block(text, 'mm_royal_native_recovery_effect'), 1);
const ordinary = withoutStormBonus(block(text, 'mm_dragon_ordinary_monthly_recovery_effect'), 5);
assert.equal(royal.replace('    if = {\n    limit = { always = yes }\n    if = { limit = { has_trait_xp', '    else = {\n    if = { limit = { has_trait_xp'), original);
assert.equal(ordinary.replace('mm_dragon_ordinary_monthly_recovery_effect', 'mm_royal_native_recovery_effect').replace(/value = -5 }/g, 'value = -1 }'), royal);
const tracks = [
  ['myv_wyvern_eye_injuries','myv_wyvern_wound_left_eye'], ['myv_wyvern_eye_injuries','myv_wyvern_wound_right_eye'],
  ['myv_wyvern_wing_injuries','myv_wyvern_wound_left_wing'], ['myv_wyvern_wing_injuries','myv_wyvern_wound_right_wing'],
  ['myv_wyvern_hindleg_injuries','myv_wyvern_wound_left_hindleg'], ['myv_wyvern_hindleg_injuries','myv_wyvern_wound_right_hindleg'],
  ['myv_wyvern_tail_injury', null]
];
for (const [effect, rate] of [[ordinary,5], [royal,1]]) {
  const found = [...effect.matchAll(/if = \{ limit = \{ has_trait_xp = \{ trait = (\w+)(?: track = (\w+))? value > 0 \} \} add_trait_xp = \{ trait = (\w+)(?: track = (\w+))? value = -(\d+) \} \}/g)];
  assert.equal(found.length, 7); const fixture = Object.fromEntries(tracks.map(([, track],i) => [track || 'tail', i+3]));
  for (const [trait, track] of tracks) { const m = found.find(x => x[1] === trait && (x[2] || null) === track); assert.ok(m, `${trait} ${track}`); assert.equal(m[3],trait); assert.equal(m[4] || null,track); assert.equal(Number(m[5]),rate); const key=track || 'tail'; fixture[key]=Math.max(0,fixture[key]-Number(m[5])); }
  assert.equal(fixture.myv_wyvern_wound_left_eye, Math.max(0,3-rate)); assert.equal(fixture.myv_wyvern_wound_right_wing, Math.max(0,6-rate));
  assert.match(effect,/remove_trait = myv_wyvern_eye_injuries/); assert.match(effect,/remove_trait = myv_wyvern_wing_injuries/); assert.match(effect,/remove_trait = myv_wyvern_hindleg_injuries/); assert.match(effect,/remove_trait = myv_wyvern_tail_injury/);
}
assert.match(block(text,'myv_wyvern_monthly_combat_injury_recovery_effect'),/mm_royal_is_king = no.*mm_dragon_ordinary_monthly_recovery_effect = yes/s);
assert.match(read('patches/wyvern-kings/mod/events/mm_royal_events.txt'),/mm_royal_is_king = yes[^]*mm_royal_native_recovery_effect = yes/);
console.log('seven concurrent injury tracks and monthly/daily gates passed');

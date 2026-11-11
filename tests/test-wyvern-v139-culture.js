const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const culture = read('patches/dragon-culture/mod/common/culture/cultures/myv_wyvern_culture.txt');
assert.strictEqual((culture.match(/tradition_[a-z_]+/g) || []).length, 6);
assert.match(culture, /ethnicities\s*=\s*\{\s*1\s*=\s*caucasian/);
const natural = read('patches/dragon-culture/mod/common/scripted_effects/zzzzzzzzzz_mm_dragon_natural_spawn.txt');
for (const id of ['99001001', '99001305', '99001002', '99001306', '99001003', '99001307', '99001304', '99001308']) assert.strictEqual((natural.match(new RegExp('set_relation_mm_dragon_creator = character:' + id, 'g')) || []).length, 2);
assert.strictEqual((natural.match(/mm_dragon_assign_regional_identity_effect = yes/g) || []).length, 2);
const maintenance = read('patches/wyvern-ascension/mod/common/scripted_effects/zzzzzzzzzz_mm_ascension_maintenance.txt');
assert.doesNotMatch(maintenance, /set_culture = culture:myv_wyvern_culture|set_character_faith = faith:pagan/);
const identity = read('patches/dragon-culture/mod/common/scripted_effects/mm_dragon_regional_identity.txt');
assert.match(identity, /NOT = \{ has_character_flag = mm_dragon_regional_identity_assigned \}/);
for (const kind of ['fire', 'earth', 'sea', 'sky', 'black', 'white']) {
  assert.match(identity, new RegExp('set_character_faith = faith:mm_dragon_creed\\s+set_character_rite = rite:mm_dragon_' + kind));
  assert.match(identity, new RegExp('set_character_rite = rite:mm_dragon_' + kind));
}
console.log('v139 culture static checks passed');
const { createHarness } = require('./wyvern-v134-finite-helper');
const parser = createHarness([]);
const parse = p => parser.parsePdx(read(p), p);
const bootstrap = parse('patches/wyvern-kings/mod/common/scripted_effects/mm_royal_identity_effects.txt')[0].value[0].value;
const royals = [['99001001',1],['99001305',1],['99001002',2],['99001306',2],['99001003',3],['99001307',3],['99001304',4],['99001308',4]];
for (const [id, throne] of royals) {
  const character = bootstrap.find(n => n.key === 'character:' + id); assert.ok(character, id);
  const vars = character.value.filter(n => n.key === 'set_variable');
  const throneVar = vars.find(n => n.value.some(x => x.key === 'name' && x.value === 'mm_royal_throne'));
  assert.equal(Number(throneVar.value.find(x => x.key === 'value').value), throne);
  const keys = character.value.map(n => n.key);
  assert.ok(keys.indexOf('mm_dragon_assign_regional_identity_effect') > keys.indexOf('myv_initialize_historical_wyvern_effect'));
}
for (const n of [1,2,3,4]) assert.match(identity, new RegExp('mm_royal_is_king = yes has_variable = mm_royal_throne var:mm_royal_throne = ' + n));
console.log('v139 all eight historical royals use their fixed thrones for faith');
const regionHarness = createHarness(['dragon-culture']);
const regionCases = [
  ['han', 'heritage_chinese', 'world_asia_east', 'fire'],
  ['persian', 'heritage_iranian', 'world_middle_east_persia', 'fire'],
  ['egyptian', 'heritage_arabic', 'world_africa_north_east', 'earth'],
  ['ancient_egyptian', 'heritage_egyptian', 'world_africa_north_east', 'earth'],
  ['greek', 'heritage_byzantine', 'world_europe_south', 'sea'],
  ['italian', 'heritage_latin', 'world_europe_south', 'sea'],
  ['norse', 'heritage_north_germanic', 'world_europe_north', 'sky'],
  ['swedish', 'heritage_north_germanic', 'world_europe_north', 'sky'],
  ['mongol', 'heritage_mongolic', 'world_asia_east', null],
  ['turkish', 'heritage_turkic', 'world_middle_east_persia', null],
  ['bedouin', 'heritage_arabic', 'world_africa_north_east', null],
  ['han', 'heritage_chinese', 'world_europe_north', null],
];
for (const [id, heritage, region, expected] of regionCases) {
  const province = { id: 'province', culture: { id, pillars: [heritage] }, regions: [region] };
  const env = regionHarness.environment({root: province});
  for (const branch of ['fire', 'earth', 'sea', 'sky']) {
    assert.equal(regionHarness.trigger('mm_dragon_spawn_' + branch + '_region', province, env), branch === expected, id + ' in ' + region + ' / ' + branch);
  }
}
for (const branch of ['fire', 'earth', 'sea', 'sky']) {
  assert.equal((natural.match(new RegExp('mm_dragon_spawn_' + branch + '_region = yes', 'g')) || []).length, branch === 'sky' ? 2 : 4);
  assert.match(read('patches/wyvern-kings/mod/common/scripted_effects/mm_royal_seed_population_effects.txt'), new RegExp('mm_dragon_spawn_' + branch + '_region = yes'));
}
console.log('v139 culture and region routing tests passed');
const history = parse('patches/wyvern-kings/mod/history/characters/myv_historical_wyverns.txt');
const expectedCulture = [
  ['99001001', 'han', 'han'], ['99001002', 'egyptian', 'egyptian'],
  ['99001003', 'greek', 'maghrebi'], ['99001304', 'norse', 'norwegian'],
  ['99001305', 'han', 'han'], ['99001306', 'armenian', 'armenian'],
  ['99001307', 'greek', 'greek'], ['99001308', 'norse', 'norwegian'],
];
function historyCulture(nodes, date) {
  let result = nodes.find(n => n.key === 'culture').value;
  for (const node of nodes) {
    if (!/^\d+\.\d+\.\d+$/.test(node.key) || !Array.isArray(node.value)) continue;
    const dateValue = node.key.split('.').map(Number);
    const packed = dateValue[0] * 10000 + dateValue[1] * 100 + dateValue[2];
    const change = node.value.find(n => n.key === 'culture');
    if (change && packed <= date) result = change.value;
  }
  return result;
}
for (const [id, c867, c1066] of expectedCulture) {
  const nodes = history.find(n => n.key === id).value;
  assert.equal(historyCulture(nodes, 8670101), c867, id + ' culture in 867');
  assert.equal(historyCulture(nodes, 10660915), c1066, id + ' culture in 1066');
  assert.notEqual(historyCulture(nodes, 8670101), 'myv_wyvern_culture');
  assert.ok(nodes.find(n => n.key === 'name').value.startsWith('mm_royal_name_'));
}
for (const id of ['99001309', '99001310']) {
  const nodes = history.find(n => n.key === id).value;
  assert.equal(historyCulture(nodes, 8670101), 'myv_wyvern_culture');
  assert.equal(historyCulture(nodes, 10660915), 'myv_wyvern_culture');
}
console.log('v139 historical dragon cultures follow birthplace in 867 and 1066');
const otherDates = [
  ['99001001','han','han'], ['99001002','egyptian','egyptian'],
  ['99001003','maghrebi','sicilian'], ['99001304','norse','norwegian'],
  ['99001305','han','han'], ['99001306','armenian','georgian'],
  ['99001307','greek','greek'], ['99001308','norwegian','norwegian'],
];
for (const [id, c1047, c1178] of otherDates) {
  const nodes = history.find(n => n.key === id).value;
  assert.equal(historyCulture(nodes, 10470101), c1047, id + ' culture in 1047');
  assert.equal(historyCulture(nodes, 11781001), c1178, id + ' culture in 1178');
}
console.log('v139 historical culture transitions match 1047 and 1178');

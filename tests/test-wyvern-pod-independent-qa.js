'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { detectProfile, enabledModIds } = require('../scripts/select-package-profile');
const { preparePodScript } = require('../scripts/prepare-pod-script');

const root = path.resolve(__dirname, '..');
const readBytes = relative => fs.readFileSync(path.join(root, relative));
const read = relative => normalize(readBytes(relative).toString('utf8'));
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = value => sha256(Buffer.from(value));
const profile = JSON.parse(read('package-profiles.json'))['wyvern-pod'];
const modules = JSON.parse(read('modules.json'));

function block(source, id, topLevel = true) {
  const prefix = topLevel ? '^' : '^[\\t ]*';
  const match = new RegExp(prefix + id + '[\\t ]*=[\\t ]*\\{', 'm').exec(source);
  assert.ok(match, 'missing definition ' + id);
  const open = source.indexOf('{', match.index);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '#') inComment = true;
    else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  assert.fail('unclosed definition ' + id);
}

function guiBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, 'missing GUI block ' + marker);
  assert.equal(source.indexOf(marker, start + marker.length), -1, 'GUI block is unique: ' + marker);
  const open = source.indexOf('{', start + marker.length - 1);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '#') inComment = true;
    else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail('unclosed GUI block ' + marker);
}

function outputPath(record) {
  return path.join(root, 'patches', 'wyvern-pod', record.path.startsWith('mod/') ? record.path : path.posix.join('mod', record.path));
}

function verifyGeneratedOutputs(manifest, packageManifest) {
  for (const record of manifest.outputs) {
    const bytes = fs.readFileSync(outputPath(record));
    assert.equal(sha256(bytes), record.sha256, (manifest.scope || 'receipt') + ': output hash ' + record.path);
    const packageFile = packageManifest.files.find(file => file.path === record.path.replace(/^mod\//, ''));
    assert.ok(packageFile, 'dry-run includes ' + record.path);
    assert.equal(packageFile.source, 'wyvern-pod', 'profile overlay owns ' + record.path);
    const prepared = preparePodScript('wyvern-pod', packageFile.path, bytes);
    assert.equal(packageFile.bytes, prepared.length, 'dry-run prepared byte length ' + record.path);
    assert.equal(packageFile.sha256, sha256(prepared), 'dry-run prepared hash ' + record.path);
  }
}

// Freeze the pre-profile Oriental module map and representative package bytes.
{
  const moduleMap = modules.map(module => [module.id, module.source, module.files || [], module.requires || [], module.mods || []]);
  assert.equal(digest(JSON.stringify(moduleMap)), '4ebc8f671e06a97fcb6451c9f19731600ce6d26e9eebbc7a0ac91441eacabe29', 'default module mapping stays unchanged');
  for (const [moduleId, file, expectedHash] of [
    ['calendar-hud', 'gui/hud.gui', '2b1f8e5ce9f0f395211b94b29f1614e5e1315fa4a7f94ccdafefb8f07c7b0353'],
    ['dragon-map-performance', 'gui/map_icon_layer.gui', '6391de4936d67fccd317a37a573e8de44a9ca2c1b34a15a88a9b21b2efa0b325'],
    ['wyvern', 'gui/window_character.gui', '4d1881a195a939ebcbfc8ff93063def57a68769f66adbb719f1f14410a2cdc7e']
  ]) {
    const sourceModule = modules.find(module => module.id === moduleId);
    assert.ok(sourceModule, 'baseline module ' + moduleId);
    assert.equal(sha256(readBytes(path.posix.join(sourceModule.source, file))), expectedHash, 'Oriental baseline hash ' + file);
  }
}

// Playset selection uses only enabled_mods, not descriptors present on disk.
{
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-wyvern-pod-qa-'));
  try {
    const modDir = path.join(tempRoot, 'mods');
    fs.mkdirSync(modDir);
    const ids = ['3811316052', '2216659254', '2506311074', '2592094512', '3684849062', '3346777360'];
    for (const id of ids) fs.writeFileSync(path.join(modDir, id + '.mod'), 'name="fixture"\nremote_file_id="' + id + '"\n');
    const playsetFile = path.join(tempRoot, 'dlc_load.json');
    const writePlayset = enabled => {
      fs.writeFileSync(playsetFile, JSON.stringify({ enabled_mods: enabled.map(id => 'mods/' + id + '.mod') }));
      return enabledModIds(playsetFile);
    };

    const enabledPod = writePlayset(['3811316052', '2216659254']);
    assert.equal(detectProfile(enabledPod), 'wyvern-pod');
    assert.equal(enabledPod.has('2506311074'), false, 'downloaded Oriental descriptor remains disabled');
    for (const id of ['2506311074', '2592094512', '3684849062']) {
      assert.throws(() => detectProfile(writePlayset(['3811316052', '2216659254', id])), /disabled|requires/i, 'reject mixed PoD and Oriental mod ' + id);
    }
    assert.throws(() => detectProfile(writePlayset(['2216659254'])), /Wyvern/i, 'reject PoD without Wyvern');
    assert.throws(() => detectProfile(writePlayset(['3811316052'])), /supported profile/i, 'reject a playset missing both supported dependency sets');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

assert.deepEqual(profile.mods, ['3811316052', '2216659254']);
assert.ok(!profile.modules.some(id => ['chinese-core', 'calendar-hud', 'palace-estate', 'weight-of-crown', 'wyvern-votc-dialogue'].includes(id)), 'PoD profile omits Oriental, calendar, palace, WOC, and optional VOTC modules');
assert.ok(!profile.mods.some(id => ['3717989134', '3614384002', '3346777360', '3740401066'].includes(id)), 'PoD profile has no MDP, merit, VOTC, or BoTL dependency');
assert.ok(profile.exclude.includes('character-preservation:common/scripted_triggers/zzzzzzzzzzzz_mm_BoTL_cleanup.txt'), 'BoTL cleanup source is excluded');
for (const excluded of [
  'wyvern-human-form:common/character_interactions/mm_wyvern_human_form.txt',
  'wyvern-human-form:gfx/portraits/portrait_modifiers/zzzz_multi_mod_wyvern_human_form.txt',
  'wyvern-human-form:gfx/portraits/trait_portrait_modifiers/zzzz_multi_mod_wyvern_human_form.txt',
  'wyvern-kings:common/character_interactions/zzzzzzzz_mm_royal_availability.txt',
  'wyvern-kings:common/traits/mm_royal_traits.txt'
]) assert.ok(profile.exclude.includes(excluded), 'exclude duplicate or stale human-form source ' + excluded);
for (const excluded of [
  'dragon-creed:common/factions/zzzzzz_mm_v1312_factions.txt',
  'dragon-relics:common/artifacts/templates/mm_dragon_relics.txt',
  'dragon-relics:common/artifacts/templates/zzzzzz_mm_relic_forging_access.txt',
  'dragon-relics:common/scripted_triggers/zzzzzz_mm_relic_puppet_access.txt'
]) assert.ok(profile.exclude.includes(excluded), 'exclude same-ID/foreign-base source ' + excluded);

// Static bridge checks plus one package dry-run. No game or CK3 callback-order claim is made.
const podRun = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-package.js'), '--profile=wyvern-pod', '--dry-run'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024
});
assert.equal(podRun.status, 0, 'PoD dry-run succeeds: ' + (podRun.stderr || ''));
const podPackage = JSON.parse(podRun.stdout.trim());
assert.equal(podPackage.profile, 'wyvern-pod');
assert.deepEqual(podPackage.modules, profile.modules);
assert.deepEqual([...podPackage.dependencies].sort(), ['2216659254', '3811316052']);
assert.ok(!podPackage.dependencies.includes('3346777360'), 'VOTC is opt-in only');
assert.equal(new Set(podPackage.files.map(file => file.path)).size, podPackage.files.length, 'package manifest has one owner per path');

const coreSources = JSON.parse(read('patches/wyvern-pod/core-sources.json'));
const uiSources = JSON.parse(read('patches/wyvern-pod/ui-sources.json'));
const mechanicsSources = JSON.parse(read('patches/wyvern-pod/mechanics-sources.json'));
const humanFormSources = JSON.parse(read('patches/wyvern-pod/human-form-sources.json'));
const torporSources = JSON.parse(read('patches/wyvern-pod/torpor-sources.json'));
for (const sourceManifest of [coreSources, uiSources, mechanicsSources, humanFormSources, torporSources]) verifyGeneratedOutputs(sourceManifest, podPackage);

const royalTraitsSourcePath = 'patches/wyvern-kings/mod/common/traits/mm_royal_traits.txt';
assert.deepEqual(torporSources.sources.map(source => [source.root, source.path, source.sha256]).sort(), [
  ['R', royalTraitsSourcePath, 'b4cf1f960e05ac2387d7e4136f2cc6ad8df15d4bfc802f62643e10ebee141c3d'],
  ['PoD', 'common/decisions/00_POD_torpor_decisions.txt', '2c424f1cd43d90c09e7bcc6cd535017a6603d7afe10ba35aeaecac8dd7300009'],
  ['PoD', 'common/character_interactions/POD_journey_interactions.txt', 'b96ee7827c5561990ad6961396b1b6ba53289f002eaf7cad2b2022ebb047b6c8'],
  ['PoD', 'common/character_interactions/POD_torpor_interactions.txt', '068912412c1c297e2971b3460390d820944c98ff3cb35abf32a3148024ceb7d4'],
  ['PoD', 'common/scripted_triggers/POD_interface_triggers.txt', '4f3400ea696618b1a3062a4549fcb139224ef0e330061368bb7c95cce1fd6f12']
].sort(), 'torpor receipt retains the inspected raw R and PoD source hashes');
const royalTraitsSourceRecord = torporSources.sources.find(source => source.root === 'R' && source.path === royalTraitsSourcePath);
assert.equal(sha256(readBytes(royalTraitsSourcePath)), royalTraitsSourceRecord.sha256, 'raw royal-traits source still matches its receipt');

// Culture bridge is the original file with exactly the three unsupported OE/Tianjia innovations removed.
{
  const source = read('patches/dragon-culture/mod/history/cultures/myv_wyvern_culture.txt');
  const actual = read('patches/wyvern-pod/mod/history/cultures/myv_wyvern_culture.txt');
  const removed = ['innovation_target_ZhongHuaLiZhi', 'innovation_target_region_liangjing', 'innovation_world_cathay'];
  for (const id of removed) assert.equal((source.match(new RegExp('^\\s*discover_innovation\\s*=\\s*' + id + '\\s*$', 'gm')) || []).length, 1, 'unsupported innovation source exists once: ' + id);
  const expected = source.split('\n').filter(line => !removed.some(id => new RegExp('^\\s*discover_innovation\\s*=\\s*' + id + '\\s*$').test(line))).join('\n');
  assert.equal(actual, expected, 'culture bridge removes only those three unsupported innovations');
  for (const id of ['innovation_dragon_kiln', 'innovation_east_settling', 'innovation_tiefutu', 'innovation_adaptive_militia']) {
    assert.match(actual, new RegExp('^\\s*discover_innovation\\s*=\\s*' + id + '\\s*$', 'm'), 'preserve vanilla/TGP innovation ' + id);
  }
}

// Cleanup removes only the undefined immortality trait key and keeps native immortal checks.
{
  const source = read('patches/character-preservation/mod/common/scripted_triggers/zzzzzzzzzzzz_mm_cleanup_protection.txt');
  const actual = read('patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzz_mm_cleanup_protection.txt');
  assert.equal((source.match(/^\s*has_trait\s*=\s*immortality\s*$/gm) || []).length, 1);
  const expected = source.split('\n').filter(line => !/^\s*has_trait\s*=\s*immortality\s*$/.test(line)).join('\n');
  assert.equal(actual, expected, 'cleanup bridge removes only undefined has_trait=immortality');
  assert.match(actual, /\bis_immortal\s*=\s*yes\b/);
  assert.match(actual, /has_trait_with_flag\s*=\s*is_immortal/);
  assert.match(actual, /has_trait\s*=\s*immortal\b/);
  assert.match(actual, /has_trait\s*=\s*mm_dragon_half\b/);
}

// The PoD birth bridge is pinned to the inspected PoD file and adds only the true-dragon fallback guard.
{
  const podBirthSource = coreSources.sourceFiles.find(file => file.root === 'pod' && file.path === 'common/on_action/POD_vanilla_child_birth_on_actions.txt');
  const podBirthOutput = coreSources.outputs.find(file => file.path === 'common/on_action/POD_vanilla_child_birth_on_actions.txt');
  assert.deepEqual(podBirthSource && [podBirthSource.root, podBirthSource.path, podBirthSource.sha256], [
    'pod', 'common/on_action/POD_vanilla_child_birth_on_actions.txt', '21437cf5731be7184d5bb644c1d9e705d3a424d7017b613ee1798e61072b2858'
  ]);
  assert.deepEqual(podBirthOutput && podBirthOutput.sha256, '795b23e94d1611560c56276dbecb803ed378204eb440743c9dda7d3d735f3724');
  const birth = read('patches/wyvern-pod/mod/common/on_action/POD_vanilla_child_birth_on_actions.txt');
  for (const role of ['mother', 'father', 'child']) {
    const hook = block(birth, 'on_birth_' + role);
    assert.match(hook, new RegExp('on_actions\\s*=\\s*\\{\\s*POD_on_birth_' + role + '\\s*\\}'), 'retain PoD birth subscription: ' + role);
  }
  assert.match(block(birth, 'POD_on_birth_mother'), /POD_mokole_rage_of_the_nest_mother_effect\s*=\s*yes/);
  assert.match(block(birth, 'POD_on_birth_father'), /POD_mokole_rage_of_the_nest_mother_effect\s*=\s*yes/);
  const child = block(birth, 'POD_on_birth_child');
  assert.match(child, /POD_supernatural_trait_assignment_on_birth\s*=\s*\{[\s\S]*?MOTHER\s*=\s*scope:mother[\s\S]*?REAL_FATHER\s*=\s*scope:real_father[\s\S]*?\}/);
  assert.match(child, /limit\s*=\s*\{\s*has_POD_race_trigger\s*=\s*no\s+NOT\s*=\s*\{\s*mm_dragon_is_true_dragon_parent_trigger\s*=\s*yes\s*\}\s*\}\s*add_trait\s*=\s*mortal/);
  assert.doesNotMatch(child, /mm_dragon_half|set_race\s*=|(?:add|set)_character_flag\s*=\s*[^\n]*splat|fertility/i, 'mortal fallback does not exclude hybrids or rewrite PoD race/fertility');
  for (const id of ['mm_dragon_natural_birth', 'mm_dragon_register_true_dragon_origins_effect']) {
    assert.match(read('patches/wyvern-bloodline/mod/common/on_action/mm_dragon_lineage.txt'), new RegExp(id), 'retain natural lineage birth registration ' + id);
  }
  assert.match(read('patches/dragon-creed/mod/common/on_action/mm_dragon_creed_migration.txt'), /on_birth_child\s*=\s*\{\s*on_actions\s*=\s*\{\s*mm_dragon_creed_birth_v1311\s*\}/, 'retain creed birth registration');
}

// PoD cleanup, marriage, knight, and longevity hooks remain in generated mechanics outputs.
{
  const mechanics = new Map(mechanicsSources.outputs.map(record => [record.path, read(path.posix.join('patches/wyvern-pod', record.path))]));
  const preservation = mechanics.get('mod/common/scripted_effects/zzzz_mm_pod_character_preservation.txt');
  const guests = mechanics.get('mod/events/courtier_guest_management_events/courtier_guest_management_events.txt');
  const triggers = mechanics.get('mod/common/scripted_triggers/zzzz_mm_pod_wyvern_dragon_triggers.txt');
  const marriage = mechanics.get('mod/common/scripted_modifiers/zzzz_mm_pod_dragon_bond_marriage.txt');
  const factions = mechanics.get('mod/common/factions/zzzz_mm_pod_dragon_creed_factions.txt');
  assert.match(preservation, /POD_can_be_invited_to_camp\s*=\s*\{\s*CAMP_OWNER\s*=\s*scope:new_landless_adventurer\s*\}/);
  assert.match(preservation, /POD_restore_saved_haven_buildings\s*=\s*yes/);
  assert.match(guests, /POD_is_available_for_events\s*=\s*yes/);
  assert.match(guests, /has_POD_longevity_trigger\s*=\s*yes/);
  assert.match(triggers, /POD_can_marry_common_trigger\s*=\s*yes/);
  assert.match(triggers, /POD_custom_incompatible_splats_trigger/);
  assert.match(triggers, /can_be_knight_trigger\s*=\s*\{[\s\S]*?has_trait\s*=\s*torpor/);
  assert.match(marriage, /POD_race_fertility_care_trigger\s*=\s*yes/);
  assert.match(marriage, /has_POD_longevity_trigger\s*=\s*no/);
  for (const output of mechanics.values()) assert.doesNotMatch(output, /\bhanfan\b|han_fan/i, 'generated mechanics omit Hanfan definitions');
  assert.ok(mechanicsSources.excludedSourceFiles.some(file => file.path.endsWith('common/factions/zzzzzz_mm_v1312_factions.txt')), 'exclude giant Hanfan faction source');

  const relics = mechanics.get('mod/common/artifacts/templates/zzzz_mm_pod_dragon_relic_templates.txt');
  const dragonRelics = [
    'mm_relic_black_crown_template', 'mm_relic_black_regalia_template', 'mm_relic_white_book_template',
    'mm_relic_fire_ring_template', 'mm_relic_earth_sarcophagus_template', 'mm_relic_sea_armor_template',
    'mm_relic_sky_spear_template'
  ];
  assert.deepEqual([...relics.matchAll(/^(mm_relic_[A-Za-z0-9_]+_template)\s*=\s*\{/gm)].map(match => match[1]).sort(), dragonRelics.slice().sort(), 'exactly seven custom dragon relic templates are emitted');
  for (const id of dragonRelics) assert.match(block(relics, id), /can_reforge\s*=\s*\{\s*always\s*=\s*no\s*\}/, id + ' cannot be reforged');
  for (const omitted of ['common/artifacts/templates/mm_dragon_relics.txt', 'common/artifacts/templates/zzzzzz_mm_relic_forging_access.txt', 'common/scripted_triggers/zzzzzz_mm_relic_puppet_access.txt']) {
    assert.ok(!podPackage.files.some(file => file.path === omitted), 'same-ID legacy module source is excluded: ' + omitted);
  }
}

// Dragon Creed is the sole religion exception; the PoD family and race rules are pinned to their source blocks.
{
  const fixtures = [
    {
      id: 'has_POD_religion_group',
      sourcePath: 'common/scripted_triggers/POD_triggers.txt',
      sourceHash: 'eb86ada76bd4772a707b20e25dceef8dee8bc0605060571b749832c4d1797175',
      blockHash: '43e742a11c14673900d5500651138c63df3799448f5c9cf5c431eae8aa19183e',
      addition: '\t\tthis = religion:mm_dragon_creed_religion\n'
    },
    {
      id: 'is_vanilla_faith_trigger',
      sourcePath: 'common/scripted_triggers/POD_religion_triggers.txt',
      sourceHash: 'f05a1fa1e6987db76a804dcf59a94bfec9407a51fcf5a513a0339e63c1e333e5',
      blockHash: '15ffaea91b76cd48def106e03de547c136f648a5dd512f2e32465f00e57e20f2',
      addition: '\tNOT = { religion = religion:mm_dragon_creed_religion }\n'
    },
    {
      id: 'POD_has_illegal_religion_custom_trigger',
      sourcePath: 'common/scripted_triggers/POD_religion_triggers.txt',
      sourceHash: 'f05a1fa1e6987db76a804dcf59a94bfec9407a51fcf5a513a0339e63c1e333e5',
      blockHash: 'f1e016551bf040d894cc28e281da3955dbc5f9fb99a04dbec3292ea4f2cd52e3',
      addition: '\tNOT = { $FAITH$ = { religion = religion:mm_dragon_creed_religion } }\n'
    }
  ];
  const sourceMetadata = coreSources.sourceFiles.filter(file => file.root === 'pod' && fixtures.some(fixture => fixture.sourcePath === file.path));
  assert.deepEqual(sourceMetadata.map(file => [file.path, file.sha256]).sort(), [
    ['common/scripted_triggers/POD_religion_triggers.txt', 'f05a1fa1e6987db76a804dcf59a94bfec9407a51fcf5a513a0339e63c1e333e5'],
    ['common/scripted_triggers/POD_triggers.txt', 'eb86ada76bd4772a707b20e25dceef8dee8bc0605060571b749832c4d1797175']
  ].sort());

  const bridge = read('patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzz_mm_pod_dragon_religion.txt');
  const emittedDefinitions = [...bridge.matchAll(/^([A-Za-z0-9_]+)\s*=\s*\{/gm)].map(match => match[1]).sort();
  assert.deepEqual(emittedDefinitions, fixtures.map(fixture => fixture.id).sort(), 'religion bridge overrides only the three reviewed PoD definitions');
  for (const fixture of fixtures) {
    const definition = block(bridge, fixture.id);
    assert.equal(definition.split(fixture.addition).length - 1, 1, fixture.id + ': exact Dragon Creed exception appears once');
    const restored = definition.replace(fixture.addition, '');
    assert.equal(sha256(Buffer.from(restored)), fixture.blockHash, fixture.id + ': removing the custom exception restores the pinned PoD definition byte-for-byte after newline normalization');
  }

  const supported = block(bridge, 'has_POD_religion_group');
  const families = [...supported.matchAll(/is_in_family\s*=\s*(rf_[A-Za-z0-9_]+)/g)].map(match => match[1]).sort();
  assert.deepEqual(families, ['rf_demons', 'rf_fae', 'rf_gaia', 'rf_hunters', 'rf_ignorance', 'rf_kindred', 'rf_kueijin', 'rf_mummies', 'rf_wraiths', 'rf_wyrm'].sort(), 'retain exactly PoD original ten supported families; do not add rf_pagan');
  assert.ok(/this\s*=\s*religion:mm_dragon_creed_religion/.test(supported), 'register only Dragon Creed as the additional supported religion');

  const vanilla = block(bridge, 'is_vanilla_faith_trigger');
  assert.ok(/NOT\s*=\s*\{\s*religion\s*=\s*religion:mm_dragon_creed_religion\s*\}/.test(vanilla), 'Dragon Creed is exempted from PoD vanilla-faith hiding');
  assert.ok(/is_in_family\s*=\s*rf_pagan/.test(vanilla), 'retain PoD original pagan vanilla-faith classification');

  const illegal = block(bridge, 'POD_has_illegal_religion_custom_trigger');
  assert.ok(/NOT\s*=\s*\{\s*\$FAITH\$\s*=\s*\{\s*religion\s*=\s*religion:mm_dragon_creed_religion\s*\}\s*\}/.test(illegal), 'only Dragon Creed bypasses the PoD illegal-faith fallback');
  assert.ok(/has_game_rule\s*=\s*world_of_monsters/.test(illegal), 'retain PoD world_of_monsters fallback');
  assert.ok(!/pod_convert_trigger|POD_race_fertility_care_trigger/i.test(bridge), 'religion bridge does not alter PoD conversion or race-family restrictions');
}

// Carry the four installed portrait overrides by frozen receipt hash and graft only the corrected human-form interaction.
{
  const expectedOutputs = [
    ['common/character_interactions/zzzzzzzz_mm_royal_availability.txt', '977eb7e9297d3e3a514c1f917003d5481ac1d2eabad2e5854f138f0adacf0931'],
    ['gfx/portraits/portrait_modifiers/mm_wyvern_human_form_portrait.txt', '85e2fd583c9f67121f86d083cc0c694a86a4046a797029b6fa3f6ddf247acb33'],
    ['gfx/portraits/portrait_modifiers/myv_wyvern_color_and_size.txt', 'dbe3c30e0a27a3b0b1ff92677584d46aae955653b2a978230755b572dfd4f732'],
    ['gfx/portraits/portrait_modifiers/zzz_myv_wyvern_no_human_accessories.txt', '16fbd92db552c41cf2da74c0972352c24d562c0a04f6051a43b951abcb456804'],
    ['gfx/portraits/trait_portrait_modifiers/myv_wyvern_trait_portrait_modifiers.txt', 'e44e7757831f61e5412559d24aea848e323bd5cfe3affc8e7b685083f7fa1091']
  ];
  assert.deepEqual(humanFormSources.outputs.map(file => [file.path, file.sha256]).sort(), expectedOutputs.slice().sort(), 'human-form receipt pins exactly four portraits and the merged interaction');
  for (const [file, expectedHash] of expectedOutputs.filter(([file]) => file.startsWith('gfx/portraits/'))) {
    const installedRecord = humanFormSources.sourceFiles.find(source => source.root === 'installed' && source.path === file);
    assert.equal(installedRecord && installedRecord.sha256, expectedHash, 'portrait receipt matches frozen installed hash for ' + file);
  }

  const sourceAvailabilityPath = 'patches/wyvern-kings/mod/common/character_interactions/zzzzzzzz_mm_royal_availability.txt';
  const sourceAvailability = read(sourceAvailabilityPath);
  const sourceRecord = humanFormSources.sourceFiles.find(source => source.root === 'repo' && source.path === sourceAvailabilityPath);
  assert.equal(sourceRecord && sourceRecord.sha256, '1a48475f3ebe8329fef35526f87996debcf7fe8f88194594e5575540a1da8b5b');
  assert.equal(sha256(readBytes(sourceAvailabilityPath)), sourceRecord.sha256, 'receipt source is the current repository interaction file');

  const availabilityPath = 'patches/wyvern-pod/mod/common/character_interactions/zzzzzzzz_mm_royal_availability.txt';
  const availability = read(availabilityPath);
  const humanInteractionId = 'mm_wyvern_toggle_human_form_interaction';
  const sourceHumanInteraction = block(sourceAvailability, humanInteractionId);
  const mergedHumanInteraction = block(availability, humanInteractionId);
  const definitionCount = source => [...source.matchAll(/^mm_wyvern_toggle_human_form_interaction\s*=\s*\{/gm)].length;
  assert.equal(definitionCount(availability), 1, 'merged royal-availability has one human-form interaction definition');
  assert.equal(sourceAvailability.replace(sourceHumanInteraction, '__HUMAN_FORM__'), availability.replace(mergedHumanInteraction, '__HUMAN_FORM__'), 'all other royal-availability entries remain byte-for-byte source-derived');
  assert.equal([...mergedHumanInteraction.matchAll(/^\s*on_send\s*=\s*\{/gm)].length, 1, 'human-form toggle is an on_send interaction');
  assert.equal([...mergedHumanInteraction.matchAll(/^\s*on_accept\s*=\s*\{/gm)].length, 0, 'obsolete human-form on_accept hook is absent');
  assert.ok(/has_character_flag\s*=\s*mm_wyvern_human_form/.test(mergedHumanInteraction), 'toggle reads the appearance flag');
  assert.ok(/remove_character_flag\s*=\s*mm_wyvern_human_form/.test(mergedHumanInteraction), 'toggle removes the existing appearance flag');
  assert.ok(/add_character_flag\s*=\s*mm_wyvern_human_form/.test(mergedHumanInteraction), 'toggle adds the existing appearance flag');

  const colorAndSize = block(read('patches/wyvern-pod/mod/gfx/portraits/portrait_modifiers/myv_wyvern_color_and_size.txt'), 'myv_wyvern_visual_color_and_size');
  const weightLines = colorAndSize.split('\n').filter(line => /^[\t ]*weight\s*=\s*\{/.test(line));
  assert.equal(weightLines.length, 67, 'portrait color/size file has one compact hidden entry plus 66 visual weights');
  const compactHidden = block(colorAndSize, 'myv_wyvern_compact_hidden', false);
  assert.match(compactHidden, /weight\s*=\s*\{\s*base\s*=\s*0\s*\}/);
  assert.doesNotMatch(compactHidden, /has_character_flag\s*=\s*mm_wyvern_human_form/);
  for (const [index, weight] of weightLines.slice(1).entries()) {
    assert.ok(/NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_wyvern_human_form\s*\}/.test(weight), 'visual color/size weight ' + (index + 1) + ' excludes human form');
  }

  for (const omitted of [
    'common/character_interactions/mm_wyvern_human_form.txt',
    'gfx/portraits/portrait_modifiers/zzzz_multi_mod_wyvern_human_form.txt',
    'gfx/portraits/trait_portrait_modifiers/zzzz_multi_mod_wyvern_human_form.txt'
  ]) assert.ok(!podPackage.files.some(file => file.path === omitted), 'stale human-form source is not packaged: ' + omitted);
  const availabilityPackageFile = podPackage.files.find(file => file.path === 'common/character_interactions/zzzzzzzz_mm_royal_availability.txt');
  assert.equal(availabilityPackageFile && availabilityPackageFile.source, 'wyvern-pod', 'merged royal-availability owns the colliding path');
}

// Preserve the seed and hatching sources, map profile references to PoD torpor, and keep a save-safe royal-traits overlay.
{
  const sharedSourceFiles = [
    ['wyvern-bloodline', 'common/scripted_effects/mm_dragon_lineage_initialization.txt'],
    ['wyvern-bloodline', 'common/scripted_triggers/mm_dragon_force_hatch.txt'],
    ['wyvern-bloodline', 'common/scripted_effects/mm_dragon_force_hatch.txt'],
    ['wyvern-kings', 'common/scripted_effects/zzzzzzzz_mm_royal_stable_breeding.txt']
  ];
  for (const [moduleId, file] of sharedSourceFiles) {
    const sourceModule = modules.find(module => module.id === moduleId);
    const packageFile = podPackage.files.find(entry => entry.path === file);
    assert.ok(sourceModule && packageFile, 'profile packages ' + moduleId + ':' + file);
    const bytes = readBytes(path.posix.join(sourceModule.source, file));
    const prepared = preparePodScript('wyvern-pod', file, bytes);
    assert.equal(packageFile.source, moduleId);
    assert.equal(packageFile.bytes, prepared.length, 'profile packages prepared byte length for ' + file);
    assert.equal(packageFile.sha256, sha256(prepared), 'profile packages prepared source hash for ' + file);
  }

  const originalRoyalTraits = read(royalTraitsSourcePath);
  const podRoyalTraitsPath = 'patches/wyvern-pod/mod/common/traits/mm_royal_traits.txt';
  const podRoyalTraits = read(podRoyalTraitsPath);
  const podRoyalTraitsPackageFile = podPackage.files.find(entry => entry.path === 'common/traits/mm_royal_traits.txt');
  assert.ok(podRoyalTraitsPackageFile, 'PoD profile includes the legacy royal-traits placeholder file');
  assert.equal(podRoyalTraitsPackageFile.source, 'wyvern-pod', 'PoD overlay owns the legacy royal-traits path');
  const royalTraitIds = [...originalRoyalTraits.matchAll(/^([A-Za-z0-9_]+)\s*=\s*\{/gm)].map(match => match[1]);
  assert.deepEqual(royalTraitIds, [
    'mm_royal_dragon_king', 'mm_royal_complete', 'mm_royal_white_empress', 'mm_royal_black_emperor', 'mm_royal_torpor'
  ], 'the raw receipt source has the expected five royal trait definitions');
  assert.deepEqual([...podRoyalTraits.matchAll(/^([A-Za-z0-9_]+)\s*=\s*\{/gm)].map(match => match[1]), royalTraitIds,
    'overlay retains each royal trait ID for existing saves');
  for (const traitId of royalTraitIds.filter(id => id !== 'mm_royal_torpor')) {
    assert.equal(block(podRoyalTraits, traitId), block(originalRoyalTraits, traitId), 'overlay preserves original non-torpor trait block ' + traitId);
  }
  const legacyTorpor = block(podRoyalTraits, 'mm_royal_torpor');
  assert.match(legacyTorpor, /shown_in_ruler_designer\s*=\s*no/);
  assert.match(legacyTorpor, /random_creation\s*=\s*0/);
  assert.doesNotMatch(legacyTorpor, /\b(?:incapacitating|can_have_children|prowess|martial|diplomacy_mult|stewardship_mult|intrigue_mult|learning_mult|prowess_mult|ai_energy)\s*=/,
    'legacy torpor definition is only a save placeholder; PoD native torpor keeps its mechanics');

  assert.match(read('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_lineage_initialization.txt'), /any_in_global_list\s*=\s*\{\s*variable\s*=\s*mm_dragon_seed_people/);
  const forceTrigger = read('patches/wyvern-bloodline/mod/common/scripted_triggers/mm_dragon_force_hatch.txt');
  const forceEffect = read('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_force_hatch.txt');
  assert.match(forceTrigger, /var:mm_dragon_half_egg\s*=\s*yes/);
  assert.match(forceEffect, /any_character_artifact\s*=\s*\{\s*mm_dragon_force_hatch_eligible_trigger\s*=\s*yes\s+is_equipped\s*=\s*yes\s*\}/);
  assert.match(forceEffect, /random_character_artifact\s*=\s*\{\s*limit\s*=\s*\{\s*mm_dragon_force_hatch_eligible_trigger\s*=\s*yes\s+is_equipped\s*=\s*yes\s*\}/);
  assert.match(forceEffect, /myv_hatch_wyvern_egg_effect\s*=\s*yes/);
  assert.match(forceEffect, /add_gold\s*=\s*-100[\s\S]*?add_piety\s*=\s*-250/);
  assert.match(block(originalRoyalTraits, 'mm_royal_torpor'), /can_have_children\s*=\s*no/);
  assert.doesNotMatch(legacyTorpor, /can_have_children\s*=\s*no/, 'legacy save placeholder does not impose dragon-only fertility restrictions');
  assert.match(read('patches/wyvern-kings/mod/common/scripted_effects/zzzzzzzz_mm_royal_stable_breeding.txt'), /any_in_global_list\s*=\s*\{[\s\S]*?NOT\s*=\s*\{\s*has_trait\s*=\s*mm_royal_torpor\s*\}/);
}

// PoD + Wyvern GUI keys are preserved; no More Personality Depth UI predicate is referenced.
{
  const gui = file => read('patches/wyvern-pod/mod/gui/' + file);
  const character = gui('window_character.gui');
  const finder = gui('window_character_finder.gui');
  const confirmation = gui('interaction_confirmation.gui');
  const faith = gui('window_faith.gui');
  const map = gui('map_icon_layer.gui');
  const tooltip = gui('shared/00_votc_trait_tooltip.gui');
  const humanWindowPath = 'common/scripted_guis/zzzz_multi_mod_wyvern_human_form.txt';
  const humanWindowModule = modules.find(module => module.id === 'wyvern-human-form');
  const humanWindowPackageFile = podPackage.files.find(file => file.path === humanWindowPath);
  assert.ok(humanWindowModule && humanWindowPackageFile, 'human-form scripted GUI is included in the PoD profile');
  const humanWindowBytes = readBytes(path.posix.join(humanWindowModule.source, humanWindowPath));
  assert.equal(humanWindowPackageFile.source, 'wyvern-human-form');
  assert.equal(humanWindowPackageFile.sha256, sha256(humanWindowBytes), 'human-form scripted GUI keeps its source hash');
  const humanWindow = block(read(path.posix.join(humanWindowModule.source, humanWindowPath)), 'myv_wyvern_character_window');
  assert.ok(/NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_wyvern_human_form\s*\}/.test(humanWindow), 'dragon character GUI is suppressed while human-form flag is set');
  assert.ok(/visible\s*=\s*"\[Not\( GetScriptedGui\('myv_wyvern_character_window'\)\.IsShown/.test(character), 'vanilla character GUI remains visible when dragon GUI is suppressed');
  assert.ok(/POD_window_character_knight_window\s*=\s*\{/.test(character), 'PoD knight window remains in the merged character GUI');
  assert.ok(/myv_wyvern_character_view\s*=\s*\{/.test(character), 'Wyvern character view remains in the merged character GUI');
  assert.ok(/myv_widget_character_list_item_finder\s*=\s*\{/.test(finder), 'Wyvern character finder remains in the merged GUI');
  assert.ok(/pod_interaction_option_scrollbox\s*=\s*\{/.test(confirmation), 'PoD interaction option layout remains in the merged GUI');
  assert.ok(/CharacterInteractionConfirmationWindow\.Send/.test(confirmation), 'interaction confirmation retains its send action');
  assert.ok(/POD_faith_is_shown/.test(faith), 'PoD faith filtering remains in the merged faith GUI');
  assert.ok(/mm_v1314_show_faith/.test(faith), 'Dragon Creed faith filtering remains in the merged faith GUI');
  assert.ok(/religious_head_map_icon/.test(map), 'religious-head map icon remains in the merged map GUI');
  assert.ok(/ReligiousHeadMapIcon\.GetCharacter/.test(map), 'religious-head map icon keeps its character binding');
  assert.ok(/myv_compact_head/.test(map), 'Wyvern portrait map rendering remains in the merged map GUI');

  const creedFaith = read('patches/dragon-creed/mod/gui/window_faith.gui');
  const tenetMarker = 'type widget_tenet_item = widget {';
  const sourceTenet = guiBlock(creedFaith, tenetMarker);
  const mergedTenet = guiBlock(faith, tenetMarker);
  const mergedTenetWithoutPoDGlowOverride = mergedTenet
    .replace(/^[\t ]*# CfV PoD: hide the new glow textures since they don't fit our old tenet banners\r?\n/m, '')
    .replace(/^([\t ]*)#using = Tenet_Glows[\t ]*$/m, '$1using = Tenet_Glows');
  assert.equal(mergedTenetWithoutPoDGlowOverride, sourceTenet, 'PoD tenet block retains Dragon Creed layout, including its 18-point rite-view label; only the PoD-specific glow suppression differs');
  assert.ok(/name\s*=\s*"mm_v1319_tenet_name"[\s\S]*?fontsize\s*=\s*18[\s\S]*?size\s*=\s*\{\s*118\s+32\s*\}/.test(mergedTenet), '18-point Dragon Creed tenet label layout survives PoD merge');
  const tooltipReferenceCount = source => [...source.matchAll(/using\s*=\s*mm_v1314_viewed_doctrine_tooltip/g)].length;
  assert.equal(tooltipReferenceCount(creedFaith), 6, 'Dragon Creed source has six doctrine tooltip hosts');
  assert.equal(tooltipReferenceCount(faith), 6, 'all six Dragon Creed doctrine tooltip hosts survive PoD merge');
  assert.ok(faith.includes('mm_v1314_holy_site_under_control_ui') && faith.includes('mm_v1314_holy_site_not_under_control_ui'), 'Dragon Creed holy-site tooltip keys remain in the merged faith GUI');

  for (const output of [character, finder, confirmation, faith, map, tooltip]) {
    assert.ok(!/Trait\.IsPersonality|MMPD_|PersonalityExperience/i.test(output), 'merged UI does not reference More Personality Depth predicates');
  }
}

console.log('Wyvern + PoD independent static QA passed. This is not CK3 runtime evidence.');

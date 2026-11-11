'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const readBytes = relative => fs.readFileSync(path.join(root, ...relative.split('/')));
const read = relative => normalize(readBytes(relative).toString('utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function blockAt(source, start, label) {
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, 'missing block opener ' + label);
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
  assert.fail('unclosed block ' + label);
}

function block(source, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('^' + escapedId + '\\s*=\\s*\\{', 'm').exec(source);
  assert.ok(match, 'missing top-level definition ' + id);
  return blockAt(source, match.index, id);
}

function definitions(source) {
  return [...source.matchAll(/^([A-Za-z0-9_]+)\s*=\s*\{/gm)].map(match => match[1]);
}

function numericProperty(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('^\\s*' + escapedKey + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*$', 'm').exec(source);
  assert.ok(match, 'missing numeric property ' + key);
  return Number(match[1]);
}

function exactName(source, label) {
  const match = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*"([^"]+)"', 'm').exec(source);
  assert.ok(match, 'missing name ' + label);
  return match[1];
}

const expectedSources = [
  ['pod', 'common/traits/00_POD_traits_fera.txt', '1493f8a69aed83c9e6ce3dbef7f4a158f1ab75ace88915b3d568208bc82be56f'],
  ['repo', 'patches/wyvern-bloodline/mod/common/traits/mm_dragon_bloodline.txt', '158e5dd880c00d962a70c41709d63b55c7c191f1f5094d65f7f5c285455999e5']
];
const expectedOutputs = [
  ['common/modifiers/mm_pod_mokole_max.txt', '6c68d68f1a048069ded5777fd1df45f4f58d69697f6c29f3f7d7e62332b495a1'],
  ['common/traits/mm_pod_mokole_gifts.txt', 'e9f9c7fc6fc9b9dfc938cde7f633b582f6b9d5c1d5526b8d627de8940c74b1d2'],
  ['common/scripted_effects/zzzzzzzzzzzzzzz_mm_pod_mokole_max.txt', '18cba9c5b8e191b59ceb2ab646de918076034b60a665fb6b59fbe47f61558922'],
  ['common/on_action/zzzzzzzzzzzzzzz_mm_pod_mokole_max.txt', '5e2da611a3a2d03cdf9d1cc1c54875f129e70fb5020daf64a685b760ed2e3d1e'],
  ['localization/replace/simp_chinese/zzzzzzzzzzzzzzz_mm_pod_mokole_max_l_simp_chinese.yml', '08a64ab4d8c72706ddba6a8b95dead5856fd5b4e31e2ab941e80c4f63bf11638'],
  ['localization/replace/english/zzzzzzzzzzzzzzz_mm_pod_mokole_max_l_english.yml', '7e776ce4f682efee892f59824503401a7a07cd60d5ad5ad6eb121c16a23e08ff']
];

const receipt = JSON.parse(read('patches/wyvern-pod/mokole-max-sources.json'));
assert.equal(receipt.CK3Runtime, 'NOT_RUN', 'the source receipt must not imply CK3 runtime verification');
assert.deepEqual(
  receipt.sourceFiles.map(item => [item.root, item.path, item.sha256]).sort(),
  expectedSources.slice().sort(),
  'the generator receipt pins PoD Mokole input and the untouched six-grade source'
);
assert.deepEqual(
  receipt.outputs.map(item => [item.path, item.sha256]).sort(),
  expectedOutputs.slice().sort(),
  'all six generated outputs are pinned'
);
for (const [sourceRoot, relative, expectedHash] of expectedSources.filter(([sourceRoot]) => sourceRoot === 'repo')) {
  assert.equal(sha256(readBytes(relative)), expectedHash, 'pinned repository source ' + relative);
}
for (const [relative, expectedHash] of expectedOutputs) {
  assert.equal(
    sha256(readBytes(path.posix.join('patches/wyvern-pod/mod', relative))),
    expectedHash,
    'pinned generated output ' + relative
  );
}

// Frozen source facts used for an independent max-arithmetic check.
const grades = [
  { trait: 'mm_dragon_half', health: 5, life: 150, prowess: 50, legitimacy: 2 },
  { trait: 'mm_dragon_lineage_1', health: 4, life: 50, prowess: 30, legitimacy: 1 },
  { trait: 'mm_dragon_lineage_2', health: 3, life: 30, prowess: 20, legitimacy: 0.75 },
  { trait: 'mm_dragon_lineage_3', health: 2, life: 15, prowess: 10, legitimacy: 0.5 },
  { trait: 'mm_dragon_lineage_4', health: 1, life: 5, prowess: 5, legitimacy: 0.25 },
  { trait: 'mm_dragon_black_blood', health: 5, life: 100, prowess: 80, legitimacy: 2.5 }
];
const phases = [
  { xp: 0, mokoleLife: 250, mokoleLegitimacy: 0 },
  { xp: 20, mokoleLife: 300, mokoleLegitimacy: 0.05 },
  { xp: 60, mokoleLife: 350, mokoleLegitimacy: 0.1 }
];
const expectedCombinations = grades.flatMap((grade, index) => phases.map((phase, phaseIndex) => ({
  ...grade,
  index,
  xp: phase.xp,
  id: index * phases.length + phaseIndex + 1,
  key: `mm_pod_mokole_max_${index}_${phase.xp}`,
  healthDelta: -Math.min(2, grade.health),
  lifeDelta: -grade.life,
  prowessDelta: -Math.min(10, grade.prowess),
  legitimacyDelta: phase.mokoleLegitimacy === 0 ? 0 : -phase.mokoleLegitimacy
})));
assert.deepEqual(receipt.grades, grades, 'receipt grade facts match the frozen six-tier bloodline fixture');
assert.deepEqual(receipt.combinations, expectedCombinations, 'all 18 phase corrections use max arithmetic');
for (const combo of expectedCombinations) {
  const grade = grades[combo.index];
  const phase = phases.find(item => item.xp === combo.xp);
  assert.ok(phase.mokoleLife > grade.life, combo.key + ' uses the stronger Mokole lifespan at every supported XP phase');
  assert.equal(2 + combo.healthDelta + grade.health, Math.max(2, grade.health), combo.key + ' keeps only the stronger health value');
  assert.equal(phase.mokoleLife + combo.lifeDelta + grade.life, phase.mokoleLife, combo.key + ' keeps the stronger Mokole lifespan');
  assert.equal(10 + combo.prowessDelta + grade.prowess, Math.max(10, grade.prowess), combo.key + ' keeps only the stronger base Prowess value');
  assert.equal(phase.mokoleLegitimacy + combo.legitimacyDelta + grade.legitimacy,
    Math.max(phase.mokoleLegitimacy, grade.legitimacy), combo.key + ' keeps only the stronger legitimacy value');
}

const bloodlineSource = read('patches/wyvern-bloodline/mod/common/traits/mm_dragon_bloodline.txt');
for (const grade of grades) {
  const sourceTrait = block(bloodlineSource, grade.trait);
  assert.equal(numericProperty(sourceTrait, 'health'), grade.health, grade.trait + ' health remains unchanged');
  assert.equal(numericProperty(sourceTrait, 'life_expectancy'), grade.life, grade.trait + ' lifespan remains unchanged');
  assert.equal(numericProperty(sourceTrait, 'prowess'), grade.prowess, grade.trait + ' Prowess remains unchanged');
  assert.equal(numericProperty(sourceTrait, 'monthly_legitimacy_add'), grade.legitimacy, grade.trait + ' legitimacy remains unchanged');
}

const modifierPath = 'patches/wyvern-pod/mod/common/modifiers/mm_pod_mokole_max.txt';
const modifierSource = read(modifierPath);
const expectedModifierKeys = expectedCombinations.map(item => item.key);
assert.deepEqual(definitions(modifierSource), expectedModifierKeys, 'one correction definition exists for each supported grade/XP phase');
for (const combo of expectedCombinations) {
  const correction = block(modifierSource, combo.key);
  assert.match(correction, /^\s*stacking\s*=\s*no\s*$/m, combo.key + ' cannot stack with itself');
  assert.match(correction, /^\s*hide_effects\s*=\s*yes\s*$/m, combo.key + ' hides the numeric list, not the modifier itself');
  assert.equal(numericProperty(correction, 'health'), combo.healthDelta, combo.key + ' health correction');
  assert.equal(numericProperty(correction, 'life_expectancy'), combo.lifeDelta, combo.key + ' lifespan correction');
  assert.equal(numericProperty(correction, 'prowess_no_portrait'), combo.prowessDelta, combo.key + ' Prowess correction uses Mokole native stat key');
  assert.equal(numericProperty(correction, 'monthly_legitimacy_add'), combo.legitimacyDelta, combo.key + ' removes only the lower Mokole track contribution');
  assert.doesNotMatch(correction, /monthly_prestige_gain_per_legitimacy_level_add|prowess_per_prestige_level|years_of_fertility|fertility\s*=/,
    combo.key + ' leaves unrelated Mokole track and fertility effects intact');
}

const giftSource = read('patches/wyvern-pod/mod/common/traits/mm_pod_mokole_gifts.txt');
const giftKeys = ['mm_pod_mokole_gifts_0', 'mm_pod_mokole_gifts_40', 'mm_pod_mokole_gifts_60'];
assert.deepEqual(definitions(giftSource), giftKeys, 'exactly three XP-adapted gift variants exist');
const giftValues = [
  { key: giftKeys[0], aptitude: 0.5, sense: 0.05 },
  { key: giftKeys[1], aptitude: 0.5, sense: null },
  { key: giftKeys[2], aptitude: 0.3, sense: null }
];
for (const gift of giftValues) {
  const definition = block(giftSource, gift.key);
  assert.match(definition, /^\s*shown_in_ruler_designer\s*=\s*no\s*$/m);
  assert.match(definition, /^\s*random_creation\s*=\s*0\s*$/m);
  assert.match(definition, /^\s*birth\s*=\s*0\s*$/m);
  assert.equal(numericProperty(definition, 'POD_terrain_umbra_aptitude_advantage'), gift.aptitude, gift.key + ' keeps the combined aptitude at 0.5');
  if (gift.sense === null) assert.doesNotMatch(definition, /^\s*POD_terrain_umbra_sense_advantage\s*=/m, gift.key + ' leaves the stronger Mokole sense track alone');
  else assert.equal(numericProperty(definition, 'POD_terrain_umbra_sense_advantage'), gift.sense, gift.key + ' provides the 0.05 floor');
  assert.match(definition, /^\s*POD_terrain_umbra_spirit_wilds_access_cancel_negative_supply\s*=\s*yes\s*$/m);
  assert.match(definition, /^\s*POD_terrain_umbra_deep_umbra_access_cancel_negative_supply\s*=\s*yes\s*$/m);
  assert.doesNotMatch(definition, /POD_terrain_can_damage_spirit_cancel_negative_supply|flag\s*=\s*(?:regeneration|fera_trait_healing|can_become_ancestor_spirit)/,
    gift.key + ' does not duplicate Mokole native spirit damage, regeneration, healing, or ancestor flags');
}

const speciesSource = read('patches/wyvern-pod/mod/common/traits/mm_pod_species.txt');
const nativeGift = block(speciesSource, 'mm_pod_dragon_gifts');
for (const property of ['POD_terrain_can_damage_spirit_cancel_negative_supply', 'regeneration', 'fera_trait_healing', 'can_become_ancestor_spirit']) {
  assert.match(nativeGift, new RegExp('(?:^|\\n)\\s*(?:flag\\s*=\\s*)?' + property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s*=\\s*yes)?\\s*(?:#.*)?$', 'm'),
    'the original dragon gift still owns ' + property);
}

const effectSource = read('patches/wyvern-pod/mod/common/scripted_effects/zzzzzzzzzzzzzzz_mm_pod_mokole_max.txt');
const clearEffect = block(effectSource, 'mm_pod_clear_mokole_max_effect');
for (const key of expectedModifierKeys) {
  assert.equal((clearEffect.match(new RegExp('remove_character_modifier\\s*=\\s*' + key, 'g')) || []).length, 1,
    'transition cleanup removes exactly one instance of ' + key);
}
assert.match(clearEffect, /remove_variable\s*=\s*mm_pod_mokole_max_combination/);

const syncEffect = block(effectSource, 'mm_pod_sync_mokole_max_effect');
assert.match(syncEffect, /limit\s*=\s*\{\s*has_trait\s*=\s*mokole\s*\}/, 'all correction logic is scoped behind Mokole presence');
assert.match(syncEffect, /NOT\s*=\s*\{\s*is_target_in_global_variable_list\s*=\s*\{\s*name\s*=\s*mm_pod_mokole_max_characters\s+target\s*=\s*this\s*\}\s*\}/,
  'registered characters are not duplicated in the maintenance list');
assert.match(syncEffect, /mm_pod_queue_mokole_max_effect\s*=\s*yes/);
assert.match(syncEffect, /has_trait_xp\s*=\s*\{\s*trait\s*=\s*mokole\s+track\s*=\s*mokole\s+value\s*>=\s*60\s*\}/,
  'XP checks use Mokole short-track name explicitly');
assert.match(syncEffect, /has_trait_xp\s*=\s*\{\s*trait\s*=\s*mokole\s+track\s*=\s*mokole\s+value\s*>=\s*60\s*\}\s*\}\s*remove_trait\s*=\s*mm_pod_mokole_gifts_0\s+remove_trait\s*=\s*mm_pod_mokole_gifts_40\s+add_trait\s*=\s*mm_pod_mokole_gifts_60/,
  'XP 60+ selects the gift variant that complements Mokole aptitude growth');
assert.match(syncEffect, /has_trait_xp\s*=\s*\{\s*trait\s*=\s*mokole\s+track\s*=\s*mokole\s+value\s*>=\s*40\s*\}\s*\}\s*remove_trait\s*=\s*mm_pod_mokole_gifts_0\s+remove_trait\s*=\s*mm_pod_mokole_gifts_60\s+add_trait\s*=\s*mm_pod_mokole_gifts_40/,
  'XP 40-59 keeps native Mokole sense growth without adding Dragon sense again');

for (let index = 0; index < grades.length; index += 1) {
  const grade = grades[index];
  const condition = `limit = { has_trait = ${grade.trait} }`;
  const conditionIndex = syncEffect.indexOf(condition);
  assert.notEqual(conditionIndex, -1, 'missing tier selection branch for ' + grade.trait);
  const priorBlocks = [...syncEffect.slice(0, conditionIndex).matchAll(/(?:else_if|if)\s*=\s*\{/g)];
  assert.ok(priorBlocks.length, grade.trait + ' branch has an enclosing if');
  const gradeBranch = blockAt(syncEffect, priorBlocks[priorBlocks.length - 1].index, grade.trait);
  const thresholds = [...gradeBranch.matchAll(/has_trait_xp\s*=\s*\{\s*trait\s*=\s*mokole\s+track\s*=\s*mokole\s+value\s*>=\s*(\d+)\s*\}\s*\}\s*set_variable\s*=\s*\{\s*name\s*=\s*mm_pod_mokole_max_desired\s+value\s*=\s*(\d+)\s*\}/g)];
  assert.deepEqual(thresholds.map(match => [Number(match[1]), Number(match[2])]), [
    [60, index * 3 + 3],
    [20, index * 3 + 2]
  ], grade.trait + ' maps its native XP phases to the right correction ID');
  assert.match(gradeBranch, new RegExp('else\\s*=\\s*\\{\\s*set_variable\\s*=\\s*\\{\\s*name\\s*=\\s*mm_pod_mokole_max_desired\\s+value\\s*=\\s*' + (index * 3 + 1) + '\\s*\\}\\s*\\}', 'm'),
    grade.trait + ' maps XP below 20 to its base correction');
}

const changedMatch = /if\s*=\s*\{\s*limit\s*=\s*\{\s*OR\s*=\s*\{\s*NOT\s*=\s*\{\s*has_variable\s*=\s*mm_pod_mokole_max_combination/.exec(syncEffect);
assert.ok(changedMatch, 'the active combination is replaced only when absent or changed');
const changedBlock = blockAt(syncEffect, changedMatch.index, 'correction transition');
assert.match(changedBlock, /mm_pod_clear_mokole_max_effect\s*=\s*yes/);
const modifierAdds = [...changedBlock.matchAll(/if\s*=\s*\{\s*limit\s*=\s*\{\s*var:mm_pod_mokole_max_desired\s*=\s*(\d+)\s*\}\s*add_character_modifier\s*=\s*\{\s*modifier\s*=\s*(mm_pod_mokole_max_\d+_\d+)\s*\}\s*\}/g)];
assert.equal(modifierAdds.length, 18, 'one possible correction is selected from the single desired-combination value');
assert.deepEqual(modifierAdds.map(match => [Number(match[1]), match[2]]), expectedCombinations.map(item => [item.id, item.key]));
assert.ok(changedBlock.indexOf('mm_pod_clear_mokole_max_effect = yes') < modifierAdds[0].index,
  'all previous grade/XP corrections are cleared before the single new one is applied');
assert.ok(changedBlock.indexOf('set_variable = { name = mm_pod_mokole_max_combination') > modifierAdds[modifierAdds.length - 1].index,
  'the applied combination is recorded after selection');
assert.match(syncEffect, /remove_variable\s*=\s*mm_pod_mokole_max_desired/);

const nonMokoleBranchMatch = /^    else = \{/m.exec(syncEffect);
assert.ok(nonMokoleBranchMatch, 'loss of Mokole enters the cleanup branch');
const nonMokoleBranch = blockAt(syncEffect, nonMokoleBranchMatch.index, 'non-Mokole cleanup');
for (const variant of giftKeys) assert.match(nonMokoleBranch, new RegExp('remove_trait\\s*=\\s*' + variant));
assert.match(nonMokoleBranch, /mm_pod_has_dragon_blood\s*=\s*yes\s*\}\s*add_trait\s*=\s*mm_pod_dragon_gifts/,
  'the ordinary dragon gift is restored only while dragon blood remains');
const registryRemovalMatch = /if\s*=\s*\{\s*limit\s*=\s*\{\s*has_global_variable_list\s*=\s*mm_pod_mokole_max_characters\s*\}\s*remove_list_global_variable\s*=\s*\{\s*name\s*=\s*mm_pod_mokole_max_characters\s+target\s*=\s*this\s*\}\s*\}/.exec(nonMokoleBranch);
assert.ok(registryRemovalMatch, 'empty registry removal is guarded for first-time non-Mokole characters');
assert.equal((nonMokoleBranch.match(/remove_list_global_variable\s*=\s*\{\s*name\s*=\s*mm_pod_mokole_max_characters/g) || []).length, 1,
  'characters leaving Mokole have one guarded removal from the daily list');
assert.doesNotMatch(nonMokoleBranch, /remove_trait\s*=\s*(?:mokole|mm_dragon_(?:half|lineage_[1-4]|black_blood))/,
  'the synchronization helper does not rewrite species or bloodline identity');

const identityEffect = block(read('patches/wyvern-pod/mod/common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_identity.txt'), 'mm_pod_integrate_species_effect');
const defaultGiftIndex = identityEffect.indexOf('add_trait = mm_pod_dragon_gifts');
const initialSyncIndex = identityEffect.indexOf('mm_pod_sync_mokole_max_effect = yes');
assert.ok(defaultGiftIndex >= 0 && initialSyncIndex > defaultGiftIndex,
  'initial species integration assigns the default dragon gift before specializing Mokole gifts');

const onAction = read('patches/wyvern-pod/mod/common/on_action/zzzzzzzzzzzzzzz_mm_pod_mokole_max.txt');
assert.match(block(onAction, 'on_trait_gained'), /on_actions\s*=\s*\{\s*mm_pod_mokole_max_trait_change\s*\}/);
assert.match(block(onAction, 'on_trait_lost'), /on_actions\s*=\s*\{\s*mm_pod_mokole_max_trait_change\s*\}/);
const traitChange = block(onAction, 'mm_pod_mokole_max_trait_change');
assert.match(traitChange, /is_alive\s*=\s*yes/);
for (const trait of ['mokole', ...grades.map(grade => grade.trait)]) {
  assert.match(traitChange, new RegExp('this\\s*=\\s*trait:' + trait + '(?:\\s|\\})'), 'trait gain/loss hook covers ' + trait);
}
assert.match(traitChange, /mm_pod_sync_mokole_max_effect\s*=\s*yes/);
assert.doesNotMatch(onAction, /on_trait_xp|on_trait_track/,
  'the daily registered-character queue, not a nonexistent XP hook, handles track changes');

const queueEffect = block(effectSource, 'mm_pod_queue_mokole_max_effect');
assert.match(queueEffect, /NOT\s*=\s*\{\s*has_global_variable\s*=\s*mm_pod_mokole_max_queued\s*\}/,
  'the global timer prevents duplicate daily events');
assert.match(queueEffect, /set_global_variable\s*=\s*\{\s*name\s*=\s*mm_pod_mokole_max_queued\s+value\s*=\s*yes\s+days\s*=\s*2\s*\}/,
  'the queue lock outlives the one-day delayed callback');
assert.equal((queueEffect.match(/trigger_event\s*=/g) || []).length, 1);
assert.match(queueEffect, /trigger_event\s*=\s*\{\s*on_action\s*=\s*mm_pod_mokole_max_daily\s+days\s*=\s*1\s*\}/,
  'the callback runs at most once per day');
const daily = block(onAction, 'mm_pod_mokole_max_daily');
const unlockIndex = daily.indexOf('remove_global_variable = mm_pod_mokole_max_queued');
const scanIndex = daily.indexOf('every_in_global_list = { variable = mm_pod_mokole_max_characters');
const requeueIndex = daily.indexOf('mm_pod_queue_mokole_max_effect = yes');
assert.ok(unlockIndex >= 0 && scanIndex > unlockIndex && requeueIndex > scanIndex,
  'the daily pass unlocks before scanning and schedules at most one next pass');
assert.match(daily, /every_in_global_list\s*=\s*\{\s*variable\s*=\s*mm_pod_mokole_max_characters/,
  'daily work iterates only registered Mokoles');
assert.match(daily, /is_alive\s*=\s*yes\s*\}\s*mm_pod_sync_mokole_max_effect\s*=\s*yes/,
  'live registered characters are synchronized; dead entries are discarded');
assert.match(daily, /any_in_global_list\s*=\s*\{\s*variable\s*=\s*mm_pod_mokole_max_characters/,
  'the timer stops when the registered list is empty');
assert.doesNotMatch(daily, /every_living_character|every_character|all_living_characters/,
  'the timer does not scan the whole world');

const succession = read('patches/wyvern-pod/mod/common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_succession.txt');
const beginSuccession = block(succession, 'mm_pod_begin_royal_succession_effect');
assert.match(beginSuccession, /add_trait\s*=\s*mm_royal_dragon_king/);
assert.match(beginSuccession, /mm_pod_clear_previous_species_effect\s*=\s*yes/,
  'the new dragon-king path runs the PoD species cleanup that removes the old Mokole trait');
const speciesCleanup = block(succession, 'mm_pod_clear_previous_species_effect');
assert.match(speciesCleanup, /POD_remove_fera_on_embrace_effect\s*=\s*yes/);
assert.match(speciesCleanup, /POD_remove_splat_traits_effect\s*=\s*yes/);
const completeSuccession = block(succession, 'mm_pod_complete_royal_succession_effect');
assert.match(completeSuccession, /mm_pod_clear_previous_species_effect\s*=\s*yes/);
assert.match(traitChange, /this\s*=\s*trait:mokole/,
  'Mokole removal on succession triggers the same cleanup and removes correction modifiers immediately');

const simplifiedChinese = read(expectedOutputs[4][0].replace('localization/replace/', 'patches/wyvern-pod/mod/localization/replace/'));
const english = read(expectedOutputs[5][0].replace('localization/replace/', 'patches/wyvern-pod/mod/localization/replace/'));
const chineseTitles = [...simplifiedChinese.matchAll(/^\s*mm_pod_mokole_max_\d+_\d+:0\s+"([^"]+)"/gm)].map(match => match[1]);
const englishTitles = [...english.matchAll(/^\s*mm_pod_mokole_max_\d+_\d+:0\s+"([^"]+)"/gm)].map(match => match[1]);
assert.equal(chineseTitles.length, 18);
assert.equal(englishTitles.length, 18);
assert.deepEqual([...new Set(chineseTitles)], ['莫科莱与龙血整合'], 'all correction variants share one friendly visible label');
assert.deepEqual([...new Set(englishTitles)], ['Mokole and dragon blood integration']);
assert.match(english, /Unique powers and Mokole renown growth remain intact/);
assert.doesNotMatch(english + simplifiedChinese, /\bhidden\b|隐藏修正|不可见修正/i,
  'localization does not claim hide_effects makes the modifier itself invisible');

console.log('Mokole/PoD independent static QA passed; CK3 runtime remains NOT_RUN.');

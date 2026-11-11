'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { preparePodScript } = require('../scripts/prepare-pod-script');

const root = path.resolve(__dirname, '..');
const readBytes = relative => fs.readFileSync(path.join(root, relative));
const read = relative => readBytes(relative).toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

function block(source, id) {
  const match = new RegExp('^' + id + '\\s*=\\s*\\{', 'm').exec(source);
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

function preparedText(relative, text) {
  return preparePodScript('wyvern-pod', relative, Buffer.from(text, 'utf8')).toString('utf8');
}

// The converter is profile-, extension-, and declaration-aware. Legacy IDs remain readable only by the migration file.
{
  const bytes = Buffer.from('mm_royal_torpor = { physical = yes }\nhas_trait = mm_royal_torpor\nremove_trait = mm_royal_torpor\n');
  const converted = preparePodScript('wyvern-pod', 'common/scripted_effects/example.txt', bytes).toString('utf8');
  assert.match(converted, /^mm_royal_torpor = \{ physical = yes \}$/m, 'retain the legacy trait definition');
  assert.match(converted, /has_trait = torpor/);
  assert.match(converted, /remove_trait = torpor/);
  assert.equal(preparePodScript('wyvern-pod', 'common/scripted_effects/mm_pod_legacy_torpor.txt', bytes), bytes, 'migration source keeps the legacy identifier');
  assert.equal(preparePodScript('oriental', 'common/scripted_effects/example.txt', bytes), bytes, 'other profiles are untouched');
  assert.equal(preparePodScript('wyvern-pod', 'localization/english/example.yml', bytes), bytes, 'localization keys are untouched');
}

const receipt = JSON.parse(read('patches/wyvern-pod/identity-sources.json'));
for (const output of receipt.outputs) {
  const bytes = readBytes(path.posix.join('patches/wyvern-pod/mod', output.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), output.sha256, 'generated identity output matches receipt: ' + output.path);
}

const species = read('patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_species.txt');
const identity = read('patches/wyvern-pod/mod/common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_identity.txt');
const lineage = read('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_lineage.txt');
const startup = read('patches/wyvern-pod/mod/common/on_action/mm_dragon_lineage_initialization.txt');
const hooks = read('patches/wyvern-pod/mod/common/on_action/zzzzzzzzzzzzzz_mm_pod_identity.txt');

// PoD's original race set stays intact, and only true dragon parentage removes the mortal fallback.
{
  const raceTrigger = block(species, 'has_POD_race_trait_trigger');
  for (const race of ['vampire', 'kueijin', 'fera', 'fae', 'demon', 'mummy', 'wraith', 'mortal']) {
    assert.match(raceTrigger, new RegExp('has_trait\\s*=\\s*' + race + '\\b'), 'preserve native PoD race ' + race);
  }
  assert.match(raceTrigger, /has_trait\s*=\s*mm_pod_dragon_race/);

  const integration = block(identity, 'mm_pod_integrate_species_effect');
  const raceAdd = integration.indexOf('add_trait = mm_pod_dragon_race');
  const mortalRemove = integration.indexOf('remove_trait = mortal');
  const trueDragonGate = integration.indexOf('mm_dragon_is_true_dragon_parent_trigger = yes');
  assert.ok(trueDragonGate >= 0 && raceAdd > trueDragonGate && mortalRemove > trueDragonGate, 'race tagging and mortal repair stay behind the true-dragon gate');
  assert.match(integration, /mm_pod_has_dragon_blood\s*=\s*yes\s*\}\s*add_trait\s*=\s*mm_pod_dragon_gifts/);
}

// Age seeding is a one-time bootstrap operation; inherited, black-blood, and already-ranked characters retain their tier.
{
  const seed = block(identity, 'mm_pod_seed_mokole_effect');
  assert.match(seed, /NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_pod_initial_rank_assigned\s*\}/);
  assert.match(seed, /mm_dragon_has_blood_trigger\s*=\s*no/);
  assert.match(seed, /NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_dragon_lineage_initialized\s*\}/);
  assert.match(seed, /NOT\s*=\s*\{\s*has_variable\s*=\s*mm_dragon_absorbed_source_count\s*\}/);
  assert.match(seed, /true_age\s*[<>]=?/);
  assert.doesNotMatch(seed, /(?<!true_)\bage\s*[<>]=?|effective_age\s*[<>]=?/);
  assert.match(startup, /every_living_character\s*=\s*\{\s*limit\s*=\s*\{\s*has_trait\s*=\s*mokole/);
  assert.match(startup, /NOT\s*=\s*\{\s*has_global_variable\s*=\s*mm_pod_mokole_cohort_initialized\s*\}/);
  assert.match(startup, /set_global_variable\s*=\s*\{\s*name\s*=\s*mm_pod_mokole_cohort_initialized/);
}

// Only the five newly age-ranked initial Mokole become founders; source and faith are fixed once without touching old ancestry.
{
  const seed = block(identity, 'mm_pod_seed_mokole_effect');
  const seedSource = block(identity, 'mm_pod_seed_source_effect');
  const cohort = block(startup, 'mm_dragon_seed_initialize_campaign');
  const founderIds = ['793509', '795111', '795208', '795209', '795210'];
  const sourceForFounder = new Map([
    ['793509', '99001305'],
    ['795111', '99001003'],
    ['795208', '99001002'],
    ['795209', '99001306'],
    ['795210', '99001306']
  ]);
  const riteForSource = new Map([
    ['99001001', 'fire'], ['99001305', 'fire'],
    ['99001002', 'earth'], ['99001306', 'earth'],
    ['99001003', 'sea'], ['99001307', 'sea'],
    ['99001304', 'sky'], ['99001308', 'sky'],
    ['99001310', 'white']
  ]);
  assert.deepEqual(receipt.founders.map(({ id, source, branch }) => [String(id), String(source), branch]), [
    ['793509', '99001305', 'fire'],
    ['795111', '99001003', 'sea'],
    ['795208', '99001002', 'earth'],
    ['795209', '99001306', 'earth'],
    ['795210', '99001306', 'earth']
  ], 'the identity receipt keeps all three Egyptian founders on Earth while Han/Akan routes remain fire/sea');

  const candidateFlagIndex = cohort.indexOf('add_character_flag = mm_pod_initial_cohort_candidate');
  const seedIndex = cohort.indexOf('mm_pod_seed_mokole_effect = yes', candidateFlagIndex);
  const removeCandidateIndex = cohort.indexOf('remove_character_flag = mm_pod_initial_cohort_candidate', seedIndex);
  assert.ok(candidateFlagIndex >= 0 && seedIndex > candidateFlagIndex && removeCandidateIndex > seedIndex, 'only the one-time startup cohort brackets rank seeding with the candidate flag');

  const founderFlagIndex = seed.indexOf('add_character_flag = mm_pod_initial_founder');
  assert.ok(founderFlagIndex > seed.indexOf('true_age >= 1000'), 'founder assignment follows the fresh age rank branch');
  const founderGate = seed.slice(seed.lastIndexOf('mm_pod_initial_cohort_candidate', founderFlagIndex), founderFlagIndex);
  assert.match(founderGate, /has_trait = mm_dragon_half/);
  assert.match(founderGate, /NOT\s*=\s*\{\s*has_variable_list\s*=\s*mm_dragon_origins\s*\}/, 'existing biological ancestry blocks founder reassignment');
  const foundFounderIds = [...founderGate.matchAll(/this\s*=\s*character:(\d+)/g)].map(match => match[1]);
  assert.deepEqual(foundFounderIds, founderIds, 'the founder gate is restricted to the five named historical Mokole');

  for (const hookId of ['mm_pod_monthly_integration', 'mm_pod_created_character']) {
    const hook = block(hooks, hookId);
    assert.doesNotMatch(hook, /mm_pod_initial_cohort_candidate|mm_pod_initial_founder|mm_pod_founder_rite_assigned|set_character_(?:faith|rite)/, hookId + ' cannot grant founder status or convert faith');
  }

  const founderSelectionIndex = seedSource.indexOf('limit = { has_character_flag = mm_pod_initial_founder }');
  const nonFounderSelectionIndex = seedSource.indexOf('else_if = {', founderSelectionIndex);
  assert.ok(founderSelectionIndex >= 0 && nonFounderSelectionIndex > founderSelectionIndex, 'founder sources are selected in their own guarded branch');
  const founderSelection = seedSource.slice(founderSelectionIndex, nonFounderSelectionIndex);
  const fixedAssignments = [...founderSelection.matchAll(/if\s*=\s*\{\s*limit\s*=\s*\{\s*this\s*=\s*character:(\d+)\s*\}\s*character:(\d+)\s*=\s*\{\s*save_scope_as\s*=\s*mm_pod_chosen_source\s*\}\s*\}/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(fixedAssignments, [...sourceForFounder.entries()], 'each founder receives its specified royal source');
  const existingSourceMarkIndex = seedSource.indexOf('add_character_flag = mm_pod_initial_source_assigned');
  assert.ok(existingSourceMarkIndex >= 0 && existingSourceMarkIndex < founderSelectionIndex, 'a known biological source is marked before fixed founder assignment can run');
  assert.match(seedSource.slice(0, founderSelectionIndex), /limit\s*=\s*\{\s*NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_pod_initial_source_assigned\s*\}/, 'fixed source assignment is guarded against replacing an existing source');

  const conversionIndex = seedSource.indexOf('limit = { has_character_flag = mm_pod_initial_founder has_trait = mm_dragon_half exists = scope:mm_pod_chosen_source NOT = { has_character_flag = mm_pod_founder_rite_assigned } }');
  assert.ok(conversionIndex > founderSelectionIndex, 'faith conversion follows source resolution and is one-time');
  const conversions = seedSource.slice(conversionIndex, seedSource.indexOf('remove_variable = mm_pod_seed_throne', conversionIndex));
  const conversionRules = [...conversions.matchAll(/if\s*=\s*\{\s*limit\s*=\s*\{\s*scope:mm_pod_chosen_source\s*=\s*\{\s*OR\s*=\s*\{([^{}]+)\}\s*\}\s*\}\s*set_character_faith\s*=\s*faith:mm_dragon_creed\s*set_character_rite\s*=\s*rite:mm_dragon_(fire|earth|sea|sky|white)\s*add_character_flag\s*=\s*mm_pod_founder_rite_assigned\s*\}/g)];
  assert.equal(conversionRules.length, 5, 'the founder conversion table has exactly five rites');
  const coveredSources = new Set();
  for (const rule of conversionRules) {
    const ids = [...rule[1].matchAll(/this\s*=\s*character:(\d+)/g)].map(match => match[1]);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.equal(riteForSource.get(id), rule[2], 'royal source selects its matching rite: ' + id);
      assert.equal(coveredSources.has(id), false, 'each royal source appears in one rite rule: ' + id);
      coveredSources.add(id);
    }
  }
  assert.deepEqual([...coveredSources].sort(), [...riteForSource.keys()].sort(), 'all and only the eight throne kings plus White Empress map to the five rites');
  assert.doesNotMatch(conversions, /black|99001309/, 'Black Emperor cannot convert an initial Mokole founder');
}

// The one-time old-save revision replaces only the two obsolete Egyptian biological origins.
{
  const revision = block(identity, 'mm_pod_revise_egyptian_founders_effect');
  assert.match(revision, /limit\s*=\s*\{\s*has_character_flag\s*=\s*mm_pod_initial_founder\s+has_trait\s*=\s*mm_dragon_half\s+NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_pod_earth_founder_revision\s*\}\s+OR\s*=\s*\{\s*this\s*=\s*character:795208\s+this\s*=\s*character:795209\s+this\s*=\s*character:795210\s*\}\s*\}/,
    'only unrevised initial half-dragon founders 795208-795210 enter the migration');
  const changedFounderIds = [...revision.matchAll(/this\s*=\s*character:(\d+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(changedFounderIds)], ['795208', '795209', '795210'], 'migration names only the three Egyptian founders');

  const removedOrigins = [...revision.matchAll(/remove_list_variable\s*=\s*\{\s*name\s*=\s*mm_dragon_origins\s+target\s*=\s*character:(\d+)/g)].map(match => match[1]);
  assert.deepEqual(removedOrigins, ['99001304', '99001310'], 'only Hrist and White Emperor legacy origins are removed');
  const addedOrigins = [...revision.matchAll(/add_to_variable_list\s*=\s*\{\s*name\s*=\s*mm_dragon_origins\s+target\s*=\s*character:(\d+)/g)].map(match => match[1]);
  assert.deepEqual(addedOrigins, ['99001306', '99001306'], 'Jorm is appended only when absent in each matching migration');
  assert.doesNotMatch(revision, /mm_dragon_absorbed|remove_trait\s*=|remove_character_modifier\s*=/,
    'migration preserves absorbed ancestry and does not purge traits or modifiers');

  for (let slot = 1; slot <= 16; slot += 1) {
    assert.equal((revision.match(new RegExp('remove_variable\\s*=\\s*mm_dragon_origin_' + slot + '\\b', 'g')) || []).length, 2,
      'legacy origin slot ' + slot + ' is reset once in each targeted migration');
  }
  assert.equal((revision.match(/remove_variable\s*=\s*mm_dragon_origin_count/g) || []).length, 2);
  assert.equal((revision.match(/mm_dragon_prepare_biological_origins_effect\s*=\s*yes/g) || []).length, 3,
    'origins are normalized before lookup and rebuilt from the retained list after each replacement');
  assert.doesNotMatch(revision, /remove_variable\s*=\s*mm_dragon_bio_(?:fire|earth|sea|sky|white|black)/,
    'migration does not clear aggregate bio flags before native conservative refresh');
  const projectMatches = [...revision.matchAll(/every_in_list\s*=\s*\{\s*variable\s*=\s*mm_dragon_origins\s+mm_dragon_project_biological_branch_effect\s*=\s*\{\s*TARGET\s*=\s*scope:mm_pod_revised_founder\s*\}\s*\}/g)];
  const refreshMatches = [...revision.matchAll(/mm_dragon_refresh_branch_traits_effect\s*=\s*yes/g)];
  assert.equal(projectMatches.length, 2, 'both source migrations project known branches from the full retained origin list');
  assert.equal(refreshMatches.length, 2, 'both source migrations defer aggregate flag cleanup to native refresh');
  for (let index = 0; index < projectMatches.length; index += 1) {
    assert.ok(projectMatches[index].index < refreshMatches[index].index,
      'project the updated known origins before native conservative refresh ' + (index + 1));
  }
  const nativeRefresh = block(lineage, 'mm_dragon_refresh_branch_traits_effect');
  const conservativeGuard = nativeRefresh.indexOf('mm_dragon_source_has_usable_branch_trigger = no');
  assert.ok(conservativeGuard >= 0, 'native refresh has an all-origins-usable guard');
  for (const branch of ['fire', 'earth', 'sea', 'sky', 'white', 'black']) {
    assert.ok(nativeRefresh.indexOf('remove_variable = mm_dragon_bio_' + branch) > conservativeGuard,
      'native refresh clears ' + branch + ' only after its all-origins-usable guard');
  }
  assert.match(nativeRefresh, /NOT\s*=\s*\{\s*any_in_list\s*=\s*\{\s*variable\s*=\s*mm_dragon_origins[\s\S]*?mm_dragon_source_has_usable_branch_trigger\s*=\s*no/,
    'unknown origin evidence keeps the native refresh guard closed');
  assert.match(revision, /faith\s*=\s*faith:mm_dragon_creed\s+rite\s*=\s*rite:mm_dragon_sky\s*\}\s*set_character_rite\s*=\s*rite:mm_dragon_earth/);
  assert.match(revision, /faith\s*=\s*faith:mm_dragon_creed\s+rite\s*=\s*rite:mm_dragon_white\s*\}\s*set_character_rite\s*=\s*rite:mm_dragon_earth/);
  assert.doesNotMatch(revision, /set_character_faith\s*=/, 'custom faith remains untouched during rite migration');
  assert.match(revision, /add_character_flag\s*=\s*mm_pod_earth_founder_revision/);
}

// Birth inheritance runs through the original lineage hook. New characters only receive a randomized source when they meet the unparented player-created Mokole gate.
{
  const created = block(hooks, 'mm_pod_created_character');
  const seedIndex = created.indexOf('mm_pod_seed_mokole_effect');
  assert.ok(seedIndex >= 0);
  const beforeSeed = created.slice(0, seedIndex);
  for (const condition of ['is_ai = no', 'NOT = { exists = mother }', 'NOT = { exists = father }']) {
    assert.ok(beforeSeed.includes(condition), 'custom source seeding is limited by ' + condition);
  }
  const birth = block(hooks, 'mm_dragon_natural_birth');
  assert.match(birth, /mm_dragon_inherit_natural_blood_effect\s*=\s*yes/);
  assert.match(birth, /mm_pod_integrate_species_effect\s*=\s*yes/);
  assert.doesNotMatch(birth, /mm_pod_seed_mokole_effect|mm_pod_seed_source_effect/, 'natural inheritance does not get replaced by age/culture seeding');
}

// Legacy origin slots are normalized before checking for an existing royal source, avoiding an extra cultural source on upgraded saves.
{
  const seedSource = block(identity, 'mm_pod_seed_source_effect');
  const normalizeIndex = seedSource.indexOf('mm_dragon_prepare_biological_origins_effect');
  const knownIndex = seedSource.indexOf('is_target_in_variable_list');
  const culturalIndex = seedSource.indexOf('mm_pod_find_cultural_throne_effect');
  assert.ok(normalizeIndex >= 0 && normalizeIndex < knownIndex, 'migrate legacy origin slots before testing for an existing royal origin');
  assert.ok(knownIndex >= 0 && knownIndex < culturalIndex, 'existing specific royal ancestry suppresses a new culture-derived source');
  assert.match(seedSource, /mm_pod_initial_source_assigned/);
}

// Monthly work is confined to the true dragon registry; the old-save population pass remains a one-shot startup hook.
{
  const monthly = block(hooks, 'mm_pod_monthly_integration');
  assert.match(monthly, /every_in_global_list\s*=\s*\{\s*variable\s*=\s*myv_living_wyverns/);
  assert.doesNotMatch(monthly, /every_living_character\s*=/, 'do not rescan every living character each month');
  assert.match(monthly, /every_player\s*=/, 'custom unparented player-created Mokole can still be initialized');
  assert.match(startup, /mm_pod_queue_load_integration/);
  const population = block(startup, 'mm_pod_population_integration');
  assert.match(population, /every_living_character\s*=/, 'perform the old-save migration through the queued startup pass');
  assert.match(population, /mm_pod_has_dragon_blood\s*=\s*yes/);
  assert.doesNotMatch(population, /has_trait\s*=\s*torpor/, 'ordinary PoD torpor users stay outside dragon migration');
}

// Keep PoD wake exits unavailable only for royal kings, while ordinary PoD torpor characters retain native access.
{
  const decision = read('patches/wyvern-pod/mod/common/decisions/zzzzzzzzzzzz_mm_pod_torpor.txt');
  const interactions = read('patches/wyvern-pod/mod/common/character_interactions/zzzzzzzzzzzz_mm_pod_torpor.txt');
  for (const id of ['ruler_exit_torpor', 'POD_wake_from_torpor_interaction', 'POD_awaketorpor_prisoner_interaction']) {
    const source = id === 'ruler_exit_torpor' ? decision : interactions;
    const entry = block(source, id);
    assert.match(entry, /NOT\s*=\s*\{\s*mm_royal_is_king\s*=\s*yes\s*\}/, id + ' blocks royal exit');
    assert.match(entry, /has_trait\s*=\s*torpor/, id + ' still uses native PoD torpor for ordinary characters');
  }
  const legacy = read('patches/wyvern-pod/mod/common/scripted_effects/mm_pod_legacy_torpor.txt');
  assert.match(legacy, /has_trait\s*=\s*mm_royal_torpor/);
  assert.match(legacy, /add_trait\s*=\s*torpor/);
  assert.match(legacy, /remove_trait\s*=\s*mm_royal_torpor/);
}

console.log('PoD species identity static QA passed');

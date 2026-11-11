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

function block(source, id) {
  const match = new RegExp('^' + id + '\\s*=\\s*\\{', 'm').exec(source);
  assert.ok(match, 'missing top-level definition ' + id);
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

function definitions(source) {
  return [...source.matchAll(/^([A-Za-z0-9_]+)\s*=\s*\{/gm)].map(match => match[1]);
}

function tuples(records, fields) {
  return records.map(record => fields.map(field => record[field])).sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

const manifest = JSON.parse(read('patches/wyvern-pod/succession-sources.json'));
const expectedSources = [
  ['pod', 'common/scripted_triggers/POD_splat_hostility_triggers.txt', '16025df65b79d6f5f43e39555bc6732283ba236be34586817f8e6e630394a85c'],
  ['pod', 'common/on_action/POD_vanilla_court_maintenance_on_actions.txt', 'a774c420d4cdbe1ee6c4edc7ca88075def207dafab46979b932cd0ad224e8ea4'],
  ['pod', 'common/scripted_effects/POD_maintenance_remove_effects.txt', '4b483fd16176e6c6a3246e049a37699f7f89c3ba93c5acbe360e82bc53f7a36d'],
  ['pod', 'common/scripted_effects/POD_fera/POD_fera_initialization_effects.txt', 'b8314d1180a1fb494504dfaf0420141a395ab40362ce215881d18abfc278a53a'],
  ['repo', 'patches/wyvern-ascension/mod/common/scripted_effects/mm_ascension_effects.txt', 'b0fd837425f591ff59826c88dd467703ee71946e7c2deb1b4c20f2f1835d1216'],
  ['repo', 'patches/wyvern-ascension/mod/common/scripted_triggers/zzzzzzzzzz_mm_ascension_breeding.txt', '17a614aea6f947dbce91aeb45a2f49a1b82203328c115ce5da89918d2e0a0e16'],
  ['repo', 'patches/wyvern-ascension/mod/common/character_interactions/zzzzzzzzzz_mm_ascension_devour.txt', 'adde4b001e3900288c95a2c9640f9235adda90ac43856a6760604c818f6a6bf3']
];
const expectedOutputs = [
  ['common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_hostility.txt', '1c95db6c368cfac562b299cdd03b23fd089d97d374ff3131a88a449556458041'],
  ['common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_succession.txt', 'c0f9d44aea9ced966d5395817b5a676333f3db811694c4238b89ed5b659bef88'],
  ['common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_succession.txt', 'a9b9b9301c2fe0117152fc9b32a3629e2c3fbeee083b0024223f2ab51a0fa7db'],
  ['common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_succession_breeding.txt', '7213f5886345856be7ea4bf7d5d28f2061739903b7f208b732dae552620c30cb'],
  ['common/character_interactions/zzzzzzzzzzzzzz_mm_pod_succession_devour.txt', '618b850af9b4662def4aabbf4ea8fc2f45f91c906d07738814e92d846f43f032'],
  ['common/on_action/zzzzzzzzzzzzzz_mm_pod_succession.txt', '0eebc91332c46fd19fff574ac7b60ee53ca93561ef19a9fdbcf30a00156fcc91'],
  ['localization/replace/simp_chinese/zzzzzzzzzzzzzz_mm_pod_succession_l_simp_chinese.yml', '64f0bab4c47362ac4a910ab727f54d1d947dc7b1797d4e8161cf07aa38576e82'],
  ['localization/replace/english/zzzzzzzzzzzzzz_mm_pod_succession_l_english.yml', '41cccfc2c63a9fb70b6ac79fec6f089cb969d962935f80c868b6f319b358a833'],
  ['common/customizable_localization/zzzzzzzzzzzzzz_mm_pod_succession.txt', '4e38d66a1d3479e3002a3cf1ef601e24694f2502375990f1ca97931d0c5e38c0']
];

assert.equal(manifest.CK3Runtime, 'NOT_RUN', 'source receipt does not claim CK3 runtime verification');
assert.deepEqual(tuples(manifest.sourceFiles, ['root', 'path', 'sha256']), expectedSources.slice().sort());
assert.deepEqual(tuples(manifest.outputs, ['path', 'sha256']), expectedOutputs.slice().sort());
for (const [sourceRoot, relative, expectedHash] of expectedSources.filter(([sourceRoot]) => sourceRoot === 'repo')) {
  assert.equal(sha256(readBytes(relative)), expectedHash, 'pinned repository source ' + relative);
}
for (const [relative, expectedHash] of expectedOutputs) {
  const bytes = readBytes(path.posix.join('patches/wyvern-pod/mod', relative));
  assert.equal(sha256(bytes), expectedHash, 'pinned PoD succession output ' + relative);
}

// The PoD body is frozen as a test fixture; only the two-sided true-dragon guard may precede it.
const frozenHostilityBody = [
  'POD_custom_incompatible_splats_trigger = {',
  '\ttrigger_if = {',
  '\t\tlimit = { POD_splat_hostility_disabled = yes }',
  '\t\t$ACTOR$ ?= { is_ai = yes }',
  '\t\t$RECIPIENT$ ?= { is_ai = yes }',
  '\t}',
  '\tOR = {',
  '\t\tPOD_supe_on_vamp_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_supe_on_vamp_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_werewolf_on_vampire_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_werewolf_on_vampire_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_werewolf_on_hunter_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_werewolf_on_hunter_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_osiris_league_on_apophis_servant_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_osiris_league_on_apophis_servant_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_supe_on_demon_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_supe_on_demon_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_supe_on_fae_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_supe_on_fae_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_supe_on_bane_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_supe_on_bane_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_vampire_on_fae_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_vampire_on_fae_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_gaia_on_wyrm_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_gaia_on_wyrm_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t\tPOD_wyld_on_weaver_trigger = { ACTOR = $ACTOR$ RECIPIENT = $RECIPIENT$ }',
  '\t\tPOD_wyld_on_weaver_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\t}',
  '\tPOD_osiris_league_on_league_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '\tPOD_set_corrupted_on_corrupted_trigger = { ACTOR = $RECIPIENT$ RECIPIENT = $ACTOR$ }',
  '}'
].join('\n');
const hostility = block(read('patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_hostility.txt'), 'POD_custom_incompatible_splats_trigger');
const hostilityGuards = [
  '    # Ancient true dragons have no inherited species feud, in either direction.',
  '    # Blood grades and Umbral gifts alone do not grant this exemption.',
  '    $ACTOR$ ?= { mm_dragon_is_true_dragon_parent_trigger = no }',
  '    $RECIPIENT$ ?= { mm_dragon_is_true_dragon_parent_trigger = no }'
].join('\n');
const hostilityPrefix = 'POD_custom_incompatible_splats_trigger = {\n' + hostilityGuards;
assert.ok(hostility.startsWith(hostilityPrefix), 'both true-dragon exclusions precede the native PoD master');
assert.equal(hostility.replace(hostilityPrefix, 'POD_custom_incompatible_splats_trigger = {'), frozenHostilityBody,
  'the entire PoD hostility body and its two-way family rules remain unchanged');
const trueDragonTrigger = block(read('patches/wyvern-bloodline/mod/common/scripted_triggers/mm_dragon_lineage.txt'), 'mm_dragon_is_true_dragon_parent_trigger');
assert.match(trueDragonTrigger, /mm_dragon_is_royal_parent_trigger\s*=\s*yes/);
assert.doesNotMatch(trueDragonTrigger, /mm_dragon_half|mm_dragon_lineage_[1-4]|mm_dragon_black_blood|\bmokole\b/,
  'bloodline hybrids do not satisfy the true-dragon exemption');
assert.doesNotMatch(hostilityGuards, /mm_dragon_has_blood_trigger|mm_pod_has_dragon_blood|mm_dragon_half|\bmokole\b/,
  'the exemption does not apply to blood-only or Mokole hybrids');

// Preserve PoD's court-leave block while preventing stale pool moves for dragons and their court members.
const frozenLeaveBlock = [
  'pod_leave_court = {',
  '\ttrigger = {',
  '\t\tNOT = { has_character_flag = blocked_from_leaving }',
  '\t\tis_pool_character = no',
  '\t\tOR = {',
  '\t\t\tis_courtier = yes',
  '\t\t\tis_foreign_court_or_pool_guest = yes',
  '\t\t}',
  '\t}',
  '\teffect = {',
  '\t\tmove_to_pool = yes',
  '\t}',
  '}'
].join('\n');
const onAction = read('patches/wyvern-pod/mod/common/on_action/zzzzzzzzzzzzzz_mm_pod_succession.txt');
const leaveCourt = block(onAction, 'pod_leave_court');
const leaveGuards = [
  '        mm_dragon_is_true_dragon_parent_trigger = no',
  '        NOT = { employer = { mm_dragon_is_true_dragon_parent_trigger = yes } }'
].join('\n');
const leavePrefix = 'pod_leave_court = {\n\ttrigger = {\n' + leaveGuards;
assert.ok(leaveCourt.startsWith(leavePrefix), 'dragon and dragon-employer checks guard the PoD leave-court trigger');
assert.equal(leaveCourt.replace(leavePrefix, 'pod_leave_court = {\n\ttrigger = {'), frozenLeaveBlock,
  'PoD leave-court trigger and move effect are otherwise unchanged');
assert.equal((onAction.match(/mm_dragon_is_true_dragon_parent_trigger\s*=\s*no/g) || []).length, 1);
assert.equal((onAction.match(/employer\s*=\s*\{\s*mm_dragon_is_true_dragon_parent_trigger\s*=\s*yes/g) || []).length, 1);
assert.deepEqual(definitions(onAction), ['pod_leave_court', 'mm_asc_load', 'mm_pod_restore_royal_successions']);

const ascension = read('patches/wyvern-ascension/mod/common/scripted_effects/mm_ascension_effects.txt');
const successionTriggers = read('patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_succession.txt');
const successionEffects = read('patches/wyvern-pod/mod/common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_succession.txt');
assert.deepEqual(definitions(successionEffects), [
  'mm_pod_clear_previous_species_effect',
  'mm_pod_begin_royal_succession_effect',
  'mm_pod_claim_royal_seat_effect',
  'mm_pod_complete_royal_succession_effect',
  'mm_asc_receive_blood_effect',
  'mm_asc_finish_body_effect'
]);

// The new rank is granted at blood receipt, but the original candidate/body progression remains intact.
const sourceReceive = block(ascension, 'mm_asc_receive_blood_effect');
const outputReceive = block(successionEffects, 'mm_asc_receive_blood_effect');
assert.equal(outputReceive, sourceReceive.slice(0, -1) + '\n    mm_pod_begin_royal_succession_effect = yes\n}',
  'blood-receipt bridge is appended after the original reward effect');
const candidate = block(read('patches/wyvern-ascension/mod/common/scripted_triggers/zzzzzzzzzz_mm_ascension_triggers.txt'), 'mm_asc_is_candidate');
assert.match(candidate, /has_trait\s*=\s*mm_asc_usurper_blood/);
assert.match(candidate, /NOT\s*=\s*\{\s*has_variable\s*=\s*mm_asc_outcome\s*\}/);
assert.match(candidate, /NOT\s*=\s*\{\s*has_trait\s*=\s*mm_asc_dragon_body\s*\}/);
const royalSource = block(successionTriggers, 'mm_pod_has_royal_trial_source');
assert.match(royalSource, /is_alive\s*=\s*yes/);
assert.match(royalSource, /NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_asc_black_trial\s*\}/);
assert.doesNotMatch(royalSource, /mm_asc_black_trial_outcome/,
  'a past Black Blood trial result does not block a later valid royal succession');
assert.match(royalSource, /exists\s*=\s*var:mm_asc_blood_source/);
assert.match(royalSource, /var:mm_asc_blood_source\s*=\s*\{\s*mm_royal_is_king\s*=\s*yes\s*\}/);
assert.match(royalSource, /OR\s*=\s*\{\s*mm_asc_source_claim_valid\s*=\s*yes\s+mm_asc_is_current_incarnation\s*=\s*yes\s*\}/);
const begin = block(successionEffects, 'mm_pod_begin_royal_succession_effect');
assert.match(begin, /limit\s*=\s*\{\s*mm_pod_has_royal_trial_source\s*=\s*yes\s+mm_asc_is_candidate\s*=\s*yes\s*\}/);
for (const trait of ['mm_royal_black_emperor', 'mm_royal_white_empress', 'mm_royal_complete', 'mm_royal_dragon_king']) {
  assert.equal((begin.match(new RegExp('add_trait\\s*=\\s*' + trait, 'g')) || []).length, 1, 'immediate rank branch ' + trait);
}
assert.doesNotMatch(begin, /mm_asc_dragon_body|remove_trait\s*=\s*mm_asc_usurper_blood|mm_asc_outcome|remove_list_global_variable/,
  'immediate rank grant leaves the candidate and body progression to original ascension');
const throneSync = block(read('patches/wyvern-kings/mod/common/scripted_effects/mm_royal_identity_effects.txt'), 'mm_royal_sync_throne_identity_trait_effect');
assert.match(throneSync, /var:mm_royal_throne\s*=\s*1[\s\S]*?add_trait\s*=\s*mm_royal_fire_king/);
assert.doesNotMatch(throneSync, /remove_trait\s*=\s*mm_royal_(?:dragon_king|complete|white_empress|black_emperor)/,
  'throne identity sync does not remove the inherited rank');
assert.doesNotMatch(throneSync, /save_scope_as|trigger_event/,
  'throne identity sync does not overwrite the caller scope or dispatch a scope-changing event');
assert.ok(begin.indexOf('set_variable = { name = mm_royal_throne') < begin.indexOf('mm_royal_sync_throne_identity_trait_effect = yes'));
assert.ok(begin.indexOf('mm_royal_sync_throne_identity_trait_effect = yes') < begin.indexOf('mm_pod_clear_previous_species_effect = yes'));
const rankTraits = read('patches/wyvern-kings/mod/common/traits/mm_royal_traits.txt');
for (const trait of ['mm_royal_dragon_king', 'mm_royal_complete', 'mm_royal_white_empress', 'mm_royal_black_emperor']) {
  assert.doesNotMatch(block(rankTraits, trait), /flag\s*=\s*splat/,
    'PoD splat cleanup cannot remove inherited rank trait ' + trait);
}

// The PoD race cleanup is limited to native trait APIs plus the pinned direct trait list.
const clearSpecies = block(successionEffects, 'mm_pod_clear_previous_species_effect');
const traitHooks = [
  'POD_remove_splat_traits_effect', 'POD_remove_vampire_clan_traits_effect',
  'POD_remove_vampire_generation_traits_effect', 'POD_remove_vampire_discipline_traits_effect',
  'POD_remove_vampire_predatortype_traits_effect', 'POD_remove_vampire_misc_traits_effect',
  'POD_remove_hunter_traits_effect', 'POD_remove_mummy_traits_effect', 'POD_remove_wraith_traits_effect',
  'POD_remove_wraith_arcanoi_traits_effect', 'POD_remove_breed_traits_effect',
  'POD_remove_lunar_auspice_traits_effect', 'POD_remove_pryio_traits_effect',
  'POD_remove_solar_auspice_traits_effect', 'POD_remove_demon_traits_effect',
  'POD_remove_fae_kith_traits_effect', 'POD_remove_fae_art_traits_effect', 'POD_remove_fae_realm_traits_effect'
];
const directTraits = [
  'torpor', 'regnant', 'massregnant', 'unbondable', 'sire', 'masssire', 'diablerist', 'wight',
  'exposed', 'oathbreaker', 'truefaith', 'beatific', 'witch', 'demonology', 'psychic', 'sorcerer',
  'theurgist', 'gnosis', 'fomori', 'drone', 'gorgon', 'kami'
];
assert.deepEqual(manifest.traitHooks, traitHooks, 'receipt permits only the reviewed PoD trait cleanup hooks');
assert.deepEqual(manifest.directTraits, directTraits, 'receipt pins the direct PoD identity trait list');
assert.match(clearSpecies, /NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_pod_royal_species_converted\s*\}/,
  'old race cleanup is once-only');
assert.ok(clearSpecies.indexOf('POD_remove_fera_on_embrace_effect = yes') < clearSpecies.indexOf('POD_remove_splat_traits_effect = yes'),
  'Fera identity and forms are cleared before generic splat removal');
const hookSegment = clearSpecies.slice(clearSpecies.indexOf('POD_remove_splat_traits_effect = yes'), clearSpecies.indexOf('\n        remove_trait ='));
assert.deepEqual([...hookSegment.matchAll(/^\s*(POD_[A-Za-z0-9_]+)\s*=\s*yes\s*$/gm)].map(match => match[1]), traitHooks);
const directSegment = clearSpecies.slice(clearSpecies.indexOf('POD_remove_splat_traits_effect = yes'), clearSpecies.indexOf('POD_trait_injector_chi_arts'));
assert.deepEqual([...directSegment.matchAll(/^\s*remove_trait\s*=\s*([A-Za-z0-9_]+)\s*$/gm)].map(match => match[1]), directTraits);
assert.match(clearSpecies, /POD_trait_injector_chi_arts\s*=\s*\{\s*EFFECT\s*=\s*POD_remove_trait\s*\}/);
assert.deepEqual([...clearSpecies.matchAll(/^\s*remove_variable\s*=\s*([A-Za-z0-9_]+)\s*$/gm)].map(match => match[1]), ['fera_type'],
  'only the PoD Fera classification variable is directly removed');
assert.deepEqual([...clearSpecies.matchAll(/^\s*remove_character_modifier\s*=\s*([A-Za-z0-9_]+)\s*$/gm)].map(match => match[1]),
  ['mm_dragon_diluted_blood_modifier'], 'only the derived dragon blood modifier is directly removed');
assert.doesNotMatch(clearSpecies,
  /POD_remove_all_supernatural_atribute_effect|POD_remove_supernatural_(?:basic_modifiers|perks|secrets|variables)_effect|POD_remove_achievement_flags_effect|refund_all_perks|remove_all_perks_in_lifestyle|clear_variable_list|remove_list_global_variable|remove_relation|set_father|set_mother/,
  'conversion does not broad-purge powers, secrets, unrelated variables, relations, or ancestry');
assert.doesNotMatch(clearSpecies, /remove_trait\s*=\s*mm_(?:asc_|royal_)/,
  'conversion retains ascension state and royal rank traits');
assert.ok(clearSpecies.indexOf('POD_remove_splat_traits_effect = yes') < clearSpecies.indexOf('add_trait = mm_pod_dragon_race'));
assert.ok(clearSpecies.indexOf('add_trait = mm_pod_dragon_race') < clearSpecies.indexOf('mm_pod_integrate_species_effect = yes'));
assert.match(clearSpecies, /remove_trait\s*=\s*mortal[\s\S]*?mm_pod_integrate_species_effect\s*=\s*yes\s*\}$/);
assert.equal((clearSpecies.match(/save_scope_as\s*=/g) || []).length, 0, 'species cleanup does not overwrite named caller scopes');
assert.equal((clearSpecies.match(/trigger_event\s*=/g) || []).length, 0, 'species cleanup does not dispatch an event that can replace scopes');

// Completion reuses the native seat transfer only when it has not already happened.
const nativeClaim = block(ascension, 'mm_asc_inherit_throne_effect');
const expectedFusionClaim = nativeClaim
  .replace(/^mm_asc_inherit_throne_effect\s*=/, 'mm_pod_claim_royal_seat_effect =')
  .replace(/^[\t ]*change_first_name\s*=\s*\{\s*template_character\s*=\s*var:mm_asc_blood_source\s*\}\n/m, '');
const fusionClaim = block(successionEffects, 'mm_pod_claim_royal_seat_effect');
assert.equal(fusionClaim, expectedFusionClaim, 'fusion receives the native seat/rank transfer without copying the source name');
assert.doesNotMatch(fusionClaim, /change_first_name|change_last_name/);
assert.match(fusionClaim, /mm_asc_current_incarnation\s+value\s*=\s*scope:mm_asc_claimant/);
assert.equal((fusionClaim.match(/save_scope_as\s*=/g) || []).length, 1, 'seat transfer has only its deliberate claimant scope binding');
assert.doesNotMatch(fusionClaim, /trigger_event/);
const complete = block(successionEffects, 'mm_pod_complete_royal_succession_effect');
assert.match(complete, /mm_pod_has_royal_trial_source\s*=\s*yes\s+has_trait\s*=\s*mm_asc_dragon_body/);
assert.match(complete, /mm_asc_is_current_incarnation\s*=\s*no\s+mm_asc_source_claim_valid\s*=\s*yes\s*\}\s*mm_pod_claim_royal_seat_effect/,
  'fusion claims a valid throne while erosion does not repeat its native claim');
assert.equal((complete.match(/mm_royal_queue_daily_effect\s*=\s*yes/g) || []).length, 1,
  'both completed outcomes queue the inherited king for normal daily royal maintenance');
const queueDaily = block(read('patches/wyvern-kings/mod/common/scripted_effects/mm_royal_identity_effects.txt'), 'mm_royal_queue_daily_effect');
assert.match(queueDaily, /NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_royal_daily_queued\s*\}/,
  'the existing idempotency flag makes repeated queue requests safe');
const sourceFinish = block(ascension, 'mm_asc_finish_body_effect');
const outputFinish = block(successionEffects, 'mm_asc_finish_body_effect');
assert.equal(outputFinish, sourceFinish.slice(0, -1) + '\n    mm_pod_complete_royal_succession_effect = yes\n}',
  'completion runs after the original body/list cleanup for both outcomes');
assert.match(outputFinish, /var:mm_asc_outcome\s*=\s*flag:dragon[\s\S]*?mm_royal_queue_daily_effect\s*=\s*yes[\s\S]*?mm_pod_complete_royal_succession_effect\s*=\s*yes/);

// Save repair is scoped to the two maintained ascension lists, never a world-wide character scan.
const repair = block(onAction, 'mm_pod_restore_royal_successions');
assert.match(onAction, /mm_asc_load\s*=\s*\{\s*on_actions\s*=\s*\{\s*mm_pod_restore_royal_successions\s*\}\s*\}/);
assert.deepEqual([...repair.matchAll(/every_in_global_list\s*=\s*\{\s*variable\s*=\s*([A-Za-z0-9_]+)/g)].map(match => match[1]),
  ['mm_asc_candidates', 'mm_asc_sovereigns']);
assert.match(repair, /variable\s*=\s*mm_asc_candidates\s+limit\s*=\s*\{\s*mm_asc_is_candidate\s*=\s*yes\s*\}\s+mm_pod_begin_royal_succession_effect\s*=\s*yes/);
assert.match(repair, /variable\s*=\s*mm_asc_sovereigns\s+limit\s*=\s*\{\s*is_alive\s*=\s*yes\s+has_trait\s*=\s*mm_asc_dragon_body\s*\}\s+mm_pod_complete_royal_succession_effect\s*=\s*yes/);
assert.doesNotMatch(repair, /every_character|every_living_character|every_vassal|every_courtier/);

// Fusion joins breeding/devouring eligibility without weakening existing king/current-incarnation guards.
const breedingSource = block(read('patches/wyvern-ascension/mod/common/scripted_triggers/zzzzzzzzzz_mm_ascension_breeding.txt'), 'mm_dragon_is_independent_royal_parent_trigger');
const breedingOutput = block(read('patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_succession_breeding.txt'), 'mm_dragon_is_independent_royal_parent_trigger');
const fusionOutcome = 'OR = { var:mm_asc_outcome = flag:dragon var:mm_asc_outcome = flag:fusion }';
assert.equal((breedingSource.match(/var:mm_asc_outcome = flag:dragon/g) || []).length, 1);
assert.equal(breedingOutput, breedingSource.replace('var:mm_asc_outcome = flag:dragon', fusionOutcome),
  'breeding trigger changes only the accepted ascension outcome');
assert.match(breedingOutput, /has_trait\s*=\s*mm_asc_dragon_body/);
assert.match(breedingOutput, /mm_royal_is_king\s*=\s*yes/);
assert.match(breedingOutput, /mm_asc_is_current_incarnation\s*=\s*yes/);
const devourSource = read('patches/wyvern-ascension/mod/common/character_interactions/zzzzzzzzzz_mm_ascension_devour.txt');
const devourOutput = read('patches/wyvern-pod/mod/common/character_interactions/zzzzzzzzzzzzzz_mm_pod_succession_devour.txt');
assert.equal((devourSource.match(/var:mm_asc_outcome = flag:dragon/g) || []).length, 2);
assert.equal(devourOutput, devourSource.replace(/var:mm_asc_outcome = flag:dragon/g, fusionOutcome),
  'devour interaction changes only the two outcome checks');
assert.match(devourOutput, /mm_royal_player_available\s*=\s*yes/);
assert.match(devourOutput, /mm_asc_pair_can_unite\s*=\s*yes/);
assert.match(devourOutput, /scope:recipient\s*=\s*var:mm_royal_twin/);

console.log('Wyvern + PoD succession independent static QA passed. This is not CK3 runtime evidence.');

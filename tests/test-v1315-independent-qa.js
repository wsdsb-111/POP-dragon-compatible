'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness: createRouteHarness } = require('./wyvern-v1311-finite-helper');
const { createHarness: createFamilyHarness } = require('./wyvern-v132-finite-helper');

const root = path.resolve(__dirname, '..');
const h = createRouteHarness(['wyvern-bloodline', 'wyvern-kings', 'dragon-creed', 'wyvern-ascension']);
const readBytes = relative => fs.readFileSync(path.join(root, relative));
const read = relative => readBytes(relative).toString('utf8').replace(/^\uFEFF/, '');
const parse = relative => h.parsePdx(read(relative), relative);
const branches = ['black', 'white', 'fire', 'earth', 'sea', 'sky'];

function only(nodes, key, label) {
  const matches = Array.from(nodes).filter(node => node.key === key);
  assert.equal(matches.length, 1, label + ': expected one ' + key);
  return matches[0];
}

function descendants(nodes, key) {
  return Array.from(nodes).flatMap(node => [
    ...(node.key === key ? [node] : []),
    ...(Array.isArray(node.value) ? descendants(node.value, key) : [])
  ]);
}

function localizationValue(source, key) {
  const lines = source.split(/\r?\n/).filter(line => new RegExp('^[\\t ]*' + key + ':0?\\s+').test(line));
  assert.equal(lines.length, 1, key + ': one localization entry');
  const match = /^[\t ]*[^:]+:0?\s+"(.*)"\s*$/.exec(lines[0]);
  assert.ok(match && match[1].length > 0, key + ': nonempty quoted description');
  return match[1];
}

// Existing seed founders keep their identity; only living biological descendants
// receive lineage tiers, even across House boundaries and dead intermediates.
{
  const seed = parse('patches/wyvern-bloodline/mod/common/scripted_effects/mm_dragon_lineage_initialization.txt');
  const family = only(seed, 'mm_dragon_seed_create_family_effect', 'existing founder seeding');
  for (const key of ['create_character', 'create_dynasty', 'set_house', 'set_father', 'set_real_father', 'change_first_name']) {
    assert.equal(descendants(family.value, key).length, 0, 'existing founder seeding does not run identity-changing ' + key);
  }
  const probe = only(seed, 'mm_dragon_seed_probe_ancestor_effect', 'biological ancestry probe');
  assert.ok(descendants(probe.value, 'mother').length > 0, 'the ancestry probe follows recorded mothers');
  assert.ok(descendants(probe.value, 'real_father').length > 0, 'the ancestry probe follows biological fathers rather than legal father alone');

  const familyHarness = createFamilyHarness(['wyvern-bloodline', 'wyvern-kings']);
  // Keep this fixture scoped to ancestry, identity preservation, and tier assignment.
  familyHarness.scriptedEffects.set('mm_dragon_append_biological_origin_effect', []);
  familyHarness.scriptedEffects.set('mm_dragon_route_creed_hook_effect', []);
  const founderHouse = { id: 'founder-house', dynasty: 'founder-dynasty' };
  const otherHouse = { id: 'other-house', dynasty: 'other-dynasty' };
  const thirdHouse = { id: 'third-house', dynasty: 'third-dynasty' };
  const person = (id, options = {}) => familyHarness.character(id, {
    name: 'Name ' + id,
    culture: 'culture:fixture',
    ...options
  });
  const founderMother = person('founder-mother');
  const founderFather = person('founder-father');
  const founder = person('existing-founder', {
    dynasty: founderHouse.dynasty,
    house: founderHouse,
    age: 45,
    mother: founderMother,
    father: founderFather,
    realFather: founderFather
  });
  const founderSpouse = person('founder-spouse', { house: otherHouse, dynasty: otherHouse.dynasty });
  const assumedFather = person('assumed-legal-father', { house: otherHouse, dynasty: otherHouse.dynasty });
  const unrelatedBiologicalFather = person('unrelated-biological-father', { house: thirdHouse, dynasty: thirdHouse.dynasty });
  const unrelatedMother = person('unrelated-mother', { house: thirdHouse, dynasty: thirdHouse.dynasty });
  const hiddenBastard = person('hidden-bastard', {
    house: otherHouse,
    dynasty: otherHouse.dynasty,
    mother: founderSpouse,
    father: assumedFather,
    realFather: founder
  });
  const biologicalGrandchild = person('biological-grandchild', {
    house: thirdHouse,
    dynasty: thirdHouse.dynasty,
    mother: unrelatedMother,
    father: assumedFather,
    realFather: hiddenBastard
  });
  const biologicalGreatGrandchild = person('biological-great-grandchild', {
    house: otherHouse,
    dynasty: otherHouse.dynasty,
    mother: unrelatedMother,
    father: assumedFather,
    realFather: biologicalGrandchild
  });
  const fifthGeneration = person('fifth-generation', {
    house: thirdHouse,
    dynasty: thirdHouse.dynasty,
    mother: unrelatedMother,
    father: assumedFather,
    realFather: biologicalGreatGrandchild
  });
  const deadIntermediate = person('dead-intermediate', {
    alive: false,
    house: otherHouse,
    dynasty: otherHouse.dynasty,
    mother: founderSpouse,
    father: assumedFather,
    realFather: founder
  });
  const livingGrandchildOfDead = person('living-grandchild-of-dead', {
    house: thirdHouse,
    dynasty: thirdHouse.dynasty,
    mother: unrelatedMother,
    father: assumedFather,
    realFather: deadIntermediate
  });
  const legalButUnrelatedChild = person('legal-but-unrelated-child', {
    house: founderHouse,
    dynasty: founderHouse.dynasty,
    mother: founderSpouse,
    father: founder,
    realFather: unrelatedBiologicalFather
  });
  const sameHouseCollateral = person('same-house-collateral', {
    house: founderHouse,
    dynasty: founderHouse.dynasty,
    mother: unrelatedMother,
    father: assumedFather,
    realFather: unrelatedBiologicalFather
  });
  const people = [
    founder, founderMother, founderFather, founderSpouse, assumedFather,
    unrelatedBiologicalFather, unrelatedMother, hiddenBastard,
    biologicalGrandchild, biologicalGreatGrandchild, fifthGeneration,
    livingGrandchildOfDead, legalButUnrelatedChild, sameHouseCollateral
  ];
  const allCharacters = [...people, deadIntermediate];
  const identityHash = character => require('node:crypto').createHash('sha256').update(JSON.stringify([
    character.id, character.name, character.dynasty, character.house?.id || null,
    character.culture, character.age, character.mother?.id || null,
    character.father?.id || null, character.realFather?.id || null, character.alive
  ])).digest('hex');
  const beforeIdentity = new Map(allCharacters.map(character => [character.id, identityHash(character)]));
  const origin = person('origin-source', { faith: 'faith:dragon-creed', rite: 'rite:fire' });
  const familyEnvironment = familyHarness.environment({ scopes: {
    mm_dragon_seed_origin: origin,
    mm_dragon_seed_founder: founder
  } });
  familyEnvironment.globalVars.set('mm_dragon_seed_family_index', 0);
  familyEnvironment.globalLists.set('mm_dragon_seed_people', people);
  familyEnvironment.characters = new Map(allCharacters.map(character => [character.id, character]));
  familyHarness.run('mm_dragon_seed_create_family_effect', founder, familyEnvironment);

  const generation = character => character.vars.get('mm_dragon_lineage_generation');
  const lineageTraits = ['mm_dragon_lineage_1', 'mm_dragon_lineage_2', 'mm_dragon_lineage_3', 'mm_dragon_lineage_4'];
  const assertUninfected = character => {
    assert.equal(character.vars.has('mm_dragon_lineage_generation'), false, character.id + ': no biological path to the founder means no generation');
    assert.equal(lineageTraits.some(trait => character.traits.has(trait)), false, character.id + ': no lineage trait is added');
  };
  assert.equal(generation(founder), 1, 'the first existing House founder receives generation 1');
  assert.equal(generation(hiddenBastard), 2, 'a hidden bastard follows real_father even when legal father differs');
  assert.equal(generation(biologicalGrandchild), 3, 'real-father descendants inherit one generation per edge');
  assert.equal(generation(biologicalGreatGrandchild), 4, 'the fourth generation remains within the ancestry cap');
  assert.ok(hiddenBastard.house === otherHouse && biologicalGrandchild.house === thirdHouse, 'true descendants inherit across House boundaries without House reassignment');
  assert.equal(deadIntermediate.alive, false);
  assertUninfected(deadIntermediate);
  assert.equal(generation(livingGrandchildOfDead), 3, 'the probe traverses a dead intermediate but seeds its living grandchild');
  assertUninfected(legalButUnrelatedChild);
  assertUninfected(sameHouseCollateral);
  assertUninfected(fifthGeneration);
  assert.equal(familyEnvironment.createdCharacters.length, 0, 'existing-character seeding creates no characters or Houses');
  for (const character of allCharacters) {
    assert.equal(identityHash(character), beforeIdentity.get(character.id), character.id + ': identity hash fields remain unchanged');
  }
}

// Loading an old save without the new-game pending marker must not scan or
// rewrite existing characters, including players who changed House, inherited
// a House, or belong to a matrilineal House. Same-name identities stay separate.
{
  const actions = parse('patches/wyvern-bloodline/mod/common/on_action/mm_dragon_lineage_initialization.txt');
  const initialize = only(actions, 'mm_dragon_seed_initialize_campaign', 'seed startup gate');
  const initializeEffect = only(initialize.value, 'effect', 'seed startup gate').value;
  const gate = only(initializeEffect, 'if', 'seed startup gate');
  const limit = only(gate.value, 'limit', 'new campaign only seed gate').value;
  assert.ok(limit.some(node => node.key === 'has_global_variable' && node.value === 'mm_dragon_seed_new_campaign_pending'), 'fresh campaign marker is required');
  assert.equal(h.scalar(only(limit, 'NOT', 'one-time seed initialization').value, 'has_global_variable', 'one-time seed initialization'), 'mm_lineage_families_initialized_v132');
  assert.equal(descendants(initializeEffect, 'every_living_character').length, 1, 'new-campaign candidate collection exists once');
  assert.equal(descendants(gate.value, 'every_living_character').length, 1, 'candidate collection remains inside the fresh-campaign gate');
  assert.equal(descendants(initializeEffect, 'set_house').length, 0, 'old saves do not receive automatic House rewrites');

  const people = [
    h.character('75456', { name: '云沐', dynasty: 'player_dynasty', house: 'player_changed_house' }),
    h.character('inherited-person', { name: '继承者', dynasty: 'old_dynasty', house: 'inherited_house' }),
    h.character('matrilineal-person', { name: '母系后代', dynasty: 'maternal_dynasty', house: 'maternal_house' }),
    h.character('same-name-other-id', { name: '云沐', dynasty: 'unrelated_dynasty', house: 'unrelated_house' })
  ];
  const env = h.environment({ root: people[0] });
  env.characters = new Map(people.map(person => [person.id, person]));
  h.scriptedEffects.set('qa_v1315_seed_initialize', initializeEffect);
  const before = people.map(person => ({ id: person.id, name: person.name, dynasty: person.dynasty, house: person.house }));
  h.run('qa_v1315_seed_initialize', people[0], env);
  assert.deepEqual(people.map(person => ({ id: person.id, name: person.name, dynasty: person.dynasty, house: person.house })), before, 'unmarked old-save characters remain unchanged');
  assert.equal(env.createdCharacters.length, 0, 'old save load creates no replacement seed family');
}

// Royal profile repair also invokes the creed hook after throne identity is synchronized.
{
  const profile = parse('patches/wyvern-kings/mod/common/scripted_effects/mm_royal_profile_effects.txt');
  const repair = only(profile, 'mm_royal_repair_profile_effect', 'royal profile creed hook').value;
  const guard = only(repair, 'if', 'royal profile repair guard').value;
  const actions = guard.filter(node => node.key !== 'limit');
  const syncIndex = actions.findIndex(node => node.key === 'mm_royal_sync_throne_identity_trait_effect');
  const routeIndex = actions.findIndex(node => node.key === 'mm_dragon_route_creed_hook_effect');
  assert.ok(syncIndex >= 0 && routeIndex > syncIndex, 'royal profile repair routes creed after synchronizing throne identity');
}

// Royals route from their own rank/throne before contaminated biological flags
// or a stale current rite. Ordinary multi-source characters still keep a
// current rite backed by biological evidence; absorbed branches do not count.
{
  const riteDefinitions = parse('patches/dragon-creed/mod/common/religion/rite_types/mm_dragon_creed.txt');
  const riteTypes = new Map(branches.map(branch => {
    const id = 'mm_dragon_' + branch;
    const definition = only(riteDefinitions, id, id + ' rite').value;
    return [id, {
      faith: 'faith:mm_dragon_creed',
      tenets: Array.from(only(definition, 'tenets', id + ' tenets').value, node => node.key),
      doctrines: Array.from(only(definition, 'doctrines', id + ' doctrines').value, node => node.key)
    }];
  }));
  const rites = new Map(branches.map(branch => {
    const id = 'mm_dragon_' + branch;
    return [id, { id, faith: 'faith:mm_dragon_creed', tenets: new Set(riteTypes.get(id).tenets), doctrines: new Set(riteTypes.get(id).doctrines) }];
  }));
  const env = h.environment({ rites, riteTypes });
  const contaminatedBio = Object.fromEntries(branches.map(branch => ['mm_dragon_bio_' + branch, true]));
  const royalCases = [
    { id: '99001001', branch: 'fire', throne: 1 }, { id: '99001305', branch: 'fire', throne: 1 },
    { id: '99001002', branch: 'earth', throne: 2 }, { id: '99001306', branch: 'earth', throne: 2 },
    { id: '99001003', branch: 'sea', throne: 3 }, { id: '99001307', branch: 'sea', throne: 3 },
    { id: '99001304', branch: 'sky', throne: 4 }, { id: '99001308', branch: 'sky', throne: 4 },
    { id: '99001309', branch: 'black', trait: 'mm_royal_black_emperor' },
    { id: '99001310', branch: 'white', trait: 'mm_royal_white_empress' }
  ];

  for (const sample of royalCases) {
    const vars = { ...contaminatedBio, mm_royal_creation_throne: sample.throne ? sample.throne % 4 + 1 : 1 };
    if (sample.throne) vars.mm_royal_throne = sample.throne;
    const traits = ['myv_wyvern_legendary', sample.trait || 'mm_royal_dragon_king'];
    const person = h.character(sample.id, { traits, vars, faith: 'faith:mm_dragon_creed' });
    const wrong = branches.find(branch => branch !== sample.branch);
    person.rite = env.rites.get('mm_dragon_' + wrong);
    env.characters.set(sample.id, person);
    h.run('mm_dragon_route_creed_effect', person, env);
    assert.equal(person.rite.id, 'mm_dragon_' + sample.branch, sample.id + ': canonical royal identity outranks bio_* and current rite');
    assert.equal(person.faith, 'faith:mm_dragon_creed');
  }

  for (const [index, sample] of ['fire', 'earth', 'sea', 'sky'].entries()) {
    const throne = index + 1;
    const anchor = h.character('legal-seat-' + sample);
    const heir = h.character('current-heir-' + sample, {
      traits: ['myv_wyvern_legendary', 'mm_royal_complete'],
      vars: { ...contaminatedBio, mm_royal_throne: throne, mm_royal_creation_throne: throne % 4 + 1 },
      faith: 'faith:mm_dragon_creed'
    });
    heir.vars.set('mm_asc_seat_anchor', anchor);
    heir.vars.set('mm_asc_outcome', 'flag:dragon');
    anchor.vars.set('mm_asc_current_incarnation', heir);
    heir.rite = env.rites.get('mm_dragon_' + branches.find(branch => branch !== sample));
    h.run('mm_dragon_route_creed_effect', heir, env);
    assert.equal(heir.rite.id, 'mm_dragon_' + sample, 'legal current inheritor routes to its own throne');
  }

  const multi = h.character('ordinary-multi-source', {
    traits: ['mm_dragon_lineage_2'],
    vars: { mm_dragon_bio_fire: true, mm_dragon_bio_sea: true, mm_dragon_absorbed_white: true },
    faith: 'faith:mm_dragon_creed'
  });
  multi.rite = env.rites.get('mm_dragon_sea');
  h.run('mm_dragon_route_creed_effect', multi, env);
  assert.equal(multi.rite.id, 'mm_dragon_sea', 'ordinary mixed biology preserves its valid current rite');

  const absorbed = h.character('absorbed-is-not-biology', {
    traits: ['mm_dragon_lineage_2'],
    vars: { mm_dragon_bio_fire: true, mm_dragon_absorbed_sea: true },
    faith: 'faith:mm_dragon_creed'
  });
  absorbed.rite = env.rites.get('mm_dragon_sea');
  h.run('mm_dragon_route_creed_effect', absorbed, env);
  assert.equal(absorbed.rite.id, 'mm_dragon_fire', 'absorbed sea cannot authorize a sea rite');
}

// The three public creed/faith summaries consistently call the origin Black Emperor.
{
  const chinese = read('patches/dragon-creed/mod/localization/simp_chinese/mm_dragon_creed_l_simp_chinese.yml');
  for (const key of ['mm_dragon_creed_desc', 'mm_dragon_creed_religion_desc', 'mm_dragon_black_desc']) {
    const description = localizationValue(chinese, key);
    assert.match(description, /黑皇/, key + ': use the corrected title');
    assert.doesNotMatch(description, /黑王/, key + ': remove the old title');
  }
}

console.log('v1.3.15 independent family, royal-route, old-save-boundary, and localization QA passed; CK3 engine behavior not exercised');

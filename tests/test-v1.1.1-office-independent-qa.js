"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Independent QA registered by tests/run-tests.js.
// This AST suite evaluates the current PDX definitions through the existing
// limited harness; native CK3 succession ordering and external engine effects
// remain outside the simulator and are never reported as proven here.
// Reuse the existing production PDX parser and limited interpreter without
// executing that file's old, unrelated test suite on import.
const legacyQaPath = path.join(__dirname, "test-v8.15.2-celestial-office-independent-qa.js");
const legacyQaSource = fs.readFileSync(legacyQaPath, "utf8");
const legacyRunCall = /\r?\nrun\(\);\s*$/;
assert(legacyRunCall.test(legacyQaSource), "the legacy QA runner boundary changed; review the harness adapter");
const legacyExports = [
  "child", "scalar", "named", "title", "character", "evalTrigger", "executeEntries", "envFor",
  "invokeHook", "runLateralRecheckEvent", "triggerFile", "actionFile", "effectFile", "eventFile",
  "regionTriggerFile", "regionEffectFile", "successionFile", "triggerDefs", "effectDefs", "TIERS"
];
const legacyModule = { exports: {} };
const legacySandbox = {
  require,
  __dirname,
  module: legacyModule,
  console
};
vm.runInNewContext(legacyQaSource.replace(legacyRunCall,
  `\nmodule.exports = { ${legacyExports.join(", ")} };\n`), legacySandbox,
{ filename: legacyQaPath });
const qa = legacyModule.exports;

const API = {
  scopeTrigger: "votc_celestial_office_scope_trigger",
  managedTitleTrigger: "votc_celestial_office_managed_title_trigger",
  candidateTrigger: "votc_celestial_office_candidate_trigger",
  expectedGainTrigger: "votc_celestial_office_expected_gain_trigger",
  reconcileEffect: "votc_celestial_office_reconcile_character_effect",
  handoffEffect: "votc_celestial_office_handoff_title_effect",
  workerEffect: "votc_celestial_office_worker_effect",
  extraDuchyTrigger: "votc_celestial_region_extra_duchy_candidate_trigger",
  assignExtraDuchyEffect: "votc_celestial_region_assign_extra_duchy_effect"
};

function requireDefinition(definitions, name, description) {
  const definition = definitions[name];
  assert(definition && Array.isArray(definition.entries),
    `${description} must be a named production PDX definition: ${name}`);
  return definition;
}

function makeRealm(prefix, options = {}) {
  const realmLawFlags = options.realmLawFlags || ["celestial_bureaucrat"];
  const chinaTitle = qa.title(options.noHegemon === true ? `e_${prefix}_local_empire` : "h_china",
    qa.TIERS.tier_empire, null);
  const emperor = qa.character(`${prefix}_emperor`, {
    primary_title: chinaTitle,
    highest_held_title_tier: qa.TIERS.tier_empire,
    independent: true,
    realm_law_flags: realmLawFlags,
    government_flags: ["government_is_celestial"]
  });
  chinaTitle.holder = emperor;
  emperor.held_titles.push(chinaTitle);
  emperor.top_liege = emperor;

  const foreignEmpire = options.foreign === true ? qa.title(`e_${prefix}_foreign`, qa.TIERS.tier_empire, null) : null;
  const foreignEmperor = foreignEmpire ? qa.character(`${prefix}_foreign_emperor`, {
    primary_title: foreignEmpire,
    highest_held_title_tier: qa.TIERS.tier_empire,
    independent: true,
    realm_law_flags: realmLawFlags,
    government_flags: ["government_is_celestial"]
  }) : null;
  if (foreignEmpire) {
    foreignEmpire.holder = foreignEmperor;
    foreignEmperor.held_titles.push(foreignEmpire);
    foreignEmperor.top_liege = foreignEmperor;
  }

  const officeTier = options.officeTier ?? qa.TIERS.tier_duchy;
  const officePrefix = officeTier === qa.TIERS.tier_empire ? "e" :
    officeTier === qa.TIERS.tier_kingdom ? "k" : officeTier === qa.TIERS.tier_county ? "c" : "d";
  const office = qa.title(`${officePrefix}_${prefix}_office`, officeTier, null, {
    title_law_flags: options.officeLaw === false ? [] : ["appointment_type_succession"]
  });
  const holder = qa.character(`${prefix}_holder`, {
    top_liege: options.foreign === true ? foreignEmperor : emperor,
    liege: options.foreign === true ? foreignEmperor : emperor,
    primary_title: office,
    highest_held_title_tier: officeTier,
    realm_law_flags: realmLawFlags,
    government_flags: options.nonBureaucrat === true ? [] : ["government_is_bureau"]
  });
  office.holder = holder;
  holder.held_titles.push(office);
  holder.liege?.vassals.push(holder);
  return {
    prefix,
    chinaTitle,
    emperor,
    foreignEmpire,
    foreignEmperor,
    office,
    holder,
    titles: [chinaTitle, office, ...(foreignEmpire ? [foreignEmpire] : [])],
    characters: [emperor, holder, ...(foreignEmperor ? [foreignEmperor] : [])]
  };
}

function addHeldTitle(realm, id, tier, options = {}) {
  const title = qa.title(id, tier, realm.holder, {
    title_law_flags: options.office === false ? [] : ["appointment_type_succession"],
    title_laws: options.title_laws || [],
    noble_family: options.nobleFamily === true,
    landless: options.landless === true,
    leased_out: options.leasedOut === true,
    de_jure_ancestors: options.deJureAncestors || [],
    de_jure_liege: options.deJureLiege || null,
    baronies: options.baronies || []
  });
  realm.holder.held_titles.push(title);
  realm.holder.highest_held_title_tier = Math.max(realm.holder.highest_held_title_tier, tier);
  realm.titles.push(title);
  return title;
}

function addVassal(realm, id, tier, options = {}) {
  const vassalTitle = qa.title(options.titleId || `c_${id}`, tier, null, {
    title_law_flags: options.office === false ? [] : ["appointment_type_succession"],
    de_jure_ancestors: options.deJureAncestors || [],
    de_jure_liege: options.deJureLiege || null
  });
  const vassal = qa.character(id, {
    primary_title: vassalTitle,
    highest_held_title_tier: tier,
    realm_law_flags: realm.holder.realm_law_flags,
    top_liege: realm.emperor,
    government_flags: ["government_is_bureau"],
    liege: realm.holder
  });
  vassalTitle.holder = vassal;
  vassal.held_titles.push(vassalTitle);
  realm.holder.vassals.push(vassal);
  realm.characters.push(vassal);
  realm.titles.push(vassalTitle);
  return { character: vassal, title: vassalTitle };
}

function addChinaOfficeHolder(realm, id, bureaucrat = true) {
  const tier = qa.TIERS.tier_duchy;
  const office = qa.title(`d_${id}_office`, tier, null,
    { title_law_flags: ["appointment_type_succession"] });
  const holder = qa.character(id, {
    top_liege: realm.emperor,
    liege: realm.emperor,
    primary_title: office,
    highest_held_title_tier: tier,
    realm_law_flags: realm.emperor.realm_law_flags,
    government_flags: bureaucrat ? ["government_is_bureau"] : []
  });
  office.holder = holder;
  holder.held_titles.push(office);
  realm.emperor.vassals.push(holder);
  realm.characters.push(holder);
  realm.titles.push(office);
  return { holder, office };
}

function makeEnv(realm, current = realm.holder, scopes = {}) {
  const env = qa.envFor(current, current, scopes);
  env.simulateTitleTransfers = true;
  env.worldRulers = realm.characters;
  env.titleLookup = new Map(realm.titles.map(title => [title.id, title]));
  return env;
}

function executeEvent(id, env) {
  const event = qa.named(qa.eventFile, id);
  const eventTrigger = qa.child(event, "trigger");
  if (eventTrigger && !qa.evalTrigger(eventTrigger, env)) return false;
  qa.executeEntries(qa.child(event, "immediate"), env);
  return true;
}

function executeScheduledNamedEvent(id, env, expectedTrigger = true) {
  const index = env.scheduledEvents.findIndex(item => item.id === id);
  assert.notEqual(index, -1, `the durable queue must have a scheduled ${id} event`);
  const [scheduled] = env.scheduledEvents.splice(index, 1);
  assert.equal(scheduled.owner, env.current, `${id} runs for its scheduled expected owner`);
  const previousScopes = env.scopes;
  env.scopes = { ...(scheduled.scopes || {}) };
  try {
    assert.equal(executeEvent(id, env), expectedTrigger,
      expectedTrigger ? `${id} must pass its production event trigger` : `${id} must reject its stale event scope`);
  } finally {
    env.scopes = previousScopes;
  }
  return scheduled;
}

function testHarnessResolvesNativePrimaryTitleRefs() {
  const realm = makeRealm("native_primary_title_ref");
  const trigger = {
    entries: [{ key: "has_primary_title", op: "=", value: "title:h_china", line: 1 }]
  };
  const env = makeEnv(realm, realm.emperor);
  assert.equal(qa.evalTrigger(trigger, env), true,
    "the AST harness resolves CK3 has_primary_title = title:<id> references as title scopes");
  realm.emperor.primary_title = realm.office;
  assert.equal(qa.evalTrigger(trigger, env), false,
    "a different primary title does not satisfy a native title-reference predicate");
}

function runPostGrantOfficeReconciliation(realm, onTitleTransfer = null) {
  const env = makeEnv(realm, realm.holder, {
    title: realm.office,
    transfer_type: "appointment_succession"
  });
  if (onTitleTransfer) env.onTitleTransfer = onTitleTransfer;
  qa.invokeHook("on_title_gain", env);
  const queuedWorker = env.scheduledEvents.find(item => item.id === "votc_celestial_office_release.0004");
  assert(queuedWorker, "the native post-grant callback must schedule the durable transaction worker");
  assert.equal(queuedWorker.days, "1", "unfinished reconciliation continues on the next daily worker tick");
  assert.equal(queuedWorker.owner, realm.holder, "the worker is owned by the character whose transaction is queued");
  drainScheduledWorkers(env);
  return env;
}

function processNextScheduledWorker(env, expectedOwner = null) {
  const index = env.scheduledEvents.findIndex(item => item.id === "votc_celestial_office_release.0004" &&
    (expectedOwner === null || item.owner === expectedOwner));
  if (index < 0) return false;
  const [scheduled] = env.scheduledEvents.splice(index, 1);
  assert.equal(scheduled.days, "1", "transaction work advances in one-day durable steps");
  assert.equal(scheduled.owner, expectedOwner || scheduled.owner, "the durable event remains on the task's character owner");
  const oldRoot = env.root;
  const oldCurrent = env.current;
  const oldScopes = env.scopes;
  env.root = scheduled.owner;
  env.current = scheduled.owner;
  env.scopes = { ...(scheduled.scopes || {}) };
  try {
    assert(executeEvent("votc_celestial_office_release.0004", env),
      "the scheduled daily worker must process the production transaction event");
  } finally {
    env.root = oldRoot;
    env.current = oldCurrent;
    env.scopes = oldScopes;
  }
  env.processedWorkerDays = (env.processedWorkerDays || 0) + Number(scheduled.days);
  env.processedWorkerOwners ||= [];
  env.processedWorkerOwners.push(scheduled.owner);
  return true;
}

function drainScheduledWorkers(env, maxSteps = 64) {
  let steps = 0;
  while (processNextScheduledWorker(env)) {
    steps += 1;
    assert(steps <= maxSteps, "the durable worker must converge instead of retrying forever");
  }
  return steps;
}

function snapshot(realm) {
  const characterState = realm.characters.map(person => ({
    id: person.id,
    alive: person.alive,
    landed: person.landed,
    primary: person.primary_title?.id || null,
    highest: person.highest_held_title_tier,
    held: Array.from(person.held_titles, item => item.id).sort(),
    liege: person.liege?.id || null,
    topLiege: person.top_liege?.id || null,
    vassals: Array.from(person.vassals, item => item.id).sort(),
    flags: Array.from(person.flags || []).sort(),
    governmentFlags: Array.from(person.government_flags || []).sort(),
    realmLawFlags: Array.from(person.realm_law_flags || []).sort(),
    realmLaws: Array.from(person.realm_laws || []).sort(),
    traits: Array.from(person.traits || []).sort(),
    contractFlags: Array.from(person.contract_flags || []).sort(),
    variables: Array.from(person.variables).sort(),
    values: Array.from(person.variableValues, ([key, value]) => [key, value?.id || value]).sort((a, b) => a[0].localeCompare(b[0])),
    lists: Array.from(person.variableLists || [], ([key, value]) => [key, Array.from(value, item => item?.id || item).sort()])
      .sort((a, b) => a[0].localeCompare(b[0]))
  }));
  const titleState = realm.titles.map(item => ({
    id: item.id,
    holder: item.holder?.id || null,
    titleLawFlags: Array.from(item.title_law_flags || []).sort(),
    titleLaws: Array.from(item.title_laws || []).sort(),
    variables: Array.from(item.variables || []).sort(),
    values: Array.from(item.variableValues || [], ([key, value]) => [key, value?.id || value])
      .sort((a, b) => a[0].localeCompare(b[0])),
    lists: Array.from(item.variableLists, ([key, value]) => [key, Array.from(value, member => member?.id || member).sort()])
      .sort((a, b) => a[0].localeCompare(b[0]))
  }));
  return JSON.stringify({ characterState, titleState });
}

function testChinaOnlyScopeAndZeroWrites() {
  const scope = requireDefinition(qa.triggerDefs, API.scopeTrigger, "scope trigger");
  const inScope = makeRealm("scope_china");
  const inScopeEnv = makeEnv(inScope, inScope.holder, { title: inScope.office });
  assert.equal(qa.evalTrigger(scope, inScopeEnv), true,
    "an OE-recognized bureau office under the actual h_china emperor is in scope");

  function assertExcludedWithoutWrites(realm, title, reason) {
    title.variableLists.set("votc_celestial_lateral_handoff_path", [realm.holder]);
    const before = snapshot(realm);
    const env = makeEnv(realm, realm.holder, { title, transfer_type: "appointment_succession" });
    assert.equal(qa.evalTrigger(scope, env), false, reason);
    qa.invokeHook("on_title_gain", env);
    assert.equal(snapshot(realm), before, `${reason}; no character, title, variable, or realm state may change`);
    assert.equal(env.changes.length, 0, `${reason}; no title or liege write may be queued`);
    assert.equal(env.scheduledEvents.length, 0, `${reason}; no reconciliation task may be scheduled`);
  }

  const foreign = makeRealm("scope_foreign", { foreign: true });
  const foreignOffice = addHeldTitle(foreign, "d_scope_foreign_extra_office", qa.TIERS.tier_duchy);
  foreign.holder.primary_title = foreignOffice;
  foreign.holder.highest_held_title_tier = qa.TIERS.tier_duchy;
  assertExcludedWithoutWrites(foreign, foreignOffice,
    "a self-declared Celestial ruler outside h_china receives no cleanup");

  const nonBureau = makeRealm("scope_non_bureau", { nonBureaucrat: true });
  assertExcludedWithoutWrites(nonBureau, nonBureau.office,
    "a h_china vassal outside the civil-service office system is excluded");

  const noHegemon = makeRealm("scope_no_hegemon", { foreign: true, noHegemon: true });
  assertExcludedWithoutWrites(noHegemon, noHegemon.office,
    "a Celestial splinter empire without h_china receives no production writes");

  const protectedOfficial = makeRealm("scope_protected_trait");
  protectedOfficial.holder.traits.add("great_misit");
  assertExcludedWithoutWrites(protectedOfficial, protectedOfficial.office,
    "the OE great_misit protection excludes an otherwise eligible official");

  const protectedHeir = makeRealm("scope_protected_heir");
  protectedHeir.holder.contract_flags.add("heir_succession_rights_unlock");
  assertExcludedWithoutWrites(protectedHeir, protectedHeir.office,
    "the contract heir-succession protection excludes an otherwise eligible official");

  const protectedTitular = makeRealm("scope_protected_titular");
  protectedTitular.office.variables.add("titular_title");
  assertExcludedWithoutWrites(protectedTitular, protectedTitular.office,
    "titular titles are not treated as ordinary landed civil-service offices");
}

function testExplicitSuccessionLawsWithoutAppointmentFlag() {
  const managedTitle = requireDefinition(qa.triggerDefs, API.managedTitleTrigger,
    "managed office title trigger");
  for (const law of ["official_succession_law", "admin_succession_law"]) {
    const realm = makeRealm(`law_only_${law}`);
    const incomingOffice = addHeldTitle(realm, `c_law_only_${law}`, qa.TIERS.tier_county,
      { office: false, title_laws: [law] });
    const env = makeEnv(realm, realm.holder, {
      title: incomingOffice,
      transfer_type: "appointment_succession"
    });

    assert.equal(incomingOffice.title_law_flags.size, 0,
      `${law} fixture has no appointment_type_succession flag to mask missing law recognition`);
    assert.equal(incomingOffice.title_laws.has(law), true, `${law} is present as its native title law`);
    assert.equal(qa.evalTrigger(managedTitle, { ...env, current: incomingOffice, previous: realm.holder }), true,
      `${law} alone makes a landed title a managed office`);
    qa.invokeHook("on_title_gain", env);
    assert.equal(incomingOffice.variableValues.get("votc_celestial_office_expected_holder"), realm.holder,
      `${law}-only office gain records its expected holder`);
    assert(realm.holder.variableLists.get("votc_celestial_office_task_unvalidated_titles")
      ?.includes(incomingOffice), `${law}-only office gain is queued for post-settlement validation`);
    assert(env.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0004"),
      `${law}-only office gain schedules the durable worker`);
  }
}

function testEmpireOfficeHasNoLowerLandOrLandedVassals() {
  const realm = makeRealm("empire_holder", { officeTier: qa.TIERS.tier_empire });
  const oldCounty = addHeldTitle(realm, "c_empire_illegal", qa.TIERS.tier_county);
  const oldDuchy = addHeldTitle(realm, "d_empire_illegal", qa.TIERS.tier_duchy);
  const familyTitle = addHeldTitle(realm, "d_empire_house", qa.TIERS.tier_duchy,
    { office: false, nobleFamily: true });
  const vassal = addVassal(realm, "empire_landed_vassal", qa.TIERS.tier_county);
  const env = runPostGrantOfficeReconciliation(realm);

  assert.equal(oldCounty.holder, realm.emperor, "an imperial office holder returns every low office title to h_china");
  assert.equal(oldDuchy.holder, realm.emperor, "an imperial office holder cannot retain a duchy title");
  assert.equal(familyTitle.holder, realm.holder, "the cleanup protects the person's separate noble-family identity");
  assert.equal(vassal.character.liege, realm.emperor,
    "a landed direct vassal is reassigned to the emperor without transferring the vassal's title");
  assert.equal(vassal.title.holder, vassal.character,
    "vassal repair changes liege and preserves the vassal's property");
  assert.equal(env.changes.some(change => change.type === "change_title_holder" && change.subject === vassal.title), false,
    "a vassal's own title is never treated as the holder's personal title");
}

function testCountyTransferAndVassalLiegeChangeAreDifferentOperations() {
  const realm = makeRealm("territory_boundary", { officeTier: qa.TIERS.tier_kingdom });
  const outsideDuchy = qa.title("d_outside_territory", qa.TIERS.tier_duchy, null);
  const foreignCounty = addHeldTitle(realm, "c_outside_kingdom", qa.TIERS.tier_county,
    { deJureLiege: outsideDuchy });
  const foreignVassal = addVassal(realm, "outside_county_vassal", qa.TIERS.tier_county,
    { deJureLiege: outsideDuchy });
  const env = runPostGrantOfficeReconciliation(realm);

  assert.notEqual(foreignCounty.holder, realm.holder,
    "the holder's own out-of-jurisdiction county is transferred as a title");
  assert.equal(foreignVassal.character.liege, realm.emperor,
    "an out-of-jurisdiction direct vassal is changed to a legal liege");
  assert.equal(foreignVassal.title.holder, foreignVassal.character,
    "changing a vassal's liege leaves the vassal's title with that vassal");
  assert(env.changes.some(change => change.type === "change_title_holder" && change.subject === foreignCounty));
  assert(env.changes.some(change => change.type === "change_liege" && change.subject === foreignVassal.character));
}

function testSameRankPostGrantReconciliationReleasesOldEstate() {
  const realm = makeRealm("same_rank_handoff", { officeTier: qa.TIERS.tier_duchy });
  const priorOffice = realm.office;
  const newOffice = qa.title("d_new_district", qa.TIERS.tier_duchy, realm.holder,
    { title_law_flags: ["appointment_type_succession"] });
  realm.holder.held_titles.push(newOffice);
  realm.holder.primary_title = newOffice;
  realm.holder.highest_held_title_tier = qa.TIERS.tier_duchy;
  realm.titles.push(newOffice);

  const oldCounty = addHeldTitle(realm, "c_old_district", qa.TIERS.tier_county,
    { deJureAncestors: [newOffice] });
  const oldVassal = addVassal(realm, "old_district_vassal", qa.TIERS.tier_county);
  const secondOldVassal = addVassal(realm, "second_old_district_vassal", qa.TIERS.tier_county);

  const env = makeEnv(realm, realm.holder, { title: newOffice, transfer_type: "appointment_succession" });
  assert.equal(newOffice.holder, realm.holder,
    "the native same-rank appointment may already be settled before the VOTC callback runs");
  assert.equal(realm.holder.primary_title, newOffice,
    "the post-grant fixture starts with the new office as primary");
  assert.equal(priorOffice.holder, realm.holder,
    "old land is still present when post-grant reconciliation begins");

  qa.invokeHook("on_title_gain", env);
  const queuedWorker = env.scheduledEvents.find(item => item.id === "votc_celestial_office_release.0004");
  assert(queuedWorker, "a real same-rank title-gain hook queues the durable reconciliation worker");
  assert.equal(queuedWorker.days, "1", "unfinished reconciliation continues on the next daily worker tick");
  assert.equal(queuedWorker.owner, realm.holder, "the worker is owned by the character whose transaction is queued");
  assert(processNextScheduledWorker(env), "the first daily worker step must capture the old-estate snapshot");
  const firstStepReleasedVassals = [oldVassal, secondOldVassal]
    .filter(item => item.character.liege === realm.emperor).length;
  assert.equal(firstStepReleasedVassals, 1,
    "the first daily step releases exactly one old direct vassal before any old title");
  assert.equal(priorOffice.holder, realm.holder, "the old office remains until every old vassal is released");
  assert.equal(oldCounty.holder, realm.holder, "the old county remains during the vassal release phase");
  assert.equal(env.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0004" && item.days === "1"), true,
    "unfinished transaction work is continued daily with no two-day expiry");
  assert(drainScheduledWorkers(env) >= 3, "the transaction releases all assets in bounded daily steps");

  const transfers = env.changes.filter(change => change.type === "change_title_holder");
  const oldOfficeTransfer = transfers.findIndex(change => change.subject === priorOffice);
  const oldCountyTransfer = transfers.findIndex(change => change.subject === oldCounty);
  assert.notEqual(priorOffice.holder, realm.holder, "same-rank reassignment gives up every old office title");
  assert.notEqual(oldCounty.holder, realm.holder, "same-rank reassignment gives up old counties even when the new region is related");
  assert.equal(oldVassal.character.liege, realm.emperor, "same-rank reassignment releases old landed vassals");
  assert(oldOfficeTransfer >= 0 && oldCountyTransfer >= 0, "the old office and county use title-transfer operations");
  assert.equal(realm.holder.primary_title, newOffice,
    "post-grant reconciliation keeps the natively assigned new primary office");
  assert.equal(newOffice.holder, realm.holder, "the newly received office remains with the incoming office holder");
  const lastLiegeChange = env.changes.reduce((index, change, current) =>
    change.type === "change_liege" ? current : index, -1);
  const firstTitleChange = env.changes.findIndex(change => change.type === "change_title_holder");
  assert(lastLiegeChange < firstTitleChange,
    "every old direct vassal is re-lieghed before old office/title release starts");
}

function testChangedLateralAnchorStopsLaterWrites() {
  const realm = makeRealm("stale_lateral_anchor", { officeTier: qa.TIERS.tier_duchy });
  const priorOffice = realm.office;
  const newOffice = qa.title("d_stale_anchor_new_office", qa.TIERS.tier_duchy, realm.holder,
    { title_law_flags: ["appointment_type_succession"] });
  realm.holder.held_titles.push(newOffice);
  realm.holder.primary_title = newOffice;
  realm.titles.push(newOffice);
  const oldCounty = addHeldTitle(realm, "c_stale_anchor_old_county", qa.TIERS.tier_county);
  const oldVassals = [
    addVassal(realm, "stale_anchor_vassal_one", qa.TIERS.tier_county),
    addVassal(realm, "stale_anchor_vassal_two", qa.TIERS.tier_county)
  ];
  const env = makeEnv(realm, realm.holder, { title: newOffice, transfer_type: "appointment_succession" });

  qa.invokeHook("on_title_gain", env);
  assert.equal(realm.holder.variableValues.get("votc_celestial_office_task_anchor_title"), newOffice,
    "a lateral grant records the actual new primary office as its durable transaction anchor");
  assert(processNextScheduledWorker(env), "the first bounded worker validates its anchor and snapshots old property");
  const releasedAfterFirstStep = oldVassals.filter(item => item.character.liege === realm.emperor).length;
  assert.equal(releasedAfterFirstStep, 1,
    "the first step releases one of the old direct vassals without depending on random selection order");
  assert.equal(priorOffice.holder, realm.holder, "the old office remains queued after the first vassal step");
  assert.equal(oldCounty.holder, realm.holder, "the old county remains queued after the first vassal step");

  newOffice.holder = realm.emperor;
  realm.holder.held_titles = realm.holder.held_titles.filter(item => item !== newOffice);
  realm.emperor.held_titles.push(newOffice);
  const changesBeforeStaleStep = env.changes.length;
  assert(processNextScheduledWorker(env), "the next day revalidates a changed office anchor before further writes");
  assert.equal(env.changes.length, changesBeforeStaleStep,
    "a title that no longer anchors the task causes no second-day handoff write");
  assert.equal(oldVassals.filter(item => item.character.liege === realm.holder).length, 1,
    "the remaining old direct vassal stays with the officer after the anchor changes");
  assert.equal(priorOffice.holder, realm.holder, "the prior appointment stays untouched after the anchor changes");
  assert.equal(oldCounty.holder, realm.holder, "old landed property stays untouched after the anchor changes");
  assert.equal(realm.holder.variables.has("votc_celestial_office_task_started"), false,
    "the stale anchored task is discarded instead of continuing under a different office owner");
}

function testNativeAppointmentCompatibility() {
  // Assert only the native appointment law configuration here. The production
  // candidate trigger below is tested separately with China-scoped fixtures.
  for (const name of ["celestial_civic_governor", "celestial_military_governor"]) {
    const appointment = qa.named(qa.successionFile, name);
    assert.equal(qa.scalar(appointment, "allowed_candidate_tier"), "lower_or_equal",
      `${name} keeps the native appointment tier rule and permits same-tier candidates`);
    assert.equal(qa.scalar(appointment, "level"), "merit",
      `${name} continues to use its native merit score`);
  }
}

function testProductionTransferCandidateHardFilter() {
  const trigger = requireDefinition(qa.triggerDefs, API.candidateTrigger, "transfer candidate hard-filter trigger");
  const realm = makeRealm("candidate_filter", { officeTier: qa.TIERS.tier_duchy });
  const scopesFor = (extra = {}) => ({ votc_celestial_office_task_title: realm.office, ...extra });
  const candidate = (id, options = {}) => qa.character(id, {
    top_liege: options.topLiege || realm.emperor,
    employer: options.employer || null,
    landed: options.landed !== false,
    alive: options.alive !== false,
    highest_held_title_tier: options.highest ?? qa.TIERS.tier_duchy,
    traits: options.traits || [],
    contract_flags: options.contractFlags || [],
    primary_title: options.primaryTitle || null
  });
  const accepts = (person, extraScopes = {}) => qa.evalTrigger(trigger,
    makeEnv(realm, person, scopesFor(extraScopes)));

  assert.equal(accepts(candidate("candidate_same_tier")), true,
    "a local same-tier successor is eligible after native appointment settlement");
  assert.equal(accepts(candidate("candidate_lower_tier", { highest: qa.TIERS.tier_county })), true,
    "a local lower-tier successor is eligible");
  const originalEmpireNowLower = candidate("candidate_original_empire_now_county", {
    landed: true,
    highest: qa.TIERS.tier_county
  });
  const lowPrimaryTitle = qa.title("c_candidate_original_empire_now_county", qa.TIERS.tier_county,
    originalEmpireNowLower);
  const familyIdentity = qa.title("c_candidate_original_empire_now_county_house", qa.TIERS.tier_county,
    originalEmpireNowLower, { noble_family: true, landless: true });
  originalEmpireNowLower.primary_title = lowPrimaryTitle;
  originalEmpireNowLower.held_titles.push(lowPrimaryTitle, familyIdentity);
  originalEmpireNowLower.variables.add("votc_celestial_office_task_original_rank");
  originalEmpireNowLower.variableValues.set("votc_celestial_office_task_original_rank", qa.TIERS.tier_empire);
  assert.equal(accepts(originalEmpireNowLower), false,
    "a currently low-ranked or family-title-only candidate remains barred from duchy succession by its recorded imperial rank");
  const countyTaskTitle = qa.title("c_candidate_original_rank_county_task", qa.TIERS.tier_county, null);
  assert.equal(accepts(originalEmpireNowLower, { votc_celestial_office_task_title: countyTaskTitle }), false,
    "the recorded imperial rank also bars that candidate from county succession");
  const sameOriginalRankCandidate = candidate("candidate_same_original_rank", {
    highest: qa.TIERS.tier_county
  });
  sameOriginalRankCandidate.variables.add("votc_celestial_office_task_original_rank");
  sameOriginalRankCandidate.variableValues.set("votc_celestial_office_task_original_rank", qa.TIERS.tier_duchy);
  assert.equal(accepts(sameOriginalRankCandidate), true,
    "a recorded original rank equal to the target tier remains eligible under native lower-or-equal appointment law");
  assert.equal(accepts(candidate("candidate_higher_tier", { highest: qa.TIERS.tier_kingdom })), false,
    "the VOTC transfer candidate filter rejects a candidate whose highest landed tier exceeds the target");

  const foreign = makeRealm("candidate_foreign", { foreign: true });
  const foreignCandidate = qa.character("candidate_foreign_landed", {
    top_liege: foreign.foreignEmperor,
    highest_held_title_tier: qa.TIERS.tier_county
  });
  assert.equal(qa.evalTrigger(trigger, makeEnv(realm, foreignCandidate,
    { votc_celestial_office_task_title: realm.office })), false,
  "a landed candidate outside the actual China top-liege chain is rejected");

  const localCourtier = candidate("candidate_local_courtier", {
    landed: false,
    highest: -1,
    employer: realm.emperor
  });
  assert.equal(accepts(localCourtier), true,
    "an eligible landless local courtier can be considered for a transfer");

  assert.equal(accepts(candidate("candidate_protected_trait", { traits: ["great_misit"] })), false,
    "the protected trait blocks otherwise eligible transfer candidates");
  assert.equal(accepts(candidate("candidate_protected_heir", {
    contractFlags: ["heir_succession_rights_unlock"]
  })), false, "the succession-rights contract blocks transfer candidates");
  const titular = qa.title("d_candidate_titular", qa.TIERS.tier_duchy, null, {
    variables: ["titular_title"]
  });
  assert.equal(accepts(candidate("candidate_titular_primary", { primaryTitle: titular })), false,
    "a candidate whose primary title is protected as titular is rejected");

  const pathMember = candidate("candidate_already_visited");
  realm.office.variableLists.set("votc_celestial_office_handoff_path", [pathMember]);
  assert.equal(accepts(pathMember), false,
    "a candidate already visited in the title-hosted handoff path is rejected to stop cycles");
}

function addLandlessFamilyCandidate(realm, id, options = {}) {
  const person = qa.character(id, {
    landed: false,
    highest_held_title_tier: -1,
    top_liege: realm.emperor,
    employer: realm.emperor,
    held_titles: []
  });
  const familyTitle = qa.title(`c_${id}_house`, qa.TIERS.tier_county, person, {
    noble_family: true,
    landless: true
  });
  person.held_titles.push(familyTitle);
  person.ordered_score = options.orderedScore ?? 0;
  realm.characters.push(person);
  realm.titles.push(familyTitle);
  return person;
}

function findEntries(block, key, result = []) {
  for (const entry of block.entries || []) {
    if (entry.key === key) result.push(entry);
    if (entry.value && typeof entry.value === "object") findEntries(entry.value, key, result);
  }
  return result;
}

function testPersistentListSyntaxIsNativeAndOwnerScoped() {
  const files = [qa.triggerFile, qa.regionTriggerFile, qa.effectFile, qa.regionEffectFile, qa.eventFile];
  const listOperators = ["any_in_list", "every_in_list", "random_in_list"];
  for (const file of files) {
    for (const operator of listOperators) {
      for (const entry of findEntries(file, operator)) {
        const variable = qa.scalar(entry.value, "variable");
        assert(variable && !variable.includes("."),
          `${operator} at line ${entry.line} must use a local CK3 variable= inside its explicit owner scope`);
        assert.equal(qa.scalar(entry.value, "list"), null,
          `${operator} at line ${entry.line} may not masquerade a persistent list as temporary list=`);
      }
    }
    for (const operator of ["is_target_in_variable_list", "add_to_variable_list", "remove_list_variable"]) {
      for (const entry of findEntries(file, operator)) {
        const name = qa.scalar(entry.value, "name");
        assert(name && !name.includes("."),
          `${operator} at line ${entry.line} must use a local list name inside its explicit owner scope`);
      }
    }
  }
}

function testHarnessSeparatesTemporaryAndPersistentListReferences() {
  const owner = qa.character("list_semantics_owner");
  const member = qa.character("list_semantics_member", { flags: ["qa_temporary_list_member"] });
  owner.variableLists.set("qa_list_semantics_probe", [member]);
  const env = qa.envFor(owner, owner);
  const triggerFor = key => ({ entries: [{ key: "any_in_list", value: { entries: [
    { key, op: "=", value: "qa_list_semantics_probe" },
    { key: "limit", op: "=", value: { entries: [{ key: "has_character_flag", op: "=", value: "qa_temporary_list_member" }] } }
  ] } }] });

  assert.equal(qa.evalTrigger(triggerFor("list"), env), false,
    "list= cannot read a same-named persistent character variable list");
  assert.equal(qa.evalTrigger(triggerFor("variable"), env), true,
    "variable= reads the persistent character variable list");
  env.temporaryLists = new Map([["qa_list_semantics_probe", [member]]]);
  assert.equal(qa.evalTrigger(triggerFor("list"), env), true,
    "list= resolves only a separately supplied temporary list");
}

function testKingdomCapitalDuchyAndMeritAppointmentAst() {
  requireDefinition(qa.triggerDefs, API.extraDuchyTrigger, "extra-duchy candidate trigger");
  const assignment = requireDefinition(qa.effectDefs, API.assignExtraDuchyEffect, "native extra-duchy appointment effect");
  const selectors = findEntries(assignment, "ordered_title_heir");
  assert.equal(selectors.length, 2,
    "the extra-duchy allocator makes a family pass followed by a courtier pass");
  for (const selector of selectors) {
    assert.equal(qa.scalar(selector.value, "order_by"),
      "appointment_candidate_score(scope:votc_region_extra_duchy)",
      "each pass delegates ordering to the duchy's native appointment score");
    assert.equal(qa.scalar(selector.value, "max"), "1",
      "one candidate is assigned per extra duchy before eligibility is recalculated");
  }
  assert(findEntries(assignment, "any_held_title").some(entry =>
    findEntries(entry.value, "votc_celestial_region_family_title_trigger").length > 0),
  "the first pass accepts existing family-title holders before the courtier fallback");
  const courtierPass = selectors[1];
  assert(findEntries(courtierPass.value, "exists").some(entry => entry.value === "employer"),
    "the fallback pass is restricted to employed domestic courtiers");
  assert(findEntries(courtierPass.value, "NOT").some(entry =>
    findEntries(entry.value, "votc_celestial_region_family_title_trigger").length > 0),
  "the fallback pass is reached only for candidates without a qualifying family title");
  assert(findEntries(assignment, "create_noble_family_effect").length === 1,
    "new family creation is delegated once to the existing native family effect after appointment");
  assert(findEntries(assignment, "votc_celestial_office_schedule_audited_officer_effect").length === 1,
    "a successful extra-duchy grant explicitly schedules the new office holder for audit");

  const realm = makeRealm("capital_duchy_priority", { officeTier: qa.TIERS.tier_kingdom });
  const extraFirst = addHeldTitle(realm, "d_extra_duchy_first", qa.TIERS.tier_duchy,
    { deJureAncestors: [realm.office.id] });
  const extraSecond = addHeldTitle(realm, "d_extra_duchy_second", qa.TIERS.tier_duchy,
    { deJureAncestors: [realm.office.id] });
  const capitalDuchy = addHeldTitle(realm, "d_kingdom_capital", qa.TIERS.tier_duchy,
    { deJureAncestors: [realm.office.id] });
  const capitalCounty = qa.title("c_kingdom_capital", qa.TIERS.tier_county, realm.holder, {
    de_jure_liege: capitalDuchy,
    de_jure_ancestors: new Set([capitalDuchy.id, realm.office.id])
  });
  realm.holder.held_titles.push(capitalCounty);
  realm.titles.push(capitalCounty);
  realm.office.title_capital_county = capitalCounty;
  const legalCounty = addHeldTitle(realm, "c_contract_legal_county", qa.TIERS.tier_county,
    { deJureLiege: capitalDuchy, deJureAncestors: [capitalDuchy.id, realm.office.id],
      title_laws: ["qa_county_contract_sentinel"] });
  realm.holder.contract_flags.add("qa_contract_metadata_sentinel");

  const landlessCourtier = qa.character("merit_courtier", {
    landed: false,
    highest_held_title_tier: -1,
    top_liege: realm.emperor,
    employer: realm.emperor
  });
  const familyCandidate = addLandlessFamilyCandidate(realm, "merit_house_candidate");
  // This fixture array represents the native title heir order. The AST asserts
  // the native score expression; this harness does not calculate that score.
  extraFirst.ordered_title_heirs = [landlessCourtier, familyCandidate];
  extraSecond.ordered_title_heirs = [familyCandidate];
  realm.characters.push(landlessCourtier);

  const env = runPostGrantOfficeReconciliation(realm, (transferredTitle, _previousHolder, recipient) => {
    if (transferredTitle !== extraFirst || recipient !== familyCandidate) return;
    // This fixture models CK3's post-appointment holder facts needed by the
    // production office-scope trigger; it does not emulate the native appointment.
    familyCandidate.landed = true;
    familyCandidate.primary_title = extraFirst;
    familyCandidate.top_liege = realm.emperor;
    familyCandidate.realm_law_flags = new Set(realm.emperor.realm_law_flags);
    familyCandidate.government_flags.add("government_is_bureau");
  });
  assert.equal(realm.holder.variableValues.get("votc_celestial_office_retained_duchy"), capitalDuchy,
    "the actual kingdom-capital county chain overrides held-title iteration order");
  assert.equal(capitalDuchy.holder, realm.holder, "the capital de-jure duchy is the retained one");
  assert.equal(legalCounty.holder, realm.holder,
    "a county inside the retained kingdom's real de-jure chain remains eligible for contract treatment");
  assert.equal(legalCounty.title_laws.has("qa_county_contract_sentinel"), true,
    "the reconciliation leaves the county's existing contract metadata untouched");
  assert.equal(familyCandidate.liege, realm.holder,
    "the top native-score eligible landless family candidate receives the first extra duchy");
  assert.equal(familyCandidate.government_flags.has("government_is_bureau"), true,
    "the explicit native-settlement fixture gives the recipient a valid bureaucratic office scope");
  assert.equal(extraFirst.holder, familyCandidate, "the first extra duchy is assigned through title transfer");
  assert.equal(extraSecond.holder, realm.emperor,
    "after the first award, the newly landed candidate cannot take another duchy and the unfilled title returns to h_china");
  assert.equal(landlessCourtier.landed, false, "the house-first pass leaves the courtier unused while a family candidate qualifies");
  assert.equal(env.externalEffects.filter(effect => effect.name === "create_noble_family_effect").length, 0,
    "an already-qualified family holder is not passed to native family creation");
  assert.equal(realm.holder.contract_flags.has("qa_contract_metadata_sentinel"), true,
    "the reconciliation leaves unrelated contract metadata intact");
  assert(env.changes.some(change => change.type === "change_title_holder" && change.subject === extraFirst),
    "the extra duchy uses a title-holder transaction");
  assert(env.changes.some(change => change.type === "change_liege" && change.subject === familyCandidate),
    "the awarded duke becomes a legal direct vassal without taking the title as emperor property");
  assert(env.processedWorkerOwners.includes(familyCandidate),
    "the successful extra-duchy holder's production-scheduled office review was executed");
  assert.equal(familyCandidate.variableValues.has("votc_celestial_office_task_original_rank"), false,
    "the completed recipient review clears its original-rank snapshot");
  // The fixture does not provide the upstream contract's county quota value;
  // it deliberately proves only de-jure eligibility and preservation of metadata.
}

function testCourtierFallbackWithExplicitNativeFamilyEffectFixture() {
  const scenarios = [
    { prefix: "courtier_family_success", familyCreationSucceeds: true, officeScopeValid: true },
    { prefix: "courtier_family_failure", familyCreationSucceeds: false, officeScopeValid: true },
    { prefix: "courtier_scope_failure", familyCreationSucceeds: true, officeScopeValid: false }
  ];
  for (const scenario of scenarios) {
    const { prefix, familyCreationSucceeds, officeScopeValid } = scenario;
    const realm = makeRealm(prefix, { officeTier: qa.TIERS.tier_kingdom });
    const retainedDuchy = addHeldTitle(realm, `d_${prefix}_capital`, qa.TIERS.tier_duchy,
      { deJureAncestors: [realm.office.id] });
    const extraDuchy = addHeldTitle(realm, `d_${prefix}_extra`, qa.TIERS.tier_duchy,
      { deJureAncestors: [realm.office.id] });
    const capitalCounty = qa.title(`c_${prefix}_capital`, qa.TIERS.tier_county, realm.holder, {
      de_jure_liege: retainedDuchy,
      de_jure_ancestors: new Set([retainedDuchy.id, realm.office.id])
    });
    realm.holder.held_titles.push(capitalCounty);
    realm.titles.push(capitalCounty);
    realm.office.title_capital_county = capitalCounty;
    realm.emperor.government_allowances.add("noble_families");

    const courtier = qa.character(`${prefix}_courtier`, {
      landed: false,
      highest_held_title_tier: -1,
      top_liege: realm.emperor,
      employer: realm.emperor
    });
    extraDuchy.ordered_title_heirs = [courtier];
    realm.characters.push(courtier);
    const createdFamilyTitles = [];
    const env = makeEnv(realm, realm.holder, {
      title: realm.office,
      transfer_type: "appointment_succession"
    });
    // This explicit fixture callback models only the external native effect's
    // success/failure outcome; it does not claim CK3 dynasty/family creation is verified.
    env.onCreateNobleFamilyEffect = recipient => {
      if (!familyCreationSucceeds) return;
      const familyTitle = qa.title(`c_${prefix}_house`, qa.TIERS.tier_county, recipient,
        { noble_family: true, landless: true });
      recipient.held_titles.push(familyTitle);
      realm.titles.push(familyTitle);
      env.titleLookup.set(familyTitle.id, familyTitle);
      createdFamilyTitles.push(familyTitle);
    };
    env.onTitleTransfer = (transferredTitle, previousHolder, recipient) => {
      if (transferredTitle === extraDuchy && recipient === courtier) {
        // Model native settlement facts needed by the production office-scope
        // trigger; this callback is not a CK3 appointment implementation.
        courtier.landed = true;
        courtier.primary_title = extraDuchy;
        courtier.top_liege = realm.emperor;
        courtier.realm_law_flags = new Set(realm.emperor.realm_law_flags);
        if (officeScopeValid) courtier.government_flags.add("government_is_bureau");
      } else if (transferredTitle === extraDuchy && previousHolder === courtier && recipient === realm.emperor) {
        courtier.landed = false;
        courtier.primary_title = null;
      }
    };

    qa.executeEntries(qa.effectDefs[API.reconcileEffect], env);

    const nativeFamilyCalls = env.externalEffects.filter(effect => effect.name === "create_noble_family_effect");
    assert.equal(nativeFamilyCalls.length, 1,
      "a courtier fallback invokes the native family effect once after the title appointment");
    assert.equal(nativeFamilyCalls[0].subject, courtier,
      "the external family effect is scoped to the actual selected courtier");
    assert.equal(nativeFamilyCalls[0].governmentGiver, realm.emperor,
      "the effect receives the actual h_china government as its giver");

    if (familyCreationSucceeds && officeScopeValid) {
      assert.equal(createdFamilyTitles.length, 1,
        "the success fixture injects one resulting family title");
      assert.equal(extraDuchy.holder, courtier,
        "a courtier retains the duchy only when the external family effect yields the required family title");
      assert.equal(courtier.liege, realm.holder,
        "a successfully founded house becomes a legal vassal of the regional office holder");
      assert.equal(createdFamilyTitles[0].holder, courtier,
        "the injected family identity belongs to the selected courtier");
      const recipientWorker = env.scheduledEvents.find(event =>
        event.id === "votc_celestial_office_release.0004" && event.owner === courtier);
      assert(recipientWorker,
        "the newly landed bureaucrat receives a real-flow-scope daily review worker");
      assert.equal(courtier.variableValues.get("votc_celestial_office_task_original_rank"), qa.TIERS.tier_duchy,
        "the recipient review records its actual new duchy rank");
      assert(processNextScheduledWorker(env, courtier),
        "the recipient's scheduled audit worker continues after the extra-duchy appointment");
      assert.equal(courtier.variables.has("votc_celestial_office_worker_pending"), false,
        "the new officer's review consumes its pending marker");
    } else {
      assert.equal(createdFamilyTitles.length, familyCreationSucceeds ? 1 : 0,
        familyCreationSucceeds ?
          "the invalid-scope fixture's external family result does not override office eligibility" :
          "the failure fixture leaves the external effect without a family result");
      assert.equal(extraDuchy.holder, realm.emperor,
        "a failed family effect or invalid office scope returns the extra duchy to h_china");
      assert.notEqual(courtier.liege, realm.holder,
        "a failed family effect or invalid office scope does not install a regional vassal");
      assert.equal(realm.holder.vassals.includes(courtier), false,
        "the failed fallback leaves the courtier outside the office holder's landed vassal tree");
      assert.equal(env.changes.some(change => change.type === "change_liege" && change.subject === courtier), false,
        "the rejected fallback performs no liege reassignment");
      assert.equal(env.scheduledEvents.some(event =>
        event.id === "votc_celestial_office_release.0004" && event.owner === courtier), false,
      "a rejected new holder is not scheduled for officer review");
    }
  }
}

function testRegionBudgetPersistsAndContinuesThroughDailyWorker() {
  const realm = makeRealm("region_budget", { officeTier: qa.TIERS.tier_kingdom });
  const capitalDuchy = addHeldTitle(realm, "d_region_budget_capital", qa.TIERS.tier_duchy,
    { deJureAncestors: [realm.office.id] });
  const capitalCounty = qa.title("c_region_budget_capital", qa.TIERS.tier_county, realm.holder, {
    de_jure_liege: capitalDuchy,
    de_jure_ancestors: new Set([capitalDuchy.id, realm.office.id])
  });
  realm.holder.held_titles.push(capitalCounty);
  realm.titles.push(capitalCounty);
  realm.office.title_capital_county = capitalCounty;
  const overflow = Array.from({ length: 10 }, (_, index) =>
    addHeldTitle(realm, `d_region_budget_overflow_${index}`, qa.TIERS.tier_duchy,
      { deJureAncestors: [realm.office.id] }));
  const env = makeEnv(realm, realm.holder,
    { title: realm.office, transfer_type: "appointment_succession" });

  qa.executeEntries(qa.effectDefs["votc_celestial_office_start_reconcile_task_effect"], env);
  assert(processNextScheduledWorker(env, realm.holder),
    "the audit-style durable task reaches the production region reconciler");
  assert.equal(overflow.filter(title => title.holder === realm.emperor).length, 8,
    "one pass performs no more than the production transfer budget of eight titles");
  assert.equal(realm.holder.variables.has("votc_celestial_office_region_work_remaining"), true,
    "unprocessed eligible titles leave a persistent continuation marker");
  assert(env.scheduledEvents.some(event => event.id === "votc_celestial_office_release.0004" && event.days === "1"),
    "budget exhaustion continues through the next daily transaction worker");

  assert(processNextScheduledWorker(env, realm.holder),
    "the next daily worker resumes the bounded region pass");
  assert.equal(overflow.filter(title => title.holder === realm.emperor).length, 10,
    "the later pass finishes the remaining eligible titles");
  assert.equal(realm.holder.variables.has("votc_celestial_office_region_work_remaining"), false,
    "completed region work clears its persistence marker");
  assert.equal(env.scheduledEvents.some(event => event.id === "votc_celestial_office_release.0004"), false,
    "no worker remains scheduled after all region transfers are complete");
}

function testDuchyAndCountyLandBoundaries() {
  const duchyRealm = makeRealm("duchy_region", { officeTier: qa.TIERS.tier_duchy });
  const insideCounty = addHeldTitle(duchyRealm, "c_duchy_inside", qa.TIERS.tier_county,
    { deJureLiege: duchyRealm.office, deJureAncestors: [duchyRealm.office.id],
      title_laws: ["qa_duchy_contract_sentinel"] });
  const outsideDuchy = qa.title("d_other_jurisdiction", qa.TIERS.tier_duchy, null);
  const outsideCounty = addHeldTitle(duchyRealm, "c_duchy_outside", qa.TIERS.tier_county,
    { deJureLiege: outsideDuchy, deJureAncestors: [outsideDuchy.id] });
  const insideVassal = addVassal(duchyRealm, "duchy_inside_vassal", qa.TIERS.tier_county,
    { deJureLiege: duchyRealm.office, deJureAncestors: [duchyRealm.office.id] });
  const outsideVassal = addVassal(duchyRealm, "duchy_outside_vassal", qa.TIERS.tier_county,
    { deJureLiege: outsideDuchy, deJureAncestors: [outsideDuchy.id] });
  const duchyEnv = makeEnv(duchyRealm);
  duchyEnv.simulateTitleTransfers = true;
  qa.executeEntries(qa.effectDefs[API.reconcileEffect], duchyEnv);

  assert.equal(insideCounty.holder, duchyRealm.holder,
    "a county inside a duke's actual de-jure jurisdiction remains held");
  assert.equal(insideCounty.title_laws.has("qa_duchy_contract_sentinel"), true,
    "ducal reconciliation preserves existing county contract metadata");
  assert.equal(outsideCounty.holder, duchyRealm.emperor,
    "a county outside the retained duchy is returned as a title");
  assert.equal(insideVassal.character.liege, duchyRealm.holder,
    "an in-jurisdiction landed direct vassal remains with the duke");
  assert.equal(outsideVassal.character.liege, duchyRealm.emperor,
    "an out-of-jurisdiction direct vassal is reassigned to the emperor");
  assert.equal(outsideVassal.title.holder, outsideVassal.character,
    "out-of-jurisdiction vassal repair never confiscates the vassal's own title");

  const countyRealm = makeRealm("county_region", { officeTier: qa.TIERS.tier_county });
  const attachedBarony = addHeldTitle(countyRealm, "b_county_attached", qa.TIERS.tier_barony,
    { deJureLiege: countyRealm.office, deJureAncestors: [countyRealm.office.id] });
  const otherCounty = qa.title("c_county_other_jurisdiction", qa.TIERS.tier_county, null);
  const otherDuchy = qa.title("d_county_other_jurisdiction", qa.TIERS.tier_duchy, null);
  const extraCounty = addHeldTitle(countyRealm, "c_county_extra", qa.TIERS.tier_county,
    { deJureLiege: otherDuchy, deJureAncestors: [otherDuchy.id] });
  const foreignBarony = addHeldTitle(countyRealm, "b_county_foreign", qa.TIERS.tier_barony,
    { deJureLiege: otherCounty, deJureAncestors: [otherCounty.id, otherDuchy.id] });

  const mustRelease = requireDefinition(qa.triggerDefs, "votc_celestial_region_title_must_release_trigger",
    "region title release trigger");
  const releaseProbe = makeEnv(countyRealm, countyRealm.holder, {
    votc_region_holder: countyRealm.holder,
    votc_region_anchor: countyRealm.office
  });
  releaseProbe.current = extraCounty;
  assert.equal(qa.evalTrigger(mustRelease, releaseProbe), true,
    "a distinct same-tier county office qualifies for release even without a matching de-jure chain");

  const handoffRealm = makeRealm("county_no_heir_handoff", { officeTier: qa.TIERS.tier_county });
  const noHeirTitle = addHeldTitle(handoffRealm, "c_county_no_heir_handoff", qa.TIERS.tier_county);
  noHeirTitle.variables.add("votc_celestial_office_expected_holder");
  noHeirTitle.variableValues.set("votc_celestial_office_expected_holder", handoffRealm.holder);
  noHeirTitle.variables.add("votc_celestial_office_authority_title");
  noHeirTitle.variableValues.set("votc_celestial_office_authority_title", handoffRealm.chinaTitle);
  const noHeirEnv = makeEnv(handoffRealm, handoffRealm.holder, {
    votc_celestial_office_task_title: noHeirTitle
  });
  qa.executeEntries(qa.effectDefs[API.handoffEffect], noHeirEnv);
  assert.equal(noHeirTitle.holder, handoffRealm.emperor,
    "the production no-heir handoff returns a same-tier county to h_china");

  const countyEnv = makeEnv(countyRealm);
  countyEnv.simulateTitleTransfers = true;
  qa.executeEntries(qa.effectDefs[API.reconcileEffect], countyEnv);

  assert.equal(countyRealm.office.holder, countyRealm.holder,
    "the baron's single highest office county remains its jurisdiction anchor");
  assert.equal(attachedBarony.holder, countyRealm.holder,
    "the county retains its legally attached barony");
  assert(countyEnv.changes.some(change => change.type === "change_title_holder" && change.subject === extraCounty),
    "the full county reconciliation emits a title-holder change for the same-tier extra county");
  assert.equal(extraCounty.holder, countyRealm.emperor,
    "an additional county-level office is released even when it cannot be retained as a second county");
  assert.equal(foreignBarony.holder, countyRealm.emperor,
    "a barony in another county's de-jure chain is outside the count's jurisdiction");
}

function testDuplicateGainAndAllExpectedOwnersAreRequired() {
  const realm = makeRealm("gain_owner_guard", { officeTier: qa.TIERS.tier_duchy });
  const oldCounty = addHeldTitle(realm, "c_old_before_grant", qa.TIERS.tier_county);
  const gainedOne = addHeldTitle(realm, "d_gain_one", qa.TIERS.tier_duchy);
  const gainedTwo = addHeldTitle(realm, "d_gain_two", qa.TIERS.tier_duchy);
  realm.holder.primary_title = gainedOne;
  const env = makeEnv(realm, realm.holder, { title: gainedOne, transfer_type: "appointment_succession" });
  qa.invokeHook("on_title_gain", env);
  env.scopes.title = gainedTwo;
  qa.invokeHook("on_title_gain", env);
  env.scopes.title = gainedOne;
  qa.invokeHook("on_title_gain", env);

  assert.equal(realm.holder.variableLists.get("votc_celestial_office_task_new_titles").length, 2,
    "duplicate callbacks add each acquired title only once");
  assert.equal(realm.holder.variableLists.get("votc_celestial_office_task_unvalidated_titles").length, 2,
    "every callback grant remains in the persistent expected-owner validation set");
  assert.equal(env.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0004").length, 1,
    "duplicate callbacks reuse the same durable task instead of queuing duplicate workers");

  const rogue = qa.character("gain_owner_rogue", { top_liege: realm.emperor });
  realm.characters.push(rogue);
  gainedTwo.holder = rogue;
  realm.holder.held_titles = realm.holder.held_titles.filter(title => title !== gainedTwo);
  rogue.held_titles.push(gainedTwo);
  assert.equal(qa.evalTrigger(requireDefinition(qa.triggerDefs, API.expectedGainTrigger, "expected-gain guard"), env), false,
    "the whole batch fails validation when any newly granted title no longer has its expected owner");
  const writesBeforeInvalidWorker = env.changes.length;
  assert(processNextScheduledWorker(env), "owner validation occurs in the scheduled worker after native settlement");
  assert.equal(oldCounty.holder, realm.holder, "invalidated gain causes no old land transfer");
  assert.equal(gainedOne.holder, realm.holder, "the still-owned grant is not used to authorize a partially invalid batch");
  assert.equal(env.changes.length, writesBeforeInvalidWorker, "a partially mismatched grant batch produces no further title or liege writes");
  assert.equal(realm.holder.variables.has("votc_celestial_office_task_started"), false,
    "a mismatched expected owner clears the abandoned transaction");
}

function testTaskExpectedHolderMismatchAndReloadRearm() {
  const realm = makeRealm("expected_owner_mismatch", { officeTier: qa.TIERS.tier_duchy });
  const oldCounty = addHeldTitle(realm, "c_old_owner_mismatch", qa.TIERS.tier_county);
  const env = makeEnv(realm, realm.holder, { title: realm.office, transfer_type: "appointment_succession" });
  qa.invokeHook("on_title_gain", env);
  assert.equal(realm.holder.variableValues.get("votc_celestial_office_task_original_rank"), realm.office.tier,
    "the durable task records the holder's observed original office tier before any old property is released");
  realm.holder.variableValues.set("votc_celestial_office_task_expected_holder", realm.emperor);
  assert(processNextScheduledWorker(env), "the worker checks its persisted expected owner before writes");
  assert.equal(oldCounty.holder, realm.holder, "a stale task owner never authorizes title release");
  assert.equal(env.changes.length, 0, "stale task-owner work has no transfer side effects");
  assert.equal(realm.holder.variables.has("votc_celestial_office_task_started"), false,
    "the stale task is discarded rather than carried into a different owner context");
  assert.equal(realm.holder.variables.has("votc_celestial_office_task_original_rank"), false,
    "discarding a stale task clears its transaction-local original-rank guard");

  const reloadRealm = makeRealm("reload_durable_worker", { officeTier: qa.TIERS.tier_duchy });
  addHeldTitle(reloadRealm, "d_reload_previous_office", qa.TIERS.tier_duchy);
  addHeldTitle(reloadRealm, "c_reload_old_county", qa.TIERS.tier_county);
  const firstVassal = addVassal(reloadRealm, "reload_vassal_one", qa.TIERS.tier_county);
  const secondVassal = addVassal(reloadRealm, "reload_vassal_two", qa.TIERS.tier_county);
  const reloadEnv = makeEnv(reloadRealm, reloadRealm.holder,
    { title: reloadRealm.office, transfer_type: "appointment_succession" });
  qa.invokeHook("on_title_gain", reloadEnv);
  assert(processNextScheduledWorker(reloadEnv), "the first day captures and begins the persistent estate task");
  const presaveReleasedVassals = [firstVassal, secondVassal]
    .filter(item => item.character.liege === reloadRealm.emperor).length;
  assert.equal(presaveReleasedVassals, 1,
    "pre-save work completes exactly one bounded direct-vassal operation without assuming selection order");
  reloadEnv.scheduledEvents.length = 0;
  reloadRealm.holder.variables.add("votc_celestial_office_worker_lock");
  reloadRealm.holder.variables.add("votc_celestial_office_worker_pending");
  const restartEnv = makeEnv(reloadRealm, reloadRealm.emperor);
  qa.invokeHook("on_game_start_after_lobby", restartEnv);
  const rearmed = restartEnv.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0004");
  assert.equal(rearmed.length, 1, "loading clears stale lock/pending state and rearms the expected holder's task");
  assert.equal(rearmed[0].owner, reloadRealm.holder, "read-load recovery schedules the original persisted task owner");
  assert.equal(rearmed[0].days, "1", "read-load recovery has no two-day transaction TTL");
  let remaining = drainScheduledWorkers(restartEnv);
  assert(remaining > 0, "the task continues after the reload boundary");
  assert.equal([firstVassal, secondVassal].filter(item => item.character.liege === reloadRealm.emperor).length, 2,
    "the post-load worker completes the remaining direct-vassal handoff regardless of native random order");
}

function testTrustedCrossborderInheritanceOnly() {
  function settleForeignGain(title, previousHolder, recipient) {
    previousHolder.held_titles = previousHolder.held_titles.filter(held => held !== title);
    if (previousHolder.primary_title === title) previousHolder.primary_title = null;
    title.holder = recipient;
    recipient.held_titles.push(title);
    recipient.primary_title = title;
    recipient.highest_held_title_tier = Math.max(recipient.highest_held_title_tier, title.tier);
  }

  const liveRealm = makeRealm("trusted_crossborder_live", { foreign: true });
  const liveSource = addChinaOfficeHolder(liveRealm, "trusted_live_china_source");
  const liveRecipient = liveRealm.holder;
  const liveInherited = qa.title("d_crossborder_live_inherited_office", qa.TIERS.tier_duchy,
    liveSource.holder, { title_law_flags: ["appointment_type_succession"] });
  liveSource.holder.held_titles.push(liveInherited);
  liveRealm.titles.push(liveInherited);
  settleForeignGain(liveInherited, liveSource.holder, liveRecipient);

  const liveEnv = makeEnv(liveRealm, liveRecipient, {
    title: liveInherited,
    previous_holder: liveSource.holder,
    transfer_type: "inheritance"
  });
  assert.equal(liveInherited.variables.has("votc_celestial_office_expected_holder"), false,
    "the live source case starts without title-local registration");
  qa.invokeHook("on_title_gain", liveEnv);
  assert.equal(liveInherited.variables.has("votc_celestial_office_crossborder_succession"), true,
    "a current h_china OE-recognized previous officeholder permits foreign inheritance correction");
  assert.equal(liveEnv.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0004").length, 1,
    "trusted cross-border correction runs on the new expected holder");
  assert(drainScheduledWorkers(liveEnv) > 0, "the foreign task worker validates then returns the inherited office");
  assert.equal(liveInherited.holder, liveRealm.emperor,
    "the valid foreign succession is corrected to the current h_china authority");
  assert.equal(liveEnv.changes.filter(change => change.type === "change_title_holder" &&
    change.subject === liveInherited).length, 1,
  "a trusted cross-border title is transferred once, without retrying the settled gain");

  const registeredRealm = makeRealm("trusted_crossborder_registered", { foreign: true });
  const registeredSource = addChinaOfficeHolder(registeredRealm, "registered_china_source");
  const registeredRecipient = registeredRealm.holder;
  const registeredTitle = registeredSource.office;
  const registrationEnv = makeEnv(registeredRealm, registeredSource.holder);
  qa.executeEntries(qa.effectDefs.votc_celestial_office_start_reconcile_task_effect, registrationEnv);
  assert.equal(registeredTitle.variableValues.get("votc_celestial_office_expected_holder"), registeredSource.holder,
    "the production reconcile task registers the held office's expected holder");
  assert.equal(registeredTitle.variableValues.get("votc_celestial_office_authority_title"), registeredRealm.chinaTitle,
    "the registration records the actual h_china authority title");
  registeredSource.holder.government_flags.clear();
  settleForeignGain(registeredTitle, registeredSource.holder, registeredRecipient);

  const registeredEnv = makeEnv(registeredRealm, registeredRecipient, {
    title: registeredTitle,
    previous_holder: registeredSource.holder,
    transfer_type: "appointment_succession"
  });
  qa.invokeHook("on_title_gain", registeredEnv);
  assert.equal(registeredTitle.variables.has("votc_celestial_office_crossborder_succession"), true,
    "a registered office can enter foreign succession correction after its prior holder leaves the bureau government");
  assert(registeredEnv.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0004"),
    "a matching registered authority chain schedules a foreign worker");
  assert(drainScheduledWorkers(registeredEnv) > 0,
    "the registered foreign succession is corrected by the durable worker");
  assert.equal(registeredTitle.holder, registeredRealm.emperor,
    "a title registered during in-scope office service returns to the current h_china authority");

  const rejectedRealm = makeRealm("untrusted_crossborder_source", { foreign: true });
  const nonBureauSource = addChinaOfficeHolder(rejectedRealm, "nonbureau_china_source", false);
  const rejectedTitle = qa.title("d_crossborder_unregistered_office", qa.TIERS.tier_duchy,
    nonBureauSource.holder, { title_law_flags: ["appointment_type_succession"] });
  nonBureauSource.holder.held_titles.push(rejectedTitle);
  rejectedRealm.titles.push(rejectedTitle);
  const rejectedRecipient = rejectedRealm.holder;
  settleForeignGain(rejectedTitle, nonBureauSource.holder, rejectedRecipient);
  const rejectedEnv = makeEnv(rejectedRealm, rejectedRecipient, {
    title: rejectedTitle,
    previous_holder: nonBureauSource.holder,
    transfer_type: "inheritance"
  });
  const rejectedBefore = snapshot(rejectedRealm);
  qa.invokeHook("on_title_gain", rejectedEnv);
  assert.equal(snapshot(rejectedRealm), rejectedBefore,
    "a foreign inheritance from a non-bureau h_china vassal with no prior registration causes zero writes");
  assert.equal(rejectedEnv.scheduledEvents.length, 0,
    "an unregistered office from a non-flowing predecessor does not enter the foreign worker");

  const untrustedRealm = makeRealm("untrusted_war_gain", { foreign: true });
  const outsider = qa.character("war_recipient", { top_liege: untrustedRealm.foreignEmperor });
  const warTitle = qa.title("d_foreign_war_gain", qa.TIERS.tier_duchy, outsider,
    { title_law_flags: ["appointment_type_succession"] });
  untrustedRealm.foreignEmperor.vassals.push(outsider);
  untrustedRealm.characters.push(outsider);
  untrustedRealm.titles.push(warTitle);
  outsider.held_titles.push(warTitle);
  const warEnv = makeEnv(untrustedRealm, outsider, {
    title: warTitle,
    previous_holder: untrustedRealm.holder,
    transfer_type: "war"
  });
  const before = snapshot(untrustedRealm);
  qa.invokeHook("on_title_gain", warEnv);
  assert.equal(snapshot(untrustedRealm), before,
    "foreign war gains without a trusted succession source cause no VOTC write or metadata mutation");
  assert.equal(warEnv.scheduledEvents.length, 0, "untrusted cross-border conquest is not queued for confiscation");
}

function testTrustedLowerOfficeSuccessionDowngrade() {
  for (const transferType of ["inheritance", "appointment_succession"]) {
    const suffix = transferType === "inheritance" ? "inheritance" : "appointment";
    const realm = makeRealm(`lower_${suffix}_downgrade`, { officeTier: qa.TIERS.tier_kingdom });
    const inheritedOffice = addHeldTitle(realm, `c_lower_${suffix}_office`, qa.TIERS.tier_county,
      { deJureAncestors: [realm.office.id] });
    const successor = addLandlessFamilyCandidate(realm, `lower_${suffix}_successor`);
    inheritedOffice.ordered_title_heirs = [successor];
    const env = makeEnv(realm, realm.holder, {
      title: inheritedOffice,
      previous_holder: realm.emperor,
      transfer_type: transferType
    });

    qa.invokeHook("on_title_gain", env);
    assert.equal(inheritedOffice.variables.has("votc_celestial_office_downgrade_succession"), true,
      `${transferType} of a lower office to an existing higher China office records a one-time correction marker`);
    assert(env.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0004"),
      `${transferType} correction uses the durable post-settlement worker`);
    assert(drainScheduledWorkers(env) > 0, `${transferType} correction completes through the worker`);
    assert.equal(inheritedOffice.holder, successor,
      `${transferType} lower office is routed through its eligible office heir instead of retained by the higher officeholder`);
    assert.equal(inheritedOffice.variables.has("votc_celestial_office_downgrade_succession"), false,
      `${transferType} correction consumes its marker exactly once`);
    assert.equal(env.changes.filter(change => change.type === "change_title_holder" &&
      change.subject === inheritedOffice).length, 1,
    `${transferType} correction settles one title transfer after the native inheritance/appointment`);
  }
}

function testOrdinaryGrantDoesNotUseSuccessionDowngrade() {
  const realm = makeRealm("lower_granted_office", { officeTier: qa.TIERS.tier_kingdom });
  const grantedCounty = addHeldTitle(realm, "c_lower_granted_office", qa.TIERS.tier_county,
    { deJureAncestors: [realm.office.id] });
  const env = makeEnv(realm, realm.holder, {
    title: grantedCounty,
    previous_holder: realm.emperor,
    transfer_type: "granted"
  });

  qa.invokeHook("on_title_gain", env);
  assert.equal(grantedCounty.variables.has("votc_celestial_office_downgrade_succession"), false,
    "an ordinary grant does not receive the succession-only lower-office marker");
  assert(drainScheduledWorkers(env) > 0, "the legitimate grant can still pass through normal reconciliation");
  assert.equal(grantedCounty.holder, realm.holder,
    "an in-region granted county remains with its recipient after normal reconciliation");
  assert.equal(env.changes.some(change => change.type === "change_title_holder" &&
    change.subject === grantedCounty), false,
  "the lower-office correction path does not transfer a legitimate grant");
}

function testSameTierNobleFamilyTitleDoesNotStartLateralTask() {
  const realm = makeRealm("noble_family_not_lateral", { officeTier: qa.TIERS.tier_kingdom });
  const incomingOffice = addHeldTitle(realm, "d_new_incoming_office", qa.TIERS.tier_duchy);
  const familyTitle = addHeldTitle(realm, "d_same_tier_family", qa.TIERS.tier_duchy,
    { office: false, nobleFamily: true });
  const env = makeEnv(realm, realm.holder, { title: incomingOffice });

  qa.executeEntries(qa.effectDefs.votc_celestial_office_begin_task_effect, env);
  assert.equal(realm.holder.variableValues.get("votc_celestial_office_task_lateral"), 0,
    "a same-tier noble-family identity title does not classify the incoming office as a lateral reassignment");
  qa.executeEntries(qa.effectDefs.votc_celestial_office_capture_lateral_snapshot_effect, env);
  assert.equal(Boolean(realm.holder.variableLists.get("votc_celestial_office_task_old_titles")?.includes(familyTitle)), false,
    "lateral snapshot excludes the same-tier noble-family title from old landed-office cleanup");
}

function testBatchIncomingTitlesDoNotTriggerLateralHandoff() {
  const realm = makeRealm("multi_title_batch", { officeTier: qa.TIERS.tier_kingdom });
  const originalPrimary = realm.office;
  const firstIncoming = addHeldTitle(realm, "d_multi_title_incoming_first", qa.TIERS.tier_duchy);
  const env = makeEnv(realm, realm.holder, { title: firstIncoming, transfer_type: "granted" });
  qa.invokeHook("on_title_gain", env);
  assert(realm.holder.variableLists.get("votc_celestial_office_task_new_titles")?.includes(firstIncoming),
    "the first title gain is recorded before the next same-tick callback");

  const secondIncoming = addHeldTitle(realm, "d_multi_title_incoming_second", qa.TIERS.tier_duchy);
  env.scopes.title = secondIncoming;
  env.titleLookup.set(secondIncoming.id, secondIncoming);
  qa.invokeHook("on_title_gain", env);

  const newTitles = realm.holder.variableLists.get("votc_celestial_office_task_new_titles") || [];
  assert(newTitles.includes(firstIncoming) && newTitles.includes(secondIncoming),
    "the shared transaction records both titles gained before its worker starts");
  assert.equal(realm.holder.variableValues.get("votc_celestial_office_task_lateral"), 0,
    "the earlier same-tier gain in this task list is not mistaken for an old office");
  assert.equal(realm.holder.variables.has("votc_celestial_office_task_anchor_title"), false,
    "same-batch lower-rank grants do not create a lateral anchor from one another");
  assert.equal(realm.holder.primary_title, originalPrimary,
    "recording additional same-batch lower-rank offices does not change the existing higher primary title");
  assert.equal(env.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0004").length, 1,
    "both callbacks share one durable transaction worker");
}

function testCrossTitleHandoffPathStopsCircularReassignment() {
  const realm = makeRealm("cross_title_cycle", { officeTier: qa.TIERS.tier_duchy });
  const visited = addLandlessFamilyCandidate(realm, "cycle_visited_a");
  const nextOfficer = qa.character("cycle_next_officer", {
    top_liege: realm.emperor,
    liege: realm.emperor,
    government_flags: ["government_is_bureau"],
    realm_law_flags: realm.holder.realm_law_flags,
    primary_title: null
  });
  const nextFamilyTitle = qa.title("s_cycle_next_house", qa.TIERS.tier_barony, nextOfficer,
    { noble_family: true });
  nextOfficer.held_titles.push(nextFamilyTitle);
  const nextOldOffice = qa.title("d_cycle_next_old_office", qa.TIERS.tier_duchy, nextOfficer,
    { title_law_flags: ["appointment_type_succession"] });
  nextOfficer.held_titles.push(nextOldOffice);
  nextOfficer.primary_title = nextOldOffice;
  nextOfficer.highest_held_title_tier = qa.TIERS.tier_duchy;
  realm.characters.push(nextOfficer);
  realm.titles.push(nextFamilyTitle, nextOldOffice);

  const outgoingOffice = qa.title("d_cycle_b_old_office", qa.TIERS.tier_duchy, realm.holder,
    { title_law_flags: ["appointment_type_succession"] });
  const returnOffice = nextOldOffice;
  realm.holder.held_titles.push(outgoingOffice);
  realm.holder.highest_held_title_tier = qa.TIERS.tier_duchy;
  outgoingOffice.ordered_title_heirs = [visited, nextOfficer];
  returnOffice.ordered_title_heirs = [visited, realm.holder];
  realm.titles.push(outgoingOffice);

  // The incoming office carries an earlier visit by `visited`; the current
  // officer's different old title must inherit that path before choosing heirs.
  realm.office.variableLists.set("votc_celestial_office_handoff_path", [visited]);
  const env = makeEnv(realm, realm.holder, {
    title: realm.office,
    previous_holder: visited,
    transfer_type: "appointment_succession"
  });
  qa.invokeHook("on_title_gain", env);
  assert(env.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0004"),
    "the settled incoming office starts the current holder's old-estate task");
  assert(realm.office.variableLists.get("votc_celestial_office_handoff_path")
    .some(person => person.id === visited.id),
  "the incoming title keeps its durable path available to the recipient's transaction");

  env.onTitleTransfer = (transferredTitle, previousHolder, recipient, _takeBaronies, transactionType) => {
    if (recipient !== nextOfficer || transferredTitle !== outgoingOffice) return;
    const oldRoot = env.root;
    const oldCurrent = env.current;
    const oldScopes = env.scopes;
    env.root = recipient;
    env.current = recipient;
    recipient.primary_title = transferredTitle;
    recipient.highest_held_title_tier = Math.max(recipient.highest_held_title_tier, transferredTitle.tier);
    env.scopes = { title: transferredTitle, previous_holder: previousHolder,
      transfer_type: transactionType || "appointment_succession" };
    qa.invokeHook("on_title_gain", env);
    env.root = oldRoot;
    env.current = oldCurrent;
    env.scopes = oldScopes;
  };

  assert(processNextScheduledWorker(env, realm.holder),
    "the original officer hands the old appointment to the first unvisited native heir");
  assert.equal(outgoingOffice.holder, nextOfficer,
    "the already-visited first heir is skipped in favor of the next eligible officer");
  assert(outgoingOffice.variableLists.get("votc_celestial_office_handoff_path")
    .some(person => person.id === visited.id),
  "the outgoing title retains the imported earlier visit after the grantor's task cleanup");
  assert(outgoingOffice.variableLists.get("votc_celestial_office_handoff_path")
    .some(person => person.id === realm.holder.id), "the outgoing title records its current grantor");
  assert.equal(realm.office.variableLists.has("votc_celestial_office_handoff_path"), false,
    "task completion clears the path from an incoming title still held by the finished owner");
  assert(outgoingOffice.variableLists.get("votc_celestial_office_handoff_path")
    .some(person => person.id === visited.id), "the next holder retains the accumulated path on its incoming title");
  assert(outgoingOffice.variableLists.get("votc_celestial_office_handoff_path")
    .some(person => person.id === realm.holder.id), "the next holder imports every previous transaction participant");

  const candidateBeforeMerge = qa.evalTrigger(requireDefinition(qa.triggerDefs, API.candidateTrigger,
    "transfer candidate hard-filter trigger"), makeEnv(realm, visited,
    { votc_celestial_office_task_title: returnOffice }));
  assert.equal(candidateBeforeMerge, true,
    "the former officers would otherwise qualify for the next title at the same rank");
  assert(processNextScheduledWorker(env, nextOfficer),
    "the next office holder processes its own old title using the imported transaction path");
  assert.equal(returnOffice.holder, realm.emperor,
    "a title whose only legal heirs are already visited returns to the current emperor and closes the cycle");
  assert.equal(outgoingOffice.holder, nextOfficer,
    "closing a cycle on the next old title does not revoke the valid office already received");
  assert.equal(outgoingOffice.variableLists.has("votc_celestial_office_handoff_path"), false,
    "the next holder clears the incoming office path only after its own task completes");
  assert.equal(env.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0004"), false,
    "the chain terminates instead of retrying or looping on daily workers");
}

function testAuditAuthorityAndNoTwoDayTtl() {
  const realm = makeRealm("audit_authority");
  const workerEvent = qa.named(qa.eventFile, "votc_celestial_office_release.0004");
  const auditEvent = qa.named(qa.eventFile, "votc_celestial_office_release.0005");
  const auditWorkerEvent = qa.named(qa.eventFile, "votc_celestial_office_release.0006");
  const auditTrigger = qa.child(auditEvent, "trigger");
  assert(findEntries(auditTrigger, "this").some(entry => entry.value === "title:h_china.holder"),
    "the recurring audit is bound to the current h_china holder");
  assert(findEntries(auditTrigger, "var:votc_celestial_office_audit_expected_holder")
    .some(entry => entry.value === "root"),
  "the monthly collector validates the authority title's expected holder");
  assert(findEntries(qa.child(auditEvent, "immediate"), "every_vassal_or_below").length === 1,
    "the bounded monthly collector walks only the China authority's actual vassal tree");
  assert.equal(findEntries(qa.child(auditWorkerEvent, "immediate"), "votc_celestial_office_audit_pop_effect").length, 8,
    "the daily audit worker processes at most eight queued officers per pass");
  const auditWorkerImmediate = qa.child(auditWorkerEvent, "immediate");
  const auditBatchLock = "votc_celestial_office_audit_batch_lock";
  const sameDayLockGate = findEntries(auditWorkerImmediate, "if").find(entry => {
    const limit = qa.child(entry.value, "limit");
    return findEntries(limit, "NOT").some(negation =>
      findEntries(negation.value, "has_variable").some(hasVariable => hasVariable.value === auditBatchLock));
  });
  assert(sameDayLockGate,
    "the daily page is guarded by a title-local lock against duplicate same-day callback consumption");
  assert(findEntries(auditWorkerImmediate, "set_variable").some(entry =>
    qa.scalar(entry.value, "name") === auditBatchLock && qa.scalar(entry.value, "days") === "1"),
  "the same-day audit lock is timed for one day by production PDX");
  assert(findEntries(qa.child(auditWorkerEvent, "trigger"), "var:votc_celestial_office_audit_worker_expected_holder")
    .some(entry => entry.value === "root"),
  "the daily audit page validates its expected h_china holder");
  const restartWorkers = qa.named(qa.actionFile, "votc_celestial_office_restart_workers");
  assert(findEntries(restartWorkers, "remove_variable").some(entry => entry.value === auditBatchLock),
    "read-load recovery clears the timed batch lock before rearming the saved audit page");
  assert(findEntries(workerEvent, "days").length === 0,
    "the worker event itself has no age-based expiration");
  assert(findEntries(qa.effectDefs["votc_celestial_office_schedule_audit_effect"], "trigger_event")
    .some(entry => qa.scalar(entry.value, "id") === "votc_celestial_office_release.0005" &&
      qa.scalar(entry.value, "days") === "1"),
  "an audit callback starts the authority-checked collector on its next day");
  assert(findEntries(qa.child(auditEvent, "immediate"), "trigger_event")
    .some(entry => qa.scalar(entry.value, "id") === "votc_celestial_office_release.0005" &&
      qa.scalar(entry.value, "days") === "30"),
  "the collector re-arms at its 30-day interval after collecting the China office tree");
  const allEventSchedules = findEntries(qa.effectFile, "trigger_event");
  assert.equal(allEventSchedules.filter(entry => qa.scalar(entry.value, "days") === "2").length, 0,
    "no legacy two-day TTL cleanup remains in production worker effects");

  const auditOfficials = [realm.holder];
  for (let index = 0; index < 9; index += 1) {
    auditOfficials.push(addVassal(realm, `audit_official_${index}`, qa.TIERS.tier_county).character);
  }
  const ministryTitles = [
    "e_minister_chancellor", "e_minister_censor", "e_minister_grand_marshal",
    "e_minister_of_personnel", "e_minister_of_revenue", "e_minister_of_rites",
    "e_minister_of_war", "e_minister_of_justice", "e_minister_of_works"
  ];
  ministryTitles.forEach((id, index) => {
    const official = auditOfficials[index % auditOfficials.length];
    const ministry = qa.title(id, qa.TIERS.tier_barony, official, {
      title_laws: ["celestial_ministry_appointment_succession_law"]
    });
    official.held_titles.push(ministry);
    realm.titles.push(ministry);
  });
  const registeredOfficerCount = () => auditOfficials.filter(person => person.held_titles.some(title =>
    title.variableValues.get("votc_celestial_office_expected_holder") === person &&
    title.variableValues.get("votc_celestial_office_authority_title") === realm.chinaTitle)).length;
  const misregisteredTitles = () => auditOfficials.flatMap(person => person.held_titles.filter(title =>
    title.variables.has("votc_celestial_office_expected_holder") &&
    (title.variableValues.get("votc_celestial_office_expected_holder") !== person ||
      title.variableValues.get("votc_celestial_office_authority_title") !== realm.chinaTitle)));

  const env = makeEnv(realm, realm.emperor);
  qa.executeEntries(qa.effectDefs["votc_celestial_office_schedule_audit_effect"], env);
  qa.executeEntries(qa.effectDefs["votc_celestial_office_schedule_audit_effect"], env);
  assert.equal(env.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0005").length, 1,
    "repeated callbacks reuse one expected-holder-bound collector event");
  assert.equal(env.scheduledEvents.find(item => item.id === "votc_celestial_office_release.0005").days, "1",
    "audit callbacks queue collection once without duplicating it");
  assert.equal(realm.chinaTitle.variableValues.get("votc_celestial_office_audit_expected_holder"), realm.emperor,
    "the durable monthly audit stores the current authority as its expected owner");
  const firstMonthlySchedule = env.scheduledEvents.find(item => item.id === "votc_celestial_office_release.0005");
  assert.equal(firstMonthlySchedule.scopes.votc_celestial_office_audit_event_generation, 1,
    "a scheduled collector captures its own native scope-value generation");
  const staleMonthlySchedule = { ...firstMonthlySchedule, scopes: { ...firstMonthlySchedule.scopes } };

  executeScheduledNamedEvent("votc_celestial_office_release.0005", env);
  assert.equal(realm.chinaTitle.variableValues.get("votc_celestial_office_audit_generation"), 2,
    "a successful monthly event increments the generation before scheduling its successor");
  const auditQueue = realm.chinaTitle.variableLists.get("votc_celestial_office_audit_queue") || [];
  assert.equal(auditQueue.length, 10,
    "collection queues each valid China vassal once and deduplicates officials also held in ministry titles");
  assert(env.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0005" && item.days === "30"),
    "completed collection leaves the next monthly audit scheduled");
  assert.equal(env.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0006").length, 1,
    "one durable daily audit worker drains the persistent queue");
  qa.executeEntries(qa.effectDefs["votc_celestial_office_schedule_audit_worker_effect"], env);
  assert.equal(env.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0006").length, 1,
    "repeated worker scheduling does not duplicate the pending daily event");

  executeScheduledNamedEvent("votc_celestial_office_release.0006", env);
  assert.equal(realm.chinaTitle.variableLists.get("votc_celestial_office_audit_queue").length, 2,
    "the first page leaves remaining officers durably queued after the eight-item budget");
  assert.equal(registeredOfficerCount(), 8,
    "the first audit page registers the actual expected owner for each of its eight processed officers");
  assert.equal(misregisteredTitles().length, 0,
    "audit registration records each held office's actual holder, not the Emperor event root");
  assert.equal(realm.chinaTitle.variableValues.get("votc_celestial_office_audit_worker_expected_holder"), realm.emperor,
    "the continuation retains the expected authority owner");
  assert.equal(realm.chinaTitle.variables.has("votc_celestial_office_audit_batch_lock"), true,
    "the first page holds the title-local same-day duplicate-consumption lock");
  // The limited AST model does not advance CK3 dates or expire timed variables.
  // It verifies duplicate blocking and the explicit load-recovery clear, not
  // whether the engine expires a one-day lock before the next daily event tick.
  const queuedBeforeDuplicatePage = realm.chinaTitle.variableLists.get("votc_celestial_office_audit_queue").length;
  assert(executeEvent("votc_celestial_office_release.0006", env),
    "a duplicate callback for the same owner remains valid at the event trigger");
  assert.equal(realm.chinaTitle.variableLists.get("votc_celestial_office_audit_queue").length,
    queuedBeforeDuplicatePage,
  "the title-local lock makes a repeated same-day page consume zero additional officers");

  env.scheduledEvents.length = 0;
  const reloadEnv = makeEnv(realm, realm.emperor);
  qa.invokeHook("on_game_start_after_lobby", reloadEnv);
  assert.equal(realm.chinaTitle.variables.has("votc_celestial_office_audit_batch_lock"), false,
    "the load hook clears the saved same-day lock before restoring pending work");
  assert.equal(reloadEnv.scheduledEvents.filter(item => item.id === "votc_celestial_office_release.0006").length, 1,
    "load recovery re-arms exactly one daily worker for the saved queue");
  assert.equal(reloadEnv.scheduledEvents.find(item => item.id === "votc_celestial_office_release.0006").owner,
    realm.emperor, "the re-armed audit page remains bound to the current h_china holder");
  assert(reloadEnv.scheduledEvents.some(item => item.id === "votc_celestial_office_release.0005" && item.days === "1"),
    "load recovery independently restores the expected-holder-bound monthly collection");
  const rearmedAuditSchedule = reloadEnv.scheduledEvents.find(item => item.id === "votc_celestial_office_release.0005");
  const rearmedGeneration = realm.chinaTitle.variableValues.get("votc_celestial_office_audit_generation");
  assert.equal(rearmedGeneration, 3,
    "load recovery advances the collector generation so pre-load monthly events become stale");
  assert.equal(rearmedAuditSchedule.scopes.votc_celestial_office_audit_event_generation, rearmedGeneration,
    "the re-armed collector captures the new post-load generation");
  const staleQueueLength = realm.chinaTitle.variableLists.get("votc_celestial_office_audit_queue").length;
  const staleWriteCount = reloadEnv.changes.length;
  reloadEnv.scheduledEvents.unshift(staleMonthlySchedule);
  executeScheduledNamedEvent("votc_celestial_office_release.0005", reloadEnv, false);
  assert.equal(realm.chinaTitle.variableLists.get("votc_celestial_office_audit_queue").length, staleQueueLength,
    "a pre-reload monthly event with an old generation performs no queue writes");
  assert.equal(reloadEnv.changes.length, staleWriteCount,
    "a stale monthly event performs no title or liege writes");
  assert.equal(realm.chinaTitle.variableValues.get("votc_celestial_office_audit_generation"), rearmedGeneration,
    "rejecting a stale event does not advance the live generation");
  const remainingMonthlySchedules = reloadEnv.scheduledEvents.filter(item =>
    item.id === "votc_celestial_office_release.0005");
  assert.equal(remainingMonthlySchedules.length, 1,
    "stale-event rejection adds no replacement monthly schedule");
  assert.equal(remainingMonthlySchedules[0], rearmedAuditSchedule,
    "stale-event rejection leaves the newly re-armed event intact");
  executeScheduledNamedEvent("votc_celestial_office_release.0006", reloadEnv);
  assert.equal(realm.chinaTitle.variableLists.get("votc_celestial_office_audit_queue").length, 0,
    "the resumed page finishes the saved audit list");
  assert.equal(registeredOfficerCount(), 10,
    "the reloaded audit registers all ten officers against their own held titles");
  assert.equal(misregisteredTitles().length, 0,
    "every audit-managed title remains bound to its current officer after continuation");
  assert.equal(realm.chinaTitle.variables.has("votc_celestial_office_audit_worker_expected_holder"), false,
    "the completed queue drops its audit worker owner lock");
}

function run() {
  testHarnessSeparatesTemporaryAndPersistentListReferences();
  testPersistentListSyntaxIsNativeAndOwnerScoped();
  testHarnessResolvesNativePrimaryTitleRefs();
  requireDefinition(qa.triggerDefs, API.scopeTrigger, "scope trigger");
  requireDefinition(qa.effectDefs, API.reconcileEffect, "holder reconciliation effect");
  requireDefinition(qa.effectDefs, API.handoffEffect, "same-rank handoff effect");
  requireDefinition(qa.effectDefs, API.workerEffect, "durable character worker effect");
  requireDefinition(qa.triggerDefs, API.expectedGainTrigger, "expected-grant owner guard");
  testChinaOnlyScopeAndZeroWrites();
  testExplicitSuccessionLawsWithoutAppointmentFlag();
  testEmpireOfficeHasNoLowerLandOrLandedVassals();
  testCountyTransferAndVassalLiegeChangeAreDifferentOperations();
  testSameRankPostGrantReconciliationReleasesOldEstate();
  testChangedLateralAnchorStopsLaterWrites();
  testNativeAppointmentCompatibility();
  testProductionTransferCandidateHardFilter();
  testKingdomCapitalDuchyAndMeritAppointmentAst();
  testCourtierFallbackWithExplicitNativeFamilyEffectFixture();
  testRegionBudgetPersistsAndContinuesThroughDailyWorker();
  testDuchyAndCountyLandBoundaries();
  testDuplicateGainAndAllExpectedOwnersAreRequired();
  testTaskExpectedHolderMismatchAndReloadRearm();
  testTrustedCrossborderInheritanceOnly();
  testTrustedLowerOfficeSuccessionDowngrade();
  testOrdinaryGrantDoesNotUseSuccessionDowngrade();
  testSameTierNobleFamilyTitleDoesNotStartLateralTask();
  testBatchIncomingTitlesDoNotTriggerLateralHandoff();
  testCrossTitleHandoffPathStopsCircularReassignment();
  testAuditAuthorityAndNoTwoDayTtl();
  console.log("V1.1.1 celestial office independent QA: assertions passed in the limited AST model");
}

run();

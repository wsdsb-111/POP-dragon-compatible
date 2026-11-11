"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v1311-finite-helper");

const root = path.resolve(__dirname, "..");
const h = createHarness([]);
const readBytes = relative => fs.readFileSync(path.join(root, relative));
const read = relative => readBytes(relative).toString("utf8").replace(/^\uFEFF/, "");
const parse = relative => h.parsePdx(read(relative), relative);

function only(nodes, key, label) {
  const found = Array.from(nodes).filter(node => node.key === key);
  assert.equal(found.length, 1, `${label}: expected one ${key}`);
  return found[0];
}

function blockKeys(node, label) {
  const entries = Array.from(node.value);
  for (const entry of entries) {
    assert.equal(entry.operator, "=", `${label}: expected a trait entry`);
    assert.ok(Array.isArray(entry.value), `${label}/${entry.key}: expected a trait block`);
  }
  return entries.map(entry => entry.key);
}

function descendants(nodes, key) {
  return Array.from(nodes).flatMap(node => [
    ...(node.key === key ? [node] : []),
    ...(Array.isArray(node.value) ? descendants(node.value, key) : [])
  ]);
}

function locale(relative, language) {
  const bytes = readBytes(relative);
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf], `${relative}: CK3 localization requires UTF-8 BOM`);
  const text = bytes.subarray(3).toString("utf8");
  assert.match(text, new RegExp(`^l_${language}:\\r?$`, "m"), `${relative}: correct language header`);
  return text;
}

function localizedValue(source, key, label) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = source.split(/\r?\n/).find(candidate => new RegExp(`^[\\t ]*${escaped}:0?\\s+`).test(candidate));
  assert.ok(line, `${label}: missing ${key}`);
  const match = /^[\t ]*[^:]+:0?\s+"(.*)"\s*$/.exec(line);
  assert.ok(match && match[1].length > 0, `${label}: empty or malformed ${key}`);
  return match[1];
}

const contexts = [
  { faith: "mm_dragon_black", tenet: "mm_tenet_black", identity: "mm_royal_black_emperor", zhName: "黑皇", enName: "Black Emperor", traitFile: "patches/wyvern-kings/mod/common/traits/mm_royal_traits.txt", zhFile: "patches/wyvern-kings/mod/localization/simp_chinese/zzzzzzzz_mm_royal_l_simp_chinese.yml", enFile: "patches/wyvern-kings/mod/localization/english/zzzzzzzz_mm_royal_l_english.yml" },
  { faith: "mm_dragon_white", tenet: "mm_tenet_white_third", identity: "mm_royal_white_empress", zhName: "白皇", enName: "White Empress", traitFile: "patches/wyvern-kings/mod/common/traits/mm_royal_traits.txt", zhFile: "patches/wyvern-kings/mod/localization/simp_chinese/zzzzzzzz_mm_royal_l_simp_chinese.yml", enFile: "patches/wyvern-kings/mod/localization/english/zzzzzzzz_mm_royal_l_english.yml" },
  { faith: "mm_dragon_fire", tenet: "mm_tenet_fire", identity: "mm_royal_fire_king", zhName: "青铜与火之王", enName: "King of Bronze and Fire", traitFile: "patches/wyvern-kings/mod/common/traits/mm_royal_throne_identity_traits.txt", zhFile: "patches/wyvern-kings/mod/localization/simp_chinese/mm_royal_throne_identity_l_simp_chinese.yml", enFile: "patches/wyvern-kings/mod/localization/english/mm_royal_throne_identity_l_english.yml" },
  { faith: "mm_dragon_earth", tenet: "mm_tenet_earth_third", identity: "mm_royal_earth_king", zhName: "大地与山之王", enName: "King of Earth and Mountain", traitFile: "patches/wyvern-kings/mod/common/traits/mm_royal_throne_identity_traits.txt", zhFile: "patches/wyvern-kings/mod/localization/simp_chinese/mm_royal_throne_identity_l_simp_chinese.yml", enFile: "patches/wyvern-kings/mod/localization/english/mm_royal_throne_identity_l_english.yml" },
  { faith: "mm_dragon_sea", tenet: "mm_tenet_sea", identity: "mm_royal_sea_king", zhName: "海洋与水之王", enName: "King of Ocean and Water", traitFile: "patches/wyvern-kings/mod/common/traits/mm_royal_throne_identity_traits.txt", zhFile: "patches/wyvern-kings/mod/localization/simp_chinese/mm_royal_throne_identity_l_simp_chinese.yml", enFile: "patches/wyvern-kings/mod/localization/english/mm_royal_throne_identity_l_english.yml" },
  { faith: "mm_dragon_sky", tenet: "mm_tenet_sky_third", identity: "mm_royal_sky_king", zhName: "天空与风之王", enName: "King of Sky and Wind", traitFile: "patches/wyvern-kings/mod/common/traits/mm_royal_throne_identity_traits.txt", zhFile: "patches/wyvern-kings/mod/localization/simp_chinese/mm_royal_throne_identity_l_simp_chinese.yml", enFile: "patches/wyvern-kings/mod/localization/english/mm_royal_throne_identity_l_english.yml" }
];

const newRoundLocalizationFiles = [
  { path: "patches/dragon-creed/mod/localization/simp_chinese/mm_v1314_projection_l_simp_chinese.yml", language: "simp_chinese" },
  { path: "patches/dragon-creed/mod/localization/english/mm_v1314_projection_l_english.yml", language: "english" },
  { path: "patches/dragon-creed/mod/localization/simp_chinese/mm_v1312_silk_road_l_simp_chinese.yml", language: "simp_chinese" },
  { path: "patches/dragon-creed/mod/localization/english/mm_v1312_silk_road_l_english.yml", language: "english" }
];
for (const file of newRoundLocalizationFiles) locale(file.path, file.language);

const rites = parse("patches/dragon-creed/mod/common/religion/rite_types/mm_dragon_creed.txt");
const tenets = parse("patches/dragon-creed/mod/common/religion/tenet_types/mm_dragon_creed.txt");
const wyvernSources = JSON.parse(read("patches/wyvern-kings/sources.json"));
const traitFiles = new Map();
const identityContexts = new Map();

for (const context of contexts) {
  if (!traitFiles.has(context.traitFile)) traitFiles.set(context.traitFile, parse(context.traitFile));
  const trait = only(traitFiles.get(context.traitFile), context.identity, `${context.identity} trait definition`);
  assert.equal(trait.value.some(node => node.key === "name"), false, `${context.identity}: use native unscoped trait_<id> name lookup`);
  assert.equal(only(trait.value, "desc", `${context.identity} trait definition`).value, `trait_${context.identity}_desc`, `${context.identity}: description uses its native localization key`);

  const rite = only(rites, context.faith, `${context.faith} faith rite`);
  const riteTenets = only(rite.value, "tenets", `${context.faith} rite tenets`).value.map(node => node.key);
  assert.ok(riteTenets.includes(context.tenet), `${context.faith}: designated identity tenet is selected`);
  const tenet = only(tenets, context.tenet, `${context.faith} identity tenet`);
  const traits = only(tenet.value, "traits", `${context.faith} identity tenet traits`);
  const virtueIds = blockKeys(only(traits.value, "virtues", `${context.faith} virtues`), `${context.faith} virtues`);
  assert.ok(virtueIds.includes(context.identity), `${context.faith}: identity is a virtue in its faith context`);
  identityContexts.set(context.identity, context.faith);

  const chinese = locale(context.zhFile, "simp_chinese");
  const english = locale(context.enFile, "english");
  for (const relative of [context.zhFile, context.enFile]) {
    const modulePath = relative.replace("patches/wyvern-kings/", "");
    const records = wyvernSources.outputs.filter(source => source.path === modulePath);
    assert.equal(records.length, 1, `${modulePath}: one output manifest record`);
    assert.equal(crypto.createHash("sha256").update(readBytes(relative)).digest("hex"), records[0].sha256, `${modulePath}: output manifest matches current localization bytes`);
  }
  assert.equal(localizedValue(chinese, `trait_${context.identity}`, "Simplified Chinese trait localization"), context.zhName, `${context.identity}: expected Chinese name`);
  assert.ok(localizedValue(chinese, `trait_${context.identity}_desc`, "Simplified Chinese trait localization").length > 0, `${context.identity}: Chinese description lookup`);
  assert.equal(localizedValue(english, `trait_${context.identity}`, "English trait localization"), context.enName, `${context.identity}: expected English name`);
  assert.ok(localizedValue(english, `trait_${context.identity}_desc`, "English trait localization").length > 0, `${context.identity}: English description lookup`);
}

for (const context of contexts) {
  let appearances = 0;
  for (const candidate of contexts) {
    const rite = only(rites, candidate.faith, `${candidate.faith} faith rite`);
    const tenetIds = only(rite.value, "tenets", `${candidate.faith} rite tenets`).value.map(node => node.key);
    for (const tenetId of tenetIds) {
      const tenet = only(tenets, tenetId, `${candidate.faith} tenet ${tenetId}`);
      const traits = only(tenet.value, "traits", `${candidate.faith} tenet ${tenetId} traits`);
      const virtues = only(traits.value, "virtues", `${candidate.faith} tenet ${tenetId} virtues`);
      appearances += blockKeys(virtues, `${candidate.faith}/${tenetId} virtues`).filter(id => id === context.identity).length;
    }
  }
  assert.equal(appearances, 1, `${context.identity}: identity virtue appears exactly once across the six faith contexts (${identityContexts.get(context.identity)})`);
}

const faithProjection = parse("patches/dragon-creed/mod/common/scripted_guis/mm_v1314_faith_projection.txt");
const showFaith = only(faithProjection, "mm_v1314_show_faith", "faith list visibility filter");
assert.equal(only(showFaith.value, "scope", "faith list visibility filter").value, "faith");
const showCondition = only(showFaith.value, "is_shown", "faith list visibility filter");
const showBranches = only(showCondition.value, "OR", "faith list visibility filter");
assert.equal(only(only(showBranches.value, "NOT", "ordinary faith branch").value, "religion", "ordinary faith branch").value, "religion:mm_dragon_creed_religion");
assert.equal(only(showBranches.value, "this", "dragon creed faith branch").value, "faith:mm_dragon_creed");
const creedView = only(faithProjection, "mm_v1314_is_creed_view", "creed-specific tooltip branch");
assert.equal(only(creedView.value, "scope", "creed-specific tooltip branch").value, "faith");
assert.equal(only(only(creedView.value, "is_shown", "creed-specific tooltip branch").value, "this", "creed-specific tooltip branch").value, "faith:mm_dragon_creed");

const faithGui = read("patches/dragon-creed/mod/gui/window_faith.gui");
const faithListFilters = [...faithGui.matchAll(/visible\s*=\s*"([^"]*mm_v1314_show_faith[^"]*)"/g)].map(match => match[1]);
assert.equal(faithListFilters.length, 3, "all three faith lists use the explicit creed-aware filter");
assert.equal(faithListFilters.filter(filter => filter.includes("Faith.IsVisibleInGui")).length, 2, "RiteWindow lists retain the native visibility condition");
const tooltipReferences = [...faithGui.matchAll(/using\s*=\s*mm_v1314_viewed_doctrine_tooltip/g)];
assert.equal(tooltipReferences.length, 6, "six FaithWindow doctrine tooltip hosts use the new projection overlay");
assert.match(faithGui, /mm_v1314_holy_site_under_control_ui/);
assert.match(faithGui, /mm_v1314_holy_site_not_under_control_ui/);
assert.match(faithGui, /font\s*=\s*MMDragonTenetUpright/);
assert.match(faithGui, /name\s*=\s*"tenet_name"\s+font\s*=\s*MMDragonTenetUpright/);

const faithTooltip = read("patches/dragon-creed/mod/gui/shared/mm_v1314_faith_tooltip.gui");
assert.match(faithTooltip, /template\s+mm_v1314_viewed_doctrine_tooltip/);
for (const key of ['mm_v1314_doctrine_title', 'mm_v1314_doctrine_effects', 'mm_v1314_doctrine_description']) assert.ok(faithTooltip.includes(`'${key}'`), `tooltip resolves the explicit ${key} localization`);
assert.match(faithTooltip, /FAITH_DOCTRINE_GENERAL_TOOLTIP/);
assert.match(faithTooltip, /FAITH_DOCTRINE_GENERAL_TOOLTIP_DESCRIPTION/);
const projectionChinese = locale("patches/dragon-creed/mod/localization/simp_chinese/mm_v1314_projection_l_simp_chinese.yml", "simp_chinese");
const projectionEnglish = locale("patches/dragon-creed/mod/localization/english/mm_v1314_projection_l_english.yml", "english");
for (const [source, label] of [[projectionChinese, "Chinese"], [projectionEnglish, "English"]]) {
  assert.match(localizedValue(source, "mm_v1314_doctrine_title", `${label} projection localization`), /DoctrineType\.GetDescriptiveNameNoTooltip\( FaithWindow\.GetFaith \)/);
  assert.match(localizedValue(source, "mm_v1314_native_doctrine_title", `${label} projection localization`), /DoctrineType\.GetDescriptiveNameNoTooltip\( GetNullCharacter\.GetFaith \)/);
  assert.match(localizedValue(source, "mm_v1314_holy_site_under_control_ui", `${label} projection localization`), /FaithWindow\.GetFaith\.GetAdherentNamePlural/);
  assert.match(localizedValue(source, "mm_v1314_holy_site_not_under_control_ui", `${label} projection localization`), /FaithWindow\.GetFaith\.GetAdherentNamePlural/);
  assert.match(localizedValue(source, "mm_v1314_doctrine_effects", `${label} projection localization`), /DoctrineType\.GetEffectsDescription\( FaithWindow\.GetSelectedRite \)/);
  assert.match(localizedValue(source, "mm_v1314_doctrine_description", `${label} projection localization`), /FaithWindow\.GetFaith/);
}

const uprightFont = read("patches/dragon-creed/mod/fonts/mm_v1314_tenet_upright.font");
assert.match(uprightFont, /name\s*=\s*"MMDragonTenetUpright"/);
assert.match(uprightFont, /style\s*=\s*italic\s+fontfiles\s*=\s*"Gitan-Regular"/);
assert.match(uprightFont, /style\s*=\s*bold\|italic\s+fontfiles\s*=\s*"Gitan-Bold"/);

const doctrineDefinitions = parse("patches/dragon-creed/mod/common/religion/doctrine_types/mm_dragon_creed.txt");
const doctrineDivergence = new Map([
  ["mm_doctrine_black", 0],
  ["mm_doctrine_white", -1000],
  ["mm_doctrine_fire", -1000],
  ["mm_doctrine_earth", -1000],
  ["mm_doctrine_sea", -1000],
  ["mm_doctrine_sky", -1000]
]);
for (const [doctrineId, expected] of doctrineDivergence) {
  const doctrine = only(doctrineDefinitions, doctrineId, "dragon rite doctrine definitions");
  const divergence = doctrine.value.find(node => node.key === "divergence");
  assert.equal(divergence ? Number(divergence.value) : 0, expected, `${doctrineId}: expected divergence contribution`);
  for (const gate of ["is_shown", "can_pick"]) {
    const gateNode = only(doctrine.value, gate, `${doctrineId} ${gate}`);
    assert.deepEqual(descendants(gateNode.value, "religion").map(node => node.value), ["religion:mm_dragon_creed_religion"], `${doctrineId} ${gate}: restrict to the Dragon Creed religion`);
  }
}

const doctrineGroup = only(parse("patches/dragon-creed/mod/common/religion/doctrine_group_types/mm_dragon_creed.txt"), "mm_dragon_rite_doctrine", "dragon rite doctrine group");
assert.equal(only(doctrineGroup.value, "divergence", "dragon rite doctrine group").value, "category");
assert.equal(only(doctrineGroup.value, "doctrine_lock", "dragon rite doctrine group").value, "religion");
const createGate = only(doctrineGroup.value, "is_available_on_create", "dragon rite doctrine group");
assert.deepEqual(descendants(createGate.value, "religion").map(node => node.value), ["religion:mm_dragon_creed_religion"], "custom rite doctrine creation is scoped to the Dragon Creed religion");

const faithRepair = parse("patches/dragon-creed/mod/common/scripted_effects/mm_v1313_faith_repair.txt");
const ensureRites = only(faithRepair, "mm_v1313_ensure_rites_effect", "canonical rite doctrine restoration");
const specialDoctrineIds = [...doctrineDivergence.keys()];
const categoryDoctrineIds = Array.from(doctrineDefinitions)
  .filter(node => node.value.some(child => child.key === "doctrine_group_type" && child.value === "mm_dragon_rite_doctrine"))
  .map(node => node.key);
for (const context of contexts) {
  const color = context.faith.replace("mm_dragon_", "");
  const correctDoctrine = `mm_doctrine_${color}`;
  const rite = only(rites, context.faith, `${context.faith} doctrine divergence input`);
  const activeDoctrines = Array.from(only(rite.value, "doctrines", `${context.faith} doctrine divergence input`).value, node => node.key);
  const activeGroupDoctrines = activeDoctrines.filter(id => categoryDoctrineIds.includes(id));
  assert.deepEqual(activeGroupDoctrines, [correctDoctrine], `${context.faith}: exactly one custom doctrine contributes to its group divergence sum`);
  // This computes only the selected doctrine's contribution to this custom group, not total faith divergence.
  const customGroupContribution = activeGroupDoctrines.reduce((sum, id) => sum + (doctrineDivergence.get(id) || 0), 0);
  assert.equal(customGroupContribution, doctrineDivergence.get(correctDoctrine), `${context.faith}: category mode uses the selected custom doctrine value`);
  if (color !== "black") assert.ok(customGroupContribution < 100, `${context.faith}: custom group contribution is below the native faith creation threshold; total runtime score remains unverified`);

  const riteScope = only(descendants(ensureRites.value, `rite:mm_dragon_${color}`), `rite:mm_dragon_${color}`, "canonical rite doctrine restoration");
  const removed = descendants(riteScope.value, "remove_rite_doctrine").map(node => node.value).sort();
  const expectedRemoved = specialDoctrineIds.filter(id => id !== correctDoctrine).sort();
  assert.deepEqual(removed, expectedRemoved, `${context.faith}: remove every other royal special doctrine`);
  assert.deepEqual(descendants(riteScope.value, "add_rite_doctrine").map(node => node.value), [correctDoctrine], `${context.faith}: restore its matching royal special doctrine`);
  const riteActions = Array.from(riteScope.value).filter(node => node.key === "if").map(branch => {
    const actions = ["remove_rite_doctrine", "add_rite_doctrine", "set_parent_faith"].filter(key => descendants(branch.value, key).length > 0);
    assert.equal(actions.length, 1, `${context.faith}: each doctrine restoration branch has one ordered action`);
    return actions[0];
  });
  assert.deepEqual(riteActions, [
    ...expectedRemoved.map(() => "remove_rite_doctrine"),
    "add_rite_doctrine",
    "set_parent_faith"
  ], `${context.faith}: restore the correct doctrine before reparenting the rite`);
}

const savedRepair = only(faithRepair, "mm_v1313_repair_saved_creed_effect", "saved Dragon Creed repair");
const creedReligion = only(descendants(savedRepair.value, "religion:mm_dragon_creed_religion"), "religion:mm_dragon_creed_religion", "saved Dragon Creed repair");
const offshootFaiths = only(creedReligion.value, "every_faith", "saved Dragon Creed offshoot repair");
const offshootLimit = only(offshootFaiths.value, "limit", "saved Dragon Creed offshoot repair");
const canonicalFaithGuard = only(offshootLimit.value, "NOT", "saved Dragon Creed canonical faith guard");
assert.equal(only(canonicalFaithGuard.value, "this", "saved Dragon Creed canonical faith guard").value, "faith:mm_dragon_creed");
const offshootRites = only(offshootFaiths.value, "every_faith_rite", "saved Dragon Creed offshoot repair");
assert.equal(only(offshootRites.value, "set_can_convert_to_rite", "saved Dragon Creed offshoot repair").value, "no", "disable conversion from old offshoot rites without deleting saved Faith objects");
assert.doesNotMatch(read("patches/dragon-creed/mod/common/scripted_effects/mm_v1314_split_cleanup.txt"), /\b(?:remove|delete)_faith\s*=/, "split cleanup does not delete saved Faith objects");

const splitCleanup = parse("patches/dragon-creed/mod/common/scripted_effects/mm_v1314_split_cleanup.txt");
for (const [effectName, setter, riteSetter] of [
  ["mm_v1314_migrate_split_character_effect", "set_character_faith", "set_character_rite"],
  ["mm_v1314_migrate_split_county_effect", "set_county_faith", "set_county_rite"]
]) {
  const migration = only(splitCleanup, effectName, "Dragon Creed split cleanup");
  const outerIf = only(migration.value, "if", `${effectName} religion scope`);
  const limit = only(outerIf.value, "limit", `${effectName} religion scope`);
  assert.equal(only(limit.value, "faith.religion", `${effectName} religion scope`).value, "religion:mm_dragon_creed_religion", `${effectName}: leave unrelated religions untouched`);
  assert.equal(only(only(limit.value, "NOT", `${effectName} canonical faith guard`).value, "faith", `${effectName} canonical faith guard`).value, "faith:mm_dragon_creed", `${effectName}: leave the canonical faith untouched`);
  const branches = outerIf.value.filter(node => node.key === "if" || node.key === "else_if");
  assert.equal(branches.length, contexts.length, `${effectName}: one migration branch per named royal tenet`);
  for (let index = 0; index < contexts.length; index += 1) {
    const context = contexts[index];
    const color = context.faith.replace("mm_dragon_", "");
    const branch = branches[index];
    const branchLimit = only(branch.value, "limit", `${effectName}/${color} branch`);
    const riteCondition = only(branchLimit.value, "rite", `${effectName}/${color} branch`);
    assert.equal(only(riteCondition.value, "rite_has_tenet", `${effectName}/${color} branch`).value, `mm_tenet_${color}`, `${effectName}: branch follows its original tenet`);
    assert.equal(only(branch.value, setter, `${effectName}/${color} branch`).value, "faith:mm_dragon_creed");
    assert.equal(only(branch.value, riteSetter, `${effectName}/${color} branch`).value, `rite:${context.faith}`);
  }
}

const migrationOnActions = parse("patches/dragon-creed/mod/common/on_action/mm_dragon_creed_migration.txt");
assert.deepEqual(Array.from(only(migrationOnActions, "on_game_start_after_lobby", "Dragon Creed startup repair").value, node => node.key), ["on_actions"]);
const startup = only(migrationOnActions, "mm_dragon_creed_repair_v1311", "Dragon Creed startup repair");
const startupEffect = only(startup.value, "effect", "Dragon Creed startup repair");
const startupCharacters = only(startupEffect.value, "every_living_character", "Dragon Creed split character migration");
const startupCounties = only(startupEffect.value, "every_county", "Dragon Creed split county migration");
assert.ok(startupCharacters.value.some(node => node.key === "mm_v1314_migrate_split_character_effect"), "startup runs the character split cleanup");
assert.ok(startupCounties.value.some(node => node.key === "mm_v1314_migrate_split_county_effect"), "startup runs the county split cleanup");

for (const context of contexts) {
  const color = context.faith.replace("mm_dragon_", "");
  const rite = only(rites, context.faith, `${context.faith} rite`);
  const doctrineIds = only(rite.value, "doctrines", `${context.faith} doctrines`).value.map(node => node.key);
  assert.ok(doctrineIds.includes(`mm_doctrine_${color}`), `${context.faith}: its matching special doctrine remains attached after repair`);
}

console.log("v1.3.14 independent localization, faith UI, divergence source, doctrine restoration, and scoped migration QA passed; CK3 runtime not exercised");

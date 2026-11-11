'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const POD_ROOT = 'D:\\SteamLibrary\\steamapps\\workshop\\content\\1158310\\2216659254';
const GAME_ROOT = 'D:\\SteamLibrary\\steamapps\\common\\Crusader Kings III\\game';
const OUTPUT_ROOT = path.join(ROOT, 'patches', 'wyvern-pod', 'mod');
const MANIFEST_PATH = path.join(ROOT, 'patches', 'wyvern-pod', 'mechanics-sources.json');
const ROOTS = { R: ROOT, PoD: POD_ROOT, game: GAME_ROOT };
const sources = new Map();
const outputs = [];

function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function inputPath(rootName, relativePath) {
  const absolutePath = path.resolve(ROOTS[rootName], relativePath);
  const rootPath = path.resolve(ROOTS[rootName]);
  if (absolutePath !== rootPath && !absolutePath.startsWith(rootPath + path.sep)) {
    throw new Error(`Input escapes ${rootName}: ${relativePath}`);
  }
  return absolutePath;
}

function readInput(rootName, relativePath, role) {
  const absolutePath = inputPath(rootName, relativePath);
  const bytes = fs.readFileSync(absolutePath);
  const key = `${rootName}:${relativePath.replace(/\\/g, '/')}`;
  sources.set(key, {
    root: rootName,
    path: relativePath.replace(/\\/g, '/'),
    sha256: sha256(bytes),
    roles: [...new Set([...(sources.get(key)?.roles || []), role])]
  });
  return normalize(bytes.toString('utf8'));
}

function matchingBrace(text, openIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
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
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unclosed block at offset ${openIndex}`);
}

function parseDefinitions(text, sourceLabel) {
  const definitions = new Map();
  const pattern = /^([A-Za-z0-9_:.@-]+)[ \t]*=[ \t]*\{/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const open = text.indexOf('{', match.index);
    const close = matchingBrace(text, open);
    const definition = {
      id: match[1],
      text: text.slice(match.index, close + 1),
      source: sourceLabel
    };
    const existing = definitions.get(definition.id);
    if (existing && existing.text !== definition.text) {
      throw new Error(`Conflicting duplicate ${definition.id} in ${sourceLabel}`);
    }
    definitions.set(definition.id, definition);
    pattern.lastIndex = close + 1;
  }
  return definitions;
}

function directBlocks(block) {
  const outerOpen = block.indexOf('{');
  const outerClose = matchingBrace(block, outerOpen);
  const found = [];
  let depth = 1;
  let inString = false;
  let escaped = false;
  let inComment = false;
  let i = outerOpen + 1;
  while (i < outerClose) {
    const atLineStart = i === 0 || block[i - 1] === '\n';
    if (atLineStart && depth === 1) {
      const lineEnd = block.indexOf('\n', i) === -1 ? block.length : block.indexOf('\n', i);
      const line = block.slice(i, lineEnd);
      const fieldMatch = /^([ \t]*)([A-Za-z0-9_:.@-]+)[ \t]*=[ \t]*\{/.exec(line);
      if (fieldMatch) {
        const open = i + fieldMatch[0].lastIndexOf('{');
        const close = matchingBrace(block, open);
        found.push({
          key: fieldMatch[2],
          start: i,
          end: close + 1,
          open,
          close,
          indent: fieldMatch[1],
          text: block.slice(i, close + 1)
        });
        i = close + 1;
        continue;
      }
    }

    const char = block[i];
    if (inComment) {
      if (char === '\n') inComment = false;
    } else if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '#') inComment = true;
    else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    i += 1;
  }
  return found;
}

function requireDefinition(definitions, id, sourceLabel) {
  const definition = definitions.get(id);
  if (!definition) throw new Error(`Missing ${id} in ${sourceLabel}`);
  return definition.text;
}

function requireField(block, key, sourceLabel) {
  const field = directBlocks(block).find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Missing field ${key} in ${sourceLabel}`);
  return field;
}

function replaceDirectBlock(block, key, replacement, sourceLabel) {
  const fields = directBlocks(block).filter((candidate) => candidate.key === key);
  if (fields.length !== 1) throw new Error(`Expected one ${key} in ${sourceLabel}, found ${fields.length}`);
  const field = fields[0];
  return block.slice(0, field.start) + replacement + block.slice(field.end);
}

function appendBeforeClose(block, addition) {
  const open = block.indexOf('{');
  const close = matchingBrace(block, open);
  const closeLine = block.lastIndexOf('\n', close - 1) + 1;
  const prefix = block.slice(0, closeLine);
  const suffix = block.slice(closeLine);
  return `${prefix}${addition.replace(/\s+$/, '')}\n${suffix}`;
}

function replaceOnce(text, before, after, sourceLabel) {
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected one anchor in ${sourceLabel}: ${before}`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function collectDirectory(rootName, relativeDirectory, role) {
  const absoluteDirectory = inputPath(rootName, relativeDirectory);
  const result = new Map();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
        const relative = path.relative(ROOTS[rootName], absolute).replace(/\\/g, '/');
        const definitions = parseDefinitions(readInput(rootName, relative, role), `${rootName}/${relative}`);
        for (const [id, definition] of definitions) {
          const existing = result.get(id);
          if (existing && existing.text !== definition.text) {
            throw new Error(`Conflicting base definitions for ${id}: ${existing.source} and ${definition.source}`);
          }
          if (!existing) result.set(id, definition);
        }
      }
    }
  }
  visit(absoluteDirectory);
  return result;
}

function indentMore(text, prefix) {
  return text.split('\n').map((line) => line.length === 0 ? line : prefix + line).join('\n');
}

function dedent(text) {
  const lines = text.trim().split('\n');
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) return '';
  const common = nonEmpty.reduce((min, line) => {
    const indent = /^[ \t]*/.exec(line)[0].length;
    return Math.min(min, indent);
  }, Infinity);
  return lines.map((line) => line.trim().length === 0 ? '' : line.slice(common)).join('\n');
}

function wrapAccessField(block, key, sourceLabel) {
  const field = requireField(block, key, sourceLabel);
  const inner = block.slice(field.open + 1, field.close);
  const body = dedent(inner);
  const indent = field.indent;
  const nested = body ? indentMore(body, `${indent}\t\t\t`) : '';
  return [
    `${indent}${key} = {`,
    `${indent}\tOR = {`,
    `${indent}\t\thas_character_modifier = mm_relic_fire_forging`,
    `${indent}\t\tAND = {`,
    nested,
    `${indent}\t\t}`,
    `${indent}\t}`, 
    `${indent}}`
  ].filter((line, index) => line !== '' || index === 4).join('\n');
}

function mergeTemplate(baseText, patchText, label) {
  let merged = baseText;
  for (const key of ['can_equip', 'can_benefit']) {
    const patchField = directBlocks(patchText).find((field) => field.key === key);
    const baseField = directBlocks(merged).find((field) => field.key === key);
    if (!patchField || !baseField) continue;
    if (!patchField.text.includes('has_character_modifier = mm_relic_fire_forging')) {
      throw new Error(`Missing relic access gate in ${label}.${key}`);
    }
    merged = replaceDirectBlock(merged, key, wrapAccessField(merged, key, label), label);
  }
  return merged;
}

function writeOutput(relativePath, content, semantic) {
  const normalized = `${normalize(content).trimEnd()}\n`;
  const absolute = path.resolve(OUTPUT_ROOT, relativePath);
  if (!absolute.startsWith(path.resolve(OUTPUT_ROOT) + path.sep)) throw new Error(`Output escapes PoD patch: ${relativePath}`);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const bytes = Buffer.from(normalized, 'utf8');
  fs.writeFileSync(absolute, bytes);
  outputs.push({ path: `mod/${relativePath.replace(/\\/g, '/')}`, sha256: sha256(bytes), semantic });
}

function definitionsText(definitions) {
  return definitions.map((definition) => definition.trim()).join('\n\n');
}

function mergeCharacterPreservation() {
  const podPath = 'common/scripted_effects/07_dlc_ep3_scripted_effects.txt';
  const sourcePath = 'patches/character-preservation/mod/common/scripted_effects/07_dlc_ep3_scripted_effects.txt';
  const pod = parseDefinitions(readInput('PoD', podPath, 'PoD base for preserved EP3 cleanup'), `PoD/${podPath}`);
  const source = parseDefinitions(readInput('R', sourcePath, 'MMPatch cleanup protection'), sourcePath);
  let effect = requireDefinition(pod, 'create_landless_adventurer_title_effect', `PoD/${podPath}`);
  const sourceEffect = requireDefinition(source, 'create_landless_adventurer_title_effect', sourcePath);
  if (!sourceEffect.includes('mm_cleanup_is_protected = yes')) throw new Error('MMPatch cleanup guard missing');
  const candidates = [...effect.matchAll(/else_if[ \t]*=[ \t]*\{/g)].map((match) => match.index);
  let inserted = 0;
  for (const start of candidates) {
    const open = effect.indexOf('{', start);
    const close = matchingBrace(effect, open);
    const branch = effect.slice(start, close + 1);
    if (!branch.includes('POD_can_be_invited_to_camp') || !branch.includes('death_reason = death_vanished')) continue;
    const limit = branch.indexOf('limit = {');
    const nor = branch.indexOf('NOR = {', limit);
    if (limit < 0 || nor < 0) throw new Error('Could not locate PoD counselor cleanup branch');
    const limitLineEnd = branch.indexOf('\n', limit);
    const lineStart = branch.lastIndexOf('\n', limit) + 1;
    const indent = branch.slice(lineStart, limit).match(/^[ \t]*/)[0] + '\t';
    const insertion = `${effect.slice(0, start)}${branch.slice(0, limitLineEnd + 1)}${indent}NOT = { mm_cleanup_is_protected = yes }\n${branch.slice(limitLineEnd + 1)}${effect.slice(close + 1)}`;
    effect = insertion;
    inserted += 1;
  }
  if (inserted !== 1 || !effect.includes('POD_restore_saved_haven_buildings = yes') || !effect.includes('POD_can_be_invited_to_camp')) {
    throw new Error('EP3 cleanup merge did not preserve PoD behavior and one MMPatch guard');
  }
  writeOutput(
    'common/scripted_effects/zzzz_mm_pod_character_preservation.txt',
    effect,
    'PoD create_landless_adventurer_title_effect with the MM cleanup-protection guard; leaves PoD building restoration, camp-invitation and curia logic intact.'
  );
}

function mergeGuestCleanupEvent() {
  const podPath = 'events/courtier_guest_management_events/courtier_guest_management_events.txt';
  const sourcePath = 'patches/character-preservation/mod/events/courtier_guest_management_events/courtier_guest_management_events.txt';
  const pod = parseDefinitions(readInput('PoD', podPath, 'PoD guest-cleanup event base'), `PoD/${podPath}`);
  const source = parseDefinitions(readInput('R', sourcePath, 'MMPatch guest-cleanup guard'), sourcePath);
  let event = requireDefinition(pod, 'courtier_guest_management.2001', `PoD/${podPath}`);
  const sourceEvent = requireDefinition(source, 'courtier_guest_management.2001', sourcePath);
  if (!sourceEvent.includes('mm_cleanup_is_protected = yes')) throw new Error('Guest cleanup MMPatch guard missing');
  const pool = 'pool_character_is_pruneable_trigger = yes';
  if (event.includes('mm_cleanup_is_protected = yes')) throw new Error('PoD guest event already includes the MM guard');
  event = replaceOnce(event, pool, `${pool}\n\t\t\t\t\tNOT = { mm_cleanup_is_protected = yes }`, 'PoD guest cleanup event');
  if (!event.includes('POD_is_available_for_events = yes') || !event.includes('has_POD_longevity_trigger = yes') || !event.includes('#random = {')) {
    throw new Error('Guest cleanup merge did not preserve PoD event behavior');
  }
  writeOutput(
    'events/courtier_guest_management_events/courtier_guest_management_events.txt',
    event,
    'PoD courtier_guest_management.2001 event with the MM cleanup-protection condition; retains PoD availability, longevity and disabled pool-development logic.'
  );
}

function mergeFactions() {
  const sourcePath = 'patches/dragon-creed/mod/common/factions/zzzzzz_mm_v1312_factions.txt';
  const source = parseDefinitions(readInput('R', sourcePath, 'Dragon Creed faction reductions'), sourcePath);
  const pod = collectDirectory('PoD', 'common/factions', 'PoD faction baseline');
  const game = collectDirectory('game', 'common/factions', 'vanilla TGP faction baseline');
  const reductions = [
    ['independence_faction', 'mm_creed_faction_reduction_common'],
    ['liberty_faction', 'mm_creed_faction_reduction_common'],
    ['claimant_faction', 'mm_creed_faction_reduction_common'],
    ['nation_fracturing_faction', 'mm_creed_faction_reduction_common'],
    ['nomadic_faction', 'mm_creed_faction_reduction_nomadic'],
    ['peasant_faction', 'mm_creed_faction_reduction_peasant'],
    ['populist_faction', 'mm_creed_faction_reduction_populist'],
    ['escalated_peasant_faction', 'mm_creed_faction_reduction_peasant'],
    ['replace_ceremonial_regent_faction', 'mm_creed_faction_reduction_common'],
    ['restore_ceremonial_liege_faction', 'mm_creed_faction_reduction_common'],
    ['ceremonial_claimant_faction', 'mm_creed_faction_reduction_common'],
    ['imperial_policy_faction', 'mm_creed_faction_reduction_common']
  ];
  const merged = [];
  for (const [id, reduction] of reductions) {
    const base = pod.get(id) || game.get(id);
    if (!base) throw new Error(`No PoD or vanilla base for faction ${id}`);
    const sourceBlock = requireDefinition(source, id, sourcePath);
    const sourceProgress = requireField(sourceBlock, 'discontent_progress', `${sourcePath}:${id}`).text;
    const modifier = directBlocks(sourceProgress).find((field) => field.key === 'modifier' && field.text.includes(`add = ${reduction}`));
    if (!modifier) throw new Error(`No ${reduction} block for faction ${id}`);
    const sourceComment = '\t\t# v1.3.12: subtract 40% of positive final progress only.';
    const progress = requireField(base.text, 'discontent_progress', `${base.source}:${id}`).text;
    if (progress.includes('mm_creed_faction_reduction_')) throw new Error(`Base faction already has a Dragon Creed reduction: ${id}`);
    const mergedProgress = appendBeforeClose(progress, `${sourceComment}\n${modifier.text}`);
    merged.push(replaceDirectBlock(base.text, 'discontent_progress', mergedProgress, `${base.source}:${id}`));
  }
  writeOutput(
    'common/factions/zzzz_mm_pod_dragon_creed_factions.txt',
    definitionsText(merged),
    'Twelve PoD or vanilla faction definitions with only their matching MM earth-rite discontent reduction; omits Hanfan faction definitions.'
  );
}

function mergeFactionValues() {
  const sourcePath = 'patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_faction_values.txt';
  const source = parseDefinitions(readInput('R', sourcePath, 'Dragon Creed faction reduction values'), sourcePath);
  const ids = [
    'mm_creed_faction_raw_common',
    'mm_creed_faction_raw_populist',
    'mm_creed_faction_raw_peasant',
    'mm_creed_faction_reduction_common',
    'mm_creed_faction_reduction_populist',
    'mm_creed_faction_reduction_peasant',
    'mm_creed_faction_reduction_nomadic'
  ];
  writeOutput(
    'common/script_values/zzzz_mm_pod_dragon_creed_faction_values.txt',
    definitionsText(ids.map((id) => requireDefinition(source, id, sourcePath))),
    'MM common, populist, peasant and nomadic reductions only; excludes both Hanfan-specific values.'
  );
}

function mergeConversionValues() {
  const podReligionPath = 'common/script_values/02_religion_values.txt';
  const sourceReligionPath = 'patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_religion_values.txt';
  const gameChaplainPath = 'common/script_values/99_court_chaplain_values.txt';
  const sourceChaplainPath = 'patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_conversion_factors.txt';
  const podReligion = parseDefinitions(readInput('PoD', podReligionPath, 'PoD religion conversion baseline'), `PoD/${podReligionPath}`);
  const sourceReligion = parseDefinitions(readInput('R', sourceReligionPath, 'Dragon Creed conversion-resistance addition'), sourceReligionPath);
  const religion = requireDefinition(podReligion, 'demand_conversion_tenet_impact', `PoD/${podReligionPath}`);
  const sourceDemand = requireDefinition(sourceReligion, 'demand_conversion_tenet_impact', sourceReligionPath);
  const demandAddition = directBlocks(sourceDemand).find((field) => field.key === 'if' && field.text.includes('mm_tenet_earth_third'));
  if (!demandAddition) throw new Error('Missing MM earth-rite conversion resistance');
  const mergedDemand = appendBeforeClose(religion, '\t# Only earth-rite vassals with the closure tenet resist their liege conversion demand.\n' + demandAddition.text);

  const gameChaplain = parseDefinitions(readInput('game', gameChaplainPath, 'Vanilla court chaplain conversion baseline'), `game/${gameChaplainPath}`);
  const sourceChaplain = parseDefinitions(readInput('R', sourceChaplainPath, 'Dragon Creed holy-site conversion addition'), sourceChaplainPath);
  const chaplain = requireDefinition(gameChaplain, 'court_chaplain_conversion_factors', `game/${gameChaplainPath}`);
  const sourceChaplainBlock = requireDefinition(sourceChaplain, 'court_chaplain_conversion_factors', sourceChaplainPath);
  const holySiteAddition = directBlocks(sourceChaplainBlock).find((field) => field.key === 'if' && field.text.includes('mm_creed_controls_baghdad_holy_site_trigger'));
  if (!holySiteAddition || chaplain.includes('mm_creed_controls_baghdad_holy_site_trigger')) throw new Error('Court chaplain holy-site merge is not a single additive block');
  const mergedChaplain = appendBeforeClose(chaplain, '\t# Controlled Dragon Creed holy sites strengthen conversion in the ruler realm.\n' + holySiteAddition.text);

  writeOutput(
    'common/script_values/zzzz_mm_pod_dragon_creed_conversion.txt',
    definitionsText([mergedDemand, mergedChaplain]),
    'PoD demand-conversion values plus the MM earth-rite resistance, and vanilla court-chaplain values plus the MM controlled holy-site bonus.'
  );
}

function mergeMarriageModifiers() {
  const podPath = 'common/scripted_modifiers/00_marriage_scripted_modifiers.txt';
  const sourcePath = 'patches/dragon-bond/mod/common/scripted_modifiers/zzzz_mm_dragon_bond_marriage.txt';
  const pod = parseDefinitions(readInput('PoD', podPath, 'PoD marriage modifier baseline'), `PoD/${podPath}`);
  const source = parseDefinitions(readInput('R', sourcePath, 'Dragon Bond marriage modifiers'), sourcePath);
  let marriage = requireDefinition(pod, 'marriage_ai_accept_modifier', `PoD/${podPath}`);
  const sourceMarriage = requireDefinition(source, 'marriage_ai_accept_modifier', sourcePath);
  if (!sourceMarriage.includes('mm_dragon_bond_faith_hostility_modifier = yes') || !sourceMarriage.includes('mm_dragon_bond_fertility_modifier = yes')) {
    throw new Error('Dragon Bond modifier substitutions missing');
  }
  marriage = replaceOnce(marriage, 'marriage_ai_accept_faith_hostility_modifier = yes', 'mm_dragon_bond_faith_hostility_modifier = yes', 'PoD marriage modifier');
  marriage = replaceOnce(marriage, 'marriage_ai_accept_fertility_modifier = yes', 'mm_dragon_bond_fertility_modifier = yes', 'PoD marriage modifier');
  const added = directBlocks(sourceMarriage).filter((field) => field.key === 'modifier' && (
    field.text.includes('mm_dragon_is_true_dragon_parent_trigger') ||
    field.text.includes('mm_v1311_sea_marriage_acceptance') ||
    field.text.includes('mm_creed_is_dragon_faith_trigger')
  ));
  if (added.length !== 6) throw new Error(`Expected six MM marriage acceptance blocks, found ${added.length}`);
  marriage = appendBeforeClose(marriage, added.map((field) => field.text).join('\n'));
  const helpers = [
    requireDefinition(source, 'mm_dragon_bond_faith_hostility_modifier', sourcePath),
    requireDefinition(source, 'mm_dragon_bond_fertility_modifier', sourcePath)
  ];
  writeOutput(
    'common/scripted_modifiers/zzzz_mm_pod_dragon_bond_marriage.txt',
    definitionsText([marriage, ...helpers]),
    'PoD marriage acceptance modifier and its PoD-specific weights, with the MM Dragon Bond modifiers and six dragon/rite acceptance additions.'
  );
}

function mergeKnightTrigger() {
  const podPath = 'common/scripted_triggers/00_war_and_peace_triggers.txt';
  const sourceCapturePath = 'patches/wyvern-capture/mod/common/scripted_triggers/zzzzzz_mm_wyvern_lifecycle_combat.txt';
  const sourceAscensionPath = 'patches/wyvern-ascension/mod/common/scripted_triggers/zzzzzzzzzz_mm_ascension_civil_rights.txt';
  const pod = parseDefinitions(readInput('PoD', podPath, 'PoD knight eligibility baseline'), `PoD/${podPath}`);
  const capture = parseDefinitions(readInput('R', sourceCapturePath, 'Wyvern capture knight branch and helper triggers'), sourceCapturePath);
  const ascension = parseDefinitions(readInput('R', sourceAscensionPath, 'Wyvern ascension knight branch and helper triggers'), sourceAscensionPath);
  const base = requireDefinition(pod, 'can_be_knight_trigger', `PoD/${podPath}`);
  const fields = directBlocks(base);
  if (fields.length < 4 || fields[0].key !== 'is_available_quick' || fields[1].key !== 'NOT' || fields[2].key !== 'NOT') {
    throw new Error('Unexpected PoD can_be_knight_trigger layout');
  }
  const prefix = fields.slice(0, 3).map((field) => indentMore(field.text.trim(), '\t')).join('\n');
  const body = fields.slice(3).map((field) => indentMore(field.text.trim(), '\t\t')).join('\n');
  const knight = [
    'can_be_knight_trigger = {',
    prefix,
    '\ttrigger_if = {',
    '\t\tlimit = {',
    '\t\t\tmyv_is_wyvern = yes',
    '\t\t\tNOT = { has_trait = mm_asc_dragon_body }',
    '\t\t}',
    '\t\tmm_wyvern_can_serve_as_knight = { ARMY_OWNER = $ARMY_OWNER$ }',
    '\t}',
    '\ttrigger_else = {',
    '\t\tOR = { myv_is_wyvern = no has_trait = mm_asc_dragon_body }',
    body,
    '\t}',
    '}'
  ].filter((line) => line !== '').join('\n');
  if (!requireDefinition(capture, 'can_be_knight_trigger', sourceCapturePath).includes('mm_wyvern_can_serve_as_knight') ||
      !requireDefinition(ascension, 'can_be_knight_trigger', sourceAscensionPath).includes('mm_asc_dragon_body')) {
    throw new Error('Wyvern knight eligibility sources not represented');
  }
  return { knight, capture, ascension, sourceCapturePath, sourceAscensionPath };
}

function mergeMarriageTrigger() {
  const podPath = 'common/scripted_triggers/00_marriage_triggers.txt';
  const sourcePath = 'patches/dragon-bond/mod/common/scripted_triggers/zzzz_mm_dragon_bond_marriage.txt';
  const pod = parseDefinitions(readInput('PoD', podPath, 'PoD marriage trigger baseline'), `PoD/${podPath}`);
  const source = parseDefinitions(readInput('R', sourcePath, 'Dragon Bond marriage trigger additions'), sourcePath);
  let trigger = requireDefinition(pod, 'can_marry_common_trigger', `PoD/${podPath}`);
  const sourceTrigger = requireDefinition(source, 'can_marry_common_trigger', sourcePath);
  const dragonGate = directBlocks(sourceTrigger).find((field) => field.key === 'trigger_if' && field.text.includes('mm_dragon_is_true_dragon_parent_trigger'));
  if (!dragonGate) throw new Error('Missing Dragon Bond adult human-form marriage gate');
  trigger = replaceOnce(
    trigger,
    '\tNOT = { has_trait_with_flag = can_not_marry }',
    '\tNOT = { has_trait_with_flag = can_not_marry }\n' + dragonGate.text,
    'PoD can_marry_common_trigger'
  );
  if (!trigger.includes('POD_can_marry_common_trigger = yes')) throw new Error('PoD marriage trigger was not preserved');
  const helpers = [
    requireDefinition(source, 'mm_dragon_bond_marriage_pair_trigger', sourcePath),
    requireDefinition(source, 'mm_dragon_bond_blood_trigger', sourcePath)
  ];
  return { trigger, helpers };
}

function mergePuppetTrigger(base, source, id, sourceLabel) {
  const sourceOr = requireField(source, 'OR', sourceLabel).text;
  const branches = directBlocks(sourceOr);
  const mmBranch = branches.find((field) => field.key === 'AND' &&
    field.text.includes('has_character_flag = mm_relic_oracle_cast_in_progress'));
  const sourceBaseBranch = branches.find((field) => field.key === 'AND' &&
    field.text.includes('can_have_puppets_trigger = yes'));
  if (!mmBranch || !sourceBaseBranch) throw new Error('Expected MM and native branches for ' + id);
  if (!base.includes('can_have_puppets_trigger = yes') || !base.includes('has_pam_dlc_trigger = yes')) {
    throw new Error('PoD puppet eligibility missing from ' + id);
  }
  if (!sourceBaseBranch.text.includes('has_pam_dlc_trigger = yes')) {
    throw new Error('MM source dropped native PoD DLC eligibility from ' + id);
  }
  if (id === 'can_have_theological_agent_puppet_trigger' &&
      (!base.includes('doctrine_theocracy_temporal') || !base.includes('doctrine_monasticism_encouraged'))) {
    throw new Error('PoD theological-agent doctrine restrictions missing');
  }
  if (!mmBranch.text.includes('has_pam_dlc_trigger = yes')) {
    throw new Error('Relic-oracle puppet access must retain its DLC requirement');
  }
  const open = base.indexOf('{');
  const close = matchingBrace(base, open);
  const baseBody = dedent(base.slice(open + 1, close));
  const nativeBranch = 'AND = {\n' + indentMore(baseBody, '\t') + '\n}';
  const orBody = [
    'OR = {',
    indentMore(dedent(mmBranch.text), '\t'),
    indentMore(nativeBranch, '\t'),
    '}'
  ].join('\n');
  return id + ' = {\n' + indentMore(orBody, '\t') + '\n}';
}

function mergeOtherWyvernTriggers(knightData) {
  const gameHuntPath = 'common/scripted_triggers/00_hunt_triggers.txt';
  const podCourtPath = 'common/scripted_triggers/00_court_position_triggers.txt';
  const puppetPath = 'common/scripted_triggers/pam_scripted_triggers.txt';
  const ascensionSource = knightData.ascension;
  const gamePuppets = parseDefinitions(readInput('game', puppetPath, 'Vanilla puppet trigger ancestor'), 'game/' + puppetPath);
  const podPuppets = parseDefinitions(readInput('PoD', puppetPath, 'PoD puppet trigger baseline'), 'PoD/' + puppetPath);
  const gameHunt = parseDefinitions(readInput('game', gameHuntPath, 'Vanilla hunt eligibility baseline'), `game/${gameHuntPath}`);
  const podCourt = parseDefinitions(readInput('PoD', podCourtPath, 'PoD court-position visibility baseline'), `PoD/${podCourtPath}`);
  const ascensionHunt = requireDefinition(ascensionSource, 'can_hunt_trigger', knightData.sourceAscensionPath);
  const sourceCourt = requireDefinition(ascensionSource, 'court_position_employee_shown_trigger', knightData.sourceAscensionPath);
  const baseHunt = requireDefinition(gameHunt, 'can_hunt_trigger', `game/${gameHuntPath}`);
  const baseCourt = requireDefinition(podCourt, 'court_position_employee_shown_trigger', `PoD/${podCourtPath}`);
  const huntGate = directBlocks(ascensionHunt).find((field) => field.key === 'OR' && field.text.includes('has_trait = mm_asc_dragon_body'));
  const courtGate = directBlocks(sourceCourt).find((field) => field.key === 'OR' && field.text.includes('has_trait = mm_asc_dragon_body'));
  if (!huntGate || !courtGate || baseHunt.includes('mm_asc_dragon_body') || baseCourt.includes('mm_asc_dragon_body')) {
    throw new Error('Ascension hunt or court-visibility gate cannot be merged onto its base');
  }
  if (!baseCourt.includes('is_imprisoned = no') || !baseCourt.includes('tgp_is_ceremonial_liege_trigger = no')) {
    throw new Error('PoD court-position visibility rules missing');
  }
  const mergedHunt = appendBeforeClose(baseHunt, indentMore(dedent(huntGate.text), '\t'));
  const mergedCourt = appendBeforeClose(baseCourt, indentMore(dedent(courtGate.text), '\t'));
  if (!ascensionHunt.includes('has_trait = mm_asc_dragon_body') || !sourceCourt.includes('has_trait = mm_asc_dragon_body')) {
    throw new Error('Ascension body visibility gates missing');
  }
  const sourceCaptureIds = [...knightData.capture.keys()].filter((id) => id !== 'can_be_knight_trigger');
  const captureHelpers = sourceCaptureIds.map((id) => requireDefinition(knightData.capture, id, knightData.sourceCapturePath));
  const marriage = mergeMarriageTrigger();
  const relicPath = 'patches/dragon-relics/mod/common/scripted_triggers/zzzzzz_mm_relic_puppet_access.txt';
  const relic = parseDefinitions(readInput('R', relicPath, 'Dragon relic puppet access branches'), relicPath);
  requireDefinition(gamePuppets, 'can_have_external_ruler_puppet_trigger', 'game/' + puppetPath);
  requireDefinition(gamePuppets, 'can_have_theological_agent_puppet_trigger', 'game/' + puppetPath);
  const combined = [
    marriage.trigger,
    ...marriage.helpers,
    knightData.knight,
    mergedHunt,
    mergedCourt,
    ...captureHelpers,
    mergePuppetTrigger(
      requireDefinition(podPuppets, 'can_have_external_ruler_puppet_trigger', 'PoD/' + puppetPath),
      requireDefinition(relic, 'can_have_external_ruler_puppet_trigger', relicPath),
      'can_have_external_ruler_puppet_trigger',
      relicPath
    ),
    mergePuppetTrigger(
      requireDefinition(podPuppets, 'can_have_theological_agent_puppet_trigger', 'PoD/' + puppetPath),
      requireDefinition(relic, 'can_have_theological_agent_puppet_trigger', relicPath),
      'can_have_theological_agent_puppet_trigger',
      relicPath
    )
  ];
  if (baseHunt.includes('mm_asc_dragon_body') || baseCourt.includes('mm_asc_dragon_body')) {
    throw new Error('Base trigger unexpectedly already includes the ascension gate');
  }
  writeOutput(
    'common/scripted_triggers/zzzz_mm_pod_wyvern_dragon_triggers.txt',
    definitionsText(combined),
    'PoD marriage and court-position rules combined with Wyvern eligibility; vanilla hunt rules plus the ascension-body gate; Dragon Bond helpers; and PoD puppet rules plus the relic-oracle in-progress access path.'
  );
}

function mergeRelicTemplates() {
  const accessPath = 'patches/dragon-relics/mod/common/artifacts/templates/zzzzzz_mm_relic_forging_access.txt';
  const customPath = 'patches/dragon-relics/mod/common/artifacts/templates/mm_dragon_relics.txt';
  const source = parseDefinitions(readInput('R', accessPath, 'MM artifact-template access wrappers'), accessPath);
  const custom = parseDefinitions(readInput('R', customPath, 'Seven MM dragon relic templates'), customPath);
  const pod = collectDirectory('PoD', 'common/artifacts/templates', 'PoD artifact-template baseline');
  const game = collectDirectory('game', 'common/artifacts/templates', 'vanilla artifact-template baseline');
  const merged = [];
  let podCount = 0;
  let gameCount = 0;
  const customIds = [...custom.keys()];
  for (const [id, patch] of source) {
    if (custom.has(id)) continue;
    const base = pod.get(id) || game.get(id);
    if (!base) continue;
    merged.push(mergeTemplate(base.text, patch.text, `${base.source}:${id}`));
    if (pod.has(id)) podCount += 1;
    else gameCount += 1;
  }
  if (podCount !== 47 || gameCount !== 29 || customIds.length !== 7) {
    throw new Error(`Unexpected artifact template audit: PoD=${podCount}, game=${gameCount}, custom=${customIds.length}`);
  }
  const customOutput = customIds.map((id) => {
    const template = requireDefinition(source, id, accessPath);
    const original = requireDefinition(custom, id, customPath);
    if (!original.includes('can_reforge = { always = no }') && !/can_reforge\s*=\s*\{\s*always\s*=\s*no\s*\}/.test(original)) {
      throw new Error(`Custom relic may be reforged: ${id}`);
    }
    if (!template.includes('can_reforge = { always = no }') && !/can_reforge\s*=\s*\{\s*always\s*=\s*no\s*\}/.test(template)) {
      throw new Error(`Access template does not preserve forge=no: ${id}`);
    }
    return template;
  });
  writeOutput(
    'common/artifacts/templates/zzzz_mm_pod_dragon_relic_templates.txt',
    definitionsText([...merged, ...customOutput]),
    `PoD baseline plus MM fire-forging bypass for ${podCount} PoD and ${gameCount} vanilla templates; adds seven dragon relic templates with can_reforge disabled. Omits ${source.size - podCount - gameCount - customIds.length} templates absent from both PoD and vanilla so other-mod/East-only IDs remain untouched.`
  );
}

function readProgressChance(block, label) {
  const matches = [...block.matchAll(/^([ \t]*)progress_chance[ \t]*=[ \t]*([0-9]+(?:\.[0-9]+)?)[ \t]*$/gm)];
  if (matches.length !== 1) throw new Error('Expected one scalar progress_chance in ' + label + ', found ' + matches.length);
  return {
    indent: matches[0][1],
    value: Number(matches[0][2]),
    text: matches[0][0],
    index: matches[0].index
  };
}

function findInlineBlock(block, key, requiredText, sourceLabel) {
  const pattern = new RegExp('\\b' + key + '[ \\t]*=[ \\t]*\\{', 'g');
  const matches = [];
  let match;
  while ((match = pattern.exec(block)) !== null) {
    const open = block.indexOf('{', match.index);
    const close = matchingBrace(block, open);
    const text = block.slice(match.index, close + 1);
    if (text.includes(requiredText)) matches.push(text);
    pattern.lastIndex = close + 1;
  }
  if (matches.length !== 1) {
    throw new Error('Expected one ' + key + ' block containing ' + requiredText + ' in ' + sourceLabel + ', found ' + matches.length);
  }
  return matches[0];
}

function mergeReligiousWars() {
  const podPath = 'common/casus_belli_types/00_religious_war.txt';
  const gamePath = 'common/casus_belli_types/00_religious_war.txt';
  const sourcePath = 'patches/dragon-creed/mod/common/casus_belli_types/zzzzzz_mm_v1312_religious_wars.txt';
  const helperPath = 'patches/dragon-creed/mod/common/scripted_triggers/mm_v1312_founder_wars.txt';
  const pod = parseDefinitions(readInput('PoD', podPath, 'PoD religious-war baseline'), 'PoD/' + podPath);
  const game = parseDefinitions(readInput('game', gamePath, 'Vanilla religious-war ancestor'), 'game/' + gamePath);
  const source = parseDefinitions(readInput('R', sourcePath, 'Dragon Creed religious-war additions'), sourcePath);
  const helper = parseDefinitions(readInput('R', helperPath, 'Dragon Creed religious-war target helper'), helperPath);
  const helperBlock = requireDefinition(helper, 'mm_v1312_is_valid_religious_war_target_trigger', helperPath);
  const helperOr = requireField(helperBlock, 'OR').text;
  const dragonTarget = directBlocks(helperOr).find((field) => field.key === 'AND' && field.text.includes('rite:mm_dragon_black'));
  if (!dragonTarget) throw new Error('Dragon founder target branch missing from religious-war helper');
  const dragonGate = dragonTarget.text.replace(/\$TARGET\$/g, 'scope:defender');
  const sourceReligiousWar = requireDefinition(source, 'religious_war', sourcePath);
  const sourceCost = requireField(sourceReligiousWar, 'cost', sourcePath);
  const sourcePiety = requireField(sourceCost.text, 'piety', sourcePath);
  const founderPiety = directBlocks(sourcePiety.text)
    .find((field) => field.key === 'if' && field.text.includes('mm_doctrine_black'));
  if (!founderPiety || !founderPiety.text.includes('value = 0')) throw new Error('Dragon founder piety exemption missing');

  const merged = [];
  for (const id of ['minor_religious_war', 'religious_war', 'major_religious_war']) {
    const base = requireDefinition(pod, id, 'PoD/' + podPath);
    const sourceBlock = requireDefinition(source, id, sourcePath);
    requireDefinition(game, id, 'game/' + gamePath);
    const sourcePietyCost = requireField(requireField(sourceBlock, 'cost', sourcePath).text, 'piety', sourcePath);
    const sourceFounderPiety = directBlocks(sourcePietyCost.text)
      .find((field) => field.key === 'if' && field.text.includes('mm_doctrine_black'));
    if (!sourceFounderPiety || sourceFounderPiety.text !== founderPiety.text) {
      throw new Error('Dragon founder piety exemption differs in ' + id);
    }
    if (!base.includes('POD_access_hostile_holy_wars')) {
      throw new Error('PoD eligibility or cooldown missing from ' + id);
    }
    if (id === 'major_religious_war' && !base.includes('POD_has_unlimited_ghws')) {
      throw new Error('PoD major-war cooldown rule missing');
    }
    if (!sourceBlock.includes('mm_v1312_is_valid_religious_war_target_trigger')) {
      throw new Error('Dragon target helper missing from ' + sourcePath + ':' + id);
    }

    const allowed = requireField(base, 'allowed_against_character').text;
    const attacker = requireField(allowed, 'scope:attacker').text;
    const orField = requireField(attacker, 'OR');
    const dragonBranch = indentMore(dedent(dragonGate), orField.indent + '\t');
    const withDragonBranch = appendBeforeClose(orField.text, dragonBranch);
    const mergedAttacker = replaceDirectBlock(attacker, 'OR', withDragonBranch, id + ':PoD attacker target rules');
    const mergedAllowed = replaceDirectBlock(allowed, 'scope:attacker', mergedAttacker, id + ':PoD target rules');
    let result = replaceDirectBlock(base, 'allowed_against_character', mergedAllowed, id + ':PoD religious-war definition');

    const cost = requireField(result, 'cost', id + ':PoD piety cost');
    const pietyCost = requireField(cost.text, 'piety', id + ':PoD piety cost');
    const piety = indentMore(dedent(founderPiety.text), pietyCost.indent + '\t');
    const mergedPiety = appendBeforeClose(pietyCost.text, piety);
    const mergedCost = replaceDirectBlock(cost.text, 'piety', mergedPiety, id + ':PoD piety cost');
    result = replaceDirectBlock(result, 'cost', mergedCost, id + ':PoD piety cost');
    if (id === 'major_religious_war' && !result.includes('POD_declared_major_religious_war_flag_tt')) {
      throw new Error('PoD major-war declaration cooldown description was lost');
    }
    if (!result.includes('mm_doctrine_black') || !result.includes('POD_access_hostile_holy_wars')) {
      throw new Error('PoD and Dragon Creed eligibility were not combined for ' + id);
    }
    merged.push(result);
  }
  writeOutput(
    'common/casus_belli_types/zzzz_mm_pod_dragon_creed_religious_wars.txt',
    definitionsText(merged),
    'PoD minor, regular and major religious wars retain hostile-faith access, dynasty cost modifiers and major-war cooldown; adds the MM black-founder rite target and piety exemption.'
  );
}

function mergeRelicSeductionSchemes() {
  const podCourtPath = 'common/schemes/scheme_types/court_scheme.txt';
  const podSeducePath = 'common/schemes/scheme_types/seduce_scheme.txt';
  const gameCourtPath = 'common/schemes/scheme_types/court_scheme.txt';
  const gameSeducePath = 'common/schemes/scheme_types/seduce_scheme.txt';
  const courtSourcePath = 'patches/dragon-relics/mod/common/schemes/scheme_types/zzzzzz_mm_relic_court_scheme.txt';
  const seduceSourcePath = 'patches/dragon-relics/mod/common/schemes/scheme_types/zzzzzz_mm_relic_seduce_scheme.txt';
  const relicTriggerPath = 'patches/dragon-relics/mod/common/scripted_triggers/mm_dragon_relics.txt';
  const podCourt = parseDefinitions(readInput('PoD', podCourtPath, 'PoD courting-scheme baseline'), 'PoD/' + podCourtPath);
  const podSeduce = parseDefinitions(readInput('PoD', podSeducePath, 'PoD seduction-scheme baseline'), 'PoD/' + podSeducePath);
  const gameCourt = parseDefinitions(readInput('game', gameCourtPath, 'Vanilla courting-scheme ancestor'), 'game/' + gameCourtPath);
  const gameSeduce = parseDefinitions(readInput('game', gameSeducePath, 'Vanilla seduction-scheme ancestor'), 'game/' + gameSeducePath);
  const courtSource = parseDefinitions(readInput('R', courtSourcePath, 'MM courting-scheme sea-armor bonus'), courtSourcePath);
  const seduceSource = parseDefinitions(readInput('R', seduceSourcePath, 'MM seduction-scheme sea-armor bonus'), seduceSourcePath);
  const relicTriggers = parseDefinitions(readInput('R', relicTriggerPath, 'MM sea-armor equipped trigger'), relicTriggerPath);
  requireDefinition(relicTriggers, 'mm_relic_sea_armor_equipped_trigger', relicTriggerPath);
  const merged = [];
  const cases = [
    ['courting', podCourt, gameCourt, courtSource, courtSourcePath, 'PoD courting scheme'],
    ['seduce', podSeduce, gameSeduce, seduceSource, seduceSourcePath, 'PoD seduction scheme']
  ];
  for (const [id, podDefinitions, gameDefinitions, sourceDefinitions, sourcePath, label] of cases) {
    const base = requireDefinition(podDefinitions, id, label);
    const vanilla = requireDefinition(gameDefinitions, id, 'game/' + id);
    const source = requireDefinition(sourceDefinitions, id, sourcePath);
    if (!base.includes('effective_age >= 16') || !base.includes('POD_is_available = yes')) {
      throw new Error('PoD age or availability rule missing from ' + id);
    }
    if (id === 'courting' && !base.includes('POD_glimpses_of_seduction_effect = yes')) {
      throw new Error('PoD courting glimpse effect missing');
    }
    const baseModifiers = requireField(base, 'base_success_chance', label);
    const sourceModifiers = requireField(source, 'base_success_chance', sourcePath);
    const seaBonus = directBlocks(sourceModifiers.text).find((field) => field.key === 'modifier' &&
      field.text.includes('mm_relic_sea_seduction_bonus') && field.text.includes('add = 16'));
    if (!seaBonus || !vanilla.includes(id)) throw new Error('Sea-armor bonus or vanilla ancestor missing for ' + id);
    if (baseModifiers.text.includes('mm_relic_sea_seduction_bonus')) throw new Error('Duplicate sea-armor bonus in ' + id);
    const result = replaceDirectBlock(
      base,
      'base_success_chance',
      appendBeforeClose(baseModifiers.text, seaBonus.text),
      label
    );
    merged.push(result);
  }
  writeOutput(
    'common/schemes/scheme_types/zzzz_mm_pod_dragon_relic_seduction.txt',
    definitionsText(merged),
    'PoD courting and seduction schemes keep their age, availability and glimpse behavior; grafts the MM sea-armor +16 success bonus.'
  );
}

function mergeInspirations() {
  const podPath = 'common/inspirations/00_inspirations.txt';
  const gamePath = 'common/inspirations/00_inspirations.txt';
  const relicPath = 'patches/dragon-relics/mod/common/inspirations/zzzzzz_mm_relic_forging.txt';
  const creedPath = 'patches/dragon-creed/mod/common/inspirations/zzzz_mm_v1312_forging.txt';
  const weaponEffectPath = 'patches/dragon-creed/mod/common/scripted_effects/zzzz_mm_v1312_forging.txt';
  const relicTriggerPath = 'patches/dragon-relics/mod/common/scripted_triggers/mm_dragon_relics.txt';
  const pod = parseDefinitions(readInput('PoD', podPath, 'PoD inspiration baseline'), 'PoD/' + podPath);
  const game = parseDefinitions(readInput('game', gamePath, 'Vanilla inspiration ancestor'), 'game/' + gamePath);
  const relics = parseDefinitions(readInput('R', relicPath, 'MM inspiration fire-ring progress bonus'), relicPath);
  const creed = parseDefinitions(readInput('R', creedPath, 'MM Dragon Creed weapon inspiration reward'), creedPath);
  const weaponEffects = parseDefinitions(readInput('R', weaponEffectPath, 'Dragon Creed weapon monthly reward helper'), weaponEffectPath);
  const relicTriggers = parseDefinitions(readInput('R', relicTriggerPath, 'MM fire-ring equipped trigger'), relicTriggerPath);
  requireDefinition(weaponEffects, 'mm_v1312_fire_weapon_monthly_effect', weaponEffectPath);
  requireDefinition(relicTriggers, 'mm_relic_fire_ring_equipped_trigger', relicTriggerPath);
  const ids = [
    'weapon_inspiration',
    'armor_inspiration',
    'book_inspiration',
    'weaver_inspiration',
    'artisan_inspiration',
    'smith_inspiration',
    'alchemy_inspiration',
    'bow_inspiration',
    'religious_artifact_inspiration'
  ];
  const merged = [];
  for (const id of ids) {
    const base = requireDefinition(pod, id, 'PoD/' + podPath);
    requireDefinition(game, id, 'game/' + gamePath);
    const relic = requireDefinition(relics, id, relicPath);
    const podProgress = readProgressChance(base, 'PoD/' + id);
    const relicProgress = requireField(relic, 'progress_chance', relicPath + ':' + id).text;
    const mmValueMatch = /\bvalue[ \t]*=[ \t]*([0-9]+(?:\.[0-9]+)?)/.exec(relicProgress);
    if (!mmValueMatch) throw new Error('MM progress value missing for ' + id);
    const mmValue = Number(mmValueMatch[1]);
    if (id === 'weapon_inspiration') {
      const creedWeapon = requireDefinition(creed, id, creedPath);
      const creedProgress = readProgressChance(creedWeapon, creedPath + ':' + id);
      if (creedProgress.value !== mmValue || !creedWeapon.includes('mm_v1312_fire_weapon_monthly_effect = yes')) {
        throw new Error('Dragon Creed weapon inspiration progress or reward differs from the relic source');
      }
    }
    const fireRing = findInlineBlock(relicProgress, 'if', 'mm_relic_fire_ring_equipped_trigger = yes', relicPath + ':' + id);
    const delta = mmValue - podProgress.value;
    if (delta < 0) throw new Error('MM progress value is below PoD baseline for ' + id);
    const progressReplacement = [
      podProgress.indent + 'progress_chance = {',
      podProgress.indent + '\tvalue = ' + podProgress.value,
      podProgress.indent + '\tadd = ' + delta,
      indentMore(dedent(fireRing), podProgress.indent + '\t'),
      podProgress.indent + '}'
    ].join('\n');
    let result = base.slice(0, podProgress.index) + progressReplacement + base.slice(podProgress.index + podProgress.text.length);
    if (id === 'weapon_inspiration') {
      const sourceWeapon = requireDefinition(creed, id, creedPath);
      const sourceMonthly = requireField(sourceWeapon, 'on_monthly', creedPath);
      const monthlyAddition = 'mm_v1312_fire_weapon_monthly_effect = yes';
      if (!sourceMonthly.text.includes(monthlyAddition) || result.includes(monthlyAddition)) {
        throw new Error('Expected one Dragon Creed weapon monthly reward');
      }
      const monthly = requireField(result, 'on_monthly', 'PoD/' + id);
      const addition = monthly.indent + '\t# Dragon Creed fire-weapon monthly reward.\n' +
        monthly.indent + '\t' + monthlyAddition;
      result = replaceDirectBlock(result, 'on_monthly', appendBeforeClose(monthly.text, addition), 'PoD/' + id);
    }
    merged.push(result);
  }
  writeOutput(
    'common/inspirations/zzzz_mm_pod_dragon_relic_inspirations.txt',
    definitionsText(merged),
    'Nine PoD inspiration definitions retain their event and reward hooks; the MM 75 progress value is represented as a delta over each PoD base and the fire-ring 10% progress bonus is grafted once. Weapon inspiration also retains the Dragon Creed monthly reward.'
  );
}

function mergeDragonCreedScriptedEffects() {
  const podSexPath = 'common/scripted_effects/00_romance_effects.txt';
  const gameSexPath = 'common/scripted_effects/00_romance_effects.txt';
  const podWealthPath = 'common/scripted_effects/00_ep1_artifact_creation_effects.txt';
  const gameWealthPath = 'common/scripted_effects/00_ep1_artifact_creation_effects.txt';
  const gamePamPath = 'common/scripted_effects/pam_effects.txt';
  const podPodRomancePath = 'common/scripted_effects/POD_romance_effects.txt';
  const activityPath = 'patches/dragon-creed/mod/common/scripted_effects/zzzz_mm_v1312_activity_rewards.txt';
  const qualityPath = 'patches/dragon-creed/mod/common/scripted_effects/zzzz_mm_v1312_quality.txt';
  const podSex = parseDefinitions(readInput('PoD', podSexPath, 'PoD sex-effect baseline'), 'PoD/' + podSexPath);
  const gameSex = parseDefinitions(readInput('game', gameSexPath, 'Vanilla sex-effect ancestor'), 'game/' + gameSexPath);
  const gamePam = parseDefinitions(readInput('game', gamePamPath, 'Vanilla vows-of-poverty effect ancestor'), 'game/' + gamePamPath);
  const podPodRomance = parseDefinitions(readInput('PoD', podPodRomancePath, 'PoD had-sex callback'), 'PoD/' + podPodRomancePath);
  const activity = parseDefinitions(readInput('R', activityPath, 'Dragon Creed activity reward effects'), activityPath);
  const podWealth = parseDefinitions(readInput('PoD', podWealthPath, 'PoD artifact wealth and quality baseline'), 'PoD/' + podWealthPath);
  const gameWealth = parseDefinitions(readInput('game', gameWealthPath, 'Vanilla artifact wealth ancestor'), 'game/' + gameWealthPath);
  const quality = parseDefinitions(readInput('R', qualityPath, 'Dragon Creed fire-equipment quality effect'), qualityPath);

  const sex = requireDefinition(podSex, 'had_sex_with_effect', 'PoD/' + podSexPath);
  requireDefinition(gameSex, 'had_sex_with_effect', 'game/' + gameSexPath);
  const mmSex = requireDefinition(activity, 'had_sex_with_effect', activityPath);
  const podCallback = requireDefinition(podPodRomance, 'POD_had_sex_with_effect', 'PoD/' + podPodRomancePath);
  const mmMemory = directBlocks(mmSex).find((field) => field.key === 'if' && field.text.includes('create_character_memory'));
  if (!mmMemory || !sex.includes('POD_had_sex_with_effect = { CHARACTER = $CHARACTER$ }') ||
      !sex.includes('POD_race_pregnancy_compatibility_with_character_trigger = { CHARACTER = scope:had_sex_with_effect_partner }')) {
    throw new Error('PoD had-sex callback or race-pregnancy compatibility missing');
  }
  if (!podCallback.includes('$CHARACTER$')) throw new Error('PoD had-sex callback definition missing its character scope');
  let mergedSex = replaceOnce(
    sex,
    'POD_had_sex_with_effect = { CHARACTER = $CHARACTER$ }',
    indentMore(dedent(mmMemory.text), '\t') + '\n\tPOD_had_sex_with_effect = { CHARACTER = $CHARACTER$ }',
    'PoD had_sex_with_effect'
  );
  const seaReward = 'mm_v1312_sea_sex_reward_effect = yes';
  if (!mmSex.includes(seaReward) || mergedSex.includes(seaReward)) throw new Error('MM sea-sex activity reward missing or duplicated');
  mergedSex = replaceOnce(
    mergedSex,
    'ce3_papal_bull_check_effect = yes # CE3 Papal Bull',
    'ce3_papal_bull_check_effect = yes # CE3 Papal Bull\n\t' + seaReward,
    'PoD had_sex_with_effect'
  );
  if ((mergedSex.match(/POD_race_pregnancy_compatibility_with_character_trigger/g) || []).length !== 2) {
    throw new Error('PoD race-pregnancy compatibility was not retained at both pregnancy sites');
  }

  const wealth = requireDefinition(podWealth, 'get_artifact_wealth_effect', 'PoD/' + podWealthPath);
  const vanillaWealth = requireDefinition(gameWealth, 'get_artifact_wealth_effect', 'game/' + gameWealthPath);
  const mmWealth = requireDefinition(quality, 'get_artifact_wealth_effect', qualityPath);
  const fireQuality = requireDefinition(quality, 'mm_v1312_fire_equipment_quality_effect', qualityPath);
  if (!vanillaWealth.includes('exists = scope:quality') || !mmWealth.includes('mm_v1312_fire_equipment_quality_effect = yes')) {
    throw new Error('PoD quality wealth algorithm or MM fire-quality graft missing');
  }
  if (wealth.includes('mm_v1312_fire_equipment_quality_effect = yes')) throw new Error('PoD wealth effect already includes the MM graft');
  const mergedWealth = appendBeforeClose(
    wealth,
    '\t# Dragon Creed fire equipment quality, after PoD wealth and quality are resolved.\n\tmm_v1312_fire_equipment_quality_effect = yes'
  );

  const retainedActivityEffects = [
    'pam_vows_of_poverty_host_completion_piety_effect',
    'mm_v1312_sea_sex_reward_effect',
    'mm_v1312_earth_funeral_reward_effect'
  ].map((id) => requireDefinition(activity, id, activityPath));
  requireDefinition(gamePam, 'pam_vows_of_poverty_host_completion_piety_effect', 'game/' + gamePamPath);
  writeOutput(
    'common/scripted_effects/zzzz_mm_pod_dragon_creed_effects.txt',
    definitionsText([mergedSex, ...retainedActivityEffects, mergedWealth, fireQuality]),
    'PoD sex effect retains PoD had-sex and race-pregnancy behavior, adds MM memory and sea-rite activity reward, and carries activity helpers. PoD wealth/quality calculation is retained before the MM fire-equipment quality effect.'
  );
}

function main() {
  mergeCharacterPreservation();
  mergeGuestCleanupEvent();
  mergeFactions();
  mergeFactionValues();
  mergeConversionValues();
  mergeMarriageModifiers();
  const knightData = mergeKnightTrigger();
  mergeOtherWyvernTriggers(knightData);
  mergeRelicTemplates();
  mergeReligiousWars();
  mergeRelicSeductionSchemes();
  mergeInspirations();
  mergeDragonCreedScriptedEffects();

  const excludedSourceFiles = [
    ['patches/character-preservation/mod/common/scripted_effects/07_dlc_ep3_scripted_effects.txt', 'Replaced by a PoD-preserving cleanup effect; the separate zongfan government branch is not part of this PoD overlay.'],
    ['patches/character-preservation/mod/events/courtier_guest_management_events/courtier_guest_management_events.txt', 'Replaced by the PoD event plus the MM cleanup guard.'],
    ['patches/dragon-creed/mod/common/factions/zzzzzz_mm_v1312_factions.txt', 'Replaced by twelve PoD/vanilla faction definitions with reductions; Hanfan factions omitted.'],
    ['patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_faction_values.txt', 'Replaced by the seven common/populist/peasant/nomadic values; Hanfan values omitted.'],
    ['patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_religion_values.txt', 'Replaced by the PoD conversion-demand value plus its MM earth-rite block.'],
    ['patches/dragon-creed/mod/common/script_values/zzzzzz_mm_dragon_v1312_conversion_factors.txt', 'Replaced by the vanilla court-chaplain value plus its MM holy-site block.'],
    ['patches/dragon-bond/mod/common/scripted_modifiers/zzzz_mm_dragon_bond_marriage.txt', 'Replaced by the PoD marriage modifier plus the MM Dragon Bond changes.'],
    ['patches/dragon-bond/mod/common/scripted_triggers/zzzz_mm_dragon_bond_marriage.txt', 'Replaced by the PoD marriage trigger plus Dragon Bond helpers.'],
    ['patches/wyvern-ascension/mod/common/scripted_triggers/zzzzzzzzzz_mm_ascension_civil_rights.txt', 'Replaced by combined PoD/Wyvern knight eligibility and retained ascension hunt/visibility gates.'],
    ['patches/wyvern-capture/mod/common/scripted_triggers/zzzzzz_mm_wyvern_lifecycle_combat.txt', 'Replaced by combined PoD/Wyvern knight eligibility and retained capture helper triggers.'],
    ['patches/dragon-relics/mod/common/scripted_triggers/zzzzzz_mm_relic_puppet_access.txt', 'Replaced by PoD puppet triggers plus the MM relic-oracle access branches.'],
    ['patches/dragon-relics/mod/common/artifacts/templates/zzzzzz_mm_relic_forging_access.txt', 'Replaced by PoD/vanilla base templates plus MM access gates; only matching PoD/vanilla IDs and seven custom dragon templates are emitted.'],
    ['patches/dragon-relics/mod/common/artifacts/templates/mm_dragon_relics.txt', 'Seven custom templates are emitted with the later MM access rules and can_reforge disabled.'],
    ['patches/dragon-creed/mod/common/casus_belli_types/zzzzzz_mm_v1312_religious_wars.txt', 'Replaced by PoD religious-war definitions with the dragon-founder target and piety exception grafted; PoD hostile-faith and major-war cooldown logic stays.'],
    ['patches/dragon-relics/mod/common/schemes/scheme_types/zzzzzz_mm_relic_court_scheme.txt', 'Replaced by the PoD courting definition with only the MM sea-armor +16 success modifier added.'],
    ['patches/dragon-relics/mod/common/schemes/scheme_types/zzzzzz_mm_relic_seduce_scheme.txt', 'Replaced by the PoD seduction definition with only the MM sea-armor +16 success modifier added.'],
    ['patches/dragon-creed/mod/common/inspirations/zzzz_mm_v1312_forging.txt', 'The weapon inspiration is composed once from the PoD base with the MM progress change, fire-ring bonus and Dragon Creed monthly reward.'],
    ['patches/dragon-relics/mod/common/inspirations/zzzzzz_mm_relic_forging.txt', 'The nine PoD inspiration definitions are composed once with the MM progress change and fire-ring bonus.'],
    ['patches/dragon-creed/mod/common/scripted_effects/zzzz_mm_v1312_activity_rewards.txt', 'Replaced by the PoD-preserving had-sex effect plus all three retained MM activity effects from this file.'],
    ['patches/dragon-creed/mod/common/scripted_effects/zzzz_mm_v1312_quality.txt', 'Replaced by the PoD wealth/quality effect plus the retained MM fire-equipment quality helper.']
  ].map(([relativePath, reason]) => {
    const bytes = fs.readFileSync(inputPath('R', relativePath));
    const key = `R:${relativePath}`;
    if (!sources.has(key)) {
      sources.set(key, { root: 'R', path: relativePath, sha256: sha256(bytes), roles: ['excluded-source'] });
    }
    return { root: 'R', path: relativePath, sha256: sha256(bytes), reason };
  });

  const builderRelativePath = 'scripts/build-wyvern-pod-mechanics.js';
  const builderBytes = fs.readFileSync(inputPath('R', builderRelativePath));
  const builderKey = `R:${builderRelativePath}`;
  sources.set(builderKey, {
    root: 'R',
    path: builderRelativePath,
    sha256: sha256(builderBytes),
    roles: ['reproducible generator']
  });

  const manifest = {
    schemaVersion: 1,
    created: new Date().toISOString().slice(0, 10),
    scope: 'Static PoD plus Wyvern non-GUI compatibility definitions. No CK3 runtime or test process was run.',
    sourceRoots: {
      R: ROOT,
      PoD: POD_ROOT,
      game: GAME_ROOT
    },
    sources: [...sources.values()].sort((a, b) => `${a.root}/${a.path}`.localeCompare(`${b.root}/${b.path}`)),
    outputs,
    excludedSourceFiles
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, manifestBytes);
  process.stdout.write(`${outputs.length} outputs written; ${sources.size} source hashes recorded.\n`);
  for (const output of outputs) process.stdout.write(`${output.path} ${output.sha256}\n`);
}

main();

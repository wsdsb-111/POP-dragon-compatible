'use strict';

// Finite PDX interpreter: executes this patch's triggers/effects against native Silk Road definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v1311-finite-helper');

const root = path.resolve(__dirname, '..');
const game = process.env.CK3_GAME_DIR || 'D:/SteamLibrary/steamapps/common/Crusader Kings III/game';
const patch = path.join(root, 'patches/dragon-creed/mod');
const h = createHarness([]);
function parse(file) { return h.parsePdx(fs.readFileSync(file, 'utf8'), file); }
function one(nodes, key) {
  const found = nodes.filter(node => node.key === key);
  assert.equal(found.length, 1, `one PDX node named ${key}`);
  return found[0];
}
function optional(nodes, key) { return nodes.find(node => node.key === key); }
function child(nodes, key) { return one(nodes, key).value; }

function withoutComments(text) {
  let quoted = false;
  let escaped = false;
  let comment = false;
  return [...text].map(character => {
    if (comment) {
      if (character === '\n') comment = false;
      return character === '\n' ? '\n' : ' ';
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      return character;
    }
    if (character === '"') quoted = true;
    else if (character === '#') { comment = true; return ' '; }
    return character;
  }).join('');
}
function matchingBrace(mask, opening) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = opening; index < mask.length; index += 1) {
    const character = mask[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index;
  }
  throw new Error('unclosed block in native PDX extraction');
}
function immediateAssignments(block) {
  const mask = withoutComments(block);
  const result = [];
  let index = 0;
  while (index < mask.length) {
    while (/\s/.test(mask[index] || '')) index += 1;
    if (index >= mask.length) break;
    const start = index;
    while (index < mask.length && !/[\s={}]/.test(mask[index])) index += 1;
    const key = mask.slice(start, index);
    while (/\s/.test(mask[index] || '')) index += 1;
    if (!key || mask[index] !== '=') {
      const endOfLine = mask.indexOf('\n', index);
      index = endOfLine < 0 ? mask.length : endOfLine + 1;
      continue;
    }
    index += 1;
    while (/\s/.test(mask[index] || '')) index += 1;
    if (mask[index] === '{') {
      const end = matchingBrace(mask, index);
      result.push({ key, block: block.slice(index + 1, end) });
      index = end + 1;
    } else {
      const endOfLine = mask.indexOf('\n', index);
      const end = endOfLine < 0 ? mask.length : endOfLine;
      result.push({ key, scalar: block.slice(index, end).trim() });
      index = end + 1;
    }
  }
  return result;
}
function assignmentBlock(block, key) {
  const assignment = immediateAssignments(block).find(entry => entry.key === key && entry.block !== undefined);
  assert.ok(assignment, `native PDX block contains ${key}`);
  return assignment.block;
}
function assignmentScalar(block, key) {
  const assignment = immediateAssignments(block).find(entry => entry.key === key && entry.scalar !== undefined);
  assert.ok(assignment, `native PDX block contains scalar ${key}`);
  return assignment.scalar;
}

const nativeFile = path.join(game, 'common/situation/situations/tgp_silk_road.txt');
const nativeText = fs.readFileSync(nativeFile, 'utf8');
const nativeRoot = assignmentBlock(nativeText, 'silk_road_situation');
const participantGroupText = assignmentBlock(nativeRoot, 'participant_groups');
const nativeGroupDefinitions = immediateAssignments(participantGroupText).map(group => {
  const fields = immediateAssignments(group.block);
  const requireRegion = fields.find(field => ['require_capital_in_sub_region', 'require_realm_in_sub_region'].includes(field.key));
  const valid = fields.find(field => field.key === 'is_character_valid' && field.block !== undefined);
  assert.ok(valid, `native ${group.key} group has is_character_valid`);
  return `${group.key} = {${requireRegion ? `${requireRegion.key} = ${requireRegion.scalar}` : ''} is_character_valid = {${valid.block}}}`;
});
const nativeGroups = h.parsePdx(nativeGroupDefinitions.join('\n'), nativeFile);
const groupOrder = Array.from(nativeGroups, node => node.key);
assert.deepEqual(groupOrder, ['china_realm', 'silk_road_domain', 'silk_road_realm', 'silk_road_periphery', 'silk_road_nomad']);
const regionNames = ['china', 'tibet', 'india', 'central_asia', 'transcaspia', 'occident'];
const nativePhases = assignmentBlock(nativeRoot, 'phases');
const nativePhaseNames = ['phase_exceptional_bounty', 'phase_steady_trading', 'phase_hardship'];
const compactNativePhases = nativePhaseNames.map(phase => {
  const phaseBlock = assignmentBlock(nativePhases, phase);
  const modifierSets = assignmentBlock(phaseBlock, 'modifier_sets');
  const phaseEffects = assignmentBlock(modifierSets, 'silk_road_phase_effects');
  const groups = immediateAssignments(phaseEffects);
  const taxGroups = groupOrder.flatMap(group => {
    const entry = groups.find(candidate => candidate.key === group && candidate.block !== undefined);
    if (!entry) return [];
    const characterModifier = immediateAssignments(entry.block).find(candidate => candidate.key === 'character_modifier' && candidate.block !== undefined);
    if (!characterModifier) return [];
    const tax = immediateAssignments(characterModifier.block).find(candidate => candidate.key === 'domain_tax_mult' && candidate.scalar !== undefined);
    return tax ? [`${group} = { character_modifier = { domain_tax_mult = ${tax.scalar} } }`] : [];
  });
  return `${phase} = { modifier_sets = { silk_road_phase_effects = { ${taxGroups.join(' ')} } } }`;
});
const phases = h.parsePdx(compactNativePhases.join('\n'), nativeFile);

function nativeTax(phase, group) {
  const phaseNode = one(phases, phase).value;
  const phaseSet = child(child(phaseNode, 'modifier_sets'), 'silk_road_phase_effects');
  const groupNode = optional(phaseSet, group);
  if (!groupNode) return 0;
  const characterModifier = optional(groupNode.value, 'character_modifier');
  const tax = characterModifier && optional(characterModifier.value, 'domain_tax_mult');
  return tax ? Number(tax.value) : 0;
}
function positiveNativeTax(phase, group) { return Math.max(0, nativeTax(phase, group)); }

const triggers = new Map(parse(path.join(patch, 'common/scripted_triggers/mm_v1312_silk_road.txt')).map(node => [node.key, node.value]));
const effects = new Map(parse(path.join(patch, 'common/scripted_effects/mm_v1312_silk_road.txt')).map(node => [node.key, node.value]));
const actions = new Map(parse(path.join(patch, 'common/on_action/mm_v1312_silk_road.txt')).map(node => [node.key, node.value]));
const event = child(parse(path.join(patch, 'events/mm_v1312_silk_road_events.txt')), 'mm_v1312_silk_road.0001');
const eventImmediate = child(event, 'immediate');
const faithConversionEffect = child(actions.get('mm_v1312_silk_road_faith_conversion'), 'effect');
const deathEffect = child(actions.get('mm_v1312_silk_road_death_cleanup'), 'effect');
const modifierNodes = parse(path.join(patch, 'common/modifiers/mm_v1312_silk_road.txt'));
const modifierTax = new Map(modifierNodes.map(node => [node.key, Number(child(node.value, 'domain_tax_mult'))]));
const modifierIds = regionNames.flatMap(region => [
  `mm_v1312_silk_road_${region}_bonus_20`,
  `mm_v1312_silk_road_${region}_bonus_40`,
]);
assert.equal(modifierNodes.length, 12, 'one pair of modifiers per native Silk Road sub-region');

function substitute(raw, parameters) {
  if (typeof raw !== 'string') return raw;
  return raw.replace(/\$(\w+)\$/g, (match, name) => parameters[name] ?? match);
}
function suppliedParameters(operand, inherited) {
  const result = { ...inherited };
  if (Array.isArray(operand)) for (const node of operand) result[node.key] = substitute(node.value, inherited);
  return result;
}
function resolve(raw, current, ctx, parameters) {
  const value = substitute(raw, parameters);
  if (value === 'current_date') return ctx.date;
  if (typeof value === 'string' && value.startsWith('scope:')) return ctx.scopes.get(value.slice(6));
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}
function compare(left, operator, right) {
  if (operator === '>=' || operator === '<=' || operator === '>' || operator === '<') {
    const tier = value => ({ tier_barony: 1, tier_county: 2, tier_duchy: 3, tier_kingdom: 4, tier_empire: 5 }[value]);
    if (tier(left) !== undefined && tier(right) !== undefined) [left, right] = [tier(left), tier(right)];
  }
  switch (operator || '=') {
    case '=': case '?=': return left === right;
    case '!=': return left !== right;
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    default: throw new Error(`unsupported test comparison ${operator}`);
  }
}
function conditionBlock(nodes, current, ctx, parameters = {}) {
  return nodes.every(node => condition(node, current, ctx, parameters));
}
function scopedValue(target, nodes, current, ctx, parameters) {
  return target !== undefined && conditionBlock(nodes, target, ctx, parameters);
}
function condition(node, current, ctx, parameters = {}) {
  const key = substitute(node.key, parameters);
  const value = substitute(node.value, parameters);
  if (key === 'AND') return conditionBlock(node.value, current, ctx, parameters);
  if (key === 'OR') return node.value.some(childNode => condition(childNode, current, ctx, parameters));
  if (key === 'NOT') return !conditionBlock(node.value, current, ctx, parameters);
  if (key === 'is_alive') return current.alive === (value === 'yes');
  if (key === 'is_landed') return current.landed === (value === 'yes');
  if (key === 'is_ruler') return current.ruler === (value === 'yes');
  if (key === 'is_independent_ruler') return current.independent === (value === 'yes');
  if (key === 'highest_held_title_tier') return compare(current.highestTier, node.operator, value);
  if (key === 'has_government') return current.government === value;
  if (key === 'tier') return compare(current.tier, node.operator, value);
  if (key === 'geographical_region') return current.regions.has(value);
  if (key === 'capital_province') return scopedValue(current.capital, node.value, current, ctx, parameters);
  if (key === 'title_province') return scopedValue(current.province, node.value, current, ctx, parameters);
  if (key === 'any_held_title') return current.heldTitles.some(title => conditionBlock(node.value, title, ctx, parameters));
  if (key === 'any_sub_realm_county') return current.subRealmCounties.some(county => conditionBlock(node.value, county, ctx, parameters));
  if (key === 'require_capital_in_sub_region') return current.capitalInSubregion === (value === 'yes');
  if (key === 'require_realm_in_sub_region') return current.realmInSubregion === (value === 'yes');
  if (key === 'faith') return compare(current.faith, node.operator, resolve(value, current, ctx, parameters));
  if (key === 'rite') return compare(current.rite, node.operator, resolve(value, current, ctx, parameters));
  if (key === 'has_character_modifier') return current.modifiers.has(value);
  if (key === 'has_character_flag') return current.flags.has(value);
  if (key === 'has_variable') return current.variables.has(value);
  if (key === 'has_global_variable_list') return ctx.globalLists.has(value);
  if (key.startsWith('var:')) return compare(current.variables.get(key.slice(4)), node.operator, resolve(value, current, ctx, parameters));
  if (key === 'situation_type') return current.type === value;
  if (key === 'sub_region_current_phase') return current.phase === value;
  if (key === 'participant_group_type') return current.type === value;
  if (key === 'participant_group_has_character') return current.members.includes(resolve(value, current, ctx, parameters));
  if (key.startsWith('situation_sub_region:')) {
    const regionKey = key.slice('situation_sub_region:'.length);
    const region = current.subregions.find(entry => entry.key === regionKey);
    return scopedValue(region, node.value, current, ctx, parameters);
  }
  if (['any_character_situation', 'any_situation_sub_region', 'any_situation_sub_region_participant_group'].includes(key)) {
    const list = key === 'any_character_situation'
      ? current.situations
      : key === 'any_situation_sub_region'
        ? current.subregions
        : current.groups;
    return list.some(target => conditionBlock(node.value, target, ctx, parameters));
  }
  if (triggers.has(key)) {
    const nestedParameters = suppliedParameters(node.value, parameters);
    return conditionBlock(triggers.get(key), current, ctx, nestedParameters);
  }
  throw new Error(`unsupported test trigger ${key}`);
}
function execute(nodes, current, ctx, parameters = {}) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const key = substitute(node.key, parameters);
    const value = substitute(node.value, parameters);
    if (key === 'if') {
      let matched = false;
      let branch = node;
      while (branch && ['if', 'else_if', 'else'].includes(branch.key)) {
        const limit = optional(branch.value, 'limit');
        if (!matched && (branch.key === 'else' || !limit || conditionBlock(limit.value, current, ctx, parameters))) {
          execute(branch.value.filter(item => item.key !== 'limit'), current, ctx, parameters);
          matched = true;
        }
        const next = nodes[index + 1];
        if (!next || !['else_if', 'else'].includes(next.key)) break;
        branch = next;
        index += 1;
      }
    } else if (key === 'else_if' || key === 'else') {
      throw new Error(`orphan conditional branch ${key}`);
    } else if (key === 'save_scope_as') ctx.scopes.set(value, current);
    else if (key === 'remove_character_modifier') current.modifiers.delete(value);
    else if (key === 'add_character_modifier') {
      current.modifiers.set(resolve(child(value, 'modifier'), current, ctx, parameters), Number(resolve(child(value, 'days'), current, ctx, parameters)));
    } else if (key === 'remove_character_flag') current.flags.delete(value);
    else if (key === 'add_character_flag') current.flags.set(child(value, 'flag'), Number(child(value, 'days')));
    else if (key === 'remove_variable') current.variables.delete(value);
    else if (key === 'set_variable') current.variables.set(child(value, 'name'), resolve(child(value, 'value'), current, ctx, parameters));
    else if (key === 'trigger_event') {
      ctx.scheduled.push({ id: child(value, 'id'), date: ctx.date + Number(child(value, 'days')), character: current });
    } else if (key === 'every_living_character') {
      for (const target of ctx.livingCharacters) {
        const limit = optional(value, 'limit');
        if (!limit || conditionBlock(limit.value, target, ctx, parameters)) execute(value.filter(item => item.key !== 'limit'), target, ctx, parameters);
      }
    } else if (key === 'every_in_global_list') {
      for (const target of ctx.globalLists.get(child(value, 'variable')) || []) {
        const limit = optional(value, 'limit');
        if (!limit || conditionBlock(limit.value, target, ctx, parameters)) execute(value.filter(item => !['variable', 'limit'].includes(item.key)), target, ctx, parameters);
      }
    } else if (effects.has(key)) {
      const nestedParameters = suppliedParameters(node.value, parameters);
      execute(effects.get(key), current, ctx, nestedParameters);
    } else throw new Error(`unsupported test effect ${key}`);
  }
}

function province(regions = []) { return { regions: new Set(regions) }; }
function character(options = {}) {
  return {
    alive: options.alive ?? true,
    landed: options.landed ?? false,
    ruler: options.ruler ?? false,
    independent: options.independent ?? false,
    highestTier: options.highestTier ?? 'tier_barony',
    government: options.government ?? 'feudal_government',
    capitalInSubregion: options.capitalInSubregion ?? false,
    realmInSubregion: options.realmInSubregion ?? false,
    capital: options.capital ?? province(),
    heldTitles: options.heldTitles ?? [],
    subRealmCounties: options.subRealmCounties ?? [],
    faith: options.faith ?? 'faith:mm_dragon_creed',
    rite: options.rite ?? 'rite:mm_dragon_sea',
    situations: options.situations ?? [],
    modifiers: new Map(options.modifiers || []),
    flags: new Map(),
    variables: new Map(),
  };
}
function context(livingCharacters = []) {
  return { date: 1, scopes: new Map(), scheduled: [], livingCharacters, globalLists: new Map() };
}
function firstValidNativeGroup(target) {
  return nativeGroups.find(group => {
    const regionRequirement = optional(group.value, 'require_capital_in_sub_region') || optional(group.value, 'require_realm_in_sub_region');
    if (regionRequirement && !condition(regionRequirement, target, context(), {})) return false;
    return conditionBlock(child(group.value, 'is_character_valid'), target, context(), {});
  })?.key;
}
function participant(regionName, phase, groupType, target) {
  return [{
    type: 'silk_road_situation',
    subregions: [{
      key: `region_silk_road_proper_${regionName}`,
      phase,
      groups: [{ type: groupType, members: [target] }],
    }],
  }];
}
function applyRefresh(target, ctx) { execute(effects.get('mm_v1312_silk_road_refresh_effect'), target, ctx); }
function taxModifier(target) { return [...target.modifiers.keys()].reduce((sum, id) => sum + (modifierTax.get(id) || 0), 0); }
function runAction(name, ctx) { execute(child(actions.get(name), 'effect'), null, ctx); }
function deliverNext(ctx) {
  const next = ctx.scheduled.shift();
  assert.ok(next, 'one queued daily event exists');
  assert.equal(next.id, 'mm_v1312_silk_road.0001');
  ctx.date = next.date;
  execute(eventImmediate, next.character, ctx);
}

for (const phase of ['phase_exceptional_bounty', 'phase_steady_trading', 'phase_hardship']) {
  for (const group of groupOrder) {
    const target = character({ situations: participant('china', phase, group, null) });
    target.situations[0].subregions[0].groups[0].members[0] = target;
    for (const id of modifierIds) target.modifiers.set(id, 1);
    applyRefresh(target, context([target]));
    assert.equal(taxModifier(target), positiveNativeTax(phase, group) * 0.2, `${phase}/${group} adds exactly 20% of the native positive tax`);
    assert.equal(modifierIds.filter(id => target.modifiers.has(id)).length, nativeTax(phase, group) > 0 ? 1 : 0);
    assert.ok(modifierIds.filter(id => target.modifiers.has(id)).every(id => target.modifiers.get(id) === 2), 'every active contribution has the two-day expiry insurance');
  }
}

for (const fixture of [
  {
    expected: 'china_realm',
    target: character({
      landed: true, ruler: true, independent: true, highestTier: 'tier_kingdom', capitalInSubregion: true,
      capital: province(['tgp_silk_road_china_region', 'dlc_tgp_silk_road_route_region']),
    }),
  },
  {
    expected: 'silk_road_domain',
    target: character({
      landed: true, ruler: true, highestTier: 'tier_kingdom', capitalInSubregion: true,
      capital: province(['dlc_tgp_silk_road_route_region']),
    }),
  },
  {
    expected: 'silk_road_realm',
    target: character({
      landed: true, ruler: true, highestTier: 'tier_kingdom', capitalInSubregion: true,
      subRealmCounties: [{ province: province(['dlc_tgp_silk_road_route_region']) }],
    }),
  },
  {
    expected: 'silk_road_periphery',
    target: character({ landed: true, ruler: true, highestTier: 'tier_county', capitalInSubregion: true }),
  },
  {
    expected: 'silk_road_nomad',
    target: character({ ruler: true, highestTier: 'tier_county', government: 'nomad_government', realmInSubregion: true }),
  },
]) {
  const assigned = firstValidNativeGroup(fixture.target);
  assert.equal(assigned, fixture.expected, 'native is_character_valid PDX chooses the first eligible group in definition order');
  const target = fixture.target;
  target.situations = participant('china', 'phase_exceptional_bounty', assigned, target);
  applyRefresh(target, context([target]));
  assert.equal(taxModifier(target), positiveNativeTax('phase_exceptional_bounty', assigned) * 0.2, `assigned ${assigned} receives its native matching share`);
}

{
  const target = character();
  target.situations = [{
    type: 'silk_road_situation',
    subregions: [
      { key: 'region_silk_road_proper_china', phase: 'phase_exceptional_bounty', groups: [{ type: 'china_realm', members: [target] }] },
      { key: 'region_silk_road_proper_tibet', phase: 'phase_steady_trading', groups: [{ type: 'silk_road_domain', members: [target] }] },
    ],
  }];
  applyRefresh(target, context([target]));
  const nativeSum = positiveNativeTax('phase_exceptional_bounty', 'china_realm') + positiveNativeTax('phase_steady_trading', 'silk_road_domain');
  assert.equal(nativeSum, 0.03);
  assert.equal(taxModifier(target), nativeSum * 0.2, 'distinct sub-region contributions accumulate instead of selecting their maximum');
  assert.equal(taxModifier(target), 0.006);
}

{
  const stale = modifierIds.map(id => [id, 2]);
  const target = character({ modifiers: stale });
  const ctx = context([target]);
  applyRefresh(target, ctx);
  execute(effects.get('mm_v1312_silk_road_queue_daily_effect'), target, ctx);
  assert.equal(taxModifier(target), 0, 'no active Silk Road participant clears all stale regional bonuses');
  assert.equal(ctx.scheduled.length, 0, 'no Silk Road feature schedules no daily event');
}

{
  const target = character({ situations: participant('china', 'phase_exceptional_bounty', 'china_realm', null) });
  target.situations[0].subregions[0].groups[0].members[0] = target;
  const ctx = context([target]);
  execute(effects.get('mm_v1312_silk_road_queue_daily_effect'), target, ctx);
  execute(effects.get('mm_v1312_silk_road_queue_daily_effect'), target, ctx);
  assert.equal(ctx.scheduled.length, 1, 'queued flag prevents a duplicate daily event');
  deliverNext(ctx);
  assert.equal(taxModifier(target), positiveNativeTax('phase_exceptional_bounty', 'china_realm') * 0.2);
  assert.equal(ctx.scheduled.length, 1, 'each event schedules one successor for this character');
  execute(eventImmediate, target, ctx);
  assert.equal(ctx.scheduled.length, 1, 'date guard ignores same-day duplicate delivery without cancelling its successor');

  target.situations[0].subregions[0].phase = 'phase_steady_trading';
  deliverNext(ctx);
  assert.equal(taxModifier(target), positiveNativeTax('phase_steady_trading', 'china_realm') * 0.2, 'daily refresh follows a changed phase');

  target.situations[0].subregions[0].groups[0].members = [];
  deliverNext(ctx);
  assert.equal(taxModifier(target), 0, 'leaving the participant group clears regional modifiers on next daily refresh');
  assert.equal(ctx.scheduled.length, 0, 'leaving the participant group stops the self-scheduled event');
}

{
  const target = character({ situations: participant('china', 'phase_exceptional_bounty', 'china_realm', null) });
  target.situations[0].subregions[0].groups[0].members[0] = target;
  const ctx = context([target]);
  execute(effects.get('mm_v1312_silk_road_queue_daily_effect'), target, ctx);
  deliverNext(ctx);
  target.faith = 'faith:other';
  execute(faithConversionEffect, target, ctx);
  assert.equal(taxModifier(target), 0, 'faith conversion clears regional modifiers immediately');
  assert.equal(target.flags.has('mm_v1312_silk_road_daily_queued'), false);
  assert.equal(target.variables.has('mm_v1312_silk_road_last_date'), false);
  deliverNext(ctx);
  assert.equal(ctx.scheduled.length, 0, 'a pending event stops after leaving sea faith');
}

{
  const target = character({ situations: participant('china', 'phase_exceptional_bounty', 'china_realm', null) });
  target.situations[0].subregions[0].groups[0].members[0] = target;
  const ctx = context([target]);
  execute(effects.get('mm_v1312_silk_road_queue_daily_effect'), target, ctx);
  target.faith = 'faith:other';
  execute(faithConversionEffect, target, ctx);
  target.faith = 'faith:mm_dragon_creed';
  execute(faithConversionEffect, target, ctx);
  assert.equal(ctx.scheduled.length, 2, 'a rapid leave-and-return can leave two one-shot event deliveries queued');
  deliverNext(ctx);
  deliverNext(ctx);
  assert.equal(ctx.scheduled.length, 1, 'same-date guard prevents duplicate chains after conversion re-entry');
}

{
  const active = character({ situations: participant('china', 'phase_exceptional_bounty', 'china_realm', null) });
  active.situations[0].subregions[0].groups[0].members[0] = active;
  const outside = character({ rite: 'rite:mm_dragon_earth', modifiers: [['mm_v1312_silk_road_china_bonus_40', 2]] });
  const noFaith = character({ faith: 'faith:other' });
  const noFeature = character();
  const ctx = context([active, outside, noFaith, noFeature]);
  runAction('mm_v1312_silk_road_startup', ctx);
  assert.equal(ctx.scheduled.length, 1, 'startup schedules only active sea-faith Silk Road participants');
  assert.equal(taxModifier(outside), 0, 'startup removes stale regional buffs from non-sea characters');
  ctx.globalLists.set('mm_dragon_creed_members', [active, outside, noFaith, noFeature]);
  runAction('mm_v1312_silk_road_monthly_members', ctx);
  assert.equal(ctx.scheduled.length, 1, 'monthly member refresh does not duplicate an active daily queue');
  outside.modifiers.set('mm_v1312_silk_road_tibet_bonus_20', 2);
  execute(deathEffect, outside, ctx);
  assert.equal(taxModifier(outside), 0, 'death cleanup removes every regional modifier');
}

console.log('v1.3.12 Silk Road finite PDX checks passed');

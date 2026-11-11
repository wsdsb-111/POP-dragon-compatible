const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = 'D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common';
const mod = path.join(__dirname, '../patches/dragon-politics/mod/common');
const source = file => fs.readFileSync(path.join(base, file), 'utf8');
function block(text, name) {
  const start = text.indexOf(`${name} = {`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw Error(name);
}
const triggers = fs.readFileSync(path.join(mod, 'scripted_triggers/zzzzzzzzzzzz_mm_dragon_politics.txt'), 'utf8');
const effects = fs.readFileSync(path.join(mod, 'scripted_effects/zzzzzzzzzzzz_mm_dragon_politics.txt'), 'utf8');
const originalTriggers = source('scripted_triggers/00_faction_triggers.txt');
const originalEffects = source('scripted_effects/00_faction_effects.txt');
const marker = '\n\tmm_dragon_can_enter_human_politics_trigger = yes';
for (const name of ['has_valid_faction_members_trigger', 'can_become_leader_of_faction_trigger']) {
  assert.equal(block(triggers, name).replace(marker, ''), block(originalTriggers, name));
}
const clear = '\n\tif = {\n\t\tlimit = { exists = scope:peasant_leader scope:peasant_leader = { mm_dragon_can_enter_human_politics_trigger = no } }\n\t\tclear_saved_scope = peasant_leader\n\t}';
const claimant = '\t\t\t\tmm_dragon_can_enter_human_politics_trigger = yes\n';
const special = '\t\t\tspecial_character = { mm_dragon_can_enter_human_politics_trigger = yes }\n';
for (const name of ['setup_peasant_leader_effect', 'setup_populist_leader_effect']) {
  let current = block(effects, name).replace(clear, '').replace(claimant, '').replace(special, '');
  assert.equal(current, block(originalEffects, name), `${name}: original bytes preserved`);
  assert.ok(block(effects, name).includes(clear));
}
const pop = block(effects, 'setup_populist_leader_effect');
assert.ok(pop.includes(claimant)); assert.ok(pop.includes(special));
// Interpret the production predicate, rather than a separately written model.
const tokens = block(triggers, 'mm_dragon_can_enter_human_politics_trigger').match(/[A-Za-z0-9_]+|[={}]/g);
let pos = 0;
function parse() {
  assert.equal(tokens[pos++], '{'); const entries = [];
  while (tokens[pos] !== '}') { const key = tokens[pos++]; assert.equal(tokens[pos++], '='); const val = tokens[pos] === '{' ? parse() : tokens[pos++]; entries.push([key,val]); }
  pos++; return entries;
}
pos = 2; const ast = parse();
function evaluate(entries, state, op = 'AND') {
  const results = entries.map(([key, value]) => {
    if (key === 'AND' || key === 'OR' || key === 'NOT') return key === 'NOT' ? !evaluate(value, state) : evaluate(value, state, key);
    if (key === 'myv_is_wyvern') return state.wyvern === (value === 'yes');
    if (key === 'has_trait') return state.traits.includes(value);
    if (key === 'has_character_flag') return state.flags.includes(value);
    throw Error(key);
  }); return op === 'OR' ? results.some(Boolean) : results.every(Boolean);
}
const cases = [
  [{wyvern:true, traits:['myv_wyvern'], flags:[]}, false],
  [{wyvern:true, traits:['myv_wyvern'], flags:['mm_wyvern_human_form']}, true],
  [{wyvern:true, traits:['mm_asc_dragon_body'], flags:['mm_asc_dragon_form']}, false],
  [{wyvern:true, traits:['mm_asc_dragon_body'], flags:[]}, true],
  [{wyvern:true, traits:['mm_asc_dragon_body'], flags:['mm_asc_dragon_form','mm_wyvern_human_form']}, true],
  [{wyvern:false, traits:['mm_royal_dragon_king'], flags:[]}, false],
  [{wyvern:false, traits:['mm_royal_complete'], flags:['mm_wyvern_human_form']}, true],
  [{wyvern:false, traits:['mm_dragon_blood'], flags:[]}, true]
];
for (const [state, expected] of cases) assert.equal(evaluate(ast, state), expected, JSON.stringify(state));
console.log('dragon politics production predicate, guarded branches, and original byte preservation passed');


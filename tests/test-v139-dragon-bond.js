const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pulse = fs.readFileSync(path.join(root, 'patches/dragon-bond/mod/common/on_action/mm_dragon_bond_on_actions.txt'), 'utf8');
const breed = fs.readFileSync(path.join(root, 'patches/wyvern-bloodline/mod/common/character_interactions/mm_dragon_breeding.txt'), 'utf8').split('on_accept =')[0];
assert.match(pulse, /myv_wyvern_monthly_pulse\s*=\s*\{\s*on_actions\s*=\s*\{\s*mm_dragon_bond_monthly_pulse/);
for (const guard of ['myv_is_living_wyvern = yes', 'var:myv_wyvern_bonded_character = { is_alive = yes }', 'has_relation_myv_wyvern_bonded_character = var:myv_wyvern_bonded_character']) assert.ok(pulse.includes(guard), guard);
assert.match(pulse, /add_trait_xp\s*=\s*\{\s*trait\s*=\s*myv_wyvern_harmony\s+value\s*=\s*1/);
for (const level of [25, 50, 75, 100]) {
  for (const [dragon, rider] of [['actor', 'recipient'], ['recipient', 'actor']]) {
    assert.ok(breed.includes(`scope:${dragon} = { mm_dragon_is_true_dragon_parent_trigger = yes exists = var:myv_wyvern_bonded_character var:myv_wyvern_bonded_character = scope:${rider} has_relation_myv_wyvern_bonded_character = scope:${rider} has_trait_xp = { trait = myv_wyvern_harmony value >= ${level} } }`));
  }
}
assert.equal((breed.match(/add = 10/g) || []).length, 4);
const loc = fs.readFileSync(path.join(root, 'patches/dragon-bond/mod/localization/replace/simp_chinese/zzzz_mm_dragon_bond_l_simp_chinese.yml'), 'utf8');
assert.ok(loc.includes("trait_myv_wyvern_rider:0 \"\u4eba\u9f99\u7f81\u7eca\""));
console.log('dragon bond static checks passed');
const feed = fs.readFileSync(path.join(root, 'patches/dragon-bond/mod/events/mm_dragon_bond_feeding_events.txt'), 'utf8');
const nativeFeed = fs.readFileSync('D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052/events/myv_wyvern_feeding_events.txt', 'utf8');
const insert = /                if = \{\r?\n                    limit = \{\r?\n                        has_trait = myv_wyvern_harmony\r?\n                        exists = var:myv_wyvern_bonded_character\r?\n                        var:myv_wyvern_bonded_character = root\r?\n                        has_relation_myv_wyvern_bonded_character = root\r?\n                        NOT = \{ has_character_flag = mm_dragon_bond_fed_recently \}\r?\n                    \}\r?\n                    add_trait_xp = \{ trait = myv_wyvern_harmony value = 2 \}\r?\n                    add_character_flag = \{ flag = mm_dragon_bond_fed_recently months = 1 \}\r?\n                    myv_refresh_wyvern_prowess_effect = yes\r?\n                \}\r?\n/;
assert.match(feed, insert);
assert.equal(feed.replace(insert, '').replace(/\r\n/g, '\n'), nativeFeed.replace(/\r\n/g, '\n'));
assert.match(breed, /add = -25 scope:recipient = \{ mm_creed_is_dragon_faith_trigger = yes \}/);
const marriage = fs.readFileSync(path.join(root, 'patches/dragon-bond/mod/common/scripted_modifiers/zzzz_mm_dragon_bond_marriage.txt'), 'utf8').replace(/\r\n/g, '\n');
const originalMarriage = fs.readFileSync('D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/scripted_modifiers/00_marriage_scripted_modifiers.txt', 'utf8');
let addition = fs.readFileSync(path.join(__dirname, 'fixtures/v139/mm-dragon-marriage-insertion.txt'), 'utf8');
for (const [dragon, human] of [['actor', 'recipient'], ['recipient', 'actor']]) addition = addition.replace(`mm_dragon_is_true_dragon_parent_trigger = yes } scope:secondary_${human} = { mm_dragon_is_true_dragon_parent_trigger = no`, `mm_dragon_bond_blood_trigger = yes } scope:secondary_${human} = { mm_dragon_bond_blood_trigger = no`);
// Preserve the reviewed sea-rite exception and acceptance bonus in the expected insertion.
const seaAddition = `    modifier = {
        add = 20
        desc = mm_v1311_sea_marriage_acceptance
        scope:recipient = { rite = rite:mm_dragon_sea }
        OR = {
            AND = { scope:secondary_actor = { rite = rite:mm_dragon_sea mm_dragon_bond_blood_trigger = yes } scope:secondary_recipient = { mm_dragon_bond_blood_trigger = no } }
            AND = { scope:secondary_recipient = { rite = rite:mm_dragon_sea mm_dragon_bond_blood_trigger = yes } scope:secondary_actor = { mm_dragon_bond_blood_trigger = no } }
        }
    }
`;
const oldPenalty = '    modifier = {\n        add = -25\n        scope:recipient = { mm_creed_is_dragon_faith_trigger = yes }';
assert.ok(addition.includes(oldPenalty), 'legacy insertion still contains the original mixed-blood penalty');
addition = addition.replace(oldPenalty, seaAddition + oldPenalty.replace('mm_creed_is_dragon_faith_trigger = yes }', 'mm_creed_is_dragon_faith_trigger = yes NOT = { rite = rite:mm_dragon_sea } }'));
const main = marriage.slice(0, marriage.indexOf('\nmm_dragon_bond_faith_hostility_modifier = {'));
assert.ok(main.includes(addition));
const stripped = main.replace(addition, '').replace('mm_dragon_bond_faith_hostility_modifier = yes', 'marriage_ai_accept_faith_hostility_modifier = yes').replace('mm_dragon_bond_fertility_modifier = yes', 'marriage_ai_accept_fertility_modifier = yes').replace(/\r\n/g, '\n').trim();
const start = originalMarriage.indexOf('marriage_ai_accept_modifier = {');
assert.ok(originalMarriage.slice(start).replace(/\r\n/g, '\n').startsWith(stripped), 'all original main modifier rules preserved');
const species = fs.readFileSync(path.join(root, 'patches/dragon-bond/mod/common/traits/zzzzzz_mm_dragon_bond_species.txt'), 'utf8').replace(/\r\n/g, '\n');
const priorSpecies = fs.readFileSync(path.join(root, 'patches/wyvern-capture/mod/common/traits/zzzzz_mm_wyvern_species_health.txt'), 'utf8').replace(/\r\n/g, '\n');
assert.equal(species, priorSpecies.replace(/    flag = can_not_marry\n/g, ''));
assert.match(marriage, /NOT = \{ mm_dragon_bond_marriage_pair_trigger = yes \}[\s\S]*?value >= faith_hostility_prevents_marriage_level/);
assert.equal((marriage.match(/NOT = \{ mm_dragon_bond_marriage_pair_trigger = yes \}/g) || []).length, 4);
console.log('dragon bond checks passed');

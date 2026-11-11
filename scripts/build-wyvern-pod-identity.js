"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const pod = "D:/SteamLibrary/steamapps/workshop/content/1158310/2216659254";
const inputs = [], outputs = [];
function read(base, relative) {
  const bytes = fs.readFileSync(path.join(base, relative));
  inputs.push({ root: base === root ? "repo" : "pod", path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  return bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
function block(source, name) {
  const match = new RegExp("^" + name + "\\s*=\\s*\\{", "m").exec(source);
  assert(match, name);
  let depth = 0, quoted = false, escaped = false, comment = false;
  for (let i = source.indexOf("{", match.index); i < source.length; i++) {
    const c = source[i];
    if (comment) { if (c === "\n") comment = false; }
    else if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
    else if (c === "#") comment = true;
    else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error("Unclosed " + name);
}
function write(relative, text) {
  const file = path.join(root, "patches/wyvern-pod/mod", relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from("\uFEFF" + text.trim() + "\n", "utf8");
  fs.writeFileSync(file, bytes);
  outputs.push({ path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
}
const pairs = [
  { branch: "fire", throne: 1, ids: [99001001, 99001305], provinces: [10430, 10216], age: 20300 },
  { branch: "earth", throne: 2, ids: [99001002, 99001306], provinces: [6077, 5759], age: 20200 },
  { branch: "sea", throne: 3, ids: [99001003, 99001307], provinces: [2646, 480], age: 20100 },
  { branch: "sky", throne: 4, ids: [99001304, 99001308], provinces: [6, 5759], age: 20000 }
];
// Read the actual lairs rather than duplicating a guessed map coordinate.
const royalIdentity = read(root, "patches/wyvern-kings/mod/common/scripted_effects/mm_royal_identity_effects.txt");
for (const pair of pairs) pair.provinces = pair.ids.map(id => {
  const match = royalIdentity.match(new RegExp("character:" + id + " = \\{[\\s\\S]*?name = myv_wyvern_lair_barony value = province:(\\d+)\\.barony"));
  assert(match, "lair " + id); return Number(match[1]);
});
const royals = [...pairs.flatMap(p => p.ids.map(id => ({ id, age: p.age }))), { id: 99001309, age: 22000 }, { id: 99001310, age: 21000 }];
const identities = royals.map(x => "this = character:" + x.id).join(" ");

write("common/traits/mm_pod_species.txt", `
mm_pod_dragon_race = {
    icon = "mm_dragon_royal_crown.dds"
    flag = splat
    flag = sidebar_priority_display
    opposites = { mortal }
    shown_in_ruler_designer = no
    random_creation = 0
    birth = 0
}
mm_pod_dragon_gifts = {
    icon = "mm_dragon_half_dragon.dds"
    POD_terrain_umbra_aptitude_advantage = 0.5
    POD_terrain_umbra_sense_advantage = 0.05
    POD_terrain_umbra_spirit_wilds_access_cancel_negative_supply = yes
    POD_terrain_umbra_deep_umbra_access_cancel_negative_supply = yes
    POD_terrain_can_damage_spirit_cancel_negative_supply = yes
    flag = regeneration
    flag = fera_trait_healing
    flag = can_become_ancestor_spirit
    shown_in_ruler_designer = no
    random_creation = 0
    birth = 0
}`);

const splats = read(pod, "common/scripted_triggers/POD_splat_triggers.txt");
const spirits = read(pod, "common/scripted_triggers/POD_spirit_triggers.txt");
const ageTriggers = read(pod, "common/scripted_triggers/POD_interface_triggers.txt");
const ancestor = block(spirits, "POD_can_become_ancestor_spirit_trigger");
write("common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_species.txt", `
mm_pod_is_fixed_royal = { OR = { ${identities} } }
mm_pod_has_dragon_blood = { OR = { mm_dragon_is_true_dragon_parent_trigger = yes mm_dragon_has_blood_trigger = yes has_trait = mokole } }
${block(splats, "has_POD_race_trait_trigger").replace("OR = {", "OR = {\n        has_trait = mm_pod_dragon_race")}
POD_character_age_is_ancient = { OR = { mm_pod_is_fixed_royal = yes age > 1000 } }
POD_can_become_ancestor_spirit_trigger = {
    OR = {
        AND = { ${ancestor.slice(ancestor.indexOf("{") + 1, -1)} }
        AND = { mm_pod_has_dragon_blood = yes is_adult = yes POD_is_clone_trigger = no }
    }
}`);
assert(block(ageTriggers, "POD_character_age_is_ancient").includes("age > 1000"));
const ageSource = block(read(pod, "common/script_values/POD_true_age_values.txt"), "true_age");
assert.equal((ageSource.match(/\btrue_age\b/g) || []).length, 1, "renamed original age must not recurse");
write("common/script_values/zzzzzzzzzzzzzz_mm_pod_age.txt", `${ageSource.replace(/^true_age/, "mm_pod_original_true_age")}
true_age = {
    value = current_year
    ${royals.map((p, i) => `${i ? "else_if" : "if"} = { limit = { this = character:${p.id} } add = ${p.age - 1230} }`).join("\n    ")}
    else = { value = mm_pod_original_true_age }
}`);

let gui = read(root, "patches/wyvern-kings/mod/gui/custom_gui/myv_wyvern_character_window.gui");
const mass = /text_single = \{\n([\t ]*)raw_text = "\[Character\.Custom\('mm_wyvern_mass_display'\)\]"([\s\S]*?)\n[\t ]*\}/;
assert(mass.test(gui));
gui = gui.replace(mass, (_, indent, rest) => `text_single = {\n${indent}visible = "[LessThan_CFixedPoint(Character.MakeScope.ScriptValue('mm_wyvern_mass_tonnes'), '(CFixedPoint)1')]"\n${indent}text = "mm_wyvern_mass_kilograms_text"${rest}\n${indent}}\n${indent}text_single = {\n${indent}visible = "[GreaterThanOrEqualTo_CFixedPoint(Character.MakeScope.ScriptValue('mm_wyvern_mass_tonnes'), '(CFixedPoint)1')]"\n${indent}text = "mm_wyvern_mass_tonnes_text"${rest}\n${indent}}`);
const ageTooltip = /(text = "myv_wyvern_panel_age"\n[\t ]*tooltip = )"\[Character.GetDeathOrBirthDateInfo\]"/;
assert(ageTooltip.test(gui));
gui = gui.replace(ageTooltip, '$1"[Character.Custom(\'PODCharacterAgeTooltip\')]"');
gui = gui.replace('text = "myv_wyvern_panel_age"', 'raw_text = "[Character.Custom(\'mm_pod_character_panel_age\')]"');
write("gui/custom_gui/myv_wyvern_character_window.gui", gui);

const biological = id => `is_target_in_variable_list = { name = mm_dragon_origins target = character:${id} }`;
const locFunctions = [], chinese = [], english = [];
for (const p of [...pairs, { branch: "white", ids: [99001310] }, { branch: "black", ids: [99001309] }]) {
  const name = "mm_pod_" + p.branch + "_source_names";
  locFunctions.push(`${name} = { type = character\n${p.ids.length === 2 ? `text = { trigger = { ${p.ids.map(biological).join(" ")} } localization_key = ${name}_both }` : ""}
${p.ids.map(id => `text = { trigger = { ${biological(id)} } localization_key = mm_pod_source_${id} }`).join("\n")}
text = { localization_key = mm_pod_source_unknown fallback = yes } }`);
  if (p.ids.length === 2) {
    const names = p.ids.map(id => `[GetScriptedCharacterByHistoryID('${id}').GetName]`).join("、");
    chinese.push(` ${name}_both:0 "${names}"`); english.push(` ${name}_both:0 "${names}"`);
  }
  for (const kind of ["creation", "biological"]) {
    chinese.push(` trait_mm_dragon_branch_${p.branch}_${kind}_desc:0 "$trait_mm_dragon_branch_${p.branch}_desc$\\n\\n具体龙王血源：[ROOT.Char.Custom('${name}')]。生物血源与后天吸收分别记录。"`);
    english.push(` trait_mm_dragon_branch_${p.branch}_${kind}_desc:0 "$trait_mm_dragon_branch_${p.branch}_desc$\\n\\nExact royal source: [ROOT.Char.Custom('${name}')]. Biological ancestry and acquired blood remain separate."`);
  }
}
write("common/customizable_localization/zzzzzzzzzzzzzz_mm_pod_sources.txt", locFunctions.join("\n\n"));
for (const p of royals) {
  const line = ` mm_pod_source_${p.id}:0 "[GetScriptedCharacterByHistoryID('${p.id}').GetName]"`;
  chinese.push(line); english.push(line);
}
chinese.push(' mm_pod_source_unknown:0 "尚无可核实的具体龙王记录"', ' trait_mm_pod_dragon_race:0 "龙族"', ' trait_mm_pod_dragon_race_desc:0 "具有独立龙族身体与血统的超自然种族。"', ' trait_mm_pod_dragon_gifts:0 "龙血·灵界天赋"', ' trait_mm_pod_dragon_gifts_desc:0 "龙血赋予灵界通行、感知、再生与先祖灵潜能。"', ' myv_wyvern_panel_age:0 "[Character.Custom(\'PODCharacterAge\')]"');
english.push(' mm_pod_source_unknown:0 "No verified royal source recorded"', ' trait_mm_pod_dragon_race:0 "Dragon"', ' trait_mm_pod_dragon_race_desc:0 "A distinct supernatural dragon species."', ' trait_mm_pod_dragon_gifts:0 "Draconic Umbral Gifts"', ' trait_mm_pod_dragon_gifts_desc:0 "Dragon blood grants Umbral access, perception, regeneration and ancestral potential."', ' myv_wyvern_panel_age:0 "[Character.Custom(\'PODCharacterAge\')]"');
chinese.push(' mm_dragon_blood_hunt_higher_grade_tt:0 "对方必须是与你同阶或更高阶的混血种。"');
english.push(' mm_dragon_blood_hunt_higher_grade_tt:0 "The target must have the same or a higher blood grade."');
for (const [language, lines] of [["simp_chinese", chinese], ["english", english]]) write(`localization/replace/${language}/zzzzzzzzzzzzzz_mm_pod_identity_l_${language}.yml`, `l_${language}:\n${lines.join("\n")}`);
for (const [kind, file] of [["scripted_effects", "mm_dragon_absorption.txt"], ["scripted_triggers", "mm_dragon_blood_hunt.txt"]]) {
  const source = read(root, `patches/wyvern-bloodline/mod/common/${kind}/${file}`);
  const changed = source.replace(/mm_dragon_blood_rank < /g, "mm_dragon_blood_rank <= ");
  assert.notEqual(changed, source, "equal-grade absorption gate " + file);
  write(`common/${kind}/zzzzzzzzzzzzzz_mm_pod_absorption.txt`, changed);
}

const census = JSON.parse(read(root, "tests/fixtures/pod-mokole-census-1230.json"));
const historicalIds = Object.values(census.census.cultures).flatMap(c => c.ids);
assert.equal(historicalIds.length, 37);
// Five existing age-qualified founders; culture, kinship and PoD ages stay intact.
// The user assigns all three Egyptian founders to Earth; no Sky/White/Black founder.
const founders = [
  { id: 793509, source: 99001305, branch: "fire" },
  { id: 795111, source: 99001003, branch: "sea" },
  { id: 795208, source: 99001002, branch: "earth" },
  { id: 795209, source: 99001306, branch: "earth" },
  { id: 795210, source: 99001306, branch: "earth" }
];
const customMokole = `has_trait = mokole is_ai = no NOT = { exists = mother } NOT = { exists = father } NOR = { ${historicalIds.map(id => "this = character:" + id).join(" ")} }`;
const choosePair = [...pairs, { throne: 5, ids: [99001310] }].map(p => `if = { limit = { var:mm_pod_seed_throne = ${p.throne} } random_list = { ${p.ids.map(id => `1 = { character:${id} = { save_scope_as = mm_pod_chosen_source } }`).join(" ")} } }`).join("\n");
const cultureDistances = pairs.flatMap(p => p.provinces.map((province, n) => ({ index: p.throne * 2 + n, province, throne: p.throne })));
const knownSource = royals.map(p => `if = { limit = { ${biological(p.id)} NOT = { exists = scope:mm_pod_chosen_source } } character:${p.id} = { save_scope_as = mm_pod_chosen_source } }`).join("\n");
write("common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_identity.txt", `
mm_pod_integrate_species_effect = {
    mm_pod_migrate_legacy_torpor_effect = yes
    if = {
        limit = { mm_dragon_is_true_dragon_parent_trigger = yes }
        add_trait = mm_pod_dragon_race
        remove_trait = mortal
    }
    if = { limit = { mm_pod_has_dragon_blood = yes } add_trait = mm_pod_dragon_gifts }
    mm_pod_sync_mokole_max_effect = yes
    mm_pod_apply_fixed_royal_appearance_effect = yes
    mm_pod_revise_egyptian_founders_effect = yes
}

mm_pod_revise_egyptian_founders_effect = {
    if = {
        limit = { has_character_flag = mm_pod_initial_founder has_trait = mm_dragon_half NOT = { has_character_flag = mm_pod_earth_founder_revision } OR = { this = character:795208 this = character:795209 this = character:795210 } }
        mm_dragon_prepare_biological_origins_effect = yes
        save_scope_as = mm_pod_revised_founder
        ${[{id:795209,old:99001304,rite:"sky"},{id:795210,old:99001310,rite:"white"}].map(f=>`if = {
            limit = { this = character:${f.id} is_target_in_variable_list = { name = mm_dragon_origins target = character:${f.old} } }
            remove_list_variable = { name = mm_dragon_origins target = character:${f.old} }
            if = { limit = { NOT = { is_target_in_variable_list = { name = mm_dragon_origins target = character:99001306 } } } add_to_variable_list = { name = mm_dragon_origins target = character:99001306 } }
            ${Array.from({length:16},(_,i)=>"remove_variable = mm_dragon_origin_"+(i+1)).join("\n")}
            remove_variable = mm_dragon_origin_count
            mm_dragon_prepare_biological_origins_effect = yes
            every_in_list = { variable = mm_dragon_origins mm_dragon_project_biological_branch_effect = { TARGET = scope:mm_pod_revised_founder } }
            mm_dragon_refresh_branch_traits_effect = yes
            if = { limit = { faith = faith:mm_dragon_creed rite = rite:mm_dragon_${f.rite} } set_character_rite = rite:mm_dragon_earth }
            add_character_flag = mm_pod_earth_founder_revision
        }`).join("\n")}
        if = { limit = { OR = { AND = { this = character:795208 is_target_in_variable_list = { name = mm_dragon_origins target = character:99001002 } } AND = { OR = { this = character:795209 this = character:795210 } is_target_in_variable_list = { name = mm_dragon_origins target = character:99001306 } } } } add_character_flag = mm_pod_earth_founder_revision }
    }
}

# Each culture is compared to the lairs using its map distribution once per save.
# Scaling squared distances avoids overflowing an accumulated script value.
mm_pod_find_cultural_throne_effect = {
    if = { limit = { OR = { culture = culture:han culture = culture:tai } } set_variable = { name = mm_pod_seed_throne value = 1 } }
    else_if = { limit = { culture = culture:ancient_egyptian } set_variable = { name = mm_pod_seed_throne value = 2 } }
    else_if = { limit = { culture = culture:japanese } set_variable = { name = mm_pod_seed_throne value = 5 } }
    else = {
        if = {
            limit = { NOT = { culture = { has_variable = mm_pod_nearest_throne } } }
            ${cultureDistances.map(p => `set_variable = { name = mm_pod_distance_${p.index} value = 0 }`).join("\n")}
            set_variable = { name = mm_pod_culture_provinces value = 0 }
            every_province = {
                limit = { exists = culture culture = scope:mm_pod_source_recipient.culture }
                save_scope_as = mm_pod_culture_province
                scope:mm_pod_source_recipient = {
                    change_variable = { name = mm_pod_culture_provinces add = 1 }
                    ${cultureDistances.map(p => `change_variable = { name = mm_pod_distance_${p.index} add = { value = "scope:mm_pod_culture_province.squared_distance(province:${p.province})" multiply = 0.0001 } }`).join("\n")}
                }
            }
            if = {
                limit = { var:mm_pod_culture_provinces > 0 }
                set_variable = { name = mm_pod_best_distance value = 999999999 }
                ${cultureDistances.map(p => `if = { limit = { var:mm_pod_distance_${p.index} < var:mm_pod_best_distance } set_variable = { name = mm_pod_best_distance value = var:mm_pod_distance_${p.index} } set_variable = { name = mm_pod_seed_throne value = ${p.throne} } }`).join("\n")}
                culture = { set_variable = { name = mm_pod_nearest_throne value = scope:mm_pod_source_recipient.var:mm_pod_seed_throne } }
            }
            ${cultureDistances.map(p => `remove_variable = mm_pod_distance_${p.index}`).join("\n")}
            remove_variable = mm_pod_culture_provinces
            remove_variable = mm_pod_best_distance
        }
        if = { limit = { culture = { has_variable = mm_pod_nearest_throne } } set_variable = { name = mm_pod_seed_throne value = culture.var:mm_pod_nearest_throne } }
        else_if = {
            limit = { exists = location }
            set_variable = { name = mm_pod_best_distance value = 999999999 }
            ${cultureDistances.map(p => `if = { limit = { "location.squared_distance(province:${p.province})" < var:mm_pod_best_distance } set_variable = { name = mm_pod_best_distance value = "location.squared_distance(province:${p.province})" } set_variable = { name = mm_pod_seed_throne value = ${p.throne} } }`).join("\n")}
            remove_variable = mm_pod_best_distance
        }
    }
}

mm_pod_seed_source_effect = {
    save_scope_as = mm_pod_source_recipient
    clear_saved_scope = mm_pod_chosen_source
    mm_dragon_prepare_biological_origins_effect = yes
    if = {
        limit = { NOT = { has_character_flag = mm_pod_initial_source_assigned } }
        ${knownSource}
        if = { limit = { exists = scope:mm_pod_chosen_source } add_character_flag = mm_pod_initial_source_assigned }
    }
    if = {
        limit = { NOT = { has_character_flag = mm_pod_initial_source_assigned } }
        if = {
            limit = { has_character_flag = mm_pod_initial_founder }
            ${founders.map(f => `if = { limit = { this = character:${f.id} } character:${f.source} = { save_scope_as = mm_pod_chosen_source } }`).join("\n")}
        }
        else_if = {
            limit = {
                is_ai = no NOT = { exists = mother } NOT = { exists = father }
                NOR = { ${historicalIds.map(id => "this = character:" + id).join(" ")} }
            }
            random_list = { ${[...pairs.flatMap(p => p.ids), 99001310].map(id => `1 = { character:${id} = { save_scope_as = mm_pod_chosen_source } }`).join(" ")} }
        }
        else = {
            mm_pod_find_cultural_throne_effect = yes
            ${choosePair}
        }
        if = {
            limit = { exists = scope:mm_pod_chosen_source }
            scope:mm_pod_chosen_source = { mm_dragon_append_biological_origin_effect = { CHILD = scope:mm_pod_source_recipient } }
            add_character_flag = mm_pod_initial_source_assigned
        }
    }
    # Only the initial five founders convert, once, after a specific source exists.
    if = {
        limit = { has_character_flag = mm_pod_initial_founder has_trait = mm_dragon_half exists = scope:mm_pod_chosen_source NOT = { has_character_flag = mm_pod_founder_rite_assigned } }
        ${[...pairs, { branch: "white", ids: [99001310] }].map(p => `if = { limit = { scope:mm_pod_chosen_source = { OR = { ${p.ids.map(id => "this = character:" + id).join(" ")} } } } set_character_faith = faith:mm_dragon_creed set_character_rite = rite:mm_dragon_${p.branch} add_character_flag = mm_pod_founder_rite_assigned }`).join("\n")}
    }
    remove_variable = mm_pod_seed_throne
    clear_saved_scope = mm_pod_chosen_source
}

mm_pod_seed_mokole_effect = {
    if = {
        limit = { has_trait = mokole NOT = { has_character_flag = mm_pod_initial_rank_assigned } }
        add_character_flag = mm_pod_initial_rank_assigned
        # Never overwrite a pre-update black-blood result or an acquired promotion.
        if = {
            limit = { mm_dragon_has_blood_trigger = no NOT = { has_character_flag = mm_dragon_lineage_initialized } NOT = { has_variable = mm_dragon_absorbed_source_count } }
            remove_trait = mm_dragon_half
            remove_trait = mm_dragon_lineage_1
            remove_trait = mm_dragon_lineage_2
            remove_trait = mm_dragon_lineage_3
            remove_trait = mm_dragon_lineage_4
            if = { limit = { true_age >= 1000 } add_trait = mm_dragon_half set_variable = { name = mm_dragon_lineage_generation value = 0 } }
            else_if = { limit = { true_age >= 200 } add_trait = mm_dragon_lineage_1 set_variable = { name = mm_dragon_lineage_generation value = 1 } }
            else_if = { limit = { true_age >= 100 } add_trait = mm_dragon_lineage_2 set_variable = { name = mm_dragon_lineage_generation value = 2 } }
            else_if = { limit = { true_age >= 50 } add_trait = mm_dragon_lineage_3 set_variable = { name = mm_dragon_lineage_generation value = 3 } }
            else = { add_trait = mm_dragon_lineage_4 set_variable = { name = mm_dragon_lineage_generation value = 4 } }
            mm_dragon_prepare_biological_origins_effect = yes
            if = { limit = { has_character_flag = mm_pod_initial_cohort_candidate has_trait = mm_dragon_half NOT = { has_variable_list = mm_dragon_origins } OR = { ${founders.map(f => "this = character:" + f.id).join(" ")} } } add_character_flag = mm_pod_initial_founder }
        }
        add_character_flag = mm_dragon_lineage_initialized
    }
    mm_pod_seed_source_effect = yes
    mm_pod_integrate_species_effect = yes
}

mm_pod_assign_true_creation_source_effect = {
    if = {
        limit = { mm_dragon_is_true_dragon_parent_trigger = yes mm_royal_is_king = no NOT = { has_variable = mm_pod_creation_source } has_variable = mm_royal_creation_throne }
        save_scope_as = mm_pod_source_recipient
        clear_saved_scope = mm_pod_chosen_source
        mm_dragon_prepare_biological_origins_effect = yes
        ${knownSource}
        if = {
            limit = { NOT = { exists = scope:mm_pod_chosen_source } }
            if = { limit = { exists = mother mother = { has_variable = mm_pod_creation_source } } mother.var:mm_pod_creation_source = { save_scope_as = mm_pod_chosen_source } }
            else_if = { limit = { exists = real_father real_father = { has_variable = mm_pod_creation_source } } real_father.var:mm_pod_creation_source = { save_scope_as = mm_pod_chosen_source } }
            else = {
                set_variable = { name = mm_pod_seed_throne value = var:mm_royal_creation_throne }
                ${choosePair}
                remove_variable = mm_pod_seed_throne
            }
        }
        if = {
            limit = { exists = scope:mm_pod_chosen_source }
            set_variable = { name = mm_pod_creation_source value = scope:mm_pod_chosen_source }
            scope:mm_pod_chosen_source = { mm_dragon_append_biological_origin_effect = { CHILD = scope:mm_pod_source_recipient } }
        }
        clear_saved_scope = mm_pod_chosen_source
    }
}
mm_dragon_creation_source_hook_effect = { mm_royal_assign_creation_effect = yes mm_pod_assign_true_creation_source_effect = yes mm_pod_integrate_species_effect = yes }
`);

// Keep the existing post-creation implementation; append only the PoD species API.
const creation = block(read(root, "patches/wyvern-ascension/mod/common/scripted_effects/zzzzzzzzzz_mm_ascension_maintenance.txt"), "myv_apply_wyvern_identity_effect");
write("common/scripted_effects/zzzzzzzzzzzzzzz_mm_pod_creation.txt", creation.slice(0, -1) + "\n    mm_pod_integrate_species_effect = yes\n}");
write("common/on_action/mm_dragon_lineage_initialization.txt", `
on_game_start_after_lobby = { on_actions = { mm_dragon_seed_initialize_campaign mm_pod_queue_load_integration mm_dragon_register_known_true_sources } }
mm_dragon_seed_initialize_campaign = {
    effect = {
        if = {
            limit = { NOT = { has_global_variable = mm_pod_mokole_cohort_initialized } }
            mm_royal_bootstrap_effect = yes
            every_living_character = { limit = { has_trait = mokole } add_character_flag = mm_pod_initial_cohort_candidate mm_pod_seed_mokole_effect = yes remove_character_flag = mm_pod_initial_cohort_candidate }
            set_global_variable = { name = mm_pod_mokole_cohort_initialized value = yes }
            set_global_variable = { name = mm_lineage_families_initialized_v132 value = yes }
            set_global_variable = { name = mm_dragon_seed_families_confirmed_v1322 value = yes }
            remove_global_variable = mm_dragon_seed_new_campaign_pending
        }
    }
}
mm_dragon_register_known_true_sources = {
    effect = { if = { limit = { has_global_variable_list = myv_living_wyverns } every_in_global_list = { variable = myv_living_wyverns mm_dragon_register_true_dragon_origins_effect = yes } } }
}
mm_pod_queue_load_integration = { effect = { trigger_event = { on_action = mm_pod_population_integration days = 1 } } }
mm_pod_population_integration = {
    effect = {
        every_living_character = {
            limit = { mm_pod_has_dragon_blood = yes }
            mm_pod_integrate_species_effect = yes
            if = { limit = { ${customMokole} NOT = { has_character_flag = mm_pod_initial_rank_assigned } } mm_pod_seed_mokole_effect = yes }
            if = { limit = { mm_dragon_is_true_dragon_parent_trigger = yes } mm_dragon_register_true_dragon_origins_effect = yes myv_refresh_wyvern_prowess_effect = yes }
            if = { limit = { has_trait = mokole has_character_flag = mm_pod_initial_rank_assigned NOT = { has_character_flag = mm_pod_initial_source_assigned } } mm_pod_seed_source_effect = yes }
        }
    }
}
`);
write("common/on_action/zzzzzzzzzzzzzz_mm_pod_identity.txt", `
myv_wyvern_monthly_pulse = { on_actions = { mm_pod_monthly_integration } }
mm_pod_monthly_integration = {
    effect = {
        if = { limit = { has_global_variable_list = myv_living_wyverns } every_in_global_list = { variable = myv_living_wyverns limit = { is_alive = yes } mm_pod_integrate_species_effect = yes mm_pod_assign_true_creation_source_effect = yes } }
        every_player = { if = { limit = { ${customMokole} NOT = { has_character_flag = mm_pod_initial_rank_assigned } } mm_pod_seed_mokole_effect = yes } }
    }
}
on_character_created = { on_actions = { mm_pod_created_character } }
mm_pod_created_character = { effect = { mm_pod_integrate_species_effect = yes if = { limit = { ${customMokole} NOT = { has_character_flag = mm_pod_initial_rank_assigned } } mm_pod_seed_mokole_effect = yes } } }
mm_dragon_natural_birth = { effect = { scope:child = { mm_dragon_register_true_dragon_origins_effect = yes mm_dragon_inherit_natural_blood_effect = yes mm_pod_integrate_species_effect = yes } } }
`);
fs.writeFileSync(path.join(root, "patches/wyvern-pod/identity-sources.json"), JSON.stringify({ date: "2026-11-03", sourceFiles: inputs, outputs, lairs: pairs, historicalIds, founders, CK3Runtime: "NOT_RUN" }, null, 2) + "\n");
console.log("Identity presentation generated: " + outputs.length + " files");

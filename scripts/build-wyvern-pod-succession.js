"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const pod = "D:/SteamLibrary/steamapps/workshop/content/1158310/2216659254";
const sources = [], outputs = [];
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function read(base, file) {
  const bytes = fs.readFileSync(path.join(base, file));
  sources.push({ root: base === root ? "repo" : "pod", path: file, sha256: sha(bytes) });
  return bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
function block(text, name) {
  const start = new RegExp("^" + name + "\\s*=\\s*\\{", "m").exec(text);
  assert(start, name);
  let depth = 0, quote = false, comment = false, escape = false;
  for (let i = text.indexOf("{", start.index); i < text.length; i++) {
    const c = text[i];
    if (comment) { if (c === "\n") comment = false; }
    else if (quote) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') quote = false; }
    else if (c === "#") comment = true;
    else if (c === '"') quote = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start.index, i + 1);
  }
  throw new Error("Unclosed " + name);
}
function write(file, text) {
  const bytes = Buffer.from("\uFEFF" + text.trim() + "\n");
  const dest = path.join(root, "patches/wyvern-pod/mod", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
  outputs.push({ path: file, sha256: sha(bytes) });
}
const hostility = block(read(pod, "common/scripted_triggers/POD_splat_hostility_triggers.txt"), "POD_custom_incompatible_splats_trigger");
write("common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_hostility.txt", hostility.replace("= {", `= {
    # Ancient true dragons have no inherited species feud, in either direction.
    # Blood grades and Umbral gifts alone do not grant this exemption.
    $ACTOR$ ?= { mm_dragon_is_true_dragon_parent_trigger = no }
    $RECIPIENT$ ?= { mm_dragon_is_true_dragon_parent_trigger = no }`));
const leave = block(read(pod, "common/on_action/POD_vanilla_court_maintenance_on_actions.txt"), "pod_leave_court");
assert(leave.includes("trigger = {"));
const cleanSource = read(pod, "common/scripted_effects/POD_maintenance_remove_effects.txt");
read(pod, "common/scripted_effects/POD_fera/POD_fera_initialization_effects.txt");
const clean = block(cleanSource, "POD_remove_all_supernatural_atribute_effect");
// Use only native trait cleanup APIs, not the broad perk/secret/achievement purge.
const traitHooks = ["POD_remove_splat_traits_effect", "POD_remove_vampire_clan_traits_effect",
  "POD_remove_vampire_generation_traits_effect", "POD_remove_vampire_discipline_traits_effect",
  "POD_remove_vampire_predatortype_traits_effect", "POD_remove_vampire_misc_traits_effect",
  "POD_remove_hunter_traits_effect", "POD_remove_mummy_traits_effect", "POD_remove_wraith_traits_effect",
  "POD_remove_wraith_arcanoi_traits_effect", "POD_remove_breed_traits_effect", "POD_remove_lunar_auspice_traits_effect",
  "POD_remove_pryio_traits_effect", "POD_remove_solar_auspice_traits_effect", "POD_remove_demon_traits_effect",
  "POD_remove_fae_kith_traits_effect", "POD_remove_fae_art_traits_effect", "POD_remove_fae_realm_traits_effect"];
for (const hook of traitHooks) assert(clean.includes(hook + " = yes"), hook);
const directTraits = [...clean.matchAll(/^\s*remove_trait = (\w+)\s*$/gm)].map(m => m[1]);
const ascension = read(root, "patches/wyvern-ascension/mod/common/scripted_effects/mm_ascension_effects.txt");
const receive = block(ascension, "mm_asc_receive_blood_effect");
const finish = block(ascension, "mm_asc_finish_body_effect");
const claim = block(ascension, "mm_asc_inherit_throne_effect");
const fusionClaim = claim.replace(/^mm_asc_inherit_throne_effect/, "mm_pod_claim_royal_seat_effect")
  .replace(/^\s*change_first_name = \{ template_character = var:mm_asc_blood_source \}\n/m, "");
assert(!fusionClaim.includes("change_first_name"));
write("common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_succession.txt", `
mm_pod_has_royal_trial_source = {
    is_alive = yes
    NOT = { has_character_flag = mm_asc_black_trial }
    exists = var:mm_asc_blood_source
    var:mm_asc_blood_source = { mm_royal_is_king = yes }
    OR = { mm_asc_source_claim_valid = yes mm_asc_is_current_incarnation = yes }
}`);
write("common/scripted_effects/zzzzzzzzzzzzzz_mm_pod_succession.txt", `
mm_pod_clear_previous_species_effect = {
    if = {
        limit = { NOT = { has_character_flag = mm_pod_royal_species_converted } }
        # Fera reversion needs its old identity still present.
        POD_remove_fera_on_embrace_effect = yes
        ${traitHooks.map(h => h + " = yes").join("\n        ")}
        ${directTraits.map(t => "remove_trait = " + t).join("\n        ")}
        POD_trait_injector_chi_arts = { EFFECT = POD_remove_trait }
        remove_variable = fera_type
        remove_trait = mm_dragon_half
        remove_trait = mm_dragon_lineage_1
        remove_trait = mm_dragon_lineage_2
        remove_trait = mm_dragon_lineage_3
        remove_trait = mm_dragon_lineage_4
        remove_trait = mm_dragon_black_blood
        remove_character_modifier = mm_dragon_diluted_blood_modifier
        add_character_flag = mm_pod_royal_species_converted
    }
    add_trait = mm_pod_dragon_race
    remove_trait = mortal
    mm_pod_integrate_species_effect = yes
}
mm_pod_begin_royal_succession_effect = {
    if = {
        limit = { mm_pod_has_royal_trial_source = yes mm_asc_is_candidate = yes }
        if = { limit = { var:mm_asc_source_rank = 4 } add_trait = mm_royal_black_emperor }
        else_if = { limit = { var:mm_asc_source_rank = 3 } add_trait = mm_royal_white_empress }
        else_if = { limit = { var:mm_asc_source_rank = 2 } add_trait = mm_royal_complete }
        else = { add_trait = mm_royal_dragon_king }
        if = { limit = { var:mm_asc_blood_source = { has_variable = mm_royal_throne } } set_variable = { name = mm_royal_throne value = var:mm_asc_blood_source.var:mm_royal_throne } }
        if = { limit = { var:mm_asc_blood_source = { has_variable = mm_royal_creation_throne } } set_variable = { name = mm_royal_creation_throne value = var:mm_asc_blood_source.var:mm_royal_creation_throne } }
        mm_royal_sync_throne_identity_trait_effect = yes
        mm_pod_clear_previous_species_effect = yes
        add_character_flag = mm_wyvern_human_form
    }
}
${fusionClaim}
mm_pod_complete_royal_succession_effect = {
    if = {
        limit = { mm_pod_has_royal_trial_source = yes has_trait = mm_asc_dragon_body }
        if = { limit = { mm_asc_is_current_incarnation = no mm_asc_source_claim_valid = yes } mm_pod_claim_royal_seat_effect = yes }
        mm_pod_clear_previous_species_effect = yes
        myv_refresh_wyvern_prowess_effect = yes
        mm_royal_queue_daily_effect = yes
    }
}
${receive.slice(0, -1)}
    mm_pod_begin_royal_succession_effect = yes
}
${finish.slice(0, -1)}
    mm_pod_complete_royal_succession_effect = yes
}
`);
const breeding = block(read(root, "patches/wyvern-ascension/mod/common/scripted_triggers/zzzzzzzzzz_mm_ascension_breeding.txt"), "mm_dragon_is_independent_royal_parent_trigger");
assert(breeding.includes("var:mm_asc_outcome = flag:dragon"));
write("common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_succession_breeding.txt", breeding.replace("var:mm_asc_outcome = flag:dragon", "OR = { var:mm_asc_outcome = flag:dragon var:mm_asc_outcome = flag:fusion }"));
const devour = read(root, "patches/wyvern-ascension/mod/common/character_interactions/zzzzzzzzzz_mm_ascension_devour.txt");
assert.equal((devour.match(/var:mm_asc_outcome = flag:dragon/g) || []).length, 2);
write("common/character_interactions/zzzzzzzzzzzzzz_mm_pod_succession_devour.txt", devour.replace(/var:mm_asc_outcome = flag:dragon/g, "OR = { var:mm_asc_outcome = flag:dragon var:mm_asc_outcome = flag:fusion }"));
write("common/on_action/zzzzzzzzzzzzzz_mm_pod_succession.txt", `
${leave.replace("trigger = {", `trigger = {
        mm_dragon_is_true_dragon_parent_trigger = no
        NOT = { employer = { mm_dragon_is_true_dragon_parent_trigger = yes } }`)}
mm_asc_load = { on_actions = { mm_pod_restore_royal_successions } }
mm_pod_restore_royal_successions = {
    effect = {
        if = { limit = { has_global_variable_list = mm_asc_candidates } every_in_global_list = { variable = mm_asc_candidates limit = { mm_asc_is_candidate = yes } mm_pod_begin_royal_succession_effect = yes } }
        if = { limit = { has_global_variable_list = mm_asc_sovereigns } every_in_global_list = { variable = mm_asc_sovereigns limit = { is_alive = yes has_trait = mm_asc_dragon_body } mm_pod_complete_royal_succession_effect = yes } }
    }
}`);
for (const [language, lines] of [
  ["simp_chinese", [
    ' mm_pod_royal_succession_desc:0 "弑王夺取的血液已使你成为新的龙王，原有超自然种族身份已被龙族身份取代。融合与侵蚀决定谁主导这具身体，两种结局都保留所继承的龙王位阶。"',
    ' mm_asc_usurper_source_desc:0 "$trait_mm_asc_usurper_blood_desc$\\n\\n实际血源：[ROOT.Char.MakeScope.Var(\'mm_asc_blood_source\').Char.GetName]。\\n[ROOT.Char.Custom(\'mm_pod_royal_succession_status\')]"',
    ' mm_asc.0002.desc:0 "龙血终于与我的意志和解。我仍是我，名字与身份不因融合而被夺走。侵蚀与低语止息，我获得源龙之躯。若这血源是龙王，我也正式执掌其王座；同一身体仍能在人形与龙形之间转换。"'
  ]],
  ["english", [
    ' mm_pod_royal_succession_desc:0 "The slain sovereign\'s blood has made you a new dragon sovereign, replacing your former supernatural species. Fusion and erosion decide who controls the body; both outcomes preserve the inherited royal rank."',
    ' mm_asc_usurper_source_desc:0 "$trait_mm_asc_usurper_blood_desc$\\n\\nActual source: [ROOT.Char.MakeScope.Var(\'mm_asc_blood_source\').Char.GetName].\\n[ROOT.Char.Custom(\'mm_pod_royal_succession_status\')]"',
    ' mm_asc.0002.desc:0 "The dragon blood has yielded to my will. My name and identity remain mine. The whispers fall silent and the source dragon\'s body is mine. If that source was a sovereign, its throne is now mine as well. I can still change between human and dragon form."'
  ]]
]) write(`localization/replace/${language}/zzzzzzzzzzzzzz_mm_pod_succession_l_${language}.yml`, `l_${language}:\n${lines.join("\n")}`);
write("common/customizable_localization/zzzzzzzzzzzzzz_mm_pod_succession.txt", `
mm_pod_royal_succession_status = {
    type = character
    text = { trigger = { has_character_flag = mm_pod_royal_species_converted } localization_key = mm_pod_royal_succession_desc }
    text = { localization_key = EMPTY_STRING fallback = yes }
}`);
fs.writeFileSync(path.join(root, "patches/wyvern-pod/succession-sources.json"), JSON.stringify({ date: "2026-11-03", sourceFiles: sources, outputs, traitHooks, directTraits, CK3Runtime: "NOT_RUN" }, null, 2) + "\n");
console.log("PoD hostility and succession generated: " + outputs.length + " files");

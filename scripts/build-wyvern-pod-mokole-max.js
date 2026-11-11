"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const pod = "D:/SteamLibrary/steamapps/workshop/content/1158310/2216659254";
const sourceFiles = [], outputs = [];
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function read(base, file) {
  const bytes = fs.readFileSync(path.join(base, file));
  sourceFiles.push({ root: base === root ? "repo" : "pod", path: file, sha256: sha(bytes) });
  return bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
function write(file, source) {
  const bytes = Buffer.from("\uFEFF" + source.trim() + "\n");
  const dest = path.join(root, "patches/wyvern-pod/mod", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
  outputs.push({ path: file, sha256: sha(bytes) });
}
const mokoleSource = read(pod, "common/traits/00_POD_traits_fera.txt");
const bloodSource = read(root, "patches/wyvern-bloodline/mod/common/traits/mm_dragon_bloodline.txt");
const nativeStart = mokoleSource.indexOf("mokole = {");
assert(nativeStart >= 0);
const native = mokoleSource.slice(nativeStart, mokoleSource.indexOf("\n}", nativeStart) + 2);
for (const line of ["prowess_no_portrait = 10", "health = 2", "life_expectancy = 250", "POD_terrain_umbra_sense_advantage = 0.1", "POD_terrain_umbra_aptitude_advantage = 0.2"]) assert(native.includes(line), line);
const grades = [
  { trait: "mm_dragon_half", health: 5, life: 150, prowess: 50, legitimacy: 2 },
  { trait: "mm_dragon_lineage_1", health: 4, life: 50, prowess: 30, legitimacy: 1 },
  { trait: "mm_dragon_lineage_2", health: 3, life: 30, prowess: 20, legitimacy: 0.75 },
  { trait: "mm_dragon_lineage_3", health: 2, life: 15, prowess: 10, legitimacy: 0.5 },
  { trait: "mm_dragon_lineage_4", health: 1, life: 5, prowess: 5, legitimacy: 0.25 },
  { trait: "mm_dragon_black_blood", health: 5, life: 100, prowess: 80, legitimacy: 2.5 }
];
for (const g of grades) {
  const source = bloodSource.slice(bloodSource.indexOf(g.trait + " = {"));
  const body = source.slice(0, source.indexOf("\n}"));
  for (const [key, value] of [["health",g.health],["life_expectancy",g.life],["prowess",g.prowess],["monthly_legitimacy_add",g.legitimacy]]) assert(body.includes(key + " = " + value), g.trait + " " + key);
}
const combinations = grades.flatMap((g, index) => [0,20,60].map(xp => ({ ...g, index, xp, id:index*3+([0,20,60].indexOf(xp))+1,
  key:`mm_pod_mokole_max_${index}_${xp}`, healthDelta:-Math.min(2,g.health), lifeDelta:-Math.min(250,g.life), prowessDelta:-Math.min(10,g.prowess), legitimacyDelta:-(xp===60?0.1:xp===20?0.05:0) })));
write("common/modifiers/mm_pod_mokole_max.txt", combinations.map(c => `${c.key} = {
    stacking = no
    hide_effects = yes
    health = ${c.healthDelta}
    life_expectancy = ${c.lifeDelta}
    prowess_no_portrait = ${c.prowessDelta}
    monthly_legitimacy_add = ${c.legitimacyDelta}
}`).join("\n\n"));
write("common/traits/mm_pod_mokole_gifts.txt", [0,40,60].map(xp => `mm_pod_mokole_gifts_${xp} = {
    icon = "mm_dragon_half_dragon.dds"
    POD_terrain_umbra_aptitude_advantage = ${xp===60?0.3:0.5}
    ${xp===0?"POD_terrain_umbra_sense_advantage = 0.05":""}
    POD_terrain_umbra_spirit_wilds_access_cancel_negative_supply = yes
    POD_terrain_umbra_deep_umbra_access_cancel_negative_supply = yes
    name = trait_mm_pod_mokole_gifts
    desc = trait_mm_pod_mokole_gifts_desc
    shown_in_ruler_designer = no
    random_creation = 0
    birth = 0
}`).join("\n\n"));
const allModifiers = combinations.map(c=>"remove_character_modifier = "+c.key).join("\n    ");
const giftTraits = [0,40,60].map(xp=>"mm_pod_mokole_gifts_"+xp);
write("common/scripted_effects/zzzzzzzzzzzzzzz_mm_pod_mokole_max.txt", `
mm_pod_clear_mokole_max_effect = {
    ${allModifiers}
    remove_variable = mm_pod_mokole_max_combination
}
mm_pod_sync_mokole_max_effect = {
    if = {
        limit = { has_trait = mokole }
        if = { limit = { NOT = { is_target_in_global_variable_list = { name = mm_pod_mokole_max_characters target = this } } } add_to_global_variable_list = { name = mm_pod_mokole_max_characters target = this } }
        mm_pod_queue_mokole_max_effect = yes
        if = {
            limit = { OR = { has_trait = mm_pod_dragon_gifts ${giftTraits.map(t=>"has_trait = "+t).join(" ")} } }
            remove_trait = mm_pod_dragon_gifts
            if = { limit = { has_trait_xp = { trait = mokole track = mokole value >= 60 } } ${[0,40].map(n=>"remove_trait = mm_pod_mokole_gifts_"+n).join(" ")} add_trait = mm_pod_mokole_gifts_60 }
            else_if = { limit = { has_trait_xp = { trait = mokole track = mokole value >= 40 } } ${[0,60].map(n=>"remove_trait = mm_pod_mokole_gifts_"+n).join(" ")} add_trait = mm_pod_mokole_gifts_40 }
            else = { ${[40,60].map(n=>"remove_trait = mm_pod_mokole_gifts_"+n).join(" ")} add_trait = mm_pod_mokole_gifts_0 }
        }
        set_variable = { name = mm_pod_mokole_max_desired value = 0 }
        ${grades.map((g,index)=>`${index?"else_if":"if"} = {
            limit = { has_trait = ${g.trait} }
            if = { limit = { has_trait_xp = { trait = mokole track = mokole value >= 60 } } set_variable = { name = mm_pod_mokole_max_desired value = ${index*3+3} } }
            else_if = { limit = { has_trait_xp = { trait = mokole track = mokole value >= 20 } } set_variable = { name = mm_pod_mokole_max_desired value = ${index*3+2} } }
            else = { set_variable = { name = mm_pod_mokole_max_desired value = ${index*3+1} } }
        }`).join("\n")}
        if = {
            limit = { OR = { NOT = { has_variable = mm_pod_mokole_max_combination } NOT = { var:mm_pod_mokole_max_combination = var:mm_pod_mokole_max_desired } } }
            mm_pod_clear_mokole_max_effect = yes
            ${combinations.map(c=>`if = { limit = { var:mm_pod_mokole_max_desired = ${c.id} } add_character_modifier = { modifier = ${c.key} } }`).join("\n")}
            set_variable = { name = mm_pod_mokole_max_combination value = var:mm_pod_mokole_max_desired }
        }
        remove_variable = mm_pod_mokole_max_desired
    }
    else = {
        if = { limit = { has_variable = mm_pod_mokole_max_combination } mm_pod_clear_mokole_max_effect = yes }
        if = { limit = { OR = { ${giftTraits.map(t=>"has_trait = "+t).join(" ")} } } ${giftTraits.map(t=>"remove_trait = "+t).join(" ")} if = { limit = { mm_pod_has_dragon_blood = yes } add_trait = mm_pod_dragon_gifts } }
        if = { limit = { has_global_variable_list = mm_pod_mokole_max_characters } remove_list_global_variable = { name = mm_pod_mokole_max_characters target = this } }
    }
}
mm_pod_queue_mokole_max_effect = {
    if = {
        limit = { NOT = { has_global_variable = mm_pod_mokole_max_queued } }
        set_global_variable = { name = mm_pod_mokole_max_queued value = yes days = 2 }
        trigger_event = { on_action = mm_pod_mokole_max_daily days = 1 }
    }
}`);
write("common/on_action/zzzzzzzzzzzzzzz_mm_pod_mokole_max.txt", `
on_trait_gained = { on_actions = { mm_pod_mokole_max_trait_change } }
on_trait_lost = { on_actions = { mm_pod_mokole_max_trait_change } }
mm_pod_mokole_max_trait_change = {
    trigger = { is_alive = yes scope:trait = { OR = { this = trait:mokole ${grades.map(g=>"this = trait:"+g.trait).join(" ")} } } }
    effect = { mm_pod_sync_mokole_max_effect = yes }
}
mm_pod_mokole_max_daily = {
    effect = {
        remove_global_variable = mm_pod_mokole_max_queued
        if = { limit = { has_global_variable_list = mm_pod_mokole_max_characters } every_in_global_list = { variable = mm_pod_mokole_max_characters if = { limit = { is_alive = yes } mm_pod_sync_mokole_max_effect = yes } else = { remove_list_global_variable = { name = mm_pod_mokole_max_characters target = this } } } }
        if = { limit = { any_in_global_list = { variable = mm_pod_mokole_max_characters always = yes } } mm_pod_queue_mokole_max_effect = yes }
    }
}`);
for(const [lang,title,desc,giftName,giftDesc] of [
  ["simp_chinese","莫科莱与龙血整合","同类健康、寿命、基础勇武和合法性取较高值，不叠加；不影响独有能力与莫科莱声望成长。","龙血·灵界天赋（已整合）","与莫科莱固有天赋合计：灵界资质取至少50%，感知取至少5%；更强的莫科莱成长保留。再生、治疗与先祖灵能力沿用种族本身，不重复列出。"],
  ["english","Mokole and dragon blood integration","Health, lifespan, base Prowess and legitimacy use the stronger overlapping contribution. Unique powers and Mokole renown growth remain intact.","Draconic Umbral Gifts (Integrated)","Combined with Mokole gifts: aptitude is at least 50%, sense at least 5%, and stronger native growth is retained. Regeneration, healing and ancestral gifts remain on the species trait."]
]) write(`localization/replace/${lang}/zzzzzzzzzzzzzzz_mm_pod_mokole_max_l_${lang}.yml`, `l_${lang}:\n${combinations.map(c=>` ${c.key}:0 "${title}"\n ${c.key}_desc:0 "${desc}"`).join("\n")}\n trait_mm_pod_mokole_gifts:0 "${giftName}"\n trait_mm_pod_mokole_gifts_desc:0 "${giftDesc}"`);
fs.writeFileSync(path.join(root,"patches/wyvern-pod/mokole-max-sources.json"),JSON.stringify({date:"2026-11-03",sourceFiles,outputs,grades,combinations,CK3Runtime:"NOT_RUN"},null,2)+"\n");
console.log("Mokole maximum-value integration generated: "+outputs.length+" files");

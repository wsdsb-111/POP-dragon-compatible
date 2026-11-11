"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,"");
const h=createHarness(["wyvern-bloodline","wyvern-kings","wyvern-ascension","wyvern-pod"]);
const modifiers=new Map(h.parsePdx(read("patches/wyvern-pod/mod/common/modifiers/mm_pod_mokole_max.txt"),"max-modifiers").map(n=>[n.key,n.value]));
const gifts=new Map(h.parsePdx(read("patches/wyvern-pod/mod/common/traits/mm_pod_mokole_gifts.txt"),"max-gifts").map(n=>[n.key,n.value]));
const number=(nodes,key)=>Number(nodes.find(n=>n.key===key)?.value||0);
const grades=[
 ["mm_dragon_half",5,150,50,2], ["mm_dragon_lineage_1",4,50,30,1], ["mm_dragon_lineage_2",3,30,20,0.75],
 ["mm_dragon_lineage_3",2,15,10,0.5], ["mm_dragon_lineage_4",1,5,5,0.25], ["mm_dragon_black_blood",5,100,80,2.5]
];
for(const [grade,health,life,prowess,legitimacy]of grades){
 for(const xp of [0,19,20,39,40,59,60,79,80,99,100]){
  const c=h.character(grade+"_"+xp,{traits:["mokole",grade,"mm_pod_dragon_gifts"],xp:{mokole:xp}}),env=h.environment({root:c});
  h.run("mm_pod_sync_mokole_max_effect",c,env);
  const applied=[...c.modifiers].filter(n=>modifiers.has(n));assert.equal(applied.length,1);
  const mod=modifiers.get(applied[0]);
  const nativeLife=250+(xp>=20?50:0)+(xp>=60?50:0)+(xp>=100?100:0);
  const nativeLegitimacy=(xp>=20?0.05:0)+(xp>=60?0.05:0);
  assert.equal(2+health+number(mod,"health"),Math.max(2,health));
  assert.equal(nativeLife+life+number(mod,"life_expectancy"),Math.max(nativeLife,life));
  assert.equal(10+prowess+number(mod,"prowess_no_portrait"),Math.max(10,prowess));
  assert(Math.abs(nativeLegitimacy+legitimacy+number(mod,"monthly_legitimacy_add")-Math.max(nativeLegitimacy,legitimacy))<0.00001);
  const giftTraits=[...c.traits].filter(n=>gifts.has(n));assert.equal(giftTraits.length,1);assert(!c.traits.has("mm_pod_dragon_gifts"));
  const gift=gifts.get(giftTraits[0]),nativeSense=(xp>=40?0.1:0)+(xp>=80?0.1:0),nativeAptitude=xp>=60?0.2:0;
  assert(Math.abs(nativeSense+number(gift,"POD_terrain_umbra_sense_advantage")-Math.max(nativeSense,0.05))<0.00001);
  assert(Math.abs(nativeAptitude+number(gift,"POD_terrain_umbra_aptitude_advantage")-Math.max(nativeAptitude,0.5))<0.00001);
  h.run("mm_pod_sync_mokole_max_effect",c,env);
  assert.equal([...c.modifiers].filter(n=>modifiers.has(n)).length,1,"idempotent correction");
  assert.equal(env.globalLists.get("mm_pod_mokole_max_characters").length,1,"registry is unique");
  c.traits.delete("mokole");c.traits.add("mm_royal_dragon_king");
  h.run("mm_pod_sync_mokole_max_effect",c,env);
  assert.equal([...c.modifiers].filter(n=>modifiers.has(n)).length,0,"no correction after species change");
  assert(c.traits.has("mm_pod_dragon_gifts"));assert(![...c.traits].some(n=>gifts.has(n)));
 }
}
{
 const c=h.character("changing-tier",{traits:["mokole","mm_dragon_lineage_4","mm_pod_dragon_gifts"],xp:{mokole:0}}),env=h.environment({root:c});
 h.run("mm_pod_sync_mokole_max_effect",c,env);const old=[...c.modifiers][0];
 c.traits.delete("mm_dragon_lineage_4");c.traits.add("mm_dragon_lineage_1");c.xp.set("mokole",100);
 const actions=h.parsePdx(read("patches/wyvern-pod/mod/common/on_action/zzzzzzzzzzzzzzz_mm_pod_mokole_max.txt"),"max-actions");
 h.scriptedEffects.set("daily-fixture",actions.find(n=>n.key==="mm_pod_mokole_max_daily").value.find(n=>n.key==="effect").value);
 h.run("daily-fixture",c,env);
 assert(!c.modifiers.has(old));assert(c.modifiers.has("mm_pod_mokole_max_1_60"));assert(c.traits.has("mm_pod_mokole_gifts_60"));
}
for(const grade of grades.map(g=>g[0])){
 const c=h.character("human-"+grade,{traits:[grade,"mm_pod_dragon_gifts"]}),env=h.environment({root:c});
 h.run("mm_pod_sync_mokole_max_effect",c,env);
 assert.equal(c.modifiers.size,0);assert(c.traits.has(grade)&&c.traits.has("mm_pod_dragon_gifts"));
}
// The user's exact appearance-age table is independent of the generator receipt.
const appearances={99001001:13,99001002:18,99001003:23,99001304:30,99001305:25,99001306:23,99001307:28,99001308:60,99001309:40,99001310:35};
for(const [id,age]of Object.entries(appearances)){
 const c=h.character(id,{age:1229,traits:["myv_wyvern_legendary"]}),env=h.environment({root:c});env.characters.set(id,c);
 h.run("mm_pod_apply_fixed_royal_appearance_effect",c,env);
 assert.equal(c.immortalAge,age);assert.equal(c.age,1229,"chronological age unchanged");
 assert(h.trigger("POD_character_age_predates_mankind",c,env),"royal uses native ??? and mankind tooltip");
}
{
 const c=h.character("ordinary",{age:123});c.immortalAge=31;const env=h.environment({root:c});
 h.run("mm_pod_apply_fixed_royal_appearance_effect",c,env);assert.equal(c.immortalAge,31);
 assert(!h.trigger("POD_character_age_predates_mankind",c,env));
}
const gui=read("patches/wyvern-pod/mod/gui/custom_gui/myv_wyvern_character_window.gui");
assert(gui.includes('tooltip = "[Character.Custom(\'PODCharacterAgeTooltip\')]"'));
assert(gui.includes('raw_text = "[Character.Custom(\'mm_pod_character_panel_age\')]"'),"actual panel age widget bypasses the conflicting localization key");
assert(!gui.includes('text = "myv_wyvern_panel_age"'),"actual panel no longer depends on duplicate age localization");
const ageReceipt=JSON.parse(read("patches/wyvern-pod/hidden-age-sources.json"));
for(const lang of ["simp_chinese","english"]){
 const loc=read("patches/wyvern-pod/"+ageReceipt.outputs.find(x=>x.path.includes("/"+lang+"/")).path);
 assert(loc.includes("[Character.Custom('PODCharacterAge')]"));
}
console.log("PoD max values: 66 tier/XP cases, transitions, native age display and ten appearance ages PASS (finite/static only)");

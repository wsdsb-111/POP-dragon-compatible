"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const root = path.resolve(__dirname, "..");
const receipt = JSON.parse(fs.readFileSync(path.join(root, "patches/wyvern-pod/succession-sources.json"), "utf8"));
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension", "wyvern-pod"]);
for(const [name,value] of [["mm_royal_reference_size",0],["mm_royal_reference_mass",0],["myv_wyvern_visual_size_tier",3]]) {
  h.scriptValues.set(name,h.parsePdx("value = "+value,"isolated-body-reference"));
}
// Model the native species-removal API boundary; native trait flags are pinned by independent QA.
h.scriptedEffects.set("POD_remove_splat_traits_effect", h.parsePdx("remove_trait = vampire remove_trait = fera remove_trait = mokole remove_trait = mortal remove_trait = mm_pod_dragon_race", "native-race-boundary"));
h.scriptedEffects.set("POD_remove_fera_on_embrace_effect", h.parsePdx("remove_trait = mokole remove_trait = fera", "native-fera-boundary"));
const stubs = [...receipt.traitHooks.filter(x=>x!=="POD_remove_splat_traits_effect"), "POD_trait_injector_chi_arts",
  "myv_refresh_wyvern_portrait_flags_effect", "myv_refresh_wyvern_prowess_effect", "mm_royal_queue_daily_effect",
  "mm_royal_repair_profile_effect", "mm_royal_apply_physical_profile_effect"];
function scenario(race, rank = "mm_royal_dragon_king", royal = true) {
  const source = h.character("99001305", { alive:false, name:"Predecessor", traits:["myv_wyvern_legendary", ...(royal?[rank]:[])], vars:{myv_wyvern_size:200,myv_wyvern_color:1,mm_royal_throne:1,mm_royal_creation_throne:1} });
  const mother = h.character("original-mother"), father=h.character("original-father");
  const claimant=h.character("claimant", { name:"Original name", age:30, traits:[race,"brave","education_martial_3",...(race==="mokole"?["fera","mm_dragon_half"]:[])], mother,father,realFather:father,culture:"han",faith:"original_faith", house:"original_house",dynasty:"original_dynasty" });
  const env=h.environment({root:claimant,year:1230,scopes:{myv_slay_wyvern_target:source},stubs});
  env.characters.set(source.id,source);
  h.run("mm_asc_receive_blood_effect",claimant,env);
  return {claimant,source,env,mother,father};
}
for(const race of ["vampire","mokole","mortal"]){
  for(const outcome of ["fusion","dragon"]){
    const s=scenario(race),c=s.claimant;
    assert(c.traits.has("mm_asc_usurper_blood")&&c.traits.has("mm_royal_dragon_king"));
    assert(h.trigger("mm_asc_is_candidate",c,s.env),"species conversion does not finish the trial");
    assert(c.traits.has("mm_pod_dragon_race")&&c.traits.has("mm_pod_dragon_gifts"));
    for(const old of ["vampire","fera","mokole","mortal","mm_dragon_half"])assert(!c.traits.has(old),"old race/grade removed: "+old);
    c.xp.set(outcome==="fusion"?"mm_asc_fusion":"mm_asc_erosion",100);
    h.run("mm_asc_resolve_effect",c,s.env);
    assert.equal(c.vars.get("mm_asc_outcome"),"flag:"+outcome);
    assert(c.traits.has("mm_royal_dragon_king")&&c.traits.has("mm_asc_dragon_body")&&c.traits.has("mm_pod_dragon_race"));
    assert.equal(s.source.vars.get("mm_asc_current_incarnation"),c,"both endings claim the reserved throne");
    assert.equal(c.vars.get("mm_asc_seat_anchor"),s.source);
    assert.equal(c.name,outcome==="fusion"?"Original name":"Predecessor");
    assert.equal(c.mother,s.mother);assert.equal(c.father,s.father);assert.equal(c.culture,"han");assert.equal(c.faith,"original_faith");
    assert.equal(c.house,"original_house");assert.equal(c.dynasty,"original_dynasty");
    assert(c.traits.has("brave")&&c.traits.has("education_martial_3"));
    h.run("mm_pod_complete_royal_succession_effect",c,s.env);
    assert(c.traits.has("mm_pod_dragon_race"),"repair is idempotent");
  }
}
for(const rank of ["mm_royal_complete","mm_royal_white_empress","mm_royal_black_emperor"]){
  const s=scenario("vampire",rank);assert(s.claimant.traits.has(rank),"actual source rank granted immediately");
}
{
  const s=scenario("vampire","mm_royal_dragon_king",false);
  assert(s.claimant.traits.has("vampire")&&!s.claimant.traits.has("mm_pod_dragon_race"),"ordinary legendary-dragon reward does not force a royal species conversion");
}
{
  const c=h.character("black-material-trial",{traits:["mokole","fera","mm_dragon_black_blood","mm_asc_usurper_blood"],flags:["mm_asc_black_trial"]});
  h.run("mm_pod_begin_royal_succession_effect",c,h.environment({root:c,stubs}));
  assert(c.traits.has("mokole")&&!c.traits.has("mm_royal_dragon_king"),"independent black-blood promotion trial stays unchanged");
}
// Substitute only the unchanged native hostility body with an oracle. Exercise both exemption directions.
const nativeGate = h.scriptedTriggers.get("POD_custom_incompatible_splats_trigger").slice(0,2);
for(const hostile of [true,false]){
  h.scriptedTriggers.set("POD_custom_incompatible_splats_trigger",[...nativeGate,...h.parsePdx("always = "+(hostile?"yes":"no"),"native-hostility-oracle")]);
  for(const a of [["myv_wyvern"],["mm_royal_dragon_king"],["mokole","fera","mm_dragon_half"],["vampire"]]){
    for(const b of [["myv_wyvern"],["mm_royal_dragon_king"],["mokole","fera","mm_dragon_half"],["vampire"]]){
      const actor=h.character("a",{traits:a}),recipient=h.character("b",{traits:b}),env=h.environment({root:actor});
      const dragon=[a,b].some(t=>t.includes("myv_wyvern")||t.includes("mm_royal_dragon_king"));
      assert.equal(h.trigger("POD_custom_incompatible_splats_trigger",actor,env,{ACTOR:actor,RECIPIENT:recipient}),dragon?false:hostile);
    }
  }
}
console.log("PoD succession and bilateral species-hostility contracts: PASS (finite native-API boundary, not CK3 runtime)");

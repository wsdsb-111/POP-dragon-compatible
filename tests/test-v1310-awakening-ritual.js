"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v135-finite-helper");
const h = createHarness(["wyvern-bloodline", "wyvern-capture", "wyvern-kings", "wyvern-ascension", "dragon-ritual"]);
const base = path.resolve(__dirname, "..");
const entries = [["constantine","99001001",1,"jingzhao"],["norton","99001305",1,"chengdu"],["fenrir","99001002",2,"qus"],["jormungandr","99001306",2,"tbilisi"],["behemoth","99001003",3,"malta"],["leviathan","99001307",3,"chandax"],["hrist","99001304",4,"faereyar"],["vidar","99001308",4,"sogn"],["white_empress","99001310",0,"sagami"],["black_emperor","99001309",0,"baghdad"]];
const decisions = h.parsePdx(fs.readFileSync(path.join(base,"patches/dragon-ritual/mod/common/decisions/zzzzzzzzzzzz_mm_ritual.txt"),"utf8"));
assert.ok("zzzzzzzzzzzz_mm_ritual.txt" > "zzzzzzzzzz_mm_ascension_awakening.txt", "ritual decisions load after ascension overrides");
const history = h.parsePdx(fs.readFileSync(path.join(base,"patches/wyvern-kings/mod/history/characters/myv_historical_wyverns.txt"),"utf8"));
for (const [,id] of entries) assert.ok(h.all(history.find(x => x.key === id).value,"trait").some(x => x.value === "mm_royal_torpor"), id);
assert.equal(decisions.length,10);
for (const decision of decisions) {
  const valid = h.first(decision.value, "is_valid").value;
  assert.ok(valid.every(node => ["custom_tooltip", "gold", "prestige", "piety"].includes(node.key)), decision.key + " exposes a raw condition");
  for (const node of valid.filter(node => node.key === "custom_tooltip")) {
    const key = h.first(node.value, "text").value;
    for (const lang of ["english", "simp_chinese"]) {
      const files = ["dragon-ritual", "dragon-creed", "wyvern-kings"].flatMap(module => {
        const dir = path.join(base, "patches", module, "mod", "localization", lang);
        return fs.readdirSync(dir).filter(file => file.endsWith(".yml")).map(file => fs.readFileSync(path.join(dir, file), "utf8"));
      });
      assert.ok(files.some(text => text.includes(" " + key + ":")), key + " missing " + lang);
    }
  }
}
function fixture(name,id,branch,site) {
  const actor = h.character("actor",{gold:20000,prestige:20000,piety:20000});
  const dragon = h.character("sacrifice",{traits:["myv_wyvern_tamed"],vars:{mm_royal_creation_throne:branch},bondedCharacter:actor});
  actor.vars.set("mm_ritual_selected_sacrifice",dragon);
  const env = h.environment({root:actor});
  for (const [,seat] of entries) env.globalVars.set("mm_asc_seat_"+seat,h.character(seat,{traits:["mm_royal_dragon_king"]}));
  const target = env.globalVars.get("mm_asc_seat_"+id); target.traits.add("mm_royal_torpor");
  h.scriptedTriggers.set("myv_is_living_wyvern",h.parsePdx("x = { is_alive = yes }")[0].value);
  h.scriptedTriggers.set("mm_creed_controls_"+site+"_holy_site_trigger",h.parsePdx("x = { always = yes }")[0].value);
  const decision = decisions.find(x=>x.key === "mm_royal_wake_"+name+"_decision");
  h.scriptedTriggers.set("test_gate",h.first(decision.value,"is_valid").value);
  h.scriptedEffects.set("test_effect",h.first(decision.value,"effect").value);
  env.stubs.add("mm_ritual_consume_selected_effect"); env.stubs.add("mm_royal_awaken_effect");
  return {actor,dragon,target,env,site};
}
for (const [name,id,branch,site] of entries) {
  const f=fixture(name,id,branch,site);
  assert.equal(h.trigger("test_gate",f.actor,f.env),true,name);
  if (branch) {
    f.dragon.vars.set("mm_royal_creation_throne",branch%4+1); assert.equal(h.trigger("test_gate",f.actor,f.env),false);
    f.dragon.vars.set("mm_royal_creation_throne",branch);
    f.dragon.bondedCharacter=h.character("foreign"); assert.equal(h.trigger("test_gate",f.actor,f.env),false); f.dragon.bondedCharacter=f.actor;
    f.dragon.alive=false; assert.equal(h.trigger("test_gate",f.actor,f.env),false); f.dragon.alive=true;
    f.dragon.traits.add("mm_dragon_half"); assert.equal(h.trigger("test_gate",f.actor,f.env),false); f.dragon.traits.delete("mm_dragon_half");
    f.dragon.traits.delete("myv_wyvern_tamed"); assert.equal(h.trigger("test_gate",f.actor,f.env),false); f.dragon.traits.add("myv_wyvern_tamed");
    f.dragon.traits.add("mm_royal_dragon_king"); assert.equal(h.trigger("test_gate",f.actor,f.env),false); f.dragon.traits.delete("mm_royal_dragon_king");
  } else {
    for (const [,seat] of entries.slice(0,8)) { const twin=f.env.globalVars.get("mm_asc_seat_"+seat); twin.traits.add("mm_royal_torpor"); assert.equal(h.trigger("test_gate",f.actor,f.env),false); twin.alive=false; assert.equal(h.trigger("test_gate",f.actor,f.env),true); twin.alive=true; twin.traits.delete("mm_royal_torpor"); }
    if(name === "black_emperor") { const white=f.env.globalVars.get("mm_asc_seat_99001310"); white.traits.add("mm_royal_torpor"); assert.equal(h.trigger("test_gate",f.actor,f.env),false); white.traits.delete("mm_royal_torpor"); white.alive=false; assert.equal(h.trigger("test_gate",f.actor,f.env),false); }
  }
  h.scriptedTriggers.set("mm_creed_controls_"+site+"_holy_site_trigger",h.parsePdx("x = { always = no }")[0].value);
  h.run("test_effect",f.actor,f.env); assert.equal(f.actor.gold,20000); assert.equal(f.env.calls.length,0);
}
{
  const f=fixture("constantine","99001001",1,"jingzhao");
  f.dragon.alive=false;
  f.env.stubs.delete("mm_ritual_consume_selected_effect"); f.env.stubs.delete("mm_royal_awaken_effect");
  h.run("test_effect",f.actor,f.env);
  assert.equal(f.env.deaths.length,0); assert.equal(f.actor.gold,20000);
}
{
  const f=fixture("constantine","99001001",1,"jingzhao");
  f.env.stubs.delete("mm_ritual_consume_selected_effect"); f.env.stubs.delete("mm_royal_awaken_effect");
  for (const name of ["mm_ritual_create_random_material_drops_effect","mm_ritual_grant_decorative_trophies_effect","myv_refresh_wyvern_prowess_effect","mm_royal_queue_daily_effect"]) f.env.stubs.add(name);
  h.run("test_effect",f.actor,f.env);
  assert.equal(f.env.deaths.length,1); assert.equal(f.env.deaths[0],f.dragon);
  assert.equal(f.target.traits.has("mm_royal_torpor"),false);
  assert.equal(f.env.calls.filter(x=>x.effect === "mm_ritual_create_random_material_drops_effect").length,1);
  assert.equal(f.env.calls.filter(x=>x.effect === "mm_ritual_grant_decorative_trophies_effect").length,1);
  h.run("test_effect",f.actor,f.env); assert.equal(f.env.deaths.length,1); assert.equal(f.actor.gold,18500);
}
console.log("V1310 ritual: finite decision gates and recheck PASS; CK3 engine unverified");

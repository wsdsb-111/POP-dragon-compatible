"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v135-finite-helper");
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"]);
const root = path.resolve(__dirname, "..");
const roster = ["99001001", "99001002", "99001003", "99001304", "99001305", "99001306", "99001307", "99001308", "99001309", "99001310"];
const sites = { constantine: "jingzhao", fenrir: "qus", leviathan: "chandax", hrist: "faereyar", black_emperor: "baghdad", white_empress: "sagami" };
function deep(nodes, predicate) {
  return nodes.flatMap(n => [...(predicate(n) ? [n] : []), ...(Array.isArray(n.value) ? deep(n.value, predicate) : [])]);
}
let cases = 0;
for (const relative of ["patches/wyvern-kings/mod/common/decisions/mm_royal_awakening.txt", "patches/wyvern-ascension/mod/common/decisions/zzzzzzzzzz_mm_ascension_awakening.txt"]) {
  const asc = relative.includes("ascension");
  for (const decision of h.parsePdx(fs.readFileSync(path.join(root, relative), "utf8"), relative)) {
    const site = Object.entries(sites).find(([key]) => decision.key.includes(key))[1];
    const trigger = "mm_creed_controls_" + site + "_holy_site_trigger";
    const valid = h.first(decision.value, "is_valid").value;
    const effect = h.first(decision.value, "effect").value;
    assert.equal(deep(valid, n => n.key === trigger).length, 1);
    assert.equal(deep(effect, n => n.key === trigger).length, 1, "effect-time ownership must be rechecked");
    for (const controlled of [false, true]) {
      const player = h.character("player", { gold: 20000, piety: 20000, prestige: 20000 });
      const env = h.environment({ root: player });
      const royals = roster.map(id => h.character(id, { traits: ["mm_royal_dragon_king"] }));
      for (let i = 0; i < roster.length; i++) {
        env.characters.set(roster[i], royals[i]);
        env.globalVars.set("mm_asc_seat_" + roster[i], royals[i]);
      }
      const targetScope = deep(valid, n => /^(character:|global_var:mm_asc_seat_)/.test(n.key))[0];
      const targetId = /9900\d+/.exec(targetScope.key)[0];
      const target = royals[roster.indexOf(targetId)];
      target.traits.add("mm_royal_torpor");
      const complete = h.character("complete", { traits: ["mm_royal_complete"] });
      player.relations.set("myv_bonded_wyvern", new Set([...royals, complete]));
      for (const branch of ["fire", "earth", "sea", "sky"]) env.globalVars.set("mm_royal_" + branch + "_united", true);
      h.scriptedTriggers.set(trigger, h.parsePdx("x = { always = " + (controlled ? "yes" : "no") + " }")[0].value);
      h.scriptedTriggers.set("v139_valid", valid);
      assert.equal(h.trigger("v139_valid", player, env), controlled, decision.key + " visible condition");
      h.scriptedEffects.set("v139_effect", effect);
      env.stubs.add("mm_royal_awaken_effect");
      h.run("v139_effect", player, env);
      assert.equal(env.calls.some(call => call.effect === "mm_royal_awaken_effect"), controlled, decision.key + " paid effect");
      assert.equal(player.gold < 20000, controlled, "lost control cannot consume ritual gold");
      cases++;
    }
  }
}
console.log("V139 awakening integration: PASS (" + cases + " finite gate/effect cases; engine ownership remains unverified)");

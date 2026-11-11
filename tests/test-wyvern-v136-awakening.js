"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v135-finite-helper");
const root = path.resolve(__dirname, "..");
const before = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v136/awakening-before.json"), "utf8"));
const keys = new Set();
const roster = ["99001001", "99001002", "99001003", "99001304", "99001305", "99001306", "99001307", "99001308", "99001309", "99001310"];
// v139 adds a separately tested holy-site prerequisite. Preserve every other
// frozen predicate and payment effect in this presentation-only regression.
function withoutHolySite(nodes) {
  return nodes.filter(n => !n.key.startsWith("mm_creed_controls_") && !(n.key === "custom_tooltip" && /^mm_creed_control_/.test(hKey(n.value))))
    .map(n => ({ ...n, value: Array.isArray(n.value) ? withoutHolySite(n.value) : n.value }));
}
function hKey(nodes) { return nodes.find(n => n.key === "text")?.value || ""; }
for (const [relative, oldText] of Object.entries(before)) {
  const asc = relative.includes("wyvern-ascension");
  const h = createHarness(asc ? ["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"] : ["wyvern-bloodline", "wyvern-kings"]);
  const actual = withoutHolySite(h.parsePdx(fs.readFileSync(path.join(root, relative), "utf8"), relative));
  const prior = withoutHolySite(h.parsePdx(oldText, "frozen v135 " + relative));
  assert.equal(actual.length, 6);
  for (let index = 0; index < actual.length; index++) {
    const decision = actual[index], previous = prior[index];
    assert.equal(decision.key, previous.key);
    assert.deepEqual(decision.value.filter(n => n.key !== "is_valid"), previous.value.filter(n => n.key !== "is_valid"), "visibility, payment-time recheck and effects are preserved exactly");
    const valid = h.first(decision.value, "is_valid").value;
    const oldValid = h.first(previous.value, "is_valid").value;
    const flat = valid.flatMap(node => {
      if (node.key !== "custom_tooltip") {
        assert.ok(["gold", "prestige", "piety"].includes(node.key), "only native resource checks are auto-rendered");
        return [node];
      }
      const text = h.first(node.value, "text");
      assert.ok(text && typeof text.value === "string"); keys.add(text.value);
      const conditions = node.value.filter(n => n.key !== "text");
      assert.equal(conditions.length, 1, "each visible checkbox retains one actual prerequisite");
      return conditions;
    });
    assert.deepEqual(flat, oldValid, "presentation must not add or remove any predicate");
    h.scriptedTriggers.set("v136_actual", valid);
    h.scriptedTriggers.set("v136_prior", oldValid);
    // Cross product includes insufficient resources, unavailable player, failed
    // bonds, missing/consumed twins, asleep/awake white empress and all 16 flag sets.
    for (let mask = 0; mask < 16; mask++) {
      for (const mode of ["eligible", "poor", "no-bond", "dead-target", "awake-target", "asleep-twins", "missing-seat", "child", "prisoner", "incapable"]) {
        const player = h.character("player", { gold: mode === "poor" ? 0 : 20000, piety: 20000, prestige: 20000,
          age: mode === "child" ? 10 : 30, imprisoned: mode === "prisoner", incapable: mode === "incapable" });
        const env = h.environment({ root: player });
        const holders = roster.map(id => h.character(asc ? "incarnation-" + id : id, { traits: ["mm_royal_dragon_king"] }));
        for (let i = 0; i < roster.length; i++) {
          env.characters.set(roster[i], holders[i]);
          env.globalVars.set("mm_asc_seat_" + roster[i], holders[i]);
        }
        const targetScope = oldValid.find(n => n.key.startsWith(asc ? "global_var:" : "character:"));
        const targetId = /9900\d+/.exec(targetScope.key)[0];
        const target = holders[roster.indexOf(targetId)];
        target.traits.add("mm_royal_torpor");
        if (mode === "dead-target") target.alive = false;
        if (mode === "awake-target") target.traits.delete("mm_royal_torpor");
        if (mode === "asleep-twins") holders.forEach(c => c.traits.add("mm_royal_torpor"));
        if (mode === "missing-seat") { env.characters.delete(targetId); env.globalVars.delete("mm_asc_seat_" + targetId); }
        const complete = h.character("complete", { traits: ["mm_royal_complete"] });
        player.relations.set("myv_bonded_wyvern", new Set(mode === "no-bond" ? [] : [...holders, complete]));
        for (let bit = 0; bit < 4; bit++) if (mask & (1 << bit)) env.globalVars.set("mm_royal_" + ["fire", "earth", "sea", "sky"][bit] + "_united", true);
        const result = h.trigger("v136_actual", player, env);
        assert.equal(result, h.trigger("v136_prior", player, env), decision.key + " " + mask + " " + mode);
        if (["poor", "no-bond", "dead-target", "awake-target", "missing-seat", "child", "prisoner", "incapable"].includes(mode)) assert.equal(result, false, "a failed prerequisite remains blocking");
        if (mode === "eligible" && (targetId !== "99001309" || mask === 15)) assert.equal(result, true, "valid ceremony remains available");
      }
    }
  }
}
assert.equal(keys.size, 15);
for (const language of ["english", "simp_chinese"]) {
  const text = fs.readFileSync(path.join(root, "patches/wyvern-kings/mod/localization", language, `mm_royal_awakening_requirements_l_${language}.yml`), "utf8");
  assert.ok(text.startsWith("\uFEFFl_" + language + ":"));
  for (const key of keys) assert.equal((text.match(new RegExp("^ " + key + ':0 "[^"\\r\\n]+"$', "gm")) || []).length, 1, "every checkbox has exactly one non-empty translation");
  assert.doesNotMatch(text, /BUG:|has_global_variable|has_relation_myv_bonded_wyvern|is_alive/);
}
console.log("V136 awakening: 1920 finite cases preserve all predicates, payment guards and current-incarnation scopes; tooltip keys complete. CK3 rendering remains unverified.");

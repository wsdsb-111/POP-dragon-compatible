"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createHarness } = require("./wyvern-v135-finite-helper");
const root = path.resolve(__dirname, "..");
const sourcePath = "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052/events/myv_wyvern_battlefield_events.txt";
const overlayPath = path.join(root, "patches/dragon-creed/mod/events/myv_wyvern_battlefield_events.txt");
const rawSource = fs.readFileSync(sourcePath);
const rawOverlay = fs.readFileSync(overlayPath);
assert.equal(crypto.createHash("sha256").update(rawSource).digest("hex"), "1be2399457be385e001af2542e29736fed313e80f7f35760ce13b514ad82cd14");
assert.ok(rawSource.subarray(0, 3).equals(rawOverlay.subarray(0, 3)), "source BOM preserved");
assert.ok(!/(?<!\r)\n/.test(rawOverlay.toString("utf8")), "CRLF preserved");
const source = rawSource.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const overlay = rawOverlay.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
function extract(text, key) {
  const escape = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("^[\\t ]*" + escape + "[\\t ]*=\\s*\\{", "m").exec(text);
  assert.ok(match, key);
  const open = text.indexOf("{", match.index); let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(match.index, i + 1);
  }
  throw new Error("unclosed " + key);
}
// Each deliberately replaced section is pinned before being peeled off; after
// restoration the entire file, including every untouched event, is identical.
const hashes = {
  "0001": { option: "af7632b5eee20495ad35894c391075b8c0ad14a3a4507fd8c7db83d3999d24e9" },
  "0110": { immediate: "2b21859746259a10590358e51f9664f12706f15898a341f644477a7b1110b66d", desc: "74f5e6ebabfc1e81d7710526f1201cdb4eb05c0d409bd97162334120cc776dbe", option: "e6b5cc201caa2cef598182cc47d2cf16c31d17c8e55056a9b66b0381703739a8" },
  "0111": { immediate: "3744c672927c65067666c6fa38165a7aa88da91bafc4a7f54c5a1d461a34bd9d", desc: "55da27c5e5fca0eb0279ddc0c13a5a2af80cfd35d5b94d2e2c1b575540fb61af", option: "870652cd21b49567f1c89db00ce64c0b84d78d24491de50c406e9e71e4c58705" },
  "0113": { immediate: "fd6949758d3d81f1843fb1dabe4563f7f5775f51611435843676b3e728dd0e6b", desc: "4b886cf038c0f19681b6137b15f1185c786642133fc34fefbf08fa3f9a64736a", option: "9536a24067c8fd75f398993f9cdbde6bfcc49df9daccc5b50dad10975ccad9b3" }
};
let restored = overlay;
for (const [id, sections] of Object.entries(hashes)) {
  const key = "myv_wyvern_battlefield." + id;
  const oldEvent = extract(source, key);
  let newEvent = extract(restored, key);
  for (const [section, hash] of Object.entries(sections)) {
    const actual = extract(newEvent, section);
    assert.equal(crypto.createHash("sha256").update(actual).digest("hex"), hash, key + " reviewed " + section);
    newEvent = newEvent.replace(actual, extract(oldEvent, section));
  }
  assert.equal(newEvent, oldEvent, key + " other content unchanged");
  restored = restored.replace(extract(restored, key), newEvent);
}
assert.equal(restored, source, "all other upstream bytes preserved after the reviewed sections are restored");
const h = createHarness(["wyvern-capture", "dragon-creed"]);
h.scriptedTriggers.set("mm_creed_earth_return_eligible_trigger", h.parsePdx("x = { is_alive = yes }")[0].value);
h.scriptedTriggers.set("myv_is_living_wyvern", h.parsePdx("x = { always = no }")[0].value);
// The engine-defined award is symbolic; use a finite non-zero value so the
// existing numeric interpreter can verify whether the kill grants prestige.
h.scriptValues.set("knight_prestige_gain_on_kill", h.parsePdx("x = { value = 5 }")[0].value);
// hidden_effect changes only UI visibility. Unwrap it without replacing any
// contained condition, random roll, injury, death, or record operation.
function transparentHiddenEffects(nodes) {
  return nodes.flatMap(node => {
    if (node.key === "hidden_effect") return transparentHiddenEffects(node.value);
    return [{ ...node, value: Array.isArray(node.value) ? transparentHiddenEffects(node.value) : node.value }];
  });
}
const events = h.parsePdx(overlay);
const event = events.find(x => x.key === "myv_wyvern_battlefield.0111").value;
h.scriptedEffects.set("test_battlefield_immediate", transparentHiddenEffects(h.first(event, "immediate").value));
h.scriptedEffects.set("test_battlefield_result", transparentHiddenEffects(h.first(h.first(event, "option").value, "hidden_effect").value));
for (const [riderReturn, mountReturn] of [[true, false], [false, true], [false, false], [true, true]]) {
  const rider = h.character("rider");
  const mount = h.character("mount");
  const opponent = h.character("opponent");
  const enemyMount = h.character("enemy-mount");
  rider.vars.set("myv_wyvern_duel_enemy_rider", opponent);
  rider.vars.set("myv_wyvern_duel_enemy_mount", enemyMount);
  rider.vars.set("myv_wyvern_duel_player_mount", mount);
  const env = h.environment({ root: rider, randomChoices: [
    { type: "chance", success: false },
    { type: "chance", success: riderReturn },
    { type: "chance", success: mountReturn }
  ], stubs: ["myv_apply_aerial_crash_injuries_effect", "myv_cleanup_wyvern_rider_duel_effect", "myv_record_player_rider_battle_death_effect"] });
  h.run("test_battlefield_immediate", rider, env);
  assert.deepEqual(Array.from(env.randomRolls, x => x.chance), [10, 15, 15]);
  assert.equal(rider.vars.get("mm_creed_bf_player_rider"), Number(riderReturn));
  assert.equal(rider.vars.get("mm_creed_bf_player_mount"), Number(mountReturn));
  h.run("test_battlefield_result", rider, env);
  assert.equal(rider.alive, riderReturn);
  assert.equal(mount.alive, mountReturn);
  assert.equal(env.calls.filter(x => x.effect === "myv_record_player_rider_battle_death_effect").length, riderReturn ? 0 : 1);
  assert.equal(rider.traits.has("wounded_3"), riderReturn);
  assert.equal(rider.modifiers.has("mm_creed_earth_wyvern_return"), riderReturn);
  assert.equal(mount.modifiers.has("mm_creed_earth_wyvern_return"), mountReturn);
  assert.equal(rider.flags.has("mm_creed_earth_wyvern_returned"), false);
  assert.equal(mount.flags.has("mm_creed_earth_wyvern_returned"), false);
}
{
  const rider = h.character("native-survival-rider");
  const mount = h.character("native-survival-mount");
  rider.vars.set("myv_wyvern_duel_enemy_rider", h.character("enemy"));
  rider.vars.set("myv_wyvern_duel_enemy_mount", h.character("enemy-mount"));
  rider.vars.set("myv_wyvern_duel_player_mount", mount);
  const env = h.environment({ root: rider, randomChoices: [{ type: "chance", success: true }], stubs: ["myv_apply_aerial_crash_injuries_effect"] });
  h.run("test_battlefield_immediate", rider, env);
  assert.deepEqual(Array.from(env.randomRolls, x => x.chance), [10]);
  assert.equal(rider.vars.get("mm_creed_bf_player_rider"), 1);
  assert.equal(rider.vars.get("mm_creed_bf_player_mount"), 1);
}
const pounce = events.find(x => x.key === "myv_wyvern_battlefield.0001").value;
h.scriptedEffects.set("test_pounce_result", transparentHiddenEffects(h.first(h.first(pounce, "option").value, "hidden_effect").value));
for (const rescued of [true, false]) {
  const attacker = h.character("attacker");
  const target = h.character("commander");
  attacker.vars.set("myv_battlefield_event_enemy_commander", target);
  const env = h.environment({ root: attacker, randomChoices: [{ type: "chance", success: rescued }], stubs: ["myv_record_enemy_rider_battle_death_effect"] });
  h.run("test_pounce_result", attacker, env);
  assert.equal(target.alive, rescued);
  assert.equal(attacker.prestige, rescued ? 5000 : 5005);
  assert.equal(env.calls.filter(x => x.effect === "myv_record_enemy_rider_battle_death_effect").length, rescued ? 0 : 1);
  assert.deepEqual(Array.from(env.randomRolls, x => x.chance), [15]);
}
for (const id of ["0110", "0113"]) {
  const definition = events.find(x => x.key === "myv_wyvern_battlefield." + id).value;
  h.scriptedEffects.set("test_other_immediate", transparentHiddenEffects(h.first(definition, "immediate").value));
  h.scriptedEffects.set("test_other_result", transparentHiddenEffects(h.first(h.first(definition, "option").value, "hidden_effect").value));
  for (const [riderReturn, mountReturn] of [[true,false], [false,true], [false,false], [true,true]]) {
    const player = h.character("player");
    const playerMount = h.character("player-mount");
    const enemy = h.character("enemy");
    const enemyMount = h.character("enemy-mount");
    player.vars.set("myv_wyvern_duel_enemy_rider", enemy);
    player.vars.set("myv_wyvern_duel_enemy_mount", enemyMount);
    player.vars.set("myv_wyvern_duel_player_mount", playerMount);
    const randomChoices = id === "0110"
      ? [{ type: "chance", success: false }, { type: "chance", success: riderReturn }, { type: "chance", success: mountReturn }]
      : [{ type: "chance", success: false }, { type: "chance", success: true }, { type: "chance", success: riderReturn }, { type: "chance", success: mountReturn }];
    const env = h.environment({ root: player, randomChoices, stubs: ["myv_apply_aerial_crash_injuries_effect", "myv_cleanup_wyvern_rider_duel_effect", "myv_record_player_rider_battle_death_effect", "myv_record_enemy_rider_battle_death_effect"] });
    h.run("test_other_immediate", player, env);
    h.run("test_other_result", player, env);
    const rider = id === "0110" ? enemy : player;
    const mount = id === "0110" ? enemyMount : playerMount;
    assert.equal(rider.alive, riderReturn, id + " rider outcome");
    assert.equal(mount.alive, mountReturn, id + " mount outcome");
    assert.equal(rider.traits.has("wounded_3"), riderReturn, id + " survivor wounded");
    const record = id === "0110" ? "myv_record_enemy_rider_battle_death_effect" : "myv_record_player_rider_battle_death_effect";
    assert.equal(env.calls.filter(x => x.effect === record).length, riderReturn ? 0 : 1, id + " death record");
  }
}

console.log("v1312 battlefield pre-death return fixtures passed");

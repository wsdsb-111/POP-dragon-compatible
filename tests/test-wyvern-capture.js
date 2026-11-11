"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const moduleRoot = path.join(projectRoot, "patches", "wyvern-capture");
const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, "sources.json"), "utf8"));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readOutput(relativePath) {
  const outputPath = path.join(moduleRoot, ...relativePath.split("/"));
  assert.ok(fs.existsSync(outputPath), "capture output missing: " + relativePath);
  const bytes = fs.readFileSync(outputPath);
  const record = manifest.outputs.find((entry) => entry.path === relativePath);
  assert.ok(record, "capture output not recorded: " + relativePath);
  assert.equal(sha256(bytes), record.sha256, "capture output hash: " + relativePath);
  // Hash every asset, but do not retain mesh/DDS bytes as expanded UTF-8 strings.
  return /\.(txt|yml)$/.test(relativePath)
    ? bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
    : null;
}

function checkDelimiters(text, label) {
  const stack = [];
  let inString = false;
  let escaped = false;
  let inComment = false;
  const pairs = { "}": "{", "]": "[", ")": "(" };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inComment) {
      if (character === "\n") inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "#") inComment = true;
    else if (character === "{" || character === "[" || character === "(") stack.push(character);
    else if (character === "}" || character === "]" || character === ")") {
      assert.equal(stack.pop(), pairs[character], label + " delimiter mismatch at " + String(index));
    }
  }

  assert.equal(inString, false, label + " unterminated string");
  assert.equal(stack.length, 0, label + " unclosed delimiter");
}

const outputs = new Map();
for (const output of manifest.outputs) {
  const text = readOutput(output.path);
  if (/\.(txt|yml)$/.test(output.path)) checkDelimiters(text, output.path);
  outputs.set(output.path, text);
}

const triggers = outputs.get("mod/common/scripted_triggers/zzzz_mm_wyvern_capture_triggers.txt");
const effects = outputs.get("mod/common/scripted_effects/zzzz_mm_wyvern_capture_effects.txt");
const interactions = outputs.get("mod/common/character_interactions/zzzz_mm_wyvern_capture_interactions.txt");
const schemes = outputs.get("mod/common/schemes/scheme_types/zzzz_mm_wyvern_capture_schemes.txt");
const events = outputs.get("mod/events/zzzz_mm_wyvern_capture_events.txt");
const deathHook = outputs.get("mod/common/on_action/zzzz_mm_wyvern_capture_on_actions.txt");
const originTrait = outputs.get("mod/common/traits/zzzz_mm_wyvern_capture_traits.txt");

assert.match(triggers, /myv_is_living_wild_wyvern[\s\S]*NOT = \{ has_variable = mm_wyvern_captor \}/);
assert.match(triggers, /mm_wyvern_can_capture_target_trigger = \{/);
assert.match(triggers, /mm_wyvern_capture_stable_room_trigger = \{[\s\S]*count >= 8[\s\S]*count >= 5[\s\S]*count >= 3/);
assert.match(triggers, /mm_wyvern_capture_valid_for_captor_trigger = \{/);
assert.match(triggers, /var:myv_wyvern_hunger < 100/);
assert.doesNotMatch(triggers, /var:mm_wyvern_taming_progress < 100/);
assert.match(triggers, /\$CAPTOR\$ = \{ is_alive = yes \}/);
assert.match(effects, /mm_wyvern_capture_target_effect = \{/);
assert.match(effects, /set_variable = \{ name = mm_wyvern_captor value = root \}/);
assert.match(effects, /set_variable = \{ name = mm_wyvern_taming_progress value = 0 \}/);
assert.match(effects, /mm_wyvern_capture_integrity_effect = yes/);
assert.match(effects, /myv_wyvern_monthly_roaming_effect = \{[\s\S]*NOT = \{ has_variable = mm_wyvern_captor \}/);
assert.match(effects, /myv_wyvern_lair_county_maintenance_effect = \{[\s\S]*NOT = \{ has_variable = mm_wyvern_captor \}/);
assert.match(effects, /myv_wyvern_move_one_province_effect = \{[\s\S]*NOT = \{ has_variable = mm_wyvern_captor \}/);
assert.match(effects, /mm_wyvern_capture_feed_effect = \{[\s\S]*myv_wyvern_feed_20_effect = yes[\s\S]*add = 20/);
assert.match(effects, /var:mm_wyvern_taming_progress > 100[\s\S]*value = 100/);
assert.match(effects, /mm_wyvern_capture_tame_effect = \{[\s\S]*add_trait = myv_wyvern_tamed[\s\S]*myv_establish_wyvern_keeper_bond_effect/);
assert.match(effects, /clear_saved_scope = mm_wyvern_capture_tame_in_stable[\s\S]*remove_trait = myv_wyvern_legendary/);
assert.match(effects, /mm_wyvern_legendary_origin/);
assert.match(interactions, /myv_attempt_slay_wyvern_interaction = \{[\s\S]*NOT = \{ has_variable = mm_wyvern_captor \}/);
assert.match(interactions, /myv_debug_trigger_wyvern_attack_interaction = \{[\s\S]*NOT = \{ has_variable = mm_wyvern_captor \}/);
assert.match(interactions, /mm_wyvern_feed_captive_interaction = \{/);
assert.match(interactions, /mm_wyvern_attempt_tame_captive_interaction = \{/);
assert.equal((schemes.match(/mm_wyvern_tame_(?:alert|docile|fierce)_captive = \{/g) || []).length, 3);
assert.match(schemes, /base_progress_goal = 180[\s\S]*base_maximum_success = 90[\s\S]*minimum_success = 10/);
assert.match(schemes, /mm_wyvern_capture_valid_for_captor_trigger = \{ CAPTOR = scope:owner \}/);
assert.match(events, /mm_wyvern_capture_can_feed_trigger = \{ CAPTOR = root \}/);
assert.match(events, /myv_wyvern_feed_(?:scraps|standard|prime)_cost/);
assert.match(events, /myv_wyvern_feed_(?:scraps|standard|prime)_provisions_cost/);
assert.match(events, /5 = \{ death = \{ death_reason = death_myv_failed_wyvern_bonding/);
const failureEvent = events.slice(events.indexOf("mm_wyvern_capture.0003 = {"));
assert.match(failureEvent, /if = \{\s*limit = \{[\s\S]*?scope:mm_wyvern_capture_scheme_target = \{[\s\S]*?mm_wyvern_capture_valid_for_captor_trigger = \{ CAPTOR = root \}[\s\S]*?var:mm_wyvern_taming_progress >= 100[\s\S]*?\}\s*random_list = \{/);
assert.match(events, /provisions >= myv_wyvern_feed_(?:scraps|standard|prime)_provisions_cost/);
assert.match(events, /gold >= myv_wyvern_feed_(?:scraps|standard|prime)_cost/);
assert.match(deathHook, /on_death = \{[\s\S]*mm_wyvern_capture_captor_death_release/);
assert.match(deathHook, /mm_wyvern_capture_release_effect = yes/);
assert.match(originTrait, /health = 2/);
assert.doesNotMatch(originTrait, /life_expectancy\s*=/, "ageless species must not stack a second lifespan bonus");

assert.equal(manifest.modulePath, "patches/wyvern-capture/mod");
assert.equal(manifest.parentModule, "wyvern");
assert.ok(manifest.outputs.length >= 8, "capture module should record all owned outputs");

console.log("PASS wyvern capture, cage, feeding, taming, and provenance contracts");

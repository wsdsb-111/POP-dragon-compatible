"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../mod/VOTC_Three_Mod_Character_Name_Compatibility");
const files = [
  "common/scripted_triggers/zzzz_votc_celestial_office_release.txt",
  "common/scripted_triggers/zzzz_votc_celestial_office_region_rules.txt",
  "common/scripted_effects/zzzz_votc_celestial_office_release.txt",
  "common/scripted_effects/zzzz_votc_celestial_office_region_rules.txt",
  "common/on_action/zzzz_votc_celestial_office_release.txt",
  "events/votc_celestial_office_release_events.txt"
];
const definitions = new Map();
const sources = files.map(file => {
  const source = fs.readFileSync(path.join(root, file), "utf8").replace(/#[^\r\n]*/g, "");
  let depth = 0;
  for (const token of source.match(/"(?:\\.|[^"\\])*"|[{}]/g) || []) {
    if (token === "{") depth++;
    if (token === "}") assert(--depth >= 0, file + " has an unmatched closing brace");
  }
  assert.equal(depth, 0, file + " has an unclosed block");
  for (const match of source.matchAll(/^(\w[\w.]*)\s*=\s*\{/gm)) {
    assert(!definitions.has(match[1]), "duplicate production definition: " + match[1]);
    definitions.set(match[1], file);
  }
  return { file, source };
});
for (const { file, source } of sources) {
  assert(!/\blist\s*=\s*votc_celestial_office_(?:task_|handoff_path)/.test(source), file + " must use variable= for persistent work lists");
  assert(!/\bname\s*=\s*root\./.test(source), file + " must scope variable-list writes to their owner");
  assert(!/type\s*=\s*change_liege\b/.test(source), file + " must use a documented native transfer reason");
  for (const match of source.matchAll(/\b(votc_\w+)\s*=\s*yes\b/g)) {
    assert(definitions.has(match[1]), file + " references missing trigger/effect " + match[1]);
  }
  for (const match of source.matchAll(/\bon_actions\s*=\s*\{([^{}]*)\}/g)) {
    for (const name of match[1].trim().split(/\s+/).filter(Boolean)) {
      assert(definitions.has(name), file + " registers missing on-action " + name);
    }
  }
  for (const match of source.matchAll(/\bid\s*=\s*(votc_celestial_office_release\.\d+)/g)) {
    assert(definitions.has(match[1]), file + " schedules missing event " + match[1]);
  }
}
for (const name of ["on_title_gain", "on_title_lost", "on_primary_title_change", "on_vassal_change", "on_vassal_gained", "on_government_change", "on_liege_government_change", "on_game_start_after_lobby", "oe_stream_patch_attachable_trigger"]) {
  assert(definitions.has(name), "missing native lifecycle or upstream entry " + name);
}
// Durability is checked in production declarations as well as in the separate
// behavioral interpreter. An event delay must not become a variable lifetime.
const all = sources.map(entry => entry.source).join("\n");
for (const match of all.matchAll(/set_variable\s*=\s*\{([^{}]*)\}/g)) {
  if (/\bname\s*=\s*votc_celestial_office_audit_batch_lock\b/.test(match[1])) {
    assert(/\bdays\s*=\s*1\b/.test(match[1]), "only the separate one-day audit budget lock may expire");
  } else {
    assert(!/\b(days|months|years)\s*=/.test(match[1]), "office task variables must survive delayed processing and reload");
  }
}
assert(!/\b(valid_candidate|on_monthly_pulse|on_title_gain_before)\s*=/.test(all), "do not invent unsupported native hooks or appointment filters");
console.log("V1.1.1 office wiring: PASS (native entries, custom definitions, deferred events and durable variables)");

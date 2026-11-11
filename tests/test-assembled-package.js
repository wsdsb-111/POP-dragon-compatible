"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const result = spawnSync(process.execPath, [path.join(root, "scripts/build-package.js")], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr || result.stdout);
const built = JSON.parse(result.stdout.trim());
const target = path.join(built.packageRoot, "mod/VOTC_Three_Mod_Character_Name_Compatibility");
const manifest = JSON.parse(fs.readFileSync(path.join(built.packageRoot, "manifest.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(root, "compatibility.json"), "utf8"));
for (const filename of ["myv_compact_head.txt", "myv_wyvern_flying.txt", "myv_wyvern_rider_flying.txt", "myv_wyvern_running.txt", "myv_wyvern_wild_aerial_flying.txt"]) {
  const relative = "gfx/portraits/portrait_animations/" + filename;
  assert(manifest.files.some(file => file.path === relative && file.source === "wyvern-ascension"),
    "the optional ascension extension owns the reviewed final pose: " + filename);
}
assert(manifest.modules.includes("wyvern-ascension"));
assert(manifest.modules.includes("character-preservation"));
assert(manifest.dependencies.includes("3740401066"), "the full package loads after Born of This Land");
for (const relative of ["common/scripted_triggers/zzzzzzzzzzzz_mm_cleanup_protection.txt", "common/scripted_triggers/zzzzzzzzzzzz_mm_BoTL_cleanup.txt", "events/courtier_guest_management_events/courtier_guest_management_events.txt", "common/scripted_effects/07_dlc_ep3_scripted_effects.txt", "common/scripted_effects/zzzzzzzzzzzz_mm_dragon_nonlethal_population.txt"]) {
  assert(manifest.files.some(file => file.path === relative && file.source === "character-preservation"), "the final package contains the audited preservation overlay: " + relative);
}
assert.equal(built.files, manifest.files.length);
assert.equal(manifest.campaign, "new");
let expressions = 0;
function validateExpression(expression, file) {
  let depth = 0;
  let quoted = false;
  for (const char of expression) {
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "(") depth++;
    else if (!quoted && char === ")") { depth--; assert(depth >= 0, file + " expression has an extra closing parenthesis: " + expression); }
  }
  assert.equal(depth, 0, file + " expression has unclosed parentheses: " + expression);
  assert(!quoted, file + " expression has an unclosed argument string");
}
for (const file of manifest.files) {
  const bytes = fs.readFileSync(path.join(target, file.path));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), file.sha256);
  if (!file.path.endsWith(".gui")) continue;
  const source = bytes.toString("utf8");
  assert(!/^(<<<<<<<|=======|>>>>>>>)\s/m.test(source), file.path + " merge markers");
  for (const match of source.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    for (const expression of match[1].matchAll(/\[([^\]]*)\]/g)) { validateExpression(expression[1], file.path); expressions++; }
  }
}
const descriptor = fs.readFileSync(path.join(target, "descriptor.mod"), "utf8");
const adjacent = fs.readFileSync(path.join(built.packageRoot, "mod/VOTC_Three_Mod_Character_Name_Compatibility.mod"), "utf8");
for (const source of [descriptor, adjacent]) {
  assert(source.includes('name="多 Mod 兼容 Mod"'));
  assert(source.includes('version="' + config.version + '"'));
  for (const mod of config.mods) assert(source.includes('"' + mod.name + '"'), "missing load-order dependency: " + mod.id);
}
for (const relative of ["gui/hud.gui", "gui/hanfan_hud.gui", "gui/00_three_mod_realm.gui", "gui/multi_mod_woc_toolbar.gui", "gui/window_character.gui", "gui/window_character_finder.gui", "gui/interaction_confirmation.gui", "common/genes/05_genes_special_accessories_clothes.txt", "common/domiciles/types/zz_nhe19_estate.txt", "common/domiciles/types/zz_nhe72_palace_estate.txt"]) assert(manifest.files.some(file => file.path === relative));
const tooltip = fs.readFileSync(path.join(target, "gui/shared/00_votc_trait_tooltip.gui"), "utf8");
assert(tooltip.includes("myv_wyvern_malnutrition"));
assert(tooltip.includes("Not( Trait.IsPersonality )"));
assert.throws(() => validateExpression("And(true,false))", "negative"), /extra closing parenthesis/);
assert.throws(() => validateExpression("And(true,false", "negative"), /unclosed parentheses/);
const crownOnly = spawnSync(process.execPath, [path.join(root, "scripts/build-package.js"), "--modules=weight-of-crown"], { encoding: "utf8" });
assert.equal(crownOnly.status, 0, crownOnly.stderr);
const crownPackage = JSON.parse(crownOnly.stdout.trim());
const crownManifest = JSON.parse(fs.readFileSync(path.join(crownPackage.packageRoot, "manifest.json"), "utf8"));
assert.deepEqual(crownManifest.modules, ["weight-of-crown"]);
assert.deepEqual(crownManifest.dependencies, ["3780779762"]);
assert(!crownManifest.files.some(file => file.path.includes("wyvern") || file.path.startsWith("common/")), "standalone WoC package must not contain unrelated game scripts");
const dragonOnly = spawnSync(process.execPath, [path.join(root, "scripts/build-package.js"), "--modules=wyvern"], { encoding: "utf8" });
assert.equal(dragonOnly.status, 0, dragonOnly.stderr);
const dragonPackage = JSON.parse(dragonOnly.stdout.trim());
const dragonManifest = JSON.parse(fs.readFileSync(path.join(dragonPackage.packageRoot, "manifest.json"), "utf8"));
assert.deepEqual(dragonManifest.modules, ["chinese-core", "wyvern"]);
assert(!dragonManifest.dependencies.includes("3780779762"));
assert(!dragonManifest.files.some(file => file.path.includes("woc_toolbar")));
const dialoguePath = "common/character_interactions/mcc_interactions.txt";
assert(manifest.files.some(file => file.path === dialoguePath && file.source === "wyvern-votc-dialogue"));
assert(!dragonManifest.files.some(file => file.path === dialoguePath), "Wyvern-only builds must not require VOTC events");
assert(!dragonManifest.dependencies.includes("3346777360"));
assert(manifest.dependencies.includes("3346777360"), "the full dialogue-enabled package declares its VOTC dependency");
for (const [file, owner] of [
  ["events/myv_wyvern_events.txt", "wyvern-capture"],
  ["common/scripted_effects/mm_wyvern_trophies.txt", "wyvern-capture"],
  ["common/character_interactions/mm_wyvern_human_form.txt", "wyvern-human-form"]
]) assert(manifest.files.some(entry => entry.path === file && entry.source === owner), "new extension must reach full package: " + file);
const extensionBuild = spawnSync(process.execPath, [path.join(root, "scripts/build-package.js"), "--modules=wyvern-capture,wyvern-human-form"], { encoding: "utf8" });
assert.equal(extensionBuild.status, 0, extensionBuild.stderr);
const extensionManifest = JSON.parse(fs.readFileSync(path.join(JSON.parse(extensionBuild.stdout.trim()).packageRoot, "manifest.json"), "utf8"));
assert.deepEqual(extensionManifest.modules, ["chinese-core", "wyvern", "wyvern-capture", "wyvern-human-form"]);
assert(!extensionManifest.dependencies.includes("3346777360"));
const dialogueOnly = spawnSync(process.execPath, [path.join(root, "scripts/build-package.js"), "--modules=wyvern-votc-dialogue"], { encoding: "utf8" });
assert.equal(dialogueOnly.status, 0, dialogueOnly.stderr);
const dialoguePackage = JSON.parse(dialogueOnly.stdout.trim());
const dialogueManifest = JSON.parse(fs.readFileSync(path.join(dialoguePackage.packageRoot, "manifest.json"), "utf8"));
assert.deepEqual(dialogueManifest.modules, ["chinese-core", "wyvern", "wyvern-votc-dialogue"]);
assert(dialogueManifest.dependencies.includes("3346777360"));
assert(dialogueManifest.files.some(file => file.path === dialoguePath));
assert(!dialogueManifest.dependencies.includes("3780779762"));
assert(manifest.files.some(file => file.path === "gui/shared/mapmodes.gui"));
assert(crownManifest.files.some(file => file.path === "gui/shared/mapmodes.gui"));
const hatchingPath = "common/script_values/zzzz_multi_mod_wyvern_hatching.txt";
for (const packageManifest of [manifest, dragonManifest]) {
  assert(packageManifest.files.some(file => file.path === hatchingPath && file.source === "wyvern"),
    "full and Wyvern packages include the equipped-egg chance override");
}
const invalid = spawnSync(process.execPath, [path.join(root, "scripts/build-package.js"), "--modules=unknown"], { encoding: "utf8" });
assert.notEqual(invalid.status, 0, "unsupported combinations must fail before creating a package");
console.log("Assembled multi-mod package: PASS (" + built.files + " files, " + expressions + " GUI expressions, " + manifest.dependencies.length + " dependencies and merged overlay parity)");

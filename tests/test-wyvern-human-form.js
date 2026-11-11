"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const patchRoot = path.join(projectRoot, "patches", "wyvern-human-form");
const manifest = JSON.parse(fs.readFileSync(path.join(patchRoot, "sources.json"), "utf8"));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readPatch(relativePath) {
  return fs.readFileSync(path.join(patchRoot, "mod", relativePath), "utf8");
}

for (const source of manifest.sourceFiles) {
  const sourceRoot = manifest.sourceRoots[source.root];
  assert.ok(sourceRoot, "source root exists for " + source.root);
  const sourcePath = path.join(sourceRoot, source.path.replaceAll("/", path.sep));
  if (fs.existsSync(sourcePath)) assert.equal(sha256(fs.readFileSync(sourcePath)), source.sha256, source.root + ":" + source.path + " source SHA-256");
}

for (const output of manifest.outputs) {
  const outputPath = path.join(patchRoot, output.path.replaceAll("/", path.sep));
  assert.equal(sha256(fs.readFileSync(outputPath)), output.sha256, output.path + " output SHA-256");
}

const interaction = readPatch("common/character_interactions/mm_wyvern_human_form.txt");
assert.match(interaction, /filter_tags\s*=\s*\{\s*myv_wyvern_interaction\s*\}/);
assert.match(interaction, /is_ai\s*=\s*no/);
assert.match(interaction, /myv_is_living_wyvern\s*=\s*yes/);
assert.match(interaction, /has_trait\s*=\s*myv_wyvern_tamed/);
assert.match(interaction, /has_relation_myv_wyvern_bonded_character\s*=\s*scope:actor/);
assert.match(interaction, /age\s*>=\s*10/);
assert.match(interaction, /add_character_flag\s*=\s*mm_wyvern_human_form/);
assert.match(interaction, /remove_character_flag\s*=\s*mm_wyvern_human_form/);
const onAccept = interaction.slice(interaction.indexOf("on_accept = {"));
for (const condition of ["is_ai = no", "is_alive = yes", "myv_is_wyvern = no", "is_imprisoned = no", "is_incapable = no", "myv_is_living_wyvern = yes", "has_trait = myv_wyvern_tamed", "has_relation_myv_wyvern_bonded_character = scope:actor", "age >= 10"]) {
  assert.ok(onAccept.includes(condition), "on_accept revalidates " + condition);
}
assert.doesNotMatch(interaction, /set_character_flag\s*=/);
assert.doesNotMatch(interaction, /(?:add_trait|remove_trait|set_age|set_gender|set_culture|change_variable|set_variable|myv_wyvern_flying|battlefield)/);

const scriptedGui = readPatch("common/scripted_guis/zzzz_multi_mod_wyvern_human_form.txt");
assert.match(scriptedGui, /myv_is_wyvern\s*=\s*yes/);
assert.match(scriptedGui, /NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_wyvern_human_form\s*\}/);
const sourceRoots = manifest.sourceRoots;
const mergedCharacterWindow = fs.readFileSync(path.join(projectRoot, "patches/wyvern/mod/gui/window_character.gui"), "utf8");
assert.match(mergedCharacterWindow, /Not\(\s*GetScriptedGui\('myv_wyvern_character_window'\)\.IsShown/);
const finalCharacterWindowRelative = "mod/common/scripted_guis/zzzzzzzzzz_mm_dragon_name_gui.txt";
const cultureRoot = path.join(projectRoot, "patches/dragon-culture");
const cultureManifest = JSON.parse(fs.readFileSync(path.join(cultureRoot, "sources.json"), "utf8"));
const finalCharacterWindowPath = path.join(cultureRoot, finalCharacterWindowRelative.replaceAll("/", path.sep));
const finalCharacterWindowOutput = cultureManifest.outputs.find(output => output.path === finalCharacterWindowRelative);
assert.ok(finalCharacterWindowOutput, "final scripted-GUI override is in the dragon-culture manifest");
assert.equal(sha256(fs.readFileSync(finalCharacterWindowPath)), finalCharacterWindowOutput.sha256, "final scripted-GUI override SHA-256");
const finalCharacterWindow = fs.readFileSync(finalCharacterWindowPath, "utf8");
assert.match(finalCharacterWindow, /myv_is_wyvern\s*=\s*yes[\s\S]*?NOT\s*=\s*\{\s*has_trait\s*=\s*mm_asc_dragon_body\s*\}[\s\S]*?NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_wyvern_human_form\s*\}/);

const portrait = readPatch("gfx/portraits/portrait_modifiers/zzzz_multi_mod_wyvern_human_form.txt");
assert.match(portrait, /priority\s*=\s*1000/);
assert.match(portrait, /weight\s*=\s*\{\s*base\s*=\s*0\s*modifier\s*=\s*\{\s*add\s*=\s*1000\s*AND\s*=\s*\{\s*NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_wyvern_human_form\s*\}\s*OR\s*=\s*\{/);
assert.match(portrait, /portrait_has_trait_trigger\s*=\s*\{\s*TRAIT\s*=\s*myv_wyvern\s*\}/);
assert.match(portrait, /portrait_has_trait_trigger\s*=\s*\{\s*TRAIT\s*=\s*myv_wyvern_tamed\s*\}/);
assert.match(portrait, /portrait_has_trait_trigger\s*=\s*\{\s*TRAIT\s*=\s*myv_wyvern_legendary\s*\}/);
assert.match(portrait, /priority\s*=\s*2000/);
assert.match(portrait, /gene\s*=\s*gene_myv_wyvern\s+template\s*=\s*no_myv_wyvern/);
assert.match(portrait, /gene\s*=\s*gene_myv_no_portrait\s+template\s*=\s*normal_portrait/);
assert.match(portrait, /weight\s*=\s*\{\s*base\s*=\s*0\s*modifier\s*=\s*\{\s*add\s*=\s*1000\s*AND\s*=\s*\{\s*portrait_has_trait_trigger\s*=\s*\{\s*TRAIT\s*=\s*myv_wyvern_tamed\s*\}\s*has_character_flag\s*=\s*mm_wyvern_human_form/);
assert.doesNotMatch(portrait, /dna_modifiers\s*=\s*\{\s*human\s*=\s*\{/);

const traitPortrait = readPatch("gfx/portraits/trait_portrait_modifiers/zzzz_multi_mod_wyvern_human_form.txt");
assert.match(traitPortrait, /trigger\s*=\s*\{\s*NOT\s*=\s*\{\s*has_character_flag\s*=\s*mm_wyvern_human_form\s*\}/);
assert.match(traitPortrait, /gene\s*=\s*gene_myv_no_portrait\s+template\s*=\s*no_portrait/);

for (const locale of ["english/mm_wyvern_human_form_l_english.yml", "simp_chinese/mm_wyvern_human_form_l_simp_chinese.yml"]) {
  const localization = readPatch("localization/" + locale);
  assert.match(localization, /mm_wyvern_toggle_human_form_interaction:0/);
  assert.match(localization, /mm_wyvern_toggle_human_form_interaction_desc:0/);
}

console.log("Wyvern human-form source, portrait, interface, and identity invariants are structurally present.");

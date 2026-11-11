"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const patchRoot = path.join(projectRoot, "patches", "wyvern");
const manifest = JSON.parse(fs.readFileSync(path.join(patchRoot, "sources.json"), "utf8"));

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalize(text) {
  const hasBom = text.charCodeAt(0) === 0xfeff;
  const withoutBom = hasBom ? text.slice(1) : text;
  const lineEnding = withoutBom.includes("\r\n") ? "\r\n" : "\n";
  return {
    text: withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    hasBom,
    lineEnding
  };
}

function renderLike(text, format) {
  return (format.hasBom ? "\uFEFF" : "") + text.replace(/\n/g, format.lineEnding);
}

function requireContains(text, needle, label) {
  assert.ok(text.includes(needle), label + " is missing: " + needle);
}

function requireCount(text, expression, expected, label) {
  const matches = text.match(expression) || [];
  assert.equal(matches.length, expected, label + " count");
}

function requireNoMergeMarkers(text, label) {
  assert.doesNotMatch(text, /^(?:<<<<<<<|=======|>>>>>>>)(?:\s|$)/m, label + " has unresolved merge markers");
}

function checkDelimiters(text, label) {
  const stack = [];
  const pairs = { "}": "{", "]": "[", ")": "(" };
  let inString = false;
  let escaped = false;
  let inComment = false;

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
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "#") {
      inComment = true;
      continue;
    }
    if (character === "{" || character === "[" || character === "(") {
      stack.push({ character, index });
      continue;
    }
    if (character === "}" || character === "]" || character === ")") {
      const opening = stack.pop();
      assert.ok(opening, label + " has unexpected " + character + " at offset " + String(index));
      assert.equal(opening.character, pairs[character], label + " has mismatched " + character + " at offset " + String(index));
    }
  }

  assert.equal(inString, false, label + " has an unterminated quoted string");
  assert.equal(stack.length, 0, label + " has unclosed " + (stack.length ? stack[stack.length - 1].character : "delimiter"));
}

function findMatchingBrace(text, openIndex) {
  const stack = [];
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (let index = openIndex; index < text.length; index += 1) {
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
    else if (character === "{") stack.push(index);
    else if (character === "}") {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  throw new Error("Unclosed block");
}

function findNamedBlock(text, name) {
  const match = new RegExp("\\b" + name + "\\s*=\\s*\\{").exec(text);
  assert.ok(match, "block missing: " + name);
  const openIndex = text.indexOf("{", match.index);
  return { openIndex, closeIndex: findMatchingBrace(text, openIndex) };
}

function findTypedNamedBlock(text, type, name) {
  const typePattern = new RegExp("\\b" + type + "\\s*=\\s*\\{", "g");
  const namePattern = new RegExp("\\bname\\s*=\\s*\"" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\"");
  let match;
  while ((match = typePattern.exec(text))) {
    const openIndex = text.indexOf("{", match.index);
    const closeIndex = findMatchingBrace(text, openIndex);
    const block = text.slice(match.index, closeIndex + 1);
    if (namePattern.test(block)) return block;
    typePattern.lastIndex = closeIndex + 1;
  }
  assert.fail(type + " block missing: " + name);
}

function assertHanfanCharacterLayout(text, label) {
  const playerHeir = findTypedNamedBlock(text, "widget", "heir_player");
  requireContains(playerHeir, "CharacterWindow.GetCharacter.GetPlayerHeir", label + " player-heir widget");

  const primaryHeir = findTypedNamedBlock(text, "widget", "heir_primary");
  requireContains(primaryHeir, "max_width = 130", label + " primary-heir label width");
  requireContains(primaryHeir, "margin_right = 15", label + " primary-heir label margin");

  const courtTab = findTypedNamedBlock(text, "button_tab", "court_button");
  requireContains(courtTab, 'text = "CV_TAB_COURT"', label + " court-tab label");
  requireContains(courtTab, "max_width = 220", label + " court-tab label width");
  requireContains(courtTab, "CharacterWindow.GetTabItemsCount('court')", label + " court-tab count");
  requireContains(courtTab, "margin_top = 3", label + " court-tab count spacing");

  const subordinateTab = findTypedNamedBlock(text, "button_tab", "subordinates_button");
  requireContains(subordinateTab, 'text = "CV_TAB_SUBORDINATES"', label + " subordinate-tab label");
  requireContains(subordinateTab, "max_width = 220", label + " subordinate-tab label width");
}

function sourceRecord(rootName, relativePath) {
  return manifest.sourceFiles.find((entry) => entry.root === rootName && entry.path === relativePath);
}

const outputFiles = new Map();
for (const output of manifest.outputs) {
  const outputPath = path.join(patchRoot, ...output.path.split("/"));
  const bytes = fs.readFileSync(outputPath);
  assert.equal(sha256(bytes), output.sha256, output.path + " output hash");
  const text = bytes.toString("utf8");
  requireNoMergeMarkers(text, output.path);
  checkDelimiters(text, output.path);
  outputFiles.set(output.path, normalize(text).text);
}

const roots = {
  workshop: process.env.CK3_WORKSHOP_ROOT || manifest.sourceRoots.workshop,
  game: process.env.CK3_GAME_ROOT || manifest.sourceRoots.game
};
let checkedSourceCount = 0;
let skippedSourceCount = 0;
for (const source of manifest.sourceFiles) {
  const sourcePath = path.join(roots[source.root], ...source.path.split("/"));
  if (!fs.existsSync(sourcePath)) {
    skippedSourceCount += 1;
    continue;
  }
  assert.equal(sha256(fs.readFileSync(sourcePath)), source.sha256, source.root + ":" + source.path + " source hash");
  checkedSourceCount += 1;
}

const character = outputFiles.get("mod/gui/window_character.gui");
assert.ok(character, "character-window patch is listed");
const mainContentStart = character.indexOf('name = "main_content"');
assert.notEqual(mainContentStart, -1, "Hanfan main_content remains present");
requireContains(
  character.slice(mainContentStart, mainContentStart + 800),
  "visible = \"[Not( GetScriptedGui('myv_wyvern_character_window').IsShown( GuiScope.SetRoot( CharacterWindow.GetCharacter.MakeScope ).End ) )]\"",
  "host main_content Wyvern visibility gate"
);
requireContains(character, "myv_wyvern_character_view = {}", "Wyvern view integration");
requireContains(character, "hanfan_jiexian = {}", "Hanfan layout divider");
requireCount(character, /hanfan_jiexian\s*=\s*\{\s*\}/g, 1, "Hanfan layout divider");
requireContains(character, "CharacterWindow.GetCharacter.Custom('myv_prowess_breakdown')", "Wyvern prowess tooltip");
requireContains(character, "name = \"myv_bonded_wyverns_with_friends\"", "Wyvern relation bar");
requireContains(character, "name = \"myv_bonded_wyverns_expanded\"", "expanded Wyvern relations");
requireContains(character, "CharacterWindow.ToggleExpandedRelation( 'myv_bonded_wyverns' )", "Wyvern relation expansion control");
requireContains(character, "name = \"mpd_view_hook\"", "MorePersonalityDepth view hook");
requireContains(character, "GetScriptedGui('mpd_gui_roll_xp').Execute", "MorePersonalityDepth XP roll");
assertHanfanCharacterLayout(character, "merged character window");

const hanfanCharacterSource = sourceRecord("workshop", "2592094512/gui/window_character.gui");
if (hanfanCharacterSource) {
  const hanfanCharacterPath = path.join(roots.workshop, ...hanfanCharacterSource.path.split("/"));
  if (fs.existsSync(hanfanCharacterPath)) {
    const hanfanCharacter = normalize(fs.readFileSync(hanfanCharacterPath, "utf8")).text;
    for (const [type, name] of [
      ["widget", "heir_player"],
      ["widget", "heir_primary"],
      ["button_tab", "court_button"],
      ["button_tab", "subordinates_button"]
    ]) {
      assert.equal(
        findTypedNamedBlock(character, type, name),
        findTypedNamedBlock(hanfanCharacter, type, name),
        "Hanfan " + name + " layout is preserved byte-for-byte"
      );
    }
  }
}
assert.throws(
  () => assertHanfanCharacterLayout(character.replace("max_width = 130", ""), "negative layout fixture"),
  /primary-heir label width is missing/
);

const confirmation = outputFiles.get("mod/gui/interaction_confirmation.gui");
assert.ok(confirmation, "interaction-confirmation patch is listed");
requireContains(confirmation, "maximumsize = { 450 60 }", "Wyvern confirmation header sizing");
requireCount(confirmation, /size\s*=\s*\{\s*460\s+42\s*\}/g, 2, "Wyvern confirmation send button sizing");
requireContains(confirmation, "widget_merit_standalone = {}", "Merit confirmation widget");

const finder = outputFiles.get("mod/gui/window_character_finder.gui");
assert.ok(finder, "character-finder patch is listed");
requireContains(finder, "myv_widget_character_list_item_finder = {", "Wyvern character-finder row");
requireContains(finder, "myv_character_finder_your_wyvern", "Wyvern finder labels");
requireContains(finder, 'blockoverride "bottom_right_box"', "Merit bottom-right row override");
requireContains(finder, "widget_merit_standalone = {}", "Merit finder widget");
requireContains(finder, "widget_list_claims = {}", "Finder claims block retained");
requireContains(finder, "datacontext = \"[Character.GetRite]\"", "Finder faith block retained");
requireContains(finder, "datacontext = \"[Character.GetCulture]\"", "Finder culture block retained");

const genes = outputFiles.get("mod/common/genes/05_genes_special_accessories_clothes.txt");
assert.ok(genes, "clothing-gene patch is listed");
requireContains(genes, "religious_eastern_devoted_clothes = {", "OE Eastern clothing gene");
requireContains(genes, "oe_green_hi_nob_si = {", "OE Chinese si clothing gene");
requireContains(genes, "oe_green_hi_nob_zhuang = {", "OE Chinese zhuang clothing gene");
requireCount(genes, /myv_no_clothes_forced\s*=\s*\{/g, 1, "Wyvern forced-clothing block");
const forcedGene = findNamedBlock(genes, "myv_no_clothes_forced");
const forcedBlock = genes.slice(forcedGene.openIndex, forcedGene.closeIndex + 1);
requireContains(forcedBlock, "index = 223", "Wyvern forced-clothing replacement index");
assert.doesNotMatch(forcedBlock, /index\s*=\s*221\b/, "Wyvern block avoids OE's index 221");
requireContains(genes, "oe_green_hi_nob_si = {\n\t\t\t\tindex = 221", "OE index 221 stays assigned to si clothing");

const geneOutputBytes = fs.readFileSync(path.join(patchRoot, "mod", "common", "genes", "05_genes_special_accessories_clothes.txt"));
const geneFormat = normalize(geneOutputBytes.toString("utf8"));
const geneComment = "# Mythical Vanilla: creature portraits must not spawn the vanilla fig-leaf nudity mesh.";
const geneCommentIndex = geneFormat.text.indexOf(geneComment);
assert.notEqual(geneCommentIndex, -1, "Wyvern insertion comment is present");
const geneCommentLineStart = geneFormat.text.lastIndexOf("\n", geneCommentIndex - 1) + 1;
const clothes = findNamedBlock(geneFormat.text, "clothes");
const clothesCloseLineStart = geneFormat.text.lastIndexOf("\n", clothes.closeIndex - 1) + 1;
const restoredGene = geneFormat.text.slice(0, geneCommentLineStart - 1) + geneFormat.text.slice(clothesCloseLineStart);
const oeSource = sourceRecord("workshop", "2506311074/common/genes/05_genes_special_accessories_clothes.txt");
assert.ok(oeSource, "OE source fingerprint is recorded");
assert.equal(sha256(Buffer.from(renderLike(restoredGene, geneFormat), "utf8")), oeSource.sha256, "OE clothing file restores byte-for-byte after removing the one Wyvern block");

assert.throws(
  () => checkDelimiters('widget = { text = "unterminated }', "negative quote fixture"),
  /unterminated quoted string/
);
assert.throws(
  () => checkDelimiters("widget = }", "negative delimiter fixture"),
  /unexpected \}/
);
assert.throws(
  () => requireNoMergeMarkers("<<<<<<< ours\nwidget = {}", "negative merge fixture"),
  /unresolved merge markers/
);
assert.throws(
  () => requireContains(character.replace("myv_wyvern_character_view = {}", ""), "myv_wyvern_character_view = {}", "negative feature fixture"),
  /is missing/
);

const tooltip = outputFiles.get("mod/gui/shared/00_votc_trait_tooltip.gui");
assert.ok(tooltip, "merged trait tooltip is listed");
requireContains(tooltip, "Not( Trait.IsPersonality )", "More Personality Depth XP visibility");
requireContains(tooltip, "Character.GetRite.Self", "current Rite API");
for (const key of ["myv_wyvern_eye_injuries", "myv_wyvern_wing_injuries", "myv_wyvern_hindleg_injuries", "myv_wyvern_tail_injury", "myv_wyvern_harmony", "myv_wyvern_malnutrition"]) requireContains(tooltip, key, "Wyvern track rules");
const restoredTooltip = tooltip.replace("[And( DataModelHasItems( Trait.GetLevelTracks ), Not( Trait.IsPersonality ) )]", "[DataModelHasItems( Trait.GetLevelTracks )]").trimEnd();
assert.equal(sha256(Buffer.from(restoredTooltip.replaceAll("\n", "\r\n"))), manifest.tooltipTemplateHash, "restore original Wyvern tooltip except XP condition");

const dialogueRoot = path.join(projectRoot, "patches/wyvern-votc-dialogue");
const dialogueSources = JSON.parse(fs.readFileSync(path.join(dialogueRoot, "sources.json"), "utf8"));
const dialogue = fs.readFileSync(path.join(dialogueRoot, "mod/common/character_interactions/mcc_interactions.txt"), "utf8");
const originalDialoguePath = path.join(roots.workshop, dialogueSources.source);
if (fs.existsSync(originalDialoguePath)) {
  assert.equal(sha256(fs.readFileSync(originalDialoguePath)), dialogueSources.sha256,
    "review the dialogue tag merge again when the installed VOTC interaction changes");
}
const restoredDialogue = dialogue.replaceAll("\r\n", "\n")
  .replace("\n\tfilter_tags = { myv_wyvern_interaction }", "")
  .replace(/^\t\tscope:(?:actor|recipient) = \{ NOT = \{ has_character_flag = mm_ds_lost_mind \} \}\n/gm, "")
  .replaceAll("\n", "\r\n").trimEnd();
assert.equal((dialogue.match(/has_character_flag = mm_ds_lost_mind/g) || []).length, 2, "lost minds cannot initiate or receive dialogue");
assert.equal(sha256(restoredDialogue), dialogueSources.normalizedSha256,
  "restore the upstream interaction after removing only the Wyvern menu tag and lost-mind guards");
assert.equal((dialogue.match(/filter_tags\s*=\s*\{\s*myv_wyvern_interaction\s*\}/g) || []).length, 1);
requireContains(dialogue, "category = interaction_category_friendly", "VOTC private category");
requireContains(dialogue, "trigger_event = mcc_event_v2.1002", "existing VOTC event entry");
requireContains(dialogue, "start_travel_plan", "existing VOTC distance behavior");
requireNoMergeMarkers(dialogue, "VOTC dialogue interaction");
checkDelimiters(dialogue, "VOTC dialogue interaction");

console.log(
  "Wyvern compatibility: PASS (" + manifest.outputs.length + " outputs, " +
    String(checkedSourceCount) +
    " source hashes checked, " +
    String(skippedSourceCount) +
    " unavailable source hashes skipped; Wyvern/Merit coexistence, Hanfan layout fidelity, index conflict, and OE byte restoration verified)"
);

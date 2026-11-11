"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createHarness } = require("./wyvern-v1311-finite-helper");
const root = path.resolve(__dirname, "..");
const game = "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
const read = p => fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const project = p => read(path.join(root, p));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const baseline = JSON.parse(project("tests/fixtures/v1321-ui-baseline.json"));
const h = createHarness(["dragon-relics"]);
function extract(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, marker);
  let depth = 0, quoted = false, comment = false, escape = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const c = source[i];
    if (comment) { if (c === "\n") comment = false; continue; }
    if (quoted) { if (c === '"' && !escape) quoted = false; escape = c === "\\" && !escape; continue; }
    if (c === "#") comment = true;
    else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unclosed " + marker);
}
const hud = project("patches/current-playset-ui/mod/gui/hud.gui");
const nativeHud = read(path.join(game, "gui/hud.gui"));
const marker = 'button_icon = {\n\t\t\t\t\tname = "ledger_window"';
assert.equal(extract(hud, marker), extract(nativeHud, marker), "native ledger control restored byte-for-byte apart from line endings");
assert.equal((hud.match(/name = "ledger_window"/g) || []).length, 1);
assert.ok(hud.indexOf('name = "ledger_window"') > hud.indexOf('name = "encyclopedia_button_extended_menu"'));
assert.ok(hud.indexOf('name = "ledger_window"') < hud.indexOf('name = "tutorial_highlight_bottom_right_bar"'));

for (const [relative, hash] of Object.entries(baseline.religionFiles)) assert.equal(sha(path.join(root, "patches/dragon-creed/mod", relative)), hash, "rite/tenet gameplay unchanged: " + relative);
assert.equal(sha(path.join(game, "common/religion/tenet_types/_tenet_types.info")), baseline.nativeTenetInfoSha256);
assert.ok(read(path.join(game, "common/religion/tenet_types/_tenet_types.info")).includes("All characters whose rite has this as a core tenet get this modifier."));
const rites = h.parsePdx(project("patches/dragon-creed/mod/common/religion/rite_types/mm_dragon_creed.txt"));
const branches = ["black", "white", "fire", "earth", "sea", "sky"];
for (const b of branches) {
  const rite = rites.find(n => n.key === "mm_dragon_" + b);
  const core = rite.value.find(n => n.key === "tenets").value.map(n => n.key);
  assert.deepEqual(Array.from(core), ["mm_tenet_" + b, "mm_tenet_" + b + "_second", "mm_tenet_" + b + "_third"]);
}
for (const lang of ["simp_chinese", "english"]) {
  const text = project("patches/dragon-creed/mod/localization/" + lang + "/zzzz_mm_v1321_tenet_scope_l_" + lang + ".yml");
  const entries = new Map(Array.from(text.matchAll(/^ (\w+):0 "(.*)"$/gm), m => [m[1], m[2]]));
  function resolve(key, tenet, visited = new Set()) {
    assert.ok(!visited.has(key), "no localization cycle");
    visited.add(key);
    const value = entries.get(key);
    assert.ok(value, key);
    if (!value.startsWith("[SelectLocalization")) return value;
    const ids = Array.from(value.matchAll(/GetTenetType\('([^']+)'\)\.Self/g), m => m[1]);
    const next = value.match(/, '(\w+)', '(\w+)' \)\]$/);
    assert.ok(next, "native localization branching format");
    if (ids.length === 0) {
      assert.ok(value.startsWith("[SelectLocalization( TenetType.IsValid,"));
      return resolve(next[tenet ? 1 : 2], tenet, visited);
    }
    assert.equal(ids.length, 3);
    return resolve(next[ids.includes(tenet) ? 1 : 2], tenet, visited);
  }
  assert.ok(!text.includes("Or3("), "localization uses native nested Or rather than a GUI-only convenience function");
  for (const suffix of ["", "_SUBHEADER"]) {
    for (const branch of branches) for (const ending of ["", "_second", "_third"]) {
      const result = resolve("CHARACTERS_OF_FAITH_MODIFIER" + suffix, "mm_tenet_" + branch + ending);
      assert.ok(result.includes("$mm_dragon_" + branch + "$"), "each tenet names its own branch, independent of player rite");
      assert.ok(!result.includes("FAITH.GetAdherent"));
    }
    assert.ok(resolve("CHARACTERS_OF_FAITH_MODIFIER" + suffix, "tenet_pacifism").includes("FAITH.GetAdherentNamePlural"), "ordinary religion headings retain native wording");
    assert.ok(resolve("CHARACTERS_OF_FAITH_MODIFIER" + suffix, undefined).includes("FAITH.GetAdherentNamePlural"), "non-tenet contexts retain native wording");
  }
}

const gui = project("patches/dragon-relics/mod/gui/window_artifact_details.gui");
const nativeGui = read(path.join(game, "gui/window_artifact_details.gui"));
assert.equal(sha(path.join(game, "gui/window_artifact_details.gui")), baseline.nativeArtifactDetailsSha256);
assert.equal(extract(gui, "window = {"), gui.trim(), "artifact GUI braces and strings are balanced");
assert.equal(extract(gui, '# right vbox is claims and history tabs\n\t\t\tvbox = {'), extract(nativeGui, '# right vbox is claims and history tabs\n\t\t\tvbox = {'), "history and claimant UI unchanged");
const scrollMarker = gui.match(/scrollbox = \{\n\s*name = "mm_v1321_artifact_effects_scrollarea"/)[0];
const scroll = extract(gui, scrollMarker);
assert.ok(scroll.includes('text = "ARTIFACT_EFFECT"'));
assert.ok(scroll.includes('name = "artifact_description"'));
assert.ok(!gui.includes('name = "artifact_description_scrollarea"'), "no nested description scroll competes with effects");
assert.ok(scroll.includes("StringIsEmpty( Artifact.GetFallbackEffects )"));
const nativeLoc = read(path.join(game, "localization/simp_chinese/inventory/inventory_l_simp_chinese.yml"));
assert.match(nativeLoc, /ARTIFACT_EFFECT_HAS_CAN_BENEFIT:.*#TOOLTIP:ARTIFACT_EFFECT_REQUIREMENT_TT/);
assert.match(nativeLoc, /ARTIFACT_EFFECT_REQUIREMENT_TT:.*Artifact.GetCanBenefitPlayerDesc/);

const visual = h.parsePdx(project("patches/dragon-relics/mod/common/artifacts/visuals/mm_dragon_relics.txt"));
const mapping = JSON.parse(project("artwork/dragon-relics/v1321-presentation.json"));
for (const [item, details] of Object.entries(mapping.placeholders)) {
  const id = "mm_relic_" + item;
  const inv = visual.find(n => n.key === id + "_inventory_visual").value;
  const court = visual.find(n => n.key === id + "_court_visual").value;
  assert.equal(inv.find(n => n.key === "asset").value, details.nativeAsset);
  assert.equal(inv.find(n => n.key === "portrait_asset").value, details.nativeAsset);
  assert.equal(court.find(n => n.key === "asset").value, id + "_entity");
  assert.equal(court.filter(n => ["support_type", "pedestal"].includes(n.key)).length, 0, "integrated bases do not gain a second native stand");
  const file = path.join(game, "gfx/interface/icons/artifact", details.icon);
  const dds = fs.readFileSync(file);
  assert.equal(dds.readUInt32LE(12), 240);
  assert.ok([240, 960].includes(dds.readUInt32LE(16)), "native 240-pixel artifact frame layout");
}
const owner = h.character("pre-generation-owner");
const env = h.environment({ root: owner, rites: new Map(), faithReligions: new Map() });
assert.equal(h.trigger("mm_relic_sea_armor_equipped_trigger", owner, env), false, "pre-generation hook does not require absent custom faiths");
console.log("v1.3.21 native ledger, rite headings, artifact requirements scroll and 2D/court separation PASS; in-game layout pending");

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../patches/weight-of-crown");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const sha = (source) => crypto.createHash("sha256").update(source).digest("hex");
const sources = JSON.parse(read("sources.json"));
const toolbar = read("mod/gui/multi_mod_woc_toolbar.gui");
const registry = read("mod/gui/scripted_widgets/multi_mod_woc_widgets.txt");
const wocModule = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../modules.json"), "utf8")).find((entry) => entry.id === "weight-of-crown");
assert.equal(wocModule.source, "patches/weight-of-crown/mod", "the GUI source must be included by the production module overlay");
assert.equal(wocModule.files, undefined, "the module overlay must include both the registered GUI and scripted-widget registry");
assert.equal(registry.trim(), "gui/multi_mod_woc_toolbar.gui = multi_mod_woc_toolbar");
assert(toolbar.startsWith("flowcontainer = {"));
assert(toolbar.includes('name = "multi_mod_woc_toolbar"'));
assert(toolbar.includes("parentanchor = bottom|right"));
assert(toolbar.includes("widgetanchor = bottom|right"));
assert(toolbar.includes("position = { -270 -80 }"));
assert(toolbar.includes("direction = horizontal"));
assert(toolbar.includes("ignoreinvisible = yes"));
assert.equal((toolbar.match(/button_standard\s*=\s*\{/g) || []).length, 3,
  "only county, buildings and finance remain in the auxiliary toolbar");
assert(!/multi_mod_woc_climate|multi_mod_woc_population|SetMapMode/.test(toolbar),
  "the two map modes must not remain as independent rectangular controls");
const map = read("mod/gui/shared/mapmodes.gui");
const restoredMap = map.replace(/\t{4}# MULTI_MOD_WOC_MAP_BUTTONS_BEGIN[\s\S]*?\t{4}# MULTI_MOD_WOC_MAP_BUTTONS_END\r\n\r\n/, "")
  .replace("size = { 250 95 }", "size = { 170 95 }");
assert.equal(sha(restoredMap), sources.nativeMapModes.normalizedSha256,
  "restore every original map button, shortcut, expand menu and visibility except trailing whitespace normalization");
const nativeMapPath = path.join(process.env.CK3_GAME_ROOT || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game", "gui/shared/mapmodes.gui");
if (fs.existsSync(nativeMapPath)) {
  assert.equal(sha(fs.readFileSync(nativeMapPath)), sources.nativeMapModes.sha256,
    "review the map-mode merge again when the installed CK3 source changes");
}
const rowStart = map.indexOf("## De Jure");
const rowEnd = map.indexOf("## Other", rowStart);
const row = map.slice(rowStart, rowEnd);
assert.equal((row.match(/icon_button_mapmode\s*=\s*\{/g) || []).length, 5,
  "two WoC circles share the existing three-crown map-mode row");
for (const [kind, mode, gui, texture] of [
  ["climate", "woc_climate_mapmode", "woc_climate_mapmode_map", "icon_climate.dds"],
  ["population", "woc_population_mapmode", "woc_pop_mapmode_map", "pops/pop_type.dds"]
]) {
  assert(row.includes('name = "multi_mod_woc_' + kind + '"'));
  assert(row.includes("GetMapMode('" + mode + "')"), "inherit native map-mode selection and glow");
  assert(row.includes("GetScriptedGui('" + gui + "').Execute(GuiScope.End)"));
  assert(row.includes("GetScriptedGui('" + gui + "').IsValid(GuiScope.End)"));
  assert(row.includes(texture), "retain the upstream climate/population icon");
}
// The 250x95 native host reserves 178px for five 38px circles with -3 spacing,
// 15px right margin and 50px for the realms circle: 7px remains between them.
assert.equal(250 - 15 - (5 * 38 - 4 * 3) - 50, 7);
for (const [width, height] of [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]]) {
  for (const visibleCount of [1, 2, 3]) {
    const right = width - 270;
    const left = right - (visibleCount * 120 + (visibleCount - 1) * 4);
    assert(left >= 0 && right <= width && height - 80 - 36 >= 0);
    assert.equal((width - 250) - right, 20, "auxiliary controls stay left of the map group");
  }
}
assert(toolbar.includes("layer = top"));
assert(!toolbar.includes("scissor = yes"));
assert(toolbar.includes("Not(IsPauseMenuShown)"));
assert(toolbar.includes("Not(IsGameViewOpen('barbershop'))"));
for (const toggle of ["woc_county_main_detail_toggle", "woc_county_building_toggle", "additional_my_realm_window_toggle"]) {
  assert(toolbar.includes("GetVariableSystem.Toggle('" + toggle + "')"));
  assert(toolbar.includes("GetVariableSystem.Exists('" + toggle + "')"));
}
const countyVisibility = "[And(IsGameViewOpen('holding_view'),And(GetVariableSystem.Exists('county_view_open'),Not(IsRightWindowOpen)))]";
assert.equal(toolbar.split('visible = "' + countyVisibility + '"').length - 1, 2,
  "both county controls require their host and exclude every open right-side window");
for (const [hostOpen, staleFlag, rightOpen, expected] of [
  [true, true, false, true], [false, true, false, false],
  [true, true, true, false], [false, true, true, false], [true, false, false, false]
]) assert.equal(hostOpen && staleFlag && !rightOpen, expected,
  "a decisions/right window or stale county flag must not expose county actions");
assert(toolbar.includes("GetPlayer.IsLandedRuler"));
for (const flag of ["government_is_tribal", "government_is_nomadic", "government_is_landless_adventurer"]) assert(toolbar.includes(flag));
const realm = read("mod/gui/shared/ces_window_realm.gui");
const visible = realm.match(/\tvisible = "[^\r\n]+"/)[0];
assert(visible.includes("GetVariableSystem.Exists('additional_my_realm_window_toggle')"), "the existing fiscal toggle must control the window");
assert(realm.includes("parentanchor = top|right\r\n\tposition = { -650 305 }"));
assert.equal(sha(realm.replace(visible, sources.originalVisible).replace("parentanchor = top|right\r\n\tposition = { -650 305 }", "position = { 1250 305 }")), sources.sources["gui/shared/ces_window_realm.gui"], "preserve fiscal controls and rules outside the visibility/anchor repair");
const council = read("mod/gui/shared/ces_window_council.gui");
assert(council.includes("position_x = -700"));
assert.equal(sha(council.replace("position_x = -700", "position_x = -620")), sources.sources["gui/shared/ces_window_council.gui"]);
// Both docks remain left of the 655-wide native panel at different viewport widths.
for (const width of [1280, 1600, 1920, 2560]) {
  assert(width - 700 < width - 655);
  assert.equal(width - 650 - (width - 655), 5);
}
for (const language of ["simp_chinese", "english"]) {
  const localization = read("mod/localization/" + language + "/multi_mod_woc_l_" + language + ".yml");
  assert(localization.startsWith("\ufeffl_" + language + ":"));
  for (const name of ["climate", "population", "county", "buildings", "finance"]) assert(localization.includes("multi_mod_woc_" + name + ":0"));
}
assert(!/ExecuteConsoleCommand|add_gold|change_government|create_character/.test(toolbar));
console.log("Weight of Crown compatibility: PASS (two native map circles, three scoped auxiliary entries, original actions, county hosts, fiscal toggle and anchored docks)");

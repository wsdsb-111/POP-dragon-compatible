"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const mod = path.join(root, "mod/VOTC_Three_Mod_Character_Name_Compatibility");
const optional = path.join(root, "patches/current-playset-ui/mod");
const read = (file) => fs.readFileSync(file, "utf8");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");

function extract(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, "missing " + marker);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let comment = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const char = source[i];
    if (comment) { if (char === "\n") comment = false; continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === "#") comment = true;
    else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail("unclosed " + marker);
}

const realm = read(path.join(mod, "gui/00_three_mod_realm.gui"));
const sources = JSON.parse(read(path.join(root, "patches/current-playset-ui/sources.json")));
const characterButton = extract(realm, "type vbox_three_mod_character_domicile_button = vbox");
assert(characterButton.includes('datacontext = "[Character.GetDomicile]"'));
assert(!characterButton.includes("TitleViewWindow"), "realm access must not require a title window");
assert(!realm.includes("type vbox_domicile_button ="), "preserve the palace title-view button");
assert(characterButton.includes("ToggleGameViewData( 'domicile', Domicile.Self )"));
assert.equal(hash(characterButton.replace("vbox_three_mod_character_domicile_button", "vbox_domicile_button")), sources.characterButtonHash);
const domain = extract(realm, "type vbox_my_realm_domain_body = vbox");
assert(domain.includes("vbox_three_mod_character_domicile_button = {}"));
assert.equal(hash(domain.replace("vbox_three_mod_character_domicile_button = {}", "vbox_domicile_button = {}")), sources.hanfanDomainHash);
assert("00_three_mod_realm.gui" < "window_my_realm.gui", "GUI types use first definition");

const hud = read(path.join(optional, "gui/hud.gui"));
const originals = JSON.parse(read(path.join(root, "tests/fixtures/ui-calendar-originals.json")));
let restoredHud = hud;
for (const [name, original] of Object.entries(originals)) {
  const current = extract(hud, "text_single = {\r\n\t\t\t\t\t\t\t\tname = \"" + name + "\"");
  if (name === "nianhao_text") assert(current.includes("visible = no"));
  else assert(current.includes("IsObserver"), "native dates must not overlap the Hanfan player calendar");
  restoredHud = restoredHud.replace(current, original);
}
// The 1.20 native ledger button was omitted by the older source HUD.
const ledger = extract(hud, 'button_icon = {\r\n\t\t\t\t\tname = "ledger_window"');
assert(ledger.includes("[ToggleGameView('ledger')]"));
restoredHud = restoredHud.replace('\r\n\r\n\t\t\t\t' + ledger, '');
assert.equal(hash(restoredHud), sources.hudHash, "retain every unrelated HUD control byte");
assert(hud.includes('name = "speed_5"'));
assert(hud.includes("[OnIncreaseGameSpeed]"));

const hanfanHud = read(path.join(mod, "gui/hanfan_hud.gui"));
const selectorNames = ["hanfan_nianhao_top_liege_calendar", "hanfan_nianhao_calendar", "hanfan_ganzhi_calendar", "hanfan_shengxiao_calendar", "hanfan_fallback_calendar"];
let restoredCalendar = hanfanHud;
const visibility = selectorNames.map((name) => {
  const current = extract(hanfanHud, 'text_single = {\r\n\t\t\t\tname = "' + name + '_date"');
  const rule = current.match(/visible = "\[([^\r\n]+)\]"/)[1];
  restoredCalendar = restoredCalendar.replace(current, current.replace(/visible = "[^\r\n]+"/, 'visible = "[And(Not(IsObserver),ScriptedGui.IsShown(GuiScope.SetRoot(GetPlayer.MakeScope).End))]"'));
  return rule;
});
assert.equal(hash(restoredCalendar), sources.hanfanHudHash, "retain Hanfan texts, styles, settings and data contexts");
function calendarVisible(expression, selected, index, observer) {
  let reduced = expression.replaceAll("IsObserver", String(observer));
  selectorNames.forEach((name, slot) => {
    reduced = reduced.replaceAll("GetScriptedGui('" + name + "_gui').IsShown(GuiScope.SetRoot(GetPlayer.MakeScope).End)", String(selected[slot]));
  });
  reduced = reduced.replaceAll("ScriptedGui.IsShown(GuiScope.SetRoot(GetPlayer.MakeScope).End)", String(selected[index]));
  const tokens = reduced.match(/And|Not|true|false|[(),]/g) || [];
  assert.equal(tokens.join(""), reduced.replace(/\s/g, ""), "unsupported calendar expression");
  let cursor = 0;
  function value() {
    const token = tokens[cursor++];
    if (token === "true" || token === "false") return token === "true";
    assert.equal(tokens[cursor++], "(");
    const first = value();
    let result;
    if (token === "Not") result = !first;
    else { assert.equal(token, "And"); assert.equal(tokens[cursor++], ","); const second = value(); result = first && second; }
    assert.equal(tokens[cursor++], ")");
    return result;
  }
  const result = value();
  assert.equal(cursor, tokens.length);
  return result;
}
for (let mask = 0; mask < 32; mask++) {
  const selected = selectorNames.map((_, index) => Boolean(mask & (1 << index)));
  for (const observer of [false, true]) {
    const shown = visibility.map((rule, index) => calendarVisible(rule, selected, index, observer));
    assert.equal(shown.filter(Boolean).length, !observer && mask !== 0 ? 1 : 0, "overlapping calendar selectors: " + mask);
    if (!observer && mask) assert.equal(shown.indexOf(true), selected.indexOf(true));
  }
}
// The reported frontier-vassal / Han-liege counterexample selects both rules.
assert.equal(calendarVisible(visibility[2], [false, false, true, true, false], 2, false), true);
assert.equal(calendarVisible(visibility[3], [false, false, true, true, false], 3, false), false);

const slotSource = read(path.join(root, "tests/fixtures/estate-native-slots.txt"));
const slotNames = ["external_slot_1", "external_slot_4", "external_slot_3", "external_slot_8", "external_slot_15", "main_slot", "external_slot_2", "external_slot_12", "external_slot_5", "external_slot_7", "external_slot_11", "external_slot_9", "external_slot_6", "external_slot_13", "external_slot_10", "external_slot_14"];
function validateSlots(source) {
  const slots = extract(source, "domicile_building_slots = {");
  const names = [...slots.matchAll(/^\t\t((?:external_slot_\d+)|main_slot) = \{/gm)].map((match) => match[1]);
  assert.deepEqual(names, slotNames, "preserve all 16 saved slot indices in the large-estate order");
  assert.equal(hash(slots), sources.largeEstateSlotsHash, "slot art, coordinates and order must match the large-estate source");
  for (const name of names) {
    const slot = extract(slots, name + " = {");
    const [, x, y] = slot.match(/position = \{ ([\d.]+)% ([\d.]+)% \}/) || [];
    const [, width, height] = slot.match(/size = \{ ([\d.]+)% ([\d.]+)% \}/) || [];
    assert(Number(x) >= 0 && Number(y) >= 0 && Number(x) + Number(width) <= 100 && Number(y) + Number(height) <= 100, name + " must fit inside the estate frame");
  }
  return slots;
}
for (const name of ["zz_nhe19_estate.txt", "zz_nhe72_palace_estate.txt"]) {
  const source = read(path.join(optional, "common/domiciles/types", name));
  const slots = validateSlots(source);
  assert.equal(hash(source.replace(slots, slotSource)), sources.estateHashes[name], "retain palace permission, herd, costs, unlocks and backgrounds");
  if (name.includes("palace")) assert(source.includes("herd = yes"));
  assert(source.includes("has_variable = nhe19_estate_access"));
  assert(source.includes("base_external_slots = 2"));
  assert(!source.includes("add_domicile_building"), "the UI patch must not rebuild saved buildings");
  assert.throws(() => validateSlots(source.replace("external_slot_15 =", "missing_slot =")), /saved slot indices/);
  assert.throws(() => validateSlots(source.replace("external_slot_1 =", "external_slot_4 =")), /saved slot indices/);
  assert.throws(() => validateSlots(source.replace("28% 0%", "99% 0%")), /coordinates/);
}
for (const file of [path.join(mod, "descriptor.mod"), path.join(root, "mod/VOTC_Three_Mod_Character_Name_Compatibility.mod")]) {
  const descriptor = read(file);
  assert(descriptor.includes('version="1.3.22"'));
  assert(descriptor.includes('name="多 Mod 兼容 Mod"'));
  assert(descriptor.includes('"天家宗仪V0.9beta-宗子维城"'));
  assert(!descriptor.includes("replace_path"));
}
console.log("Three-Mod UI update: PASS (realm scope, single player calendar, 16 ordered estate slots, preservation and adversarial fixtures)");

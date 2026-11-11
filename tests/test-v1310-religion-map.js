"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const game = "D:/SteamLibrary/steamapps/common/Crusader Kings III/game/gui/map_icon_layer.gui";
const wyvern = "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052/gui/map_icon_layer.gui";
const overlay = path.resolve(__dirname, "../patches/dragon-map-performance/mod/gui/map_icon_layer.gui");
const read = file => fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const native = read(game);
let expected = read(wyvern);
const actual = read(overlay);
function replaceExactly(oldText, newText, count = 1) {
  assert.equal(expected.split(oldText).length - 1, count, `unexpected source occurrences: ${oldText}`);
  expected = expected.split(oldText).join(newText);
}
const nativeBindings = [
  'name = "religious_head_widget"',
  '[ReligiousHeadMapIcon.GetCharacter]',
  '[ReligiousHeadMapIcon.IsHeadOfFaith]',
  '[Not( ReligiousHeadMapIcon.IsHeadOfFaith )]',
  '[Not( GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' ) )]',
  '[And( HolySiteItem.IsHeldByFaith, Not( GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' ) ) )]',
  '[Nor( HolySiteItem.IsHeldByFaith, GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' ) )]',
  '[GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' )]'
];
for (const binding of nativeBindings) assert(native.includes(binding), `missing native binding: ${binding}`);
replaceExactly('### Landless Head of Faith / Head of Rite Map Icon', '### Head of Faith / Head of Rite Map Icon');
replaceExactly('name = "landless_religious_head_widget"', 'name = "religious_head_widget"');
replaceExactly('LandlessReligiousHeadMapIcon', 'ReligiousHeadMapIcon', 3);
const holyStart = expected.indexOf('name = "holy_site_widget"');
const holyEnd = expected.indexOf('###', holyStart);
assert(holyStart >= 0 && holyEnd > holyStart);
const holyBefore = expected.slice(0, holyStart);
const holyAfter = expected.slice(holyEnd);
expected = expected.slice(holyStart, holyEnd);
replaceExactly('parentanchor = hcenter\n\t\tbackground = {', 'parentanchor = hcenter\n\n\t\tvisible = "[Not( GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' ) )]"\n\n\t\tbackground = {');
replaceExactly('visible = "[HolySiteItem.IsHeldByFaith]"\n\t\ttext', 'visible = "[And( HolySiteItem.IsHeldByFaith, Not( GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' ) ) )]"\n\t\ttext');
replaceExactly('visible = "[Not( HolySiteItem.IsHeldByFaith )]"\n\t\ttext', 'visible = "[Nor( HolySiteItem.IsHeldByFaith, GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' ) )]"\n\t\ttext');
expected = holyBefore + expected + holyAfter;
// Scope the zoom replacement to the religious head widget, not other map icons.
const marker = '### Head of Faith / Head of Rite Map Icon';
const index = expected.indexOf(marker);
assert(index >= 0);
const before = expected.slice(0, index);
expected = expected.slice(index);
replaceExactly('visible = "[LessThan_int32( GetZoomLevel, \'(int32)19\' )]"', 'visible = "[GetVariableSystem.Exists( \'faith_map_mode_religious_heads\' )]"');
expected = before + expected;
assert.equal(actual, expected, "overlay must contain only the specified changes to Wyvern");
console.log("Religion map overlay static comparison passed; runtime performance is not measured.");

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const modRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const originTraitPath = path.join(modRoot, "common", "traits", "zzzz_mm_wyvern_capture_traits.txt");
const positiveKeys = [
  "health",
  "character_travel_safety",
  "character_travel_speed",
  "enemy_hostile_scheme_success_chance_add",
  "stress_gain_mult",
];
const frozenNativeValues = {
  myv_wyvern_tamed: {
    life_expectancy: 100,
    health: 3,
    character_travel_safety: 1000,
    character_travel_speed: 200,
    enemy_hostile_scheme_success_chance_add: -100,
    stress_gain_mult: -1,
  },
  myv_wyvern_legendary: {
    life_expectancy: 300,
    health: 5,
    character_travel_safety: 1000,
    character_travel_speed: 200,
    enemy_hostile_scheme_success_chance_add: -100,
    stress_gain_mult: -1,
  },
};
const frozenRestrictions = {
  fertility: "-1000",
  can_have_children: "no",
  inheritance_blocker: "all",
  claim_inheritance_blocker: "all",
  disables_combat_leadership: "yes",
};
const traitMetadataKeys = new Set([
  "icon",
  "physical",
  "opposites",
  "shown_in_ruler_designer",
  "random_creation",
  "birth",
  "potential",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^()|[\]\\]/g, "\\$&");
}

function extractBlock(source, name, label) {
  const match = new RegExp("^[\\t ]*" + escapeRegex(name) + "\\s*=\\s*\\{", "m").exec(source);
  assert.ok(match, label + " is missing " + name);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let comment = false;
  for (let index = source.indexOf("{", match.index); index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === "\n") comment = false;
    } else if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === "#") comment = true;
    else if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  assert.fail(label + " has an unclosed " + name + " block");
}

function scalar(block, key, label) {
  const match = new RegExp("^[\\t ]*" + escapeRegex(key) + "\\s*=\\s*([^\\s{}#]+)", "m").exec(block);
  assert.ok(match, label + " is missing " + key);
  return match[1];
}

function maybeScalar(block, key) {
  const match = new RegExp("^[\\t ]*" + escapeRegex(key) + "\\s*=\\s*([^\\s{}#]+)", "m").exec(block);
  return match ? match[1] : undefined;
}

function topLevelKeys(block) {
  const keys = [];
  let depth = 0;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0];
    if (depth === 1) {
      const match = /^[\t ]*([A-Za-z0-9_]+)\s*=/.exec(line);
      if (match) keys.push(match[1]);
    }
    for (const character of line) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
  }
  return keys;
}

function traitNumbers(block, label) {
  const values = {};
  for (const key of positiveKeys) values[key] = Number(scalar(block, key, label));
  return values;
}

function assertFrozenNativeTrait(block, name) {
  const actual = traitNumbers(block, name);
  assert.equal(Number(scalar(block, "life_expectancy", name)), frozenNativeValues[name].life_expectancy,
    name + " changed its frozen native life expectancy");
  for (const key of positiveKeys) {
    assert.equal(actual[key], frozenNativeValues[name][key],
      name + " changed its frozen native " + key + " value");
  }
  for (const [key, expected] of Object.entries(frozenRestrictions)) {
    assert.equal(scalar(block, key, name), expected, name + " must retain native " + key);
  }
  const flags = [...block.matchAll(/^[\t ]*flag[\t ]*=[\t ]*([^\s{}#]+)/gm)].map(match => match[1]);
  assert.ok(flags.includes("can_not_marry"), name + " must retain its native marriage restriction");
  assert.ok(flags.includes("immune_to_disease"), name + " must retain native disease immunity");
}

const originSource = fs.readFileSync(originTraitPath, "utf8");
const originTrait = extractBlock(originSource, "mm_wyvern_legendary_origin", "origin trait source");
assert.equal(maybeScalar(originTrait, "life_expectancy"), undefined,
  "origin does not add an obsolete lifespan modifier to an already immortal species");
assert.equal(Number(scalar(originTrait, "health", "origin trait")), 2);
const originModifiers = topLevelKeys(originTrait).filter(key => !traitMetadataKeys.has(key)).sort();
assert.deepEqual(originModifiers, ["health"],
  "origin may add only the health difference already absent from Tamed Wyvern");
for (const key of Object.keys(frozenRestrictions)) {
  assert.equal(maybeScalar(originTrait, key), undefined, "origin must not add " + key);
}
assert.ok(!/^[\t ]*flag[\t ]*=[\t ]*can_not_marry\b/m.test(originTrait),
  "origin must not add the marriage restriction");
assert.ok(!/^[\t ]*flag[\t ]*=/m.test(originTrait),
  "origin must not add trait flags or identity restrictions");

const nativeModRoot = process.env.CK3_WYVERN_MOD_DIR
  ? path.resolve(process.env.CK3_WYVERN_MOD_DIR)
  : "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
const nativeTraitsPath = path.join(nativeModRoot, "common", "traits", "myv_wyvern_traits.txt");
let tamedTrait = null;
let legendaryTrait = null;
if (fs.existsSync(nativeTraitsPath)) {
  const nativeSource = fs.readFileSync(nativeTraitsPath, "utf8");
  tamedTrait = extractBlock(nativeSource, "myv_wyvern_tamed", "installed native trait source");
  legendaryTrait = extractBlock(nativeSource, "myv_wyvern_legendary", "installed native trait source");
  assertFrozenNativeTrait(tamedTrait, "myv_wyvern_tamed");
  assertFrozenNativeTrait(legendaryTrait, "myv_wyvern_legendary");
} else {
  tamedTrait = frozenNativeValues.myv_wyvern_tamed;
  legendaryTrait = frozenNativeValues.myv_wyvern_legendary;
}

function positiveValues(trait, label) {
  const values = {};
  for (const key of positiveKeys) {
    values[key] = typeof trait[key] === "number" ? trait[key] : Number(scalar(trait, key, label));
  }
  return values;
}

function assertPositiveTotals(tamedValues, originValues, legendaryValues, label) {
  for (const key of positiveKeys) {
    assert.equal(tamedValues[key] + (originValues[key] || 0), legendaryValues[key],
      label + " must equal the native legendary " + key + " total exactly once");
  }
}

const activeTraitSource = fs.readFileSync(
  path.join(modRoot, "common", "traits", "zzzzz_mm_wyvern_species_health.txt"), "utf8");
const activeNormalTrait = extractBlock(activeTraitSource, "myv_wyvern", "active species override");
const activeTamedTrait = extractBlock(activeTraitSource, "myv_wyvern_tamed", "active species override");
const activeLegendaryTrait = extractBlock(activeTraitSource, "myv_wyvern_legendary", "active species override");
const tamedValues = positiveValues(activeTamedTrait, "active Tamed Wyvern");
const legendaryValues = positiveValues(activeLegendaryTrait, "active Legendary Wyvern");
assert.equal(Number(scalar(activeNormalTrait, "life_expectancy", "active Wyvern")), 200,
  "active ordinary wyvern has a 200-year life expectancy");
assert.equal(Number(scalar(activeTamedTrait, "life_expectancy", "active Tamed Wyvern")), 200,
  "active tamed wyvern has a 200-year life expectancy");
assert.equal(Number(scalar(activeLegendaryTrait, "life_expectancy", "active Legendary Wyvern")), 666,
  "raw legendary species keeps the royal-only ageless lifespan sentinel");
for (const [trait, name] of [[activeNormalTrait, "ordinary Wyvern"], [activeTamedTrait, "tamed Wyvern"]]) {
  assert.equal(maybeScalar(trait, "immortal"), undefined, name + " is not immortal");
  assert.equal(maybeScalar(trait, "no_prowess_loss_from_age"), undefined, name + " may age normally");
  assert.notEqual(Number(maybeScalar(trait, "elderly_health")), 666, name + " has no immortality health sentinel");
  for (const flag of ["is_immortal", "immortal_visuals", "immortal_incapability"]) {
    assert.ok(!new RegExp("^[\\t ]*flag[\\t ]*=[\\t ]*" + escapeRegex(flag) + "\\b", "m").test(trait),
      name + " does not carry " + flag);
  }
}
assert.equal(scalar(activeLegendaryTrait, "immortal", "active Legendary Wyvern"), "yes",
  "raw legendary species retains the immortal trait for the fixed royal roster");
const originValues = {};
for (const key of positiveKeys) originValues[key] = Number(maybeScalar(originTrait, key) || 0);
assertPositiveTotals(tamedValues, originValues, legendaryValues, "active tamed species plus origin");
assert.throws(() => assertPositiveTotals(tamedValues,
  { ...originValues, character_travel_speed: 200 }, legendaryValues, "duplicated travel speed"),
/character_travel_speed/, "origin must not double the Tamed Wyvern travel speed");
assert.throws(() => assertPositiveTotals(tamedValues,
  { ...originValues, stress_gain_mult: -2 }, legendaryValues, "duplicated stress modifier"),
/stress_gain_mult/, "origin must not double the Tamed Wyvern stress modifier");
assert.equal(maybeScalar(originTrait, "life_expectancy"), undefined,
  "legendary bloodline does not add a second life expectancy modifier");

function localizedDescription(filePath, key) {
  const source = fs.readFileSync(filePath, "utf8");
  const match = new RegExp("^[\\t ]*" + escapeRegex(key) + ":0[\\t ]*\"([^\\r\\n]*)\"", "m").exec(source);
  assert.ok(match, filePath + " is missing " + key);
  return match[1];
}

const englishDescription = localizedDescription(
  path.join(modRoot, "localization", "english", "mm_wyvern_capture_l_english.yml"),
  "trait_mm_wyvern_legendary_origin_desc"
);
const chineseDescription = localizedDescription(
  path.join(modRoot, "localization", "simp_chinese", "mm_wyvern_capture_l_simp_chinese.yml"),
  "trait_mm_wyvern_legendary_origin_desc"
);
for (const phrase of [
  "Combined positive effects with Tamed Wyvern",
  "Health: #P +5",
  "Life expectancy: #P +200 years",
  "Stress gain: #P -100%",
  "Enemy hostile scheme initial success chance: #P -100%",
  "Travel speed: #P +200",
  "Travel safety: #P +1000",
  "Retains disease immunity",
  "not additional stacking bonuses",
  "only adds the health difference",
  "adds no fertility, marriage or title inheritance restrictions",
]) {
  assert.ok(englishDescription.includes(phrase), "English origin description must include " + phrase);
}
for (const phrase of [
  "与“已驯服飞龙”合计的正面效果",
  "健康：#P +5",
  "预期寿命：#P +200年",
  "压力增加值：#P -100%",
  "敌方阴谋初始成功率：#P -100%",
  "旅行速度：#P +200",
  "旅行安全性：#P +1000",
  "保留疾病免疫",
  "不会重复叠加",
  "血统只补足健康差额",
  "不附加生育、婚姻或头衔继承限制",
]) {
  assert.ok(chineseDescription.includes(phrase), "Chinese origin description must include " + phrase);
}

function alphaPalette(bytes, offset) {
  const alpha0 = bytes[offset];
  const alpha1 = bytes[offset + 1];
  const palette = [alpha0, alpha1];
  if (alpha0 > alpha1) {
    for (let index = 2; index < 8; index += 1) {
      palette[index] = Math.floor(((8 - index) * alpha0 + (index - 1) * alpha1) / 7);
    }
  } else {
    for (let index = 2; index < 6; index += 1) {
      palette[index] = Math.floor(((6 - index) * alpha0 + (index - 1) * alpha1) / 5);
    }
    palette[6] = 0;
    palette[7] = 255;
  }
  return palette;
}

function ddsAlphaProfile(bytes, label) {
  assert.ok(bytes.length >= 128, label + " DDS header is truncated");
  assert.equal(bytes.toString("ascii", 0, 4), "DDS ", label + " is missing DDS magic");
  assert.equal(bytes.readUInt32LE(4), 124, label + " has an invalid DDS header");
  assert.equal(bytes.readUInt32LE(76), 32, label + " has an invalid pixel format");
  assert.equal(bytes.toString("ascii", 84, 88), "DXT5", label + " must use DXT5 alpha");
  const width = bytes.readUInt32LE(16);
  const height = bytes.readUInt32LE(12);
  assert.equal(width, 240, label + " must be 240 pixels wide");
  assert.equal(height, 240, label + " must be 240 pixels tall");
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  assert.ok(bytes.length >= 128 + blocksWide * blocksHigh * 16, label + " base mip is truncated");
  const corners = {
    "top-left": null,
    "top-right": null,
    "bottom-left": null,
    "bottom-right": null,
  };
  let transparent = 0;
  let opaque = 0;
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const offset = 128 + (blockY * blocksWide + blockX) * 16;
      const palette = alphaPalette(bytes, offset);
      const alphaBits = bytes.readUIntLE(offset + 2, 6);
      for (let pixelY = 0; pixelY < 4; pixelY += 1) {
        for (let pixelX = 0; pixelX < 4; pixelX += 1) {
          const x = blockX * 4 + pixelX;
          const y = blockY * 4 + pixelY;
          const pixelIndex = pixelY * 4 + pixelX;
          const alphaIndex = Math.floor(alphaBits / (2 ** (pixelIndex * 3))) % 8;
          const alpha = palette[alphaIndex];
          if (alpha <= 8) transparent += 1;
          if (alpha >= 247) opaque += 1;
          if (x === 0 && y === 0) corners["top-left"] = alpha;
          if (x === width - 1 && y === 0) corners["top-right"] = alpha;
          if (x === 0 && y === height - 1) corners["bottom-left"] = alpha;
          if (x === width - 1 && y === height - 1) corners["bottom-right"] = alpha;
        }
      }
    }
  }
  return { width, height, transparentFraction: transparent / (width * height), opaque, corners };
}

const materialSourcePath = path.join(projectRoot, "artwork", "wyvern-trophies", "material-icons-v118-transparent.png");
const materialSource = fs.readFileSync(materialSourcePath);
assert.equal(materialSource.toString("hex", 0, 8), "89504e470d0a1a0a", "material source must be a PNG");
assert.equal(materialSource.readUInt32BE(16), 1774, "material source must retain two side-by-side square panels");
assert.equal(materialSource.readUInt32BE(20), 887, "material source panels must remain square");
assert.equal(materialSource[25], 6, "material source PNG must retain its RGBA alpha channel");
const iconBuilder = fs.readFileSync(path.join(projectRoot, "scripts", "build-dragon-material-icons.py"), "utf8");
assert.ok(iconBuilder.includes("material-icons-v118-transparent.png"),
  "material icon builder must use the transparent v1.1.8 source image");

for (const kind of ["claw", "horn"]) {
  const iconPath = path.join(modRoot, "gfx", "interface", "icons", "artifact", "mm_wyvern_material_" + kind + ".dds");
  const alpha = ddsAlphaProfile(fs.readFileSync(iconPath), "dragon " + kind + " icon");
  assert.ok(alpha.transparentFraction >= 0.25,
    "dragon " + kind + " icon must leave enough alpha-transparent area for CK3's rarity backdrop");
  assert.ok(Object.values(alpha.corners).every(value => value !== null && value <= 8),
    "dragon " + kind + " icon corners must be transparent");
  assert.ok(alpha.opaque >= 1000, "dragon " + kind + " icon must retain its opaque subject");
}

const installRoot = process.env.CK3_INSTALL_ROOT
  ? path.resolve(process.env.CK3_INSTALL_ROOT)
  : process.env.CK3_GAME_DIR
    ? path.dirname(path.resolve(process.env.CK3_GAME_DIR))
    : "D:/SteamLibrary/steamapps/common/Crusader Kings III";
const inventoryGuiPath = path.join(installRoot, "game", "gui", "window_inventory.gui");
if (fs.existsSync(inventoryGuiPath)) {
  const inventoryGui = fs.readFileSync(inventoryGuiPath, "utf8");
  const rarityIndex = inventoryGui.indexOf('name = "rarity_icon"');
  assert.ok(rarityIndex >= 0, "native inventory GUI must define the artifact rarity icon");
  const rarityBlock = inventoryGui.slice(rarityIndex, rarityIndex + 350);
  assert.ok(rarityBlock.includes('texture = "gfx/interface/icons/artifact/artifact_bg.dds"'),
    "native rarity icon must use the artifact background atlas");
  assert.ok(rarityBlock.includes('frame = "[Artifact.GetIconFrame]"'),
    "native rarity background must select its frame from artifact rarity");
  assert.ok(rarityBlock.includes("framesize = { 240 240 }"),
    "native rarity atlas must use 240-pixel frames");
  const rarityAtlasPath = path.join(installRoot, "game", "gfx", "interface", "icons", "artifact", "artifact_bg.dds");
  const rarityAtlas = fs.readFileSync(rarityAtlasPath);
  assert.equal(rarityAtlas.toString("ascii", 0, 4), "DDS ", "native artifact rarity atlas must be DDS");
  assert.equal(rarityAtlas.readUInt32LE(16), 960, "native artifact rarity atlas must contain four horizontal frames");
  assert.equal(rarityAtlas.readUInt32LE(12), 240, "native artifact rarity atlas frame height must be 240 pixels");
}

function assertTriangleBudget(triangles, label) {
  assert.ok(Number.isInteger(triangles) && triangles > 0 && triangles <= 520000,
    label + " triangle count must be positive and at most 520000");
}

function assertHeadDimensions(minimum, maximum, originalBounds, scale, label) {
  assert.ok(Array.isArray(minimum) && minimum.length === 3, label + " minimum bounds are missing");
  assert.ok(Array.isArray(maximum) && maximum.length === 3, label + " maximum bounds are missing");
  const names = ["width", "height", "depth"];
  for (let axis = 0; axis < 3; axis += 1) {
    const expected = (originalBounds[1][axis] - originalBounds[0][axis]) * scale;
    const actual = maximum[axis] - minimum[axis];
    assert.ok(Number.isFinite(actual) && actual > 0, label + " " + names[axis] + " must be finite and positive");
    assert.ok(Math.abs(actual - expected) <= expected * 0.01,
      label + " " + names[axis] + " must stay within 1% of the complete scaled source");
  }
}

const sourceFixture = JSON.parse(fs.readFileSync(path.join(projectRoot, "tests", "fixtures", "v121", "head-source-contract.json"), "utf8"));
const sourceMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, "artwork", "wyvern-trophies", "models", "winner77-head-source.json"), "utf8"));
const models = JSON.parse(fs.readFileSync(path.join(projectRoot, "artwork", "wyvern-trophies", "models", "models.json"), "utf8"));
const head = models.models.head;
const source = sourceFixture.source;
assert.equal(source.uniformScale, 0.73, "head import scale must remain enlarged to 0.73");
assert.notEqual(source.uniformScale, 0.36, "head import must not regress to the previous 0.36 scale");
assert.equal(source.optimizedTriangles, 520000, "head optimization target must be 520000 triangles");
assert.equal(source.exportedTriangles, 520000, "head export contract must record 520000 triangles");
assert.equal(sourceMetadata.fullSculptRetained, true, "head import must preserve the complete source sculpt");
assert.ok(sourceMetadata.changes.some(change => /preserved the complete head, neck and original base/i.test(change)),
  "head source changes must retain the complete head, neck, and original base");
assert.equal(head.triangles, 520000, "runtime head metadata must record the full 520000-triangle budget");
assertTriangleBudget(head.triangles, "runtime head");
assertHeadDimensions(head.min, head.max, source.originalBounds, source.uniformScale, "runtime head");
assert.ok(Math.abs(head.min[1]) <= 0.36, "runtime head must retain the original base at Y=0");
const expectedHeight = (source.originalBounds[1][1] - source.originalBounds[0][1]) * source.uniformScale;
assert.ok(Math.abs(head.max[1] - expectedHeight) <= 0.36, "runtime head must retain its full scaled height");

const expectedSpans = [0, 1, 2].map(axis =>
  (source.originalBounds[1][axis] - source.originalBounds[0][axis]) * source.uniformScale
);
assert.throws(() => assertHeadDimensions([0, 0, 0], [0, expectedSpans[1], expectedSpans[2]],
  source.originalBounds, source.uniformScale, "negative width fixture"), /width/,
  "head dimension guard must reject a collapsed width");
assert.throws(() => assertHeadDimensions([0, 0, 0], [expectedSpans[0], expectedSpans[1] * 1.5, expectedSpans[2]],
  source.originalBounds, source.uniformScale, "negative height fixture"), /height/,
  "head dimension guard must reject an implausible height");
assert.throws(() => assertTriangleBudget(520001, "negative triangle fixture"), /520000/,
  "head triangle guard must reject any export over 520000 triangles");

console.log("Wyvern v1.1.8 independent regressions: PASS (legendary totals, no origin restrictions, rarity alpha, and enlarged full head bounds)");

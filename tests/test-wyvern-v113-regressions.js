"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const captureRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const humanRoot = path.join(projectRoot, "patches", "wyvern-human-form", "mod");
const trophyPath = path.join(captureRoot, "common", "scripted_effects", "mm_wyvern_trophies.txt");
const feedEventsPath = path.join(captureRoot, "events", "zzzz_mm_wyvern_capture_events.txt");
const schemePath = path.join(captureRoot, "common", "schemes", "scheme_types", "zzzz_mm_wyvern_capture_schemes.txt");

function tokenizePdx(text, label) {
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (character === "\"" ) {
      index += 1;
      let value = "";
      let closed = false;
      while (index < text.length) {
        const current = text[index++];
        if (current === "\\" && index < text.length) {
          value += text[index++];
        } else if (current === "\"") {
          closed = true;
          break;
        } else {
          value += current;
        }
      }
      assert.ok(closed, label + " has an unterminated string");
      tokens.push(value);
    } else if ("{}=".includes(character)) {
      tokens.push(character);
      index += 1;
    } else {
      const start = index;
      while (index < text.length && !/[\s{}=#\"]/.test(text[index])) index += 1;
      assert.ok(index > start, label + " contains an invalid token at " + String(index));
      tokens.push(text.slice(start, index));
    }
  }
  return tokens;
}

function parsePdxBlock(tokens, label, nested) {
  const entries = [];
  while (tokens.index < tokens.values.length) {
    const token = tokens.values[tokens.index++];
    if (token === "}") {
      assert.ok(nested, label + " has an unmatched closing brace");
      return entries;
    }
    assert.notEqual(token, "{", label + " has a block without a key");
    assert.notEqual(token, "=", label + " has a key without a name");

    if (tokens.values[tokens.index] === "=") {
      tokens.index += 1;
      const valueToken = tokens.values[tokens.index++];
      assert.notEqual(valueToken, undefined, label + " has a key without a value");
      assert.notEqual(valueToken, "}", label + " has a key without a value");
      const value = valueToken === "{" ? parsePdxBlock(tokens, label, true) : valueToken;
      entries.push({ key: token, value });
    } else {
      entries.push({ key: null, value: token });
    }
  }
  assert.ok(!nested, label + " has an unclosed block");
  return entries;
}

function parsePdxFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const tokens = { values: tokenizePdx(text, filePath), index: 0 };
  const result = parsePdxBlock(tokens, filePath, false);
  assert.equal(tokens.index, tokens.values.length, filePath + " has trailing PDX tokens");
  return result;
}

function values(block, key) {
  return block.filter((entry) => entry.key === key).map((entry) => entry.value);
}

function firstScalar(block, key) {
  const value = values(block, key).find((candidate) => typeof candidate === "string");
  return value;
}

function directKeys(block) {
  return block.filter((entry) => entry.key !== null).map((entry) => entry.key).sort();
}

function containsKey(block, key) {
  return block.some((entry) => entry.key === key || (Array.isArray(entry.value) && containsKey(entry.value, key)));
}

function findDefinition(entries, key) {
  return entries.find((entry) => entry.key === key && Array.isArray(entry.value))?.value;
}

function walkFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath, extension);
    return entry.isFile() && entry.name.toLowerCase().endsWith(extension) ? [fullPath] : [];
  });
}

function localeFiles(moduleRoot, locale) {
  const directory = path.join(moduleRoot, "localization", locale);
  const files = walkFiles(directory, ".yml");
  assert.ok(files.length > 0, "missing " + locale + " localization files in " + moduleRoot);
  return files;
}

function assertUtf8Bom(bytes, label) {
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf], label + " must be UTF-8 with BOM");
}

function readLocale(moduleRoot, locale) {
  const keys = new Map();
  for (const filePath of localeFiles(moduleRoot, locale)) {
    const bytes = fs.readFileSync(filePath);
    assertUtf8Bom(bytes, filePath);
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    for (const match of text.matchAll(/^\s*([A-Za-z0-9_.-]+):\d+\s+"((?:\\.|[^"\\])*)"\s*$/gm)) {
      assert.ok(!keys.has(match[1]), "duplicate localization key " + match[1] + " in " + locale);
      keys.set(match[1], match[2]);
    }
  }
  return keys;
}

function scalarLeaves(value, output) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value) scalarLeaves(entry.value, output);
  }
}

function isModuleLocalizationKey(value) {
  return /^(?:mm_wyvern_[A-Za-z0-9_.]+|MM_WYVERN_[A-Z0-9_.]+)$/.test(value);
}

function collectLocalizationReferences(entries, parentKey, references) {
  const localizedFields = new Set([
    "title",
    "desc",
    "success_desc",
    "custom_tooltip",
    "custom_description",
    "desc_general",
    "action",
  ]);
  for (const entry of entries) {
    const fieldIsLocalized = localizedFields.has(entry.key)
      || (entry.key === "name" && (parentKey === "option" || parentKey === "create_artifact"));
    if (fieldIsLocalized) {
      const leaves = [];
      scalarLeaves(entry.value, leaves);
      for (const leaf of leaves) {
        if (isModuleLocalizationKey(leaf)) references.add(leaf);
      }
    }
    if (Array.isArray(entry.value)) collectLocalizationReferences(entry.value, entry.key, references);
  }
}

function assertLocalizationParity(moduleRoot, moduleLabel) {
  const english = readLocale(moduleRoot, "english");
  const chinese = readLocale(moduleRoot, "simp_chinese");
  assert.deepEqual(
    [...english.keys()].sort(),
    [...chinese.keys()].sort(),
    moduleLabel + " English and Simplified Chinese localization keys must match",
  );
  return { english, chinese };
}

function assertSchemeLocalizationKeys(english, chinese, scheme) {
  for (const [locale, keys] of [["English", english], ["Simplified Chinese", chinese]]) {
    for (const key of [scheme, scheme + "_action", scheme + "_desc_general"]) {
      assert.ok(keys.has(key), "missing " + locale + " scheme localization: " + key);
    }
  }
}

const captureLocales = assertLocalizationParity(captureRoot, "capture");
const humanLocales = assertLocalizationParity(humanRoot, "human-form");
const capturePdxFiles = walkFiles(captureRoot, ".txt");
const humanPdxFiles = walkFiles(humanRoot, ".txt");
const localizedReferences = new Set();
const parsedFiles = new Map();

for (const filePath of [...capturePdxFiles, ...humanPdxFiles]) {
  const parsed = parsePdxFile(filePath);
  parsedFiles.set(filePath, parsed);
  collectLocalizationReferences(parsed, null, localizedReferences);

  if (filePath.includes(path.join("common", "character_interactions"))) {
    for (const entry of parsed) {
      if (typeof entry.key === "string" && /^mm_wyvern_[A-Za-z0-9_]+_interaction$/.test(entry.key)) {
        localizedReferences.add(entry.key);
        localizedReferences.add(entry.key + "_desc");
      }
    }
  }
}

const allEnglish = new Map([...captureLocales.english, ...humanLocales.english]);
const allChinese = new Map([...captureLocales.chinese, ...humanLocales.chinese]);
for (const key of localizedReferences) {
  assert.ok(allEnglish.has(key), "unresolved English localization key: " + key);
  assert.ok(allChinese.has(key), "unresolved Simplified Chinese localization key: " + key);
}

for (const temperament of ["alert", "docile", "fierce"]) {
  const scheme = "mm_wyvern_tame_" + temperament + "_captive";
  assertSchemeLocalizationKeys(allEnglish, allChinese, scheme);
}

for (const temperament of ["alert", "docile", "fierce"]) {
  const scheme = "mm_wyvern_tame_" + temperament + "_captive";
  for (const key of [scheme, scheme + "_action", scheme + "_desc_general"]) {
    const missingEnglish = new Map(allEnglish);
    missingEnglish.delete(key);
    assert.throws(() => assertSchemeLocalizationKeys(missingEnglish, allChinese, scheme));

    const missingChinese = new Map(allChinese);
    missingChinese.delete(key);
    assert.throws(() => assertSchemeLocalizationKeys(allEnglish, missingChinese, scheme));
  }
}

const trophyAst = parsePdxFile(trophyPath);
const trophySet = findDefinition(trophyAst, "mm_wyvern_create_decorative_trophy_set_effect");
assert.ok(trophySet, "decorative trophy creation effect is missing");
const artifacts = values(trophySet, "create_artifact").filter(Array.isArray);
assert.equal(artifacts.length, 1, "only the head remains a new decorative trophy");

const trophyKinds = ["head"];
function assertArtifactHasNativeCharacterModifier(artifact, label, nativeModifierIds) {
  const modifiers = values(artifact, "modifier").filter((value) => typeof value === "string");
  assert.ok(
    modifiers.some((modifier) => /^artifact_[A-Za-z0-9_]+_modifier$/.test(modifier)),
    "trophy " + label + " must pass a native artifact modifier directly to create_artifact",
  );
  if (nativeModifierIds) {
    assert.ok(
      modifiers.some((modifier) => nativeModifierIds.has(modifier)),
      "trophy " + label + " must reference a modifier registered by the installed CK3 game",
    );
  }
}

for (const [index, artifact] of artifacts.entries()) {
  const kind = trophyKinds[index];
  assert.equal(firstScalar(artifact, "name"), "mm_wyvern_trophy_" + kind + "_name");
  assert.equal(firstScalar(artifact, "description"), "mm_wyvern_trophy_" + kind + "_desc");
  assert.equal(firstScalar(artifact, "rarity"), "$RARITY$");
  assert.equal(firstScalar(artifact, "creator"), "root");
}

const nativeGameRoot = process.env.CK3_GAME_DIR || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
const nativeArtifactModifiersPath = path.join(nativeGameRoot, "common", "modifiers", "00_artifact_modifiers.txt");
let nativeModifierIds = null;
if (fs.existsSync(nativeArtifactModifiersPath)) {
  const nativeModifierText = fs.readFileSync(nativeArtifactModifiersPath, "utf8");
  nativeModifierIds = new Set(
    [...nativeModifierText.matchAll(/^\s*(artifact_[A-Za-z0-9_]+_modifier)\s*=/gm)].map((match) => match[1]),
  );
}
for (const [index, artifact] of artifacts.entries()) {
  assertArtifactHasNativeCharacterModifier(artifact, trophyKinds[index], nativeModifierIds);
  const withoutModifier = JSON.parse(JSON.stringify(artifact)).filter((entry) => entry.key !== "modifier");
  assert.throws(() => assertArtifactHasNativeCharacterModifier(withoutModifier, trophyKinds[index], nativeModifierIds));
}

const sampleLocaleBytes = fs.readFileSync(localeFiles(captureRoot, "english")[0]);
assert.throws(() => assertUtf8Bom(sampleLocaleBytes.subarray(3), "BOM-removal fixture"));

const historyScopes = values(trophySet, "scope:mm_wyvern_trophy").filter(Array.isArray);
assert.equal(historyScopes.length, artifacts.length, "each created trophy must receive source metadata and history");
for (const historyScope of historyScopes) {
  const sourceVariable = values(historyScope, "set_variable").filter(Array.isArray).find((variable) =>
    firstScalar(variable, "name") === "mm_wyvern_trophy_source");
  assert.ok(sourceVariable, "trophy must retain its source wyvern");
  assert.equal(firstScalar(sourceVariable, "value"), "scope:mm_wyvern_trophy_source");

  const histories = values(historyScope, "add_artifact_history").filter(Array.isArray);
  assert.equal(histories.length, 1, "each trophy needs exactly one creation history entry");
  assert.equal(firstScalar(histories[0], "type"), "created");
  // CK3's native created-history description presents actor as the maker;
  // keep the player as creator and carry the wyvern source in trophy metadata/loc.
  assert.equal(firstScalar(histories[0], "actor"), "root");
  assert.equal(firstScalar(histories[0], "recipient"), "root");
}

for (const kind of trophyKinds) {
  for (const language of [captureLocales.english, captureLocales.chinese]) {
    for (const suffix of ["name", "desc"]) {
      const localizedText = language.get("mm_wyvern_trophy_" + kind + "_" + suffix);
      assert.ok(localizedText, "missing trophy " + kind + " " + suffix + " localization");
      assert.ok(
        localizedText.includes("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]"),
        "trophy " + kind + " " + suffix + " must display the dragon source name",
      );
    }
  }
}

const feedAst = parsedFiles.get(feedEventsPath) || parsePdxFile(feedEventsPath);
const feedEvent = findDefinition(feedAst, "mm_wyvern_capture.0001");
assert.ok(feedEvent, "captured-wyvern feeding event is missing");
const feedOptions = values(feedEvent, "option").filter(Array.isArray).filter((option) => values(option, "custom_tooltip").length > 0);
assert.equal(feedOptions.length, 3, "all three feeding choices must use the numeric custom tooltip");
function assertFeedTooltipShowsCostsOnly(option, tier) {
  assert.equal(firstScalar(option, "custom_tooltip"), "mm_wyvern_capture.feed_progress_tt");
  const previews = values(option, "show_as_tooltip").filter(Array.isArray);
  assert.equal(previews.length, 1, "each feeding choice must preserve its dynamic cost preview");
  const preview = previews[0];
  assert.deepEqual(directKeys(preview), ["else", "if"], "show_as_tooltip may preview only costs");

  const ifBranch = values(preview, "if").find(Array.isArray);
  assert.ok(ifBranch, "cost preview must include the landless provisions branch");
  assert.deepEqual(directKeys(ifBranch), ["domicile", "limit"]);
  const limit = values(ifBranch, "limit").find(Array.isArray);
  assert.ok(limit);
  assert.deepEqual(directKeys(limit), ["government_has_flag"]);
  assert.equal(firstScalar(limit, "government_has_flag"), "government_is_landless_adventurer");

  const domicile = values(ifBranch, "domicile").find(Array.isArray);
  assert.ok(domicile);
  assert.deepEqual(directKeys(domicile), ["change_provisions"]);
  const provisions = values(domicile, "change_provisions").find(Array.isArray);
  assert.ok(provisions);
  assert.deepEqual(directKeys(provisions), ["multiply", "value"]);
  assert.equal(firstScalar(provisions, "value"), "myv_wyvern_feed_" + tier + "_provisions_cost");
  assert.equal(firstScalar(provisions, "multiply"), "-1");

  const elseBranch = values(preview, "else").find(Array.isArray);
  assert.ok(elseBranch);
  assert.deepEqual(directKeys(elseBranch), ["remove_short_term_gold"]);
  assert.equal(firstScalar(elseBranch, "remove_short_term_gold"), "myv_wyvern_feed_" + tier + "_cost");
  assert.doesNotMatch(JSON.stringify(preview), /myv_wyvern_feed_20_effect|mm_wyvern_capture_feed_effect|force_character_skill|refresh/i);
}

for (const [index, option] of feedOptions.entries()) {
  const tier = ["scraps", "standard", "prime"][index];
  assertFeedTooltipShowsCostsOnly(option, tier);
  const hiddenEffects = values(option, "hidden_effect").filter(Array.isArray);
  assert.equal(hiddenEffects.length, 1, "actual feed effect must remain in the hidden effect");
  assert.ok(containsKey(hiddenEffects[0], "mm_wyvern_capture_feed_effect"), "actual progress feeding belongs in hidden_effect");
}

for (const localizedText of [captureLocales.english.get("mm_wyvern_capture.feed_progress_tt"), captureLocales.chinese.get("mm_wyvern_capture.feed_progress_tt")]) {
  assert.ok(localizedText, "feeding numeric tooltip localization is missing");
  assert.match(localizedText, /20/);
  assert.match(localizedText, /100/);
  assert.doesNotMatch(localizedText, /force_character_skill/i);
}

console.log("PASS wyvern trophy modifier/history and capture localization/tooltip regressions");

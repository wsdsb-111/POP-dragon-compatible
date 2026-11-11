'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readBytes = relative => fs.readFileSync(path.join(root, ...relative.split('/')));
const read = relative => readBytes(relative).toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const UTF8_BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

function assertUtf8Bom(bytes, label) {
  assert.ok(bytes.subarray(0, 3).equals(UTF8_BOM), label + ' must start with a UTF-8 BOM');
}

const legacyNoBomFixture = Buffer.from('l_english:\n myv_wyvern_panel_age:0 "[Character.Custom(\'PODCharacterAge\')]"\n', 'utf8');
assert.throws(() => assertUtf8Bom(legacyNoBomFixture, 'legacy no-BOM localization fixture'), assert.AssertionError,
  'the pre-fix localization encoding is rejected');

function blockAt(source, start, label) {
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, 'missing block opener ' + label);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '#') inComment = true;
    else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail('unclosed block ' + label);
}

function block(source, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('^' + escapedId + '\\s*=\\s*\\{', 'm').exec(source);
  assert.ok(match, 'missing top-level definition ' + id);
  return blockAt(source, match.index, id);
}

function valuesForKey(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp('^\\s*' + escapedKey + ':0\\s+"([^"]*)"\\s*$', 'gm');
  return [...source.matchAll(expression)].map(match => match[1]);
}

function filesUnder(relativeDirectory) {
  const absoluteDirectory = path.join(root, ...relativeDirectory.split('/'));
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? filesUnder(relativePath) : [relativePath];
  });
}

function valuesInLocalizationTree(relativeDirectory, key) {
  return filesUnder(relativeDirectory)
    .filter(file => file.endsWith('.yml'))
    .flatMap(file => valuesForKey(read(file), key));
}

const identityReceipt = JSON.parse(read('patches/wyvern-pod/identity-sources.json'));
const ageReceipt = JSON.parse(read('patches/wyvern-pod/hidden-age-sources.json'));
assert.equal(identityReceipt.CK3Runtime, 'NOT_RUN', 'the identity receipt must not imply CK3 runtime verification');

// Pin only the output files that form this display path. Receipt paths are explicit; filename priority is never used as evidence.
const outputPins = [
  ['identity', 'gui/custom_gui/myv_wyvern_character_window.gui', 'b82ee840c3fcb052dfc2fba9bce339e7519081ffd65bbc7dc789af7e8f9e3ed5'],
  ['identity', 'common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_species.txt', '44f1f9a106e890517b92912d6c965f603d844f47decb5302d8587b67dd3d3242'],
  ['identity', 'localization/replace/english/zzzzzzzzzzzzzz_mm_pod_identity_l_english.yml', '07bc4940668216f6882040def91c0b01212c744b4e3197fdd960f4b745ef8949'],
  ['identity', 'localization/replace/simp_chinese/zzzzzzzzzzzzzz_mm_pod_identity_l_simp_chinese.yml', '6205c9819f740dfd0c2a73bf6bd04a108511cc87ee5ed80a2f35182a7799bb71'],
  ['age', 'mod/common/customizable_localization/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_mm_pod_hidden_age.txt', '3f05edf6e1b945def0bd2d73be61d29c2896aef7e19f92e6947c48f17bce1ec8'],
  ['age', 'mod/localization/replace/english/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_mm_pod_hidden_age_l_english.yml', '58e5b7ae7adf98753fc169c2671e24fffa318857bcaadbf6b0aa63bdfea3a046'],
  ['age', 'mod/localization/replace/simp_chinese/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_mm_pod_hidden_age_l_simp_chinese.yml', '14eb3251cb806d8d4ff0ea26dee538e1768153fc3d26fd8e2676a45878318926']
];
const receipts = { identity: identityReceipt, age: ageReceipt };
for (const [receiptName, outputPath, expectedHash] of outputPins) {
  const output = receipts[receiptName].outputs.find(item => item.path === outputPath);
  assert.ok(output, 'receipt contains the displayed age output ' + outputPath);
  assert.equal(output.sha256, expectedHash, 'pinned output receipt hash ' + outputPath);
  const diskPath = outputPath.startsWith('mod/')
    ? path.posix.join('patches/wyvern-pod', outputPath)
    : path.posix.join('patches/wyvern-pod/mod', outputPath);
  const outputBytes = readBytes(diskPath);
  assert.equal(sha256(outputBytes), expectedHash, 'generated output matches its pinned hash ' + outputPath);
  if (outputPath.endsWith('.yml')) assertUtf8Bom(outputBytes, outputPath);
}

const gui = read('patches/wyvern-pod/mod/gui/custom_gui/myv_wyvern_character_window.gui');
const ageWidgets = [...gui.matchAll(/text_single\s*=\s*\{/g)]
  .map(match => blockAt(gui, match.index, 'text_single'))
  .filter(source => /raw_text\s*=\s*"\[Character\.Custom\('mm_pod_character_panel_age'\)\]"/.test(source));
assert.equal(ageWidgets.length, 1, 'the custom wyvern panel has exactly one direct age custom-localization call');
assert.match(ageWidgets[0], /tooltip\s*=\s*"\[Character\.Custom\('PODCharacterAgeTooltip'\)\]"/,
  'the age widget retains PoD native age tooltip behavior');
assert.doesNotMatch(gui, /text\s*=\s*"myv_wyvern_panel_age"|MakeScope\.ScriptValue\('true_age'\)/,
  'the panel no longer renders the ambiguous legacy age key or raw true_age');

const customLocPath = 'patches/wyvern-pod/mod/common/customizable_localization/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_mm_pod_hidden_age.txt';
const customLoc = read(customLocPath);
const customLocFiles = fs.readdirSync(path.join(root, 'patches/wyvern-pod/mod/common/customizable_localization'))
  .filter(file => file.endsWith('.txt'))
  .map(file => read('patches/wyvern-pod/mod/common/customizable_localization/' + file));
const allCustomLocs = customLocFiles.join('\n');
assert.equal((allCustomLocs.match(/^mm_pod_character_panel_age\s*=\s*\{/gm) || []).length, 1,
  'the direct panel age dispatch identifier is unique in the overlay');
const ageDispatch = block(customLoc, 'mm_pod_character_panel_age');
assert.match(ageDispatch, /^mm_pod_character_panel_age\s*=\s*\{\s*type\s*=\s*character\b/m);
const textBlocks = [...ageDispatch.matchAll(/text\s*=\s*\{/g)].map(match => blockAt(ageDispatch, match.index, 'age dispatch text'));
assert.equal(textBlocks.length, 2, 'the display dispatch has one fixed-royal branch and one fallback');
assert.match(textBlocks[0], /trigger\s*=\s*\{\s*mm_pod_is_fixed_royal\s*=\s*yes\s*\}/);
assert.match(textBlocks[0], /localization_key\s*=\s*mm_pod_royal_age_unknown/);
assert.doesNotMatch(textBlocks[0], /fallback\s*=\s*yes/);
assert.match(textBlocks[1], /localization_key\s*=\s*mm_pod_panel_age_native/);
assert.match(textBlocks[1], /fallback\s*=\s*yes/);
assert.doesNotMatch(textBlocks[1], /trigger\s*=/, 'ordinary characters use the native-age fallback');
assert.deepEqual(
  [...ageDispatch.matchAll(/localization_key\s*=\s*(mm_pod_[A-Za-z0-9_]+)/g)].map(match => match[1]),
  ['mm_pod_royal_age_unknown', 'mm_pod_panel_age_native'],
  'the fixed and fallback paths resolve to two distinct explicit localization keys'
);

const fixedRoyalTrigger = block(
  read('patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_species.txt'),
  'mm_pod_is_fixed_royal'
);
assert.deepEqual(
  [...fixedRoyalTrigger.matchAll(/this\s*=\s*character:(\d+)/g)].map(match => match[1]),
  ['99001001', '99001305', '99001002', '99001306', '99001003', '99001307', '99001304', '99001308', '99001309', '99001310'],
  'the fixed-age branch covers the ten configured royal characters, including the Black Emperor'
);

const localeFiles = {
  english: {
    age: 'patches/wyvern-pod/mod/localization/replace/english/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_mm_pod_hidden_age_l_english.yml',
    identity: 'patches/wyvern-pod/mod/localization/replace/english/zzzzzzzzzzzzzz_mm_pod_identity_l_english.yml',
    legacyAge: '[Character.Custom(\'PODCharacterAge\')]'
  },
  simp_chinese: {
    age: 'patches/wyvern-pod/mod/localization/replace/simp_chinese/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz_mm_pod_hidden_age_l_simp_chinese.yml',
    identity: 'patches/wyvern-pod/mod/localization/replace/simp_chinese/zzzzzzzzzzzzzz_mm_pod_identity_l_simp_chinese.yml',
    legacyAge: '[Character.Custom(\'PODCharacterAge\')]'
  }
};
for (const [language, files] of Object.entries(localeFiles)) {
  const ageText = read(files.age);
  const identityText = read(files.identity);
  const replaceDirectory = 'patches/wyvern-pod/mod/localization/replace/' + language;
  assert.deepEqual(valuesForKey(ageText, 'mm_pod_royal_age_unknown'), ['???'], language + ' fixed-royal display is question marks');
  assert.deepEqual(valuesForKey(ageText, 'mm_pod_panel_age_native'), ["[ROOT.Char.Custom('PODCharacterAge')]"],
    language + ' fallback calls native PoD age customization');
  assert.deepEqual(valuesForKey(ageText, 'myv_wyvern_panel_age'), [files.legacyAge], language + ' hidden-age legacy key is normalized');
  assert.deepEqual(valuesForKey(identityText, 'myv_wyvern_panel_age'), [files.legacyAge], language + ' identity legacy key is normalized');
  assert.deepEqual(valuesInLocalizationTree(replaceDirectory, 'mm_pod_royal_age_unknown'), ['???'],
    language + ' has one unambiguous fixed-royal localization key');
  assert.deepEqual(valuesInLocalizationTree(replaceDirectory, 'mm_pod_panel_age_native'), ["[ROOT.Char.Custom('PODCharacterAge')]"],
    language + ' has one unambiguous native fallback localization key');
  const legacyValues = valuesInLocalizationTree(replaceDirectory, 'myv_wyvern_panel_age');
  assert.ok(legacyValues.length >= 2, language + ' checks both identity and hidden-age legacy definitions');
  assert.deepEqual([...new Set(legacyValues)], [files.legacyAge], language + ' has no conflicting legacy age values');
}

console.log('PoD wyvern age display independent static QA passed; CK3 runtime remains NOT_RUN.');

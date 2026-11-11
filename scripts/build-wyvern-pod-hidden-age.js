'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const POD_ROOT = 'D:\\SteamLibrary\\steamapps\\workshop\\content\\1158310\\2216659254';
const GAME_ROOT = 'D:\\SteamLibrary\\steamapps\\common\\Crusader Kings III\\game';
const OUTPUT_ROOT = path.join(ROOT, 'patches', 'wyvern-pod', 'mod');
const RECEIPT_PATH = path.join(ROOT, 'patches', 'wyvern-pod', 'hidden-age-sources.json');
const ROOTS = { R: ROOT, PoD: POD_ROOT, game: GAME_ROOT };
const sources = new Map();
const outputs = [];
const pendingOutputs = [];
const prefix = 'z'.repeat(32);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readSource(rootName, relativePath, role) {
  const bytes = fs.readFileSync(path.resolve(ROOTS[rootName], relativePath));
  const key = `${rootName}:${relativePath.replace(/\\/g, '/')}`;
  const existing = sources.get(key);
  sources.set(key, {
    root: rootName,
    path: relativePath.replace(/\\/g, '/'),
    sha256: sha256(bytes),
    roles: [...new Set([...(existing?.roles || []), role])]
  });
  return bytes;
}

function matchingBrace(text, openIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const character = text[i];
    if (inComment) {
      if (character === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '#') inComment = true;
    else if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unclosed block at offset ${openIndex}`);
}

function extractDefinition(text, id) {
  const escaped = id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const match = new RegExp(`^[\\t ]*${escaped}[\\t ]*=[\\t ]*\\{`, 'm').exec(text);
  if (!match) throw new Error(`Missing definition ${id}`);
  const start = match.index;
  const open = text.indexOf('{', start);
  const close = matchingBrace(text, open);
  return text.slice(start, close + 1);
}

function writeOutput(relativePath, text, role) {
  const encodedText = relativePath.endsWith('.yml') ? '\uFEFF' + text.replace(/^\uFEFF/, '') : text;
  pendingOutputs.push({ relativePath, bytes: Buffer.from(encodedText, 'utf8'), role });
}

function flushOutputs() {
  for (const output of pendingOutputs) {
    const destination = path.join(OUTPUT_ROOT, output.relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, output.bytes);
    outputs.push({ path: `mod/${output.relativePath.replace(/\\/g, '/')}`, sha256: sha256(output.bytes), role: output.role });
  }
}
const triggerPath = 'common/scripted_triggers/POD_interface_triggers.txt';
const triggerSource = readSource('PoD', triggerPath, 'native POD_character_age_predates_mankind definition');
const triggerText = triggerSource.toString('utf8');
const nativeAgeTrigger = extractDefinition(triggerText, 'POD_character_age_predates_mankind');
const triggerLines = nativeAgeTrigger.split(/\r?\n/);
assert(triggerLines.some((line) => /this = character:795111\b/.test(line)), 'native Mokole-Mbembe age case changed');
assert(triggerLines.some((line) => /this = character:793509\b/.test(line)), 'native Hunger of Qyrl age case changed');
assert(!triggerLines.some((line) => /mm_pod_is_fixed_royal/.test(line)), 'source already contains the fixed-royal branch');
const hungerIndex = triggerLines.findIndex((line) => /this = character:793509\b/.test(line));
triggerLines.splice(hungerIndex + 1, 0, '\t\tmm_pod_is_fixed_royal = yes');
const sourceNewline = triggerText.includes('\r\n') ? '\r\n' : '\n';
writeOutput(
  `common/scripted_triggers/${prefix}_mm_pod_hidden_age.txt`,
  triggerLines.join(sourceNewline),
  'PoD native age trigger plus fixed-royal branch'
);

const fixedRoyalPath = 'patches/wyvern-pod/mod/common/scripted_triggers/zzzzzzzzzzzzzz_mm_pod_species.txt';
const fixedRoyalSource = readSource('R', fixedRoyalPath, 'reused mm_pod_is_fixed_royal trigger');
assert(fixedRoyalSource.toString('utf8').includes('mm_pod_is_fixed_royal = {'), 'fixed-royal trigger is missing from the PoD overlay');

const ages = [
  ['99001309', 40],
  ['99001310', 35],
  ['99001305', 25],
  ['99001001', 13],
  ['99001306', 23],
  ['99001002', 18],
  ['99001307', 28],
  ['99001003', 23],
  ['99001308', 60],
  ['99001304', 30]
];
const effectLines = ['mm_pod_apply_fixed_royal_appearance_effect = {'];
for (const [index, [characterId, age]] of ages.entries()) {
  effectLines.push(`    ${index === 0 ? 'if' : 'else_if'} = {`);
  effectLines.push(`        limit = { this = character:${characterId} }`);
  effectLines.push(`        set_immortal_age = ${age}`);
  effectLines.push('    }');
}
effectLines.push('}');
writeOutput(
  `common/scripted_effects/${prefix}_mm_pod_hidden_age.txt`,
  `${effectLines.join('\n')}\n`,
  'per-character fixed-royal appearance-age setter using set_immortal_age'
);

const customLocPath = 'common/customizable_localization/POD_fog_of_war_custom_loc.txt';
const customLocSource = readSource('PoD', customLocPath, 'native PODCharacterAge and PODCharacterAgeTooltip dispatch');
const customLocText = customLocSource.toString('utf8');
const ageDispatch = extractDefinition(customLocText, 'PODCharacterAge');
assert(/trigger\s*=\s*\{\s*POD_character_age_predates_mankind\s*=\s*yes\s*\}[\s\S]*?localization_key\s*=\s*AGE_DINOSAUR/.test(ageDispatch), 'native PODCharacterAge no longer maps predates-mankind to AGE_DINOSAUR');
assert(ageDispatch.indexOf('localization_key = AGE_DINOSAUR') < ageDispatch.indexOf('POD_character_age_is_ancient = yes'), 'native age dispatch order changed; verify fixed royals still resolve as dinosaur age');
assert(/PODCharacterAgeTooltip\s*=\s*\{[\s\S]*?parent\s*=\s*PODCharacterAge[\s\S]*?suffix\s*=\s*"_TT"/.test(customLocText), 'native tooltip custom localization changed');

const visualAgePath = 'common/script_values/POD_visual_age_values.txt';
const visualAgeSource = readSource('PoD', visualAgePath, 'native visual-age calculation');
const visualAgeText = visualAgeSource.toString('utf8');
assert(/POD_visual_age\s*=\s*\{[\s\S]*?limit\s*=\s*\{\s*is_immortal\s*=\s*yes\s*\}[\s\S]*?add\s*=\s*effective_age/.test(visualAgeText), 'PoD visual age no longer uses effective_age for immortals');

const englishPath = 'localization/english/gui/POD_character_window_l_english.yml';
const chinesePath = 'localization/simp_chinese/gui/POD_character_window_l_simp_chinese.yml';
const englishSource = readSource('PoD', englishPath, 'native English dinosaur-age tooltip and visual-age localization');
const chineseSource = readSource('PoD', chinesePath, 'native Chinese dinosaur-age tooltip and visual-age localization');
assert(/AGE_DINOSAUR_TT:.*PODCharacterVisualAge/.test(englishSource.toString('utf8')) && /POD_VISUAL_AGE:.*POD_visual_age/.test(englishSource.toString('utf8')), 'native English tooltip loc wiring changed');
assert(/AGE_DINOSAUR_TT:.*PODCharacterVisualAge/.test(chineseSource.toString('utf8')) && /POD_VISUAL_AGE:.*POD_visual_age/.test(chineseSource.toString('utf8')), 'native Chinese tooltip loc wiring changed');

const ageEffectPath = 'common/effect_localization/00_additional_effects.txt';
const ageEffectSource = readSource('game', ageEffectPath, 'native set_immortal_age effect localization');
assert(ageEffectSource.toString('utf8').includes('set_immortal_age = {'), 'native set_immortal_age effect is missing');

writeOutput(
  `common/customizable_localization/${prefix}_mm_pod_hidden_age.txt`,
  `mm_pod_character_panel_age = {
    type = character
    text = {
        trigger = { mm_pod_is_fixed_royal = yes }
        localization_key = mm_pod_royal_age_unknown
    }
    text = {
        localization_key = mm_pod_panel_age_native
        fallback = yes
    }
}\n`,
  'direct panel age dispatch with unique keys; independent of duplicate localization ordering'
);

for (const [language, key, value] of [
  ['english', 'l_english', 'myv_wyvern_panel_age:0 "[Character.Custom(\'PODCharacterAge\')]"'],
  ['simp_chinese', 'l_simp_chinese', 'myv_wyvern_panel_age:0 "[Character.Custom(\'PODCharacterAge\')]"']
]) {
  writeOutput(
    `localization/replace/${language}/${prefix}_mm_pod_hidden_age_l_${language}.yml`,
    `${key}:\n ${value}\n mm_pod_royal_age_unknown:0 "???"\n mm_pod_panel_age_native:0 "[ROOT.Char.Custom('PODCharacterAge')]"\n`,
    'unique fixed-royal question marks and native fallback; legacy panel key also aligned'
  );
}

flushOutputs();

const generatorBytes = fs.readFileSync(__filename);
const receipt = {
  schemaVersion: 1,
  created: '2026-11-03',
  scope: 'PoD profile fixed-royal age display and appearance ages only; no tests, game launch, install, or true_age change.',
  sourceRoots: { R: ROOT, PoD: POD_ROOT, game: GAME_ROOT },
  sources: [...sources.values()],
  outputs,
  generator: {
    path: 'scripts/build-wyvern-pod-hidden-age.js',
    sha256: sha256(generatorBytes)
  },
  appearanceAgeByCharacter: Object.fromEntries(ages),
  behavior: {
    fixedRoyalAgeText: '??? via direct mm_pod_character_panel_age dispatch and unique localization key; native PODCharacterAge remains the ordinary fallback',
    tooltip: 'Root GUI integration should use PODCharacterAgeTooltip; native AGE_DINOSAUR_TT appends PODCharacterVisualAge, which uses POD_visual_age/effective_age for immortals.',
    caller: 'Root integration calls mm_pod_apply_fixed_royal_appearance_effect in each fixed-character scope during delayed after_lobby setup and myv_wyvern_monthly_pulse.',
    trueAge: 'Existing true_age 20k formula and identity generator/receipt are untouched.'
  }
};
fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
process.stdout.write(`Generated ${outputs.length} PoD fixed-royal hidden-age overlay files and hidden-age-sources.json.\n`);

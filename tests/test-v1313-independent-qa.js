"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v1311-finite-helper");

const root = path.resolve(__dirname, "..");
const h = createHarness([]);
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/^\uFEFF/, "");
const parse = (relative, label = relative) => h.parsePdx(read(relative), label);

function only(nodes, key, label) {
  const found = Array.from(nodes).filter(node => node.key === key);
  assert.equal(found.length, 1, `${label}: expected one ${key}`);
  return found[0];
}

function listValues(node, label) {
  const values = Array.from(node.value);
  for (const entry of values) assert.equal(entry.operator, null, `${label}: expected a PDX list item`);
  return values.map(entry => entry.key);
}

function blockKeys(node, label) {
  const entries = Array.from(node.value);
  for (const entry of entries) {
    assert.equal(entry.operator, "=", `${label}: expected a trait entry`);
    assert.ok(Array.isArray(entry.value), `${label}/${entry.key}: expected a trait block`);
  }
  return entries.map(entry => entry.key);
}

function descendants(nodes, key) {
  return Array.from(nodes).flatMap(node => [
    ...(node.key === key ? [node] : []),
    ...(Array.isArray(node.value) ? descendants(node.value, key) : [])
  ]);
}

function allDescendants(nodes) {
  return Array.from(nodes).flatMap(node => [
    node,
    ...(Array.isArray(node.value) ? allDescendants(node.value) : [])
  ]);
}

const traitIdByName = {
  "虔诚": "zealous",
  "狂热": "zealous",
  "公正": "just",
  "勇敢": "brave",
  "忠信": "loyal",
  "黑皇血脉": "mm_dragon_branch_black",
  "黑皇": "mm_royal_black_emperor",
  "懦弱": "craven",
  "害羞": "shy",
  "贪婪": "greedy",
  "懒惰": "lazy",
  "初代种黑血": "mm_dragon_black_blood",
  "死侍": "mm_dragon_death_servant",
  "冷静": "calm",
  "耐心": "patient",
  "白皇血脉": "mm_dragon_branch_white",
  "白皇": "mm_royal_white_empress",
  "暴怒": "wrathful",
  "愤世嫉俗": "cynical",
  "轻信": "trusting",
  "勤奋": "diligent",
  "青铜与火之王": "mm_royal_fire_king",
  "青铜与火之王血脉": "mm_dragon_branch_fire",
  "暴食": "gluttonous",
  "忠贞": "chaste",
  "节制": "temperate",
  "大地与山之王": "mm_royal_earth_king",
  "大地与山之王血脉": "mm_dragon_branch_earth",
  "急躁": "impatient",
  "傲慢": "arrogant",
  "慷慨": "generous",
  "合群": "gregarious",
  "海洋与水之王": "mm_royal_sea_king",
  "海洋与水之王血脉": "mm_dragon_branch_sea",
  "轻率": "reckless",
  "固执": "stubborn",
  "野心勃勃": "ambitious",
  "天空与风之王": "mm_royal_sky_king",
  "天空与风之王血脉": "mm_dragon_branch_sky",
  "狡诈": "deceitful"
};

const doctrineRules = {
  "性别观点": { options: { "男性主导": "doctrine_gender_male_dominated", "女性主导": "doctrine_gender_female_dominated", "男女平等": "doctrine_gender_equal" } },
  "宗教态度": { options: { "基要主义": "doctrine_pluralism_fundamentalist", "多元主义": "doctrine_pluralism_pluralistic", "正义": "doctrine_pluralism_righteous" } },
  "圣职专权传统": { options: { "神权制": "doctrine_theocracy_temporal", "平信徒神职人员": "doctrine_theocracy_lay_clergy" } },
  "信仰领袖": { options: { "属灵": "doctrine_spiritual_head", "世俗": "doctrine_temporal_head", "无": "doctrine_no_head" } },
  "朝圣态度": { options: { "强制": "doctrine_pilgrimage_mandatory", "鼓励": "doctrine_pilgrimage_encouraged", "当地仪式": "doctrine_pilgrimage_local_rites" } },
  "有神论": { options: { "一神论": "doctrine_monotheist", "多神论": "doctrine_polytheist" } },
  "婚姻类型": { options: { "三妾制": "doctrine_concubines", "多配偶制": "doctrine_polygamy", "一夫一妻制": "doctrine_monogamy" } },
  "离婚": { options: { "离婚必须获得批准": "doctrine_divorce_approval", "允许离婚": "doctrine_divorce_allowed" } },
  "私生子": { options: { "私生子不可以被合法化": "doctrine_bastardry_none", "私生子可以被合法化": "doctrine_bastardry_legitimization" } },
  "血亲性关系": { options: { "无限制婚姻": "doctrine_consanguinity_unrestricted", "同辈堂表亲婚姻": "doctrine_consanguinity_cousins", "血亲禁婚": "doctrine_consanguinity_restricted", "至亲禁忌": "doctrine_consanguinity_cousins" } },
  "同性关系": { options: { "罪行": "doctrine_homosexuality_crime", "接纳": "doctrine_homosexuality_accepted", "忌讳": "doctrine_homosexuality_shunned" } },
  "性变态": { options: { "罪行": "doctrine_deviancy_crime", "接纳": "doctrine_deviancy_accepted", "忌讳": "doctrine_deviancy_shunned" } },
  "男性通奸": { options: { "罪行": "doctrine_adultery_men_crime", "忌讳": "doctrine_adultery_men_shunned", "接纳": "doctrine_adultery_men_accepted" } },
  "女性通奸": { options: { "罪行": "doctrine_adultery_women_crime", "忌讳": "doctrine_adultery_women_shunned", "接纳": "doctrine_adultery_women_accepted" } },
  "弑亲": { options: { "杀死至亲是犯罪": "doctrine_kinslaying_close_kin_crime", "杀死宗族成员是犯罪": "doctrine_kinslaying_any_dynasty_member_crime", "杀死亲族成员是犯罪": "doctrine_kinslaying_extended_family_crime", "接纳": "doctrine_kinslaying_accepted", "忌讳": "doctrine_kinslaying_shunned" } },
  "巫术": { options: { "接受": "doctrine_witchcraft_accepted", "美德": "doctrine_witchcraft_virtuous", "忌讳": "doctrine_witchcraft_shunned" } },
  "神职人员的作用": { options: { "控制力": "doctrine_clerical_function_taxation", "施舍与安抚": "doctrine_clerical_function_alms_and_pacification", "征兵": "doctrine_clerical_function_recruitment" } },
  "神职的性别限制": { options: { "仅男性": "doctrine_clerical_gender_male_only", "性别不限": "doctrine_clerical_gender_either" } },
  "神职人员的婚姻": { options: { "允许": "doctrine_clerical_marriage_allowed" } },
  "神职人员的任命": { options: { "属灵，终身": "doctrine_clerical_succession_spiritual_fixed_appointment", "世俗，终身": "doctrine_clerical_succession_temporal_fixed_appointment", "世俗，可被剥夺": "doctrine_clerical_succession_temporal_appointment" } },
  "丧葬传统": { options: { "亲族丧礼": "doctrine_funeral_bewailment", "克制式葬礼": "doctrine_funeral_stoic", "制为木乃伊": "doctrine_funeral_mummification", "海葬": "mm_doctrine_funeral_sea", "火葬": "doctrine_funeral_cremation" } },
  "加冕传统": { options: { "皇帝傅油礼": "doctrine_imperial_anointment", "允许傅油礼": "doctrine_anointment_permitted", "无傅油礼": "doctrine_no_anointment" } },
  "隐修制度": { options: { "接纳": "doctrine_monasticism_accepted", "不存在": "doctrine_monasticism_absent", "鼓励": "doctrine_monasticism_encouraged", "禁止": "doctrine_monasticism_forbidden" } },
  "圣事": { options: { "核心": "doctrine_sacraments_central", "无圣事": "doctrine_sacraments_absent" } }
};

const faithSpecs = [
  { title: "始祖正统派", rite: "mm_dragon_black", tenets: ["mm_tenet_black", "mm_tenet_black_second", "mm_tenet_black_third"], identity: "mm_royal_black_emperor", bloodline: "mm_dragon_branch_black", virtueCount: 6, sinCount: 6 },
  { title: "白皇神谕派", rite: "mm_dragon_white", tenets: ["mm_tenet_white", "mm_tenet_white_second", "mm_tenet_white_third"], identity: "mm_royal_white_empress", bloodline: "mm_dragon_branch_white", virtueCount: 6, sinCount: 5 },
  { title: "铸火宗", rite: "mm_dragon_fire", tenets: ["mm_tenet_fire", "mm_tenet_fire_second", "mm_tenet_fire_third"], identity: "mm_royal_fire_king", bloodline: "mm_dragon_branch_fire", virtueCount: 5, sinCount: 5 },
  { title: "冥府宗", rite: "mm_dragon_earth", tenets: ["mm_tenet_earth", "mm_tenet_earth_second", "mm_tenet_earth_third"], identity: "mm_royal_earth_king", bloodline: "mm_dragon_branch_earth", virtueCount: 5, sinCount: 5 },
  { title: "怒潮宗", rite: "mm_dragon_sea", tenets: ["mm_tenet_sea", "mm_tenet_sea_second", "mm_tenet_sea_third"], identity: "mm_royal_sea_king", bloodline: "mm_dragon_branch_sea", virtueCount: 5, sinCount: 5 },
  { title: "风暴宗", rite: "mm_dragon_sky", tenets: ["mm_tenet_sky", "mm_tenet_sky_second", "mm_tenet_sky_third"], identity: "mm_royal_sky_king", bloodline: "mm_dragon_branch_sky", virtueCount: 5, sinCount: 5 }
];

function parseNameList(line, label) {
  const names = line.split(/[、，,]/).map(name => name.trim()).filter(Boolean);
  assert.ok(names.length > 0, `${label}: empty list`);
  return names.map(name => {
    assert.ok(Object.hasOwn(traitIdByName, name), `${label}: unmapped documented trait ${name}`);
    return traitIdByName[name];
  });
}

const documentLines = read("tests/fixtures/v1313-doctrine-document.txt").replace(/\r\n/g, "\n").split("\n");

function sectionFor(title) {
  const start = documentLines.findIndex(line => /^0[1-6]\s+/.test(line) && line.includes(title));
  assert.notEqual(start, -1, `document is missing faith section ${title}`);
  let end = documentLines.findIndex((line, index) => index > start && /^0[1-6]\s+/.test(line));
  if (end === -1) end = documentLines.length;
  return documentLines.slice(start, end);
}

function parseDocumentFaith(faith) {
  const section = sectionFor(faith.title);
  const coreStart = section.findIndex(line => line.trim() === "A. 核心信条与美德／罪恶分配");
  const coreEnd = section.findIndex((line, index) => index > coreStart && line.trim().startsWith("B. 特殊教义"));
  assert.ok(coreStart >= 0 && coreEnd > coreStart, `${faith.title}: documented tenet section is bounded`);
  const core = section.slice(coreStart + 1, coreEnd);
  const headers = [];
  for (let index = 0; index < core.length; index += 1) {
    const match = /^(\d+)\.\s*(.+)$/.exec(core[index].trim());
    if (match) headers.push({ index, number: Number(match[1]), title: match[2] });
  }
  assert.deepEqual(headers.map(header => header.number), [1, 2, 3], `${faith.title}: document specifies three core tenets`);
  const tenets = headers.map((header, index) => {
    const block = core.slice(header.index, headers[index + 1]?.index ?? core.length);
    const virtueHeading = block.findIndex(line => line.trim() === "美德");
    const sinHeading = block.findIndex(line => line.trim() === "罪恶");
    assert.ok(virtueHeading >= 0 && sinHeading > virtueHeading, `${faith.title}/${header.title}: document lists virtues and sins`);
    return {
      title: header.title,
      virtues: parseNameList(block[virtueHeading + 1].trim(), `${faith.title}/${header.title} virtues`),
      sins: parseNameList(block[sinHeading + 1].trim(), `${faith.title}/${header.title} sins`)
    };
  });

  const summaryVirtuesLine = section.find(line => /^美德（\d+）：/.test(line.trim()));
  const summarySinsLine = section.find(line => /^罪恶（\d+）：/.test(line.trim()));
  assert.ok(summaryVirtuesLine && summarySinsLine, `${faith.title}: document has totals`);
  const virtueSummary = /^美德（(\d+)）：(.+)$/.exec(summaryVirtuesLine.trim());
  const sinSummary = /^罪恶（(\d+)）：(.+)$/.exec(summarySinsLine.trim());
  const virtues = tenets.flatMap(tenet => tenet.virtues);
  const sins = tenets.flatMap(tenet => tenet.sins);
  assert.equal(Number(virtueSummary[1]), faith.virtueCount, `${faith.title}: documented virtue total`);
  assert.equal(Number(sinSummary[1]), faith.sinCount, `${faith.title}: documented sin total`);
  assert.deepEqual([...parseNameList(virtueSummary[2], `${faith.title} virtue summary`)].sort(), [...virtues].sort(), `${faith.title}: per-tenet virtues equal the summary`);
  assert.deepEqual([...parseNameList(sinSummary[2], `${faith.title} sin summary`)].sort(), [...sins].sort(), `${faith.title}: per-tenet sins equal the summary`);
  assert.equal(new Set(virtues).size, virtues.length, `${faith.title}: each virtue occurs once in the document`);
  assert.equal(new Set(sins).size, sins.length, `${faith.title}: each sin occurs once in the document`);
  assert.equal(new Set([...virtues, ...sins]).size, virtues.length + sins.length, `${faith.title}: no documented trait is both virtue and sin`);
  return { section, tenets };
}

function parseDocumentDoctrines(section, faithTitle) {
  const start = section.findIndex(line => line.trim() === "C. 主要教义");
  const end = section.findIndex((line, index) => index > start && line.trim() === "本流派特质核对");
  assert.ok(start >= 0 && end > start, `${faithTitle}: documented doctrine tables are bounded`);
  const rows = [];
  const lines = section.slice(start, end);
  for (let index = 0; index < lines.length; index += 1) {
    const category = lines[index].trim();
    if (!Object.hasOwn(doctrineRules, category)) continue;
    const option = lines[index + 1]?.trim();
    assert.ok(option, `${faithTitle}/${category}: selected option exists`);
    assert.ok(Object.hasOwn(doctrineRules[category].options, option), `${faithTitle}/${category}: unmapped selected option ${option}`);
    rows.push({ category, option, id: doctrineRules[category].options[option] });
  }
  assert.equal(rows.length, 24, `${faithTitle}: document selects all 24 doctrine categories`);
  assert.equal(new Set(rows.map(row => row.category)).size, rows.length, `${faithTitle}: each doctrine category is specified once`);
  return rows;
}

const tenetDefinitions = parse("patches/dragon-creed/mod/common/religion/tenet_types/mm_dragon_creed.txt");
const riteDefinitions = parse("patches/dragon-creed/mod/common/religion/rite_types/mm_dragon_creed.txt");
const doctrineDefinitions = parse("patches/dragon-creed/mod/common/religion/doctrine_types/mm_dragon_creed.txt");
const forbiddenSharedVirtues = new Set(["mm_royal_dragon_king", "mm_royal_complete"]);
const doctrineReports = [];
const allTenetIds = faithSpecs.flatMap(faith => faith.tenets);
assert.equal(allTenetIds.length, 18, "the six schools declare eighteen core tenets");
assert.equal(new Set(allTenetIds).size, allTenetIds.length, "each core tenet ID is unique");
const seaFuneral = only(doctrineDefinitions, "mm_doctrine_funeral_sea", "documented sea-burial doctrine");
assert.equal(only(seaFuneral.value, "doctrine_group_type", "documented sea-burial doctrine").value, "doctrine_funeral", "sea burial is offered through CK3's funeral doctrine group");

for (const faith of faithSpecs) {
  const documented = parseDocumentFaith(faith);
  // Preserve the original document fixture; apply the later explicit user amendment.
  if (faith.rite === "mm_dragon_black") {
    assert.ok(documented.tenets[1].sins.includes("mm_dragon_black_blood"));
    documented.tenets[1].sins = documented.tenets[1].sins.filter(id => id !== "mm_dragon_black_blood");
    documented.tenets[1].virtues.push("mm_dragon_black_blood");
  }
  const virtueCount = faith.virtueCount + (faith.rite === "mm_dragon_black" ? 1 : 0);
  const sinCount = faith.sinCount - (faith.rite === "mm_dragon_black" ? 1 : 0);
  const rite = only(riteDefinitions, faith.rite, `${faith.title} rite`);
  const riteTenets = listValues(only(rite.value, "tenets", faith.rite), `${faith.rite} tenets`);
  assert.deepEqual(riteTenets, faith.tenets, `${faith.title}: source rite retains the three documented core tenets`);
  const allVirtues = [];
  const allSins = [];

  for (let index = 0; index < faith.tenets.length; index += 1) {
    const tenetId = faith.tenets[index];
    const tenet = only(tenetDefinitions, tenetId, `${faith.title} tenet definitions`);
    const traits = only(tenet.value, "traits", tenetId);
    const actualVirtues = blockKeys(only(traits.value, "virtues", tenetId), `${tenetId} virtues`);
    const actualSins = blockKeys(only(traits.value, "sins", tenetId), `${tenetId} sins`);
    const expected = documented.tenets[index];
    assert.ok(actualVirtues.length > 0 && actualSins.length > 0, `${tenetId}: both virtue and sin lists are nonempty`);
    assert.equal(new Set(actualVirtues).size, actualVirtues.length, `${tenetId}: no duplicate virtues`);
    assert.equal(new Set(actualSins).size, actualSins.length, `${tenetId}: no duplicate sins`);
    assert.deepEqual([...actualVirtues].sort(), [...expected.virtues].sort(), `${tenetId}: exact documented virtue set`);
    assert.deepEqual([...actualSins].sort(), [...expected.sins].sort(), `${tenetId}: exact documented sin set`);
    for (const shared of forbiddenSharedVirtues) assert.ok(!actualVirtues.includes(shared), `${tenetId}: shared ${shared} is not a virtue`);
    allVirtues.push(...actualVirtues);
    allSins.push(...actualSins);
  }

  assert.equal(allVirtues.length, virtueCount, `${faith.title}: exact virtue count`);
  assert.equal(allSins.length, sinCount, `${faith.title}: exact sin count`);
  assert.equal(new Set(allVirtues).size, allVirtues.length, `${faith.title}: each virtue occurs once across its three tenets`);
  assert.equal(new Set(allSins).size, allSins.length, `${faith.title}: each sin occurs once across its three tenets`);
  assert.equal(new Set([...allVirtues, ...allSins]).size, allVirtues.length + allSins.length, `${faith.title}: no trait is both virtue and sin`);
  assert.equal(allVirtues.filter(id => id === faith.identity).length, 1, `${faith.title}: its dedicated identity is a virtue exactly once`);
  assert.equal(allVirtues.filter(id => id === faith.bloodline).length, 1, `${faith.title}: its separate bloodline is a virtue exactly once`);

  const documentedDoctrines = parseDocumentDoctrines(documented.section, faith.title);
  const sourceDoctrines = listValues(only(rite.value, "doctrines", faith.rite), `${faith.rite} doctrines`);
  const expectedDoctrineIds = documentedDoctrines.map(row => row.id);
  for (const row of documentedDoctrines) {
    const candidates = Object.values(doctrineRules[row.category].options);
    const actual = sourceDoctrines.filter(id => candidates.includes(id));
    if (actual.length !== 1 || actual[0] !== row.id) {
      doctrineReports.push(`${faith.title}/${row.category}: document=${row.option} (${row.id}), source=${actual.join(", ") || "<missing>"}`);
    }
  }
  for (const id of sourceDoctrines.filter(id => id.startsWith("doctrine_") || id.startsWith("mm_doctrine_funeral_"))) {
    if (!expectedDoctrineIds.includes(id)) doctrineReports.push(`${faith.title}: source has undocumented doctrine ${id}`);
  }
}

const expectedIdentityIds = [
  "mm_royal_black_emperor",
  "mm_royal_white_empress",
  "mm_royal_fire_king",
  "mm_royal_earth_king",
  "mm_royal_sea_king",
  "mm_royal_sky_king"
];
const moduleList = JSON.parse(read("modules.json"));

function walkTextFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTextFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".txt") ? [fullPath] : [];
  });
}

const patchTraitFiles = [...new Set(moduleList.flatMap(module => {
  const source = path.join(root, module.source);
  if (module.files) return module.files.filter(file => file.startsWith("common/traits/") && file.endsWith(".txt")).map(file => path.join(source, file));
  return walkTextFiles(path.join(source, "common", "traits"));
}))];

function declaredIn(id, source) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`^[\\t ]*${escaped}[\\t ]*=\\s*\\{`, "gm"))].length;
}

const baseTraitPath = "patches/wyvern-kings/mod/common/traits/mm_royal_traits.txt";
const newTraitPath = "patches/wyvern-kings/mod/common/traits/mm_royal_throne_identity_traits.txt";
for (const id of expectedIdentityIds) {
  const locations = patchTraitFiles.flatMap(file => {
    const count = declaredIn(id, fs.readFileSync(file, "utf8"));
    return count ? [{ file: path.relative(root, file).replaceAll("\\", "/"), count }] : [];
  });
  assert.deepEqual(locations, [{
    file: id === "mm_royal_black_emperor" || id === "mm_royal_white_empress" ? baseTraitPath : newTraitPath,
    count: 1
  }], `${id}: one independent trait definition in the intended source`);
}

const baseTraitZip = path.join(root, "releases/Multi-Mod-Compatibility-1.3.12.zip");
const baseTraitZipEntry = "mod/VOTC_Three_Mod_Character_Name_Compatibility/common/traits/mm_royal_traits.txt";
const zippedBaseline = execFileSync("tar", ["-xOf", baseTraitZip, baseTraitZipEntry]);
assert.deepEqual(fs.readFileSync(path.join(root, baseTraitPath)), zippedBaseline, "generic royal trait source remains byte-identical to the v1.3.12 release ZIP");

const parsedBaseTraits = parse(baseTraitPath);
const parsedNewTraits = parse(newTraitPath);
for (const id of ["mm_royal_black_emperor", "mm_royal_white_empress"]) only(parsedBaseTraits, id, "v1.3.12 royal trait definitions");
const newIdentityNames = {
  mm_royal_fire_king: "青铜与火之王",
  mm_royal_earth_king: "大地与山之王",
  mm_royal_sea_king: "海洋与水之王",
  mm_royal_sky_king: "天空与风之王"
};
const chineseIdentityLocalization = read("patches/wyvern-kings/mod/localization/simp_chinese/mm_royal_throne_identity_l_simp_chinese.yml");
const englishIdentityLocalization = read("patches/wyvern-kings/mod/localization/english/mm_royal_throne_identity_l_english.yml");
function localizedValue(source, key, label) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^[\\t ]*${escaped}:0?\\s+"([^"]+)"`, "m").exec(source);
  assert.ok(match, `${label}: missing ${key}`);
  return match[1];
}
const combatStats = new Set([
  "prowess", "prowess_mult", "prowess_add", "martial", "martial_mult", "martial_add",
  "advantage", "advantage_mult", "damage", "damage_mult", "enemy_hard_casualty_modifier",
  "max_combat_roll", "siege_phase_time", "movement_speed", "movement_speed_mult"
]);
for (const id of expectedIdentityIds.slice(2)) {
  const trait = only(parsedNewTraits, id, "new throne identity trait definitions");
  const stats = allDescendants(trait.value).filter(node => combatStats.has(node.key)).map(node => node.key);
  assert.deepEqual(stats, [], `${id}: identity trait adds no combat stats`);
  assert.equal(localizedValue(chineseIdentityLocalization, `trait_${id}`, "simplified Chinese identity localization"), newIdentityNames[id], `${id}: documented Chinese identity name`);
  assert.ok(localizedValue(chineseIdentityLocalization, `trait_${id}_desc`, "simplified Chinese identity localization").length > 0);
  assert.ok(localizedValue(englishIdentityLocalization, `trait_${id}`, "English identity localization").length > 0);
  assert.ok(localizedValue(englishIdentityLocalization, `trait_${id}_desc`, "English identity localization").length > 0);
}

const identityEffects = parse("patches/wyvern-kings/mod/common/scripted_effects/mm_royal_identity_effects.txt");
const sync = only(identityEffects, "mm_royal_sync_throne_identity_trait_effect", "royal identity effects");
const profileEffects = parse("patches/wyvern-kings/mod/common/scripted_effects/mm_royal_profile_effects.txt");
const repair = only(profileEffects, "mm_royal_repair_profile_effect", "royal profile effects");
assert.equal(descendants(repair.value, sync.key).length, 1, "validated profile repair invokes throne identity synchronization");

const syncNodes = Array.from(sync.value);
const throneIdentities = expectedIdentityIds.slice(2);
const cleared = syncNodes.filter(node => node.key === "remove_trait").map(node => node.value);
assert.deepEqual([...cleared].sort(), [...throneIdentities].sort(), "synchronization clears every elemental identity before assigning the current throne identity");
const assignments = new Map();
for (const branch of syncNodes.filter(node => node.key === "if")) {
  const limit = only(branch.value, "limit", "throne identity branch").value;
  const throne = only(descendants(limit, "var:mm_royal_throne"), "var:mm_royal_throne", "throne identity condition").value;
  const added = descendants(branch.value, "add_trait").map(node => node.value);
  assert.equal(added.length, 1, `throne ${throne}: exactly one identity is added`);
  assert.ok(!assignments.has(throne), `throne ${throne}: only one assignment branch`);
  assignments.set(throne, added[0]);
}
assert.deepEqual([...assignments.entries()].sort(([left], [right]) => Number(left) - Number(right)), [
  ["1", "mm_royal_fire_king"],
  ["2", "mm_royal_earth_king"],
  ["3", "mm_royal_sea_king"],
  ["4", "mm_royal_sky_king"]
], "each valid throne number maps to its dedicated king identity; other throne values leave the cleared set empty");

const physicalMaintenance = parse("patches/wyvern-kings/mod/common/scripted_effects/mm_royal_physical_maintenance.txt");
const monthlyRepair = only(physicalMaintenance, "mm_royal_update_physical_profiles_effect", "royal physical maintenance");
assert.ok(descendants(monthlyRepair.value, "mm_royal_repair_profile_effect").length > 0, "monthly physical maintenance rechecks and repairs throne identity");

if (doctrineReports.length) {
  console.warn("V1.3.13 doctrine option review (reported only; this QA does not rewrite doctrine source):\n" + doctrineReports.map(item => "- " + item).join("\n"));
}
assert.deepEqual(doctrineReports, [], "all selected doctrine options match the revised document");

console.log("v1.3.13 independent tenet, identity, throne synchronization, and doctrine review passed; CK3 runtime not exercised");

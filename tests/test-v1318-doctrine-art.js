'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v1311-finite-helper');

const root = path.resolve(__dirname, '..');
const artworkRoot = 'artwork/dragon-doctrine-illustrations';
const modRoot = 'patches/dragon-creed/mod';
const branchNames = [
  ['black', ['血脉压制', '纯血圣约', '僭越审判']],
  ['white', ['精神共鸣', '灵血觉醒', '意识涤罪']],
  ['fire', ['百炼龙火', '宗庙血嗣', '焰刑正俗']],
  ['earth', ['地脉安魂', '地脉承嗣', '地之封闭']],
  ['sea', ['潮汐霸权', '海脉联姻', '海之风韵']],
  ['sky', ['风之轻盈', '战血淬炼', '血鹰裁决']]
];
const suffixes = ['', '_second', '_third'];
const expected = branchNames.flatMap(([branch, names]) => names.map((name, index) => ({
  id: `mm_tenet_${branch}${suffixes[index]}`,
  name,
  kind: 'tenet',
  width: 260,
  height: 400
}))).concat([
  ['black', '始祖再临'],
  ['white', '逆命神谕'],
  ['fire', '铸火匠心'],
  ['earth', '冥府守序'],
  ['sea', '怒潮之誓'],
  ['sky', '风暴之翼']
].map(([branch, name]) => ({
  id: `mm_doctrine_${branch}`,
  name,
  kind: 'doctrine',
  width: 120,
  height: 120
})));

function relativePath(file, label) {
  assert.equal(typeof file, 'string', label + ' path must be a string');
  const normalized = file.replace(/\\/g, '/');
  assert.ok(normalized.length > 0 && !normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized), label + ' path must be project-relative');
  assert.ok(!normalized.split('/').includes('..'), label + ' path must not escape the project');
  return normalized;
}

function projectPath(file, label) {
  const normalized = relativePath(file, label);
  const absolute = path.resolve(root, normalized);
  const fromRoot = path.relative(root, absolute);
  assert.ok(fromRoot && fromRoot !== '..' && !fromRoot.startsWith('..' + path.sep) && !path.isAbsolute(fromRoot), label + ' path must stay inside the project');
  return absolute;
}

function readProject(file, label) {
  return fs.readFileSync(projectPath(file, label));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertSha256(value, label) {
  assert.match(value, /^[a-f0-9]{64}$/, label + ' must be a lowercase SHA-256');
}

function only(nodes, key, label) {
  const matches = nodes.filter(node => node.key === key);
  assert.equal(matches.length, 1, label + ': expected one ' + key);
  return matches[0];
}

function localizationValue(source, key) {
  const lines = source.split(/\r?\n/).filter(line => new RegExp('^[\\t ]*' + key + ':0?\\s+').test(line));
  assert.equal(lines.length, 1, key + ': expected one localized name');
  const match = /^[\t ]*[^:]+:0?\s+"(.*)"\s*$/.exec(lines[0]);
  assert.ok(match && match[1].length > 0, key + ': expected a nonempty quoted name');
  return match[1];
}

function dxt5AlphaRange(bytes, width, height, label) {
  assert.ok(bytes.length >= 128, label + ' DDS header is truncated');
  assert.equal(bytes.toString('ascii', 0, 4), 'DDS ', label + ' must have DDS magic');
  assert.equal(bytes.readUInt32LE(4), 124, label + ' must have a valid DDS header');
  assert.equal(bytes.readUInt32LE(76), 32, label + ' must have a valid pixel-format header');
  assert.ok((bytes.readUInt32LE(80) & 0x4) !== 0, label + ' must declare a FOURCC pixel format');
  assert.equal(bytes.toString('ascii', 84, 88), 'DXT5', label + ' must use DXT5/BC3 alpha');
  assert.equal(bytes.readUInt32LE(16), width, label + ' DDS width must match the manifest');
  assert.equal(bytes.readUInt32LE(12), height, label + ' DDS height must match the manifest');

  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  assert.ok(bytes.length >= 128 + blocksWide * blocksHigh * 16, label + ' DXT5 base level is truncated');
  let min = 255;
  let max = 0;
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const offset = 128 + (blockY * blocksWide + blockX) * 16;
      const alpha0 = bytes[offset];
      const alpha1 = bytes[offset + 1];
      const bits = bytes.readUIntLE(offset + 2, 6);
      const palette = [alpha0, alpha1];
      if (alpha0 > alpha1) {
        for (let index = 2; index < 8; index += 1) palette[index] = Math.floor(((8 - index) * alpha0 + (index - 1) * alpha1) / 7);
      } else {
        for (let index = 2; index < 6; index += 1) palette[index] = Math.floor(((6 - index) * alpha0 + (index - 1) * alpha1) / 5);
        palette[6] = 0;
        palette[7] = 255;
      }
      for (let pixel = 0; pixel < 16; pixel += 1) {
        const x = blockX * 4 + pixel % 4;
        const y = blockY * 4 + Math.floor(pixel / 4);
        if (x >= width || y >= height) continue;
        const alpha = palette[Math.floor(bits / (2 ** (pixel * 3))) & 7];
        min = Math.min(min, alpha);
        max = Math.max(max, alpha);
      }
    }
  }
  return { min, max };
}

const manifest = JSON.parse(readProject(artworkRoot + '/manifest.json', 'art manifest').toString('utf8').replace(/^\uFEFF/, ''));
const fixture = JSON.parse(readProject('tests/fixtures/v1318-art-baseline.json', 'v1.3.17 art baseline fixture').toString('utf8').replace(/^\uFEFF/, ''));
assert.equal(fixture.archiveSHA, '053ab5334f7f41334252b854ea4707de8f27f9fd2f87269bce2133c820d33205', 'fixture must identify the archived v1.3.17 baseline');
assertSha256(fixture.documentSha256, 'fixture documentSha256');
assertSha256(manifest.documentSha256, 'manifest documentSha256');
assert.equal(manifest.documentSha256, fixture.documentSha256, 'manifest must reference the audited source document');
assert.equal(fixture.sourceImages.length, 24, 'source fixture must contain the 24 referenced illustrations');
assertSha256(fixture.baseline.tenetTypesSha256, 'fixture tenet AST hash');
assertSha256(fixture.baseline.doctrineTypesSha256, 'fixture doctrine AST hash');
assert.equal(sha256(Buffer.from(fixture.baseline.tenetTypesText, 'utf8')), fixture.baseline.tenetTypesSha256, 'fixture tenet baseline hash');
assert.equal(sha256(Buffer.from(fixture.baseline.doctrineTypesText, 'utf8')), fixture.baseline.doctrineTypesSha256, 'fixture doctrine baseline hash');
assert.equal(manifest.assets.length, expected.length, 'manifest must contain exactly 24 assets');

const sourceByName = new Map(fixture.sourceImages.map(image => [image.name, image]));
assert.equal(sourceByName.size, fixture.sourceImages.length, 'source image names must be unique');
assert.deepEqual([...sourceByName.keys()].sort(), expected.map(asset => asset.name).sort(), 'source image names must match the 24 mapped illustrations');
assert.equal(fixture.sourceImages.filter(image => image.hasAlpha).length, 15, '15 source images already have transparency');
assert.equal(fixture.sourceImages.filter(image => !image.hasAlpha).length, 9, '9 source images need background removal');
const assetById = new Map(manifest.assets.map(asset => [asset.id, asset]));
assert.equal(assetById.size, manifest.assets.length, 'manifest IDs must be unique');
assert.deepEqual([...assetById.keys()].sort(), expected.map(asset => asset.id).sort(), 'manifest IDs must match the 18 tenets and 6 doctrines');
assert.equal(new Set(manifest.assets.map(asset => asset.iconKey)).size, 24, 'each asset must have a unique icon key');

const locPath = modRoot + '/localization/simp_chinese/mm_dragon_v1311_l_simp_chinese.yml';
const localization = readProject(locPath, 'Chinese tenet/doctrine localization').toString('utf8').replace(/^\uFEFF/, '');
const ddsFiles = new Set();
const originalFiles = new Set();
const preparedFiles = new Set();
for (const expectedAsset of expected) {
  const asset = assetById.get(expectedAsset.id);
  assert.equal(asset.name, expectedAsset.name, expectedAsset.id + ' name');
  assert.equal(asset.kind, expectedAsset.kind, expectedAsset.id + ' kind');
  assert.equal(asset.iconKey, 'mm_v1318_' + expectedAsset.id, expectedAsset.id + ' icon key');
  assert.equal(localizationValue(localization, expectedAsset.id + '_name'), expectedAsset.name, expectedAsset.id + ' localized name');
  assertSha256(asset.original.sha256, expectedAsset.id + ' original hash');
  assertSha256(asset.prepared.sha256, expectedAsset.id + ' prepared hash');
  assertSha256(asset.dds.sha256, expectedAsset.id + ' DDS hash');
  assert.equal(typeof asset.prepared.method, 'string');
  assert.ok(asset.prepared.method.length > 0, expectedAsset.id + ' preparation method');

  const originalFile = relativePath(asset.original.file, expectedAsset.id + ' original');
  const preparedFile = relativePath(asset.prepared.file, expectedAsset.id + ' prepared');
  assert.ok(originalFile.startsWith(artworkRoot + '/'), expectedAsset.id + ' original copy must be retained under the artwork directory');
  assert.ok(preparedFile.startsWith(artworkRoot + '/'), expectedAsset.id + ' prepared image must stay under the artwork directory');
  const source = sourceByName.get(expectedAsset.name);
  assert.equal(asset.original.sha256, source.sha256, expectedAsset.id + ' original copy must match the source-image fixture');
  assert.equal(sha256(readProject(originalFile, expectedAsset.id + ' original')), asset.original.sha256, expectedAsset.id + ' original copy hash');
  const preparedBytes = readProject(preparedFile, expectedAsset.id + ' prepared');
  assert.equal(sha256(preparedBytes), asset.prepared.sha256, expectedAsset.id + ' prepared image hash');
  if (source.hasAlpha) {
    assert.equal(originalFile, preparedFile, expectedAsset.id + ' existing transparent art must reuse the archived original');
    assert.equal(asset.prepared.method, 'original-alpha-preserved', expectedAsset.id + ' original alpha method');
    assert.equal(asset.prepared.sha256, asset.original.sha256, expectedAsset.id + ' preserved original hash');
  } else {
    assert.notEqual(originalFile, preparedFile, expectedAsset.id + ' background-removed art must have a separate prepared copy');
    assert.notEqual(asset.prepared.sha256, asset.original.sha256, expectedAsset.id + ' edited image must differ from its original');
    assert.notEqual(asset.prepared.method, 'original-alpha-preserved', expectedAsset.id + ' edited image preparation method');
  }
  assert.ok(!originalFiles.has(originalFile), expectedAsset.id + ' original copy path must be unique');
  assert.ok(!preparedFiles.has(preparedFile), expectedAsset.id + ' prepared image path must be unique');
  originalFiles.add(originalFile);
  preparedFiles.add(preparedFile);

  const iconDirectory = expectedAsset.kind === 'tenet' ? 'faith_tenets' : 'faith_doctrines';
  const ddsFile = `${modRoot}/gfx/interface/icons/${iconDirectory}/${asset.iconKey}.dds`;
  assert.equal(relativePath(asset.dds.file, expectedAsset.id + ' DDS'), ddsFile, expectedAsset.id + ' DDS path');
  assert.equal(asset.dds.width, expectedAsset.width, expectedAsset.id + ' manifest width');
  assert.equal(asset.dds.height, expectedAsset.height, expectedAsset.id + ' manifest height');
  assert.ok(!ddsFiles.has(ddsFile), expectedAsset.id + ' DDS path must be unique');
  ddsFiles.add(ddsFile);
  const dds = readProject(ddsFile, expectedAsset.id + ' DDS');
  assert.equal(sha256(dds), asset.dds.sha256, expectedAsset.id + ' DDS hash');
  const alpha = dxt5AlphaRange(dds, expectedAsset.width, expectedAsset.height, expectedAsset.id);
  assert.equal(alpha.min, 0, expectedAsset.id + ' must contain transparent texels');
  assert.ok(alpha.max >= 200, expectedAsset.id + ' must contain substantially opaque texels');
}

const currentReligion = modRoot + '/common/religion/';
const h = createHarness([]);

function readPdx(relative, label) {
  return h.parsePdx(readProject(relative, label).toString('utf8').replace(/^\uFEFF/, ''), label);
}

function parseFixturePdx(source, label) {
  return h.parsePdx(source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), label);
}

function compareOnlyIconChanges(relativeCurrent, baselineText, assets, label) {
  const current = readPdx(relativeCurrent, label + ' current AST');
  const baseline = parseFixturePdx(baselineText, label + ' v1.3.17 fixture AST');
  const baselineById = new Map(baseline.map(node => [node.key, node]));
  assert.equal(baselineById.size, baseline.length, label + ' baseline IDs must be unique');
  if (label === 'tenet') {
    // The immutable illustration fixture predates the 2026-10-29 user amendment.
    const traits = only(only(baseline, 'mm_tenet_black_second', label).value, 'traits', label).value;
    const sins = only(traits, 'sins', label).value;
    const blood = only(sins, 'mm_dragon_black_blood', label);
    sins.splice(sins.indexOf(blood), 1);
    only(traits, 'virtues', label).value.push(blood);
  }
  for (const asset of assets) {
    const currentDefinition = only(current, asset.id, label + ' current');
    const baselineDefinition = only(baseline, asset.id, label + ' baseline');
    const currentIcon = only(currentDefinition.value, 'icon', asset.id);
    const baselineIcon = only(baselineDefinition.value, 'icon', asset.id);
    assert.equal(currentIcon.value, asset.iconKey, asset.id + ' must reference its new art key');
    currentIcon.value = baselineIcon.value;
  }
  assert.equal(JSON.stringify(current), JSON.stringify(baseline), label + ' AST may differ only in the 24 requested icon values');
}

const tenets = expected.filter(asset => asset.kind === 'tenet').map(asset => ({ ...asset, iconKey: 'mm_v1318_' + asset.id }));
const doctrines = expected.filter(asset => asset.kind === 'doctrine').map(asset => ({ ...asset, iconKey: 'mm_v1318_' + asset.id }));
const currentTenetAst = readPdx(currentReligion + 'tenet_types/mm_dragon_creed.txt', 'current tenets');
const baselineTenetAst = parseFixturePdx(fixture.baseline.tenetTypesText, 'v1.3.17 fixture tenets');
for (const id of ['mm_tenet_blood_purification', 'mm_tenet_death_servant_punishment']) {
  assert.equal(JSON.stringify(only(currentTenetAst, id, 'current tenets')), JSON.stringify(only(baselineTenetAst, id, 'v1.3.17 tenets')), id + ' must remain unchanged');
}
compareOnlyIconChanges(currentReligion + 'tenet_types/mm_dragon_creed.txt', fixture.baseline.tenetTypesText, tenets, 'tenet');
compareOnlyIconChanges(currentReligion + 'doctrine_types/mm_dragon_creed.txt', fixture.baseline.doctrineTypesText, doctrines, 'doctrine');

console.log('v1.3.18 doctrine-art static asset checks passed');

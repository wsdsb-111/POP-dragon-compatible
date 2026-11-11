'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v1311-finite-helper');

const root = path.resolve(__dirname, '..');
const modRoot = 'patches/dragon-creed/mod';
const artworkManifestPath = 'artwork/dragon-doctrine-illustrations/manifest.json';
const fixturePath = 'tests/fixtures/v1319-layout-baseline.json';
const safeBox = [30, 108, 200, 224];
const titleBand = [0, 336, 260, 400];
const cardSize = [130, 200];
const iconOffset = [0, -10];
const cardScale = 0.5;
const titleSize = [118, 32];
const viewHelper = "GetScriptedGui( 'mm_v1314_is_creed_view' ).IsShown( GuiScope.SetRoot( Faith.MakeScope ).End )";

function projectPath(file, label) {
  assert.equal(typeof file, 'string', label + ' path must be a string');
  const normalized = file.replace(/\\/g, '/');
  assert.ok(normalized.length > 0 && !normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized), label + ' path must be project-relative');
  assert.ok(!normalized.split('/').includes('..'), label + ' path must not escape the project');
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

function normalizeLf(value) {
  return value.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
}

function extractBlock(source, marker, fromIndex = 0) {
  const start = source.indexOf(marker, fromIndex);
  assert.ok(start >= 0, 'missing block marker: ' + marker);
  const markerOpen = marker.indexOf('{');
  const open = markerOpen >= 0 ? start + markerOpen : source.indexOf('{', start + marker.length);
  assert.ok(open >= 0, 'missing opening brace for: ' + marker);

  let depth = 0;
  let quoted = false;
  let escaped = false;
  let comment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === '\n') comment = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '#') {
      comment = true;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(start, index + 1), start, end: index + 1 };
    }
  }
  assert.fail('unclosed block: ' + marker);
}

function only(nodes, key, label) {
  const matches = nodes.filter(node => node.key === key);
  assert.equal(matches.length, 1, label + ': expected one ' + key);
  return matches[0];
}

function property(block, key, label) {
  const matches = block.split(/\r?\n/)
    .map(line => /^[\t ]*([a-zA-Z_]+)\s*=\s*(.*?)\s*$/.exec(line))
    .filter(match => match && match[1] === key);
  assert.equal(matches.length, 1, label + ': expected one ' + key + ' property');
  return matches[0][2];
}

function unquote(value, label) {
  assert.ok(value.startsWith('"') && value.endsWith('"'), label + ' must be quoted');
  return value.slice(1, -1);
}

function normalizeExpression(value) {
  return value.replace(/\s+/g, '');
}

function roundHalfEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < 1e-12) return lower % 2 === 0 ? lower : lower + 1;
  return Math.round(value);
}

function modRelativePath(file, label) {
  const normalized = file.replace(/\\/g, '/');
  const prefix = modRoot + '/';
  assert.ok(normalized.startsWith(prefix), label + ' must be inside the Dragon Creed module');
  return normalized.slice(prefix.length);
}

function decodeDxt5Alpha(bytes, width, height, label) {
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
  const alpha = new Uint8Array(width * height);
  let min = 255;
  let max = 0;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  let occupied = 0;

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
        const value = palette[Math.floor(bits / (2 ** (pixel * 3))) & 7];
        alpha[y * width + x] = value;
        min = Math.min(min, value);
        max = Math.max(max, value);
        if (value > 0) {
          occupied += 1;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
  }

  assert.ok(occupied > 0, label + ' must contain visible pixels');
  return { alpha, min, max, bounds: [left, top, right, bottom] };
}

function normalizedTenetAst(source, customIds, label) {
  const harness = createHarness([]);
  const parsed = harness.parsePdx(normalizeLf(source), label);
  if (label === 'baseline tenet definitions') {
    // Preserve the archived bytes, then apply the later explicit Black Blood amendment.
    const tenet = parsed.find(node => node.key === 'mm_tenet_black_second');
    const traits = tenet.value.find(node => node.key === 'traits').value;
    const sins = traits.find(node => node.key === 'sins').value;
    const index = sins.findIndex(node => node.key === 'mm_dragon_black_blood');
    assert.ok(index >= 0, 'archived fixture contains the superseded Black Blood sin');
    traits.find(node => node.key === 'virtues').value.push(sins.splice(index, 1)[0]);
  }
  for (const id of customIds) {
    const definition = only(parsed, id, label);
    const icon = only(definition.value, 'icon', id + ' icon');
    assert.equal(typeof icon.value, 'string', id + ' icon must remain a resource key');
    icon.value = '<custom-tenet-art>';
  }
  return JSON.stringify(parsed);
}

const fixture = JSON.parse(readProject(fixturePath, 'v1.3.18 layout baseline fixture').toString('utf8').replace(/^\uFEFF/, ''));
const baseline = fixture.baseline;
assert.ok(baseline && typeof baseline.version === 'string', 'fixture must identify its v1.3.18 source package');
assertSha256(baseline.archiveSha256, 'baseline archive hash');
assertSha256(baseline.packageManifestSha256, 'baseline package manifest hash');
assertSha256(baseline.gui.sha256, 'baseline GUI file hash');
assertSha256(baseline.gui.widgetTenetItemSha256, 'baseline widget hash');
assertSha256(baseline.tenetTypes.sha256, 'baseline tenet types hash');
assertSha256(baseline.font.sha256, 'baseline font hash');
assert.equal(sha256(Buffer.from(baseline.gui.widgetTenetItemText, 'utf8')), baseline.gui.widgetTenetItemSha256, 'fixture widget text must match its frozen hash');
const rawTenetText = baseline.tenetTypes.text;
const decodedTenetText = rawTenetText.replace(/^\uFEFF/, '');
const normalizedTenetText = normalizeLf(rawTenetText);
assert.equal(rawTenetText.startsWith('\uFEFF'), true, 'raw baseline tenet text retains the UTF-8 BOM from the package');
assert.equal(sha256(Buffer.from(rawTenetText, 'utf8')), baseline.tenetTypes.sha256, 'fixture raw tenet text must match its frozen package hash');
assertSha256(baseline.tenetTypes.decodedTextSha256, 'BOM-stripped baseline text hash');
assertSha256(baseline.tenetTypes.normalizedTextSha256, 'normalized baseline text hash');
assert.equal(sha256(Buffer.from(decodedTenetText, 'utf8')), baseline.tenetTypes.decodedTextSha256, 'BOM-stripped text hash is recorded separately');
assert.equal(sha256(Buffer.from(normalizedTenetText, 'utf8')), baseline.tenetTypes.normalizedTextSha256, 'BOM/CRLF-normalized text hash is recorded separately');
assert.equal(baseline.tenetTypes.rawEvidence.stageAndArchiveEntryBytesEqual, true, 'baseline stage and ZIP entry were byte-identical');
assert.equal(baseline.tenetTypes.rawEvidence.byteLength, Buffer.byteLength(rawTenetText, 'utf8'), 'raw baseline byte length');
assert.equal(baseline.tenetTypes.rawEvidence.stageSha256, baseline.tenetTypes.sha256, 'raw stage hash matches the frozen hash');
assert.equal(baseline.tenetTypes.rawEvidence.archiveEntrySha256, baseline.tenetTypes.sha256, 'raw ZIP-entry hash matches the frozen hash');
assert.equal(sha256(readProject(modRoot + '/fonts/mm_v1314_tenet_upright.font', 'tenet font')), baseline.font.sha256, 'the referenced custom font definition remains unchanged');

const artwork = JSON.parse(readProject(artworkManifestPath, 'illustration manifest').toString('utf8').replace(/^\uFEFF/, ''));
const tenetAssets = artwork.assets.filter(asset => asset.kind === 'tenet');
const doctrineAssets = artwork.assets.filter(asset => asset.kind === 'doctrine');
assert.equal(tenetAssets.length, 18, 'layout applies to exactly the 18 custom tenet illustrations');
assert.equal(doctrineAssets.length, 6, 'the six special-doctrine illustrations remain a separate asset group');
const assetsById = new Map(tenetAssets.map(asset => [asset.id, asset]));
assert.equal(assetsById.size, tenetAssets.length, 'custom tenet asset IDs must be unique');
assert.ok(tenetAssets.every(asset => asset.id && asset.iconKey), 'each custom tenet asset must keep its semantic ID and icon key');

const currentTenetBytes = readProject(modRoot + '/common/religion/tenet_types/mm_dragon_creed.txt', 'custom tenet definitions');
const currentTenetText = currentTenetBytes.toString('utf8');
const baselineAst = createHarness([]).parsePdx(normalizeLf(baseline.tenetTypes.text), 'baseline tenet definitions');
const baselineCustomIds = Array.from(baselineAst).filter(node => {
  if (!node.key.startsWith('mm_tenet_') || !Array.isArray(node.value)) return false;
  const icons = node.value.filter(child => child.key === 'icon');
  return icons.length === 1 && typeof icons[0].value === 'string' && icons[0].value.startsWith('mm_');
}).map(node => node.key).sort();
const assetIds = tenetAssets.map(asset => asset.id).sort();
assert.deepEqual(assetIds, baselineCustomIds, 'the custom tenet ID set must remain the same as the frozen package');
assert.equal(normalizedTenetAst(currentTenetText, baselineCustomIds, 'current tenet definitions'), normalizedTenetAst(baseline.tenetTypes.text, baselineCustomIds, 'baseline tenet definitions'), 'tenet modifiers, virtues, sins, visibility, and other semantics remain unchanged apart from icon resource keys');
const currentTenetAst = createHarness([]).parsePdx(normalizeLf(currentTenetText), 'current tenet icon references');
for (const asset of tenetAssets) {
  const definition = only(currentTenetAst, asset.id, 'current tenet definition');
  assert.equal(only(definition.value, 'icon', asset.id + ' icon').value, asset.iconKey, asset.id + ' must keep its manifest icon mapping');
  const iconPath = modRelativePath(asset.dds.file, asset.id + ' DDS');
  assert.equal(path.posix.basename(iconPath), asset.iconKey + '.dds', asset.id + ' DDS path must match its icon key');
}

const baselineDoctrineDds = new Map(baseline.doctrineDds.map(asset => [asset.path, asset.sha256]));
assert.equal(baselineDoctrineDds.size, 6, 'fixture must freeze six v1.3.18 doctrine DDS hashes');
const currentDoctrinePaths = [];
for (const asset of doctrineAssets) {
  const relative = modRelativePath(asset.dds.file, asset.id + ' doctrine DDS');
  const baselineHash = baselineDoctrineDds.get(relative);
  assertSha256(baselineHash, asset.id + ' frozen doctrine DDS hash');
  const bytes = readProject(asset.dds.file, asset.id + ' doctrine DDS');
  assert.equal(sha256(bytes), baselineHash, asset.id + ' DDS bytes remain identical to the v1.3.18 package');
  assert.equal(asset.dds.sha256, baselineHash, asset.id + ' manifest hash remains identical to the v1.3.18 package');
  currentDoctrinePaths.push(relative);
}
assert.deepEqual(currentDoctrinePaths.sort(), [...baselineDoctrineDds.keys()].sort(), 'only the same six special-doctrine textures are frozen');

const guiSource = normalizeLf(readProject(modRoot + '/gui/window_faith.gui', 'faith window GUI').toString('utf8'));
const baselineWidget = extractBlock(normalizeLf(baseline.gui.widgetTenetItemText), 'type widget_tenet_item = widget');
const currentWidget = extractBlock(guiSource, 'type widget_tenet_item = widget');
assert.match(currentWidget.text, /^\t\tsize = \{ 130 200 \}$/m, 'native tenet card remains 130x200');

const baselineBackground = extractBlock(baselineWidget.text, 'highlight_icon = {');
const currentBackground = extractBlock(currentWidget.text, 'highlight_icon = {');
assert.equal(currentBackground.text, baselineBackground.text, 'native background-icon lookup remains unchanged');
const baselineIcon = extractBlock(baselineWidget.text, 'block "tenet_icon"');
const currentIcon = extractBlock(currentWidget.text, 'block "tenet_icon"');
assert.equal(currentIcon.text, baselineIcon.text, 'native tenet icon widget and semantic icon lookup remain unchanged');
assert.match(currentIcon.text, /position = \{ 0 -10 \}/, 'native tenet icon vertical offset remains unchanged');
assert.match(currentIcon.text, /size = \{ 130 200 \}/, 'native tenet icon widget remains 130x200');

const baselineVbox = extractBlock(baselineWidget.text, 'vbox = {');
const currentVbox = extractBlock(currentWidget.text, 'vbox = {');
const currentVboxLines = currentVbox.text.split('\n');
assert.match(currentVboxLines[1], /^\s*visible\s*=/, 'only the existing title vbox receives a new visibility gate');
const ordinaryVisibilityLine = /^\s*visible\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(currentVboxLines[1]);
assert.ok(ordinaryVisibilityLine, 'ordinary-faith visibility must be a single visible property');
const ordinaryVisibility = unquote(ordinaryVisibilityLine[1], 'ordinary-faith visibility');
assert.equal(
  normalizeExpression(ordinaryVisibility),
  normalizeExpression('[Not( ' + viewHelper + ' )]'),
  'the original title vbox remains visible outside the custom creed view'
);
currentVboxLines.splice(1, 1);
assert.equal(currentVboxLines.join('\n'), baselineVbox.text, 'the original title vbox contents, text, and font remain unchanged');

const currentTextbox = extractBlock(currentWidget.text, 'textbox = {', currentVbox.end);
assert.ok(currentTextbox.start > currentVbox.end, 'custom title textbox is a sibling after the preserved vbox');
const textboxLineStart = currentWidget.text.lastIndexOf('\n', currentTextbox.start - 1) + 1;
assert.equal(currentWidget.text.slice(textboxLineStart, currentTextbox.start), '\t\t', 'custom title textbox is a direct child of widget_tenet_item');
assert.match(property(currentTextbox.text, 'name', 'custom title textbox'), /^"mm_v\d+_tenet_name"$/, 'custom textbox has a version-neutral unique widget name');
assert.equal(property(currentTextbox.text, 'font', 'custom title textbox'), 'MMDragonTenetUpright');
assert.equal(property(currentTextbox.text, 'size', 'custom title textbox').replace(/\s+/g, ''), '{11832}');
assert.equal(property(currentTextbox.text, 'autoresize', 'custom title textbox'), 'no');
assert.equal(property(currentTextbox.text, 'parentanchor', 'custom title textbox'), 'bottom|hcenter');
assert.equal(property(currentTextbox.text, 'widgetanchor', 'custom title textbox'), 'bottom|hcenter');
assert.equal(property(currentTextbox.text, 'position', 'custom title textbox').replace(/\s+/g, ''), '{0-10}');
assert.equal(property(currentTextbox.text, 'fontsize', 'custom title textbox'), '18');
assert.equal(property(currentTextbox.text, 'fontsize_min', 'custom title textbox'), '12');
assert.equal(property(currentTextbox.text, 'multiline', 'custom title textbox'), 'yes');
assert.equal(property(currentTextbox.text, 'align', 'custom title textbox'), 'center|nobaseline');
assert.equal(property(currentTextbox.text, 'elide', 'custom title textbox'), 'right');
assert.equal(property(currentTextbox.text, 'text', 'custom title textbox'), '"[TenetType.GetBaseNameNoTooltip]"');
assert.doesNotMatch(currentTextbox.text, /^[\t ]*(?:background|using)\s*=/m, 'fixed textbox does not inherit the centered label background or font-size template');
const customVisibility = unquote(property(currentTextbox.text, 'visible', 'custom title textbox'), 'custom title visibility');
assert.equal(
  normalizeExpression(customVisibility),
  normalizeExpression('[And( TenetType.IsValid, ' + viewHelper + ' )]'),
  'the fixed title textbox is limited to valid tenets in the custom creed view'
);

for (const asset of tenetAssets) {
  const label = asset.id;
  assert.equal(asset.dds.width, 260, label + ' DDS canvas width');
  assert.equal(asset.dds.height, 400, label + ' DDS canvas height');
  assert.equal(asset.layout.fit, 'contain', label + ' must use proportional contain fitting');
  assert.deepEqual(asset.layout.safeBox, safeBox, label + ' safe box');
  assert.deepEqual(asset.layout.reservedTitleArea, titleBand, label + ' title-band reservation');
  assert.equal(asset.layout.cardScale, cardScale, label + ' GUI-to-texture scale');
  assert.deepEqual(asset.layout.cardIconOffset, iconOffset, label + ' native icon-widget offset');
  assert.equal(asset.layout.sourceAspectPreserved, true, label + ' aspect preservation metadata');

  const [sourceLeft, sourceTop, sourceRight, sourceBottom] = asset.layout.sourceAlphaBBox;
  assert.ok(sourceRight > sourceLeft && sourceBottom > sourceTop, label + ' source alpha bounds');
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;
  const [safeLeft, safeTop, safeWidth, safeHeight] = safeBox;
  const scale = Math.min(safeWidth / sourceWidth, safeHeight / sourceHeight);
  const fittedWidth = Math.max(1, roundHalfEven(sourceWidth * scale));
  const fittedHeight = Math.max(1, roundHalfEven(sourceHeight * scale));
  const expectedRect = [
    safeLeft + Math.floor((safeWidth - fittedWidth) / 2),
    safeTop + Math.floor((safeHeight - fittedHeight) / 2),
    fittedWidth,
    fittedHeight
  ];
  assert.deepEqual(asset.layout.placedRect, expectedRect, label + ' centered proportional placement');
  const [placedLeft, placedTop, placedWidth, placedHeight] = asset.layout.placedRect;
  assert.ok(placedLeft >= safeLeft && placedTop >= safeTop, label + ' placed art starts inside the safe box');
  assert.ok(placedLeft + placedWidth <= safeLeft + safeWidth && placedTop + placedHeight <= safeTop + safeHeight, label + ' placed art ends inside the safe box');
  const widthScale = placedWidth / sourceWidth;
  const heightScale = placedHeight / sourceHeight;
  assert.ok(Math.abs(widthScale - heightScale) <= (1 / sourceWidth) + (1 / sourceHeight), label + ' source aspect ratio remains within one-pixel rounding');

  const bounds = decodeDxt5Alpha(readProject(asset.dds.file, label + ' tenet DDS'), 260, 400, label);
  assert.equal(bounds.min, 0, label + ' must preserve transparent texels');
  assert.ok(bounds.max >= 200, label + ' must preserve opaque artwork');
  const [alphaLeft, alphaTop, alphaRight, alphaBottom] = bounds.bounds;
  assert.ok(alphaLeft >= safeLeft && alphaTop >= safeTop, label + ' decoded alpha starts inside the safe box');
  assert.ok(alphaRight <= safeLeft + safeWidth && alphaBottom <= safeTop + safeHeight, label + ' decoded alpha ends inside the safe box');
  assert.ok(alphaBottom <= titleBand[1], label + ' decoded alpha clears the reserved title band');
  for (let y = 0; y < 400; y += 1) {
    for (let x = 0; x < 260; x += 1) {
      const alpha = bounds.alpha[y * 260 + x];
      if (alpha === 0) continue;
      assert.ok(x >= safeLeft && x < safeLeft + safeWidth && y >= safeTop && y < safeTop + safeHeight, label + ' has no nontransparent pixel outside its safe box');
      assert.ok(y < titleBand[1] || y >= titleBand[3] || x < titleBand[0] || x >= titleBand[2], label + ' has no nontransparent pixel in the title band');
    }
  }

  const screenLeft = safeLeft * cardScale + iconOffset[0];
  const screenRight = (safeLeft + safeWidth) * cardScale + iconOffset[0];
  const screenTop = safeTop * cardScale + iconOffset[1];
  const screenBottom = (safeTop + safeHeight) * cardScale + iconOffset[1];
  assert.deepEqual([screenLeft, screenTop, screenRight, screenBottom], [15, 44, 115, 156], label + ' safe box maps to the centered in-card region');
  assert.equal((screenLeft + screenRight) / 2, 65, label + ' safe box center x');
  assert.equal((screenTop + screenBottom) / 2, 100, label + ' safe box center y');
  const titleTop = cardSize[1] + iconOffset[1] - titleSize[1];
  assert.equal(titleTop, 158, label + ' fixed title top edge');
  assert.ok(titleTop - screenBottom >= 2, label + ' has at least two GUI pixels of clearance before the title box');
}

console.log('independent tenet-layout and icon-semantics checks defined; CK3 rendering not exercised');

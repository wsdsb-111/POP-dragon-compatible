"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "v131", "royal-icons-contract.json"), "utf8"));
const iconRoot = path.join(root, fixture.iconDirectory);
const operators = new Set(["?=", ">=", "<=", "!=", "==", "=", ">", "<"]);

function resolveRootFile(relative, label) {
  assert.equal(typeof relative, "string", label + " path is missing");
  const file = path.resolve(root, relative);
  assert.ok(file.startsWith(root + path.sep), label + " must stay inside the repository");
  assert.ok(fs.existsSync(file), label + " is missing: " + relative);
  return file;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function tokenize(source, label) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === '"') {
      index += 1;
      let value = "";
      let closed = false;
      while (index < source.length) {
        const next = source[index++];
        if (next === "\\" && index < source.length) value += source[index++];
        else if (next === '"') {
          closed = true;
          break;
        } else value += next;
      }
      assert.ok(closed, label + " has an unterminated quoted value");
      tokens.push(value);
      continue;
    }
    const operator = ["?=", ">=", "<=", "!=", "==", "=", ">", "<"]
      .find(candidate => source.startsWith(candidate, index));
    if (operator) {
      tokens.push(operator);
      index += operator.length;
      continue;
    }
    if (character === "{" || character === "}") {
      tokens.push(character);
      index += 1;
      continue;
    }
    const start = index;
    while (index < source.length && !/[\s{}#"=<>?]/.test(source[index])) index += 1;
    assert.ok(index > start, label + " has an unsupported token at offset " + index);
    tokens.push(source.slice(start, index));
  }
  return tokens;
}

function parsePdx(source, label) {
  const tokens = tokenize(source, label);
  let index = 0;
  function block(nested) {
    const entries = [];
    while (index < tokens.length && tokens[index] !== "}") {
      const key = tokens[index++];
      const operator = tokens[index];
      if (!operators.has(operator)) {
        assert.ok(nested, label + " expected an operator after " + key);
        entries.push({ key, operator: null, value: key });
        continue;
      }
      index += 1;
      if (tokens[index] === "{") {
        index += 1;
        entries.push({ key, operator, value: block(true) });
      } else {
        assert.ok(index < tokens.length, label + " is missing a value for " + key);
        entries.push({ key, operator, value: tokens[index++] });
      }
    }
    if (nested) {
      assert.equal(tokens[index], "}", label + " has an unclosed block");
      index += 1;
    }
    return entries;
  }
  const result = block(false);
  assert.equal(index, tokens.length, label + " has trailing tokens");
  return result;
}

function first(entries, key) {
  return (entries || []).find(entry => entry.key === key);
}

function all(entries, key) {
  return (entries || []).filter(entry => entry.key === key);
}

function required(entries, key, label) {
  const entry = first(entries, key);
  assert.ok(entry, label + " is missing " + key);
  return entry.value;
}

function scalar(entries, key, label) {
  const value = required(entries, key, label);
  assert.equal(typeof value, "string", label + " expected scalar " + key);
  return value;
}

function containsPair(entries, key, expected) {
  return (entries || []).some(entry => entry.key === key && entry.value === expected ||
    Array.isArray(entry.value) && containsPair(entry.value, key, expected));
}

function descendants(entries, key, result = []) {
  for (const entry of entries || []) {
    if (entry.key === key) result.push(entry);
    if (Array.isArray(entry.value)) descendants(entry.value, key, result);
  }
  return result;
}

function hasNoCharacterFallback(trigger) {
  return (trigger || []).some(entry => entry.key === "NOT" && Array.isArray(entry.value) &&
    containsPair(entry.value, "exists", "this"));
}

function parsePngRgba(bytes, label, allowRgb = false) {
  assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a", label + " is not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    assert.ok(start + length + 4 <= bytes.length, label + " has a truncated PNG chunk");
    if (type === "IHDR") {
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === "IDAT") compressed.push(bytes.subarray(start, start + length));
    offset = start + length + 4;
    if (type === "IEND") break;
  }
  assert.ok(width > 0 && height > 0 && width === height, label + " must be a nonempty square image");
  assert.equal(bitDepth, 8, label + " must use 8-bit channels");
  assert.ok(colorType === 6 || allowRgb && colorType === 2,
    label + " must use RGB or RGBA channels as required");
  assert.equal(interlace, 0, label + " must be a noninterlaced RGBA PNG");
  assert.ok(compressed.length > 0, label + " has no PNG image data");

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(compressed));
  assert.equal(raw.length, (rowBytes + 1) * height, label + " decompressed RGBA data has the wrong size");
  const previous = Buffer.alloc(rowBytes);
  const alpha = Buffer.alloc(width * height, 255);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const source = raw[rawOffset++];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
      }
      assert.ok(filter >= 0 && filter <= 4, label + " uses an unsupported PNG filter");
      row[x] = (source + predictor) & 0xff;
    }
    if (colorType === 6) {
      for (let x = 0; x < width; x += 1) alpha[y * width + x] = row[x * 4 + 3];
    }
    row.copy(previous);
  }
  return { width, height, colorType, alpha };
}

function alphaCoverage(alpha, width, height, transparentThreshold, opaqueThreshold) {
  let transparent = 0;
  let opaque = 0;
  let centralOpaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = alpha[y * width + x];
      if (value <= transparentThreshold) transparent += 1;
      if (value >= opaqueThreshold) {
        opaque += 1;
        if (x >= width / 4 && x < width * 3 / 4 && y >= height / 4 && y < height * 3 / 4) centralOpaque += 1;
      }
    }
  }
  return { transparent, opaque, centralOpaque };
}

function decodeDdsAlpha(bytes, label) {
  const { width, height, transparentThreshold, opaqueThreshold } = fixture.ddsProfile;
  assert.ok(bytes.length >= 128, label + " DDS header is truncated");
  assert.equal(bytes.toString("ascii", 0, 4), "DDS ", label + " is missing DDS magic");
  assert.equal(bytes.readUInt32LE(4), 124, label + " has an invalid header size");
  assert.equal(bytes.readUInt32LE(76), 32, label + " has an invalid pixel-format size");
  assert.ok((bytes.readUInt32LE(80) & 0x4) !== 0, label + " must use a FOURCC pixel format");
  assert.equal(bytes.toString("ascii", 84, 88), fixture.ddsProfile.format, label + " must use DXT5/BC3 RGBA");
  assert.equal(bytes.readUInt32LE(16), width, label + " has the wrong width");
  assert.equal(bytes.readUInt32LE(12), height, label + " has the wrong height");
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const baseBytes = blocksWide * blocksHigh * 16;
  assert.ok(bytes.length >= 128 + baseBytes, label + " DXT5 base mip is truncated");
  const alpha = Buffer.alloc(width * height);
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const offset = 128 + (blockY * blocksWide + blockX) * 16;
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
      const selectors = bytes.readUIntLE(offset + 2, 6);
      for (let pixelY = 0; pixelY < 4; pixelY += 1) {
        for (let pixelX = 0; pixelX < 4; pixelX += 1) {
          const x = blockX * 4 + pixelX;
          const y = blockY * 4 + pixelY;
          if (x >= width || y >= height) continue;
          const pixelIndex = pixelY * 4 + pixelX;
          const alphaIndex = Math.floor(selectors / (2 ** (pixelIndex * 3))) & 7;
          alpha[y * width + x] = palette[alphaIndex];
        }
      }
    }
  }
  const coverage = alphaCoverage(alpha, width, height, transparentThreshold, opaqueThreshold);
  assert.ok(coverage.transparent >= fixture.ddsProfile.minimumTransparentPixels,
    label + " keeps meaningful transparent pixels");
  assert.ok(coverage.opaque >= fixture.ddsProfile.minimumOpaquePixels &&
    coverage.centralOpaque >= fixture.ddsProfile.minimumCentralOpaquePixels,
  label + " keeps its central artwork visible");
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    assert.ok(alpha[y * width + x] <= transparentThreshold, label + " corner remains transparent");
  }
  return { alpha, coverage };
}

const manifestPath = resolveRootFile(fixture.manifest, "user icon manifest");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.ok(Array.isArray(manifest.assets), "manifest must list the six ordered source-to-DDS assets");
assert.equal(manifest.assets.length, fixture.assets.length, "manifest contains exactly six user icons");
const manifestFile = (relative, label) => {
  assert.equal(typeof relative, "string", label + " path is missing");
  assert.ok(!path.isAbsolute(relative), label + " must be repository-relative");
  return resolveRootFile(relative, label);
};
for (let index = 0; index < fixture.assets.length; index += 1) {
  const expected = fixture.assets[index];
  const actual = manifest.assets[index];
  assert.equal(actual.index, expected.index, "manifest preserves upload order at item " + expected.index);
  assert.equal(actual.role, expected.role, "upload " + expected.index + " uses the final corrected role mapping");
  assert.equal(actual.dds.file, path.posix.join(fixture.iconDirectory.replaceAll("\\", "/"), expected.dds),
    expected.role + " is exported to the right trait DDS");
  assert.equal(actual.backgroundRemoved, expected.backgroundRemoved,
    expected.role + " records only the requested checkerboard cleanup");
  assert.match(actual.original.sha256, /^[a-f0-9]{64}$/, expected.role + " original source SHA is sealed");
  assert.match(actual.processed.sha256, /^[a-f0-9]{64}$/, expected.role + " processed source SHA is sealed");
  assert.match(actual.dds.sha256, /^[a-f0-9]{64}$/, expected.role + " DDS SHA is sealed");

  const originalPath = manifestFile(actual.original.file, expected.role + " archived original");
  const processedPath = manifestFile(actual.processed.file, expected.role + " processed RGBA source");
  const ddsPath = manifestFile(actual.dds.file, expected.role + " game DDS");
  assert.ok(actual.original.file.replaceAll("\\", "/").startsWith("artwork/dragon-kings/user-icons/"),
    expected.role + " original remains archived with the user icon sources");
  assert.equal(sha256(fs.readFileSync(originalPath)), actual.original.sha256,
    expected.role + " archived original matches its manifest SHA");
  assert.equal(sha256(fs.readFileSync(processedPath)), actual.processed.sha256,
    expected.role + " processed source matches its manifest SHA");
  const ddsBytes = fs.readFileSync(ddsPath);
  assert.equal(sha256(ddsBytes), actual.dds.sha256, expected.role + " DDS matches its manifest SHA");
  const original = parsePngRgba(fs.readFileSync(originalPath), expected.role + " original PNG", true);
  const processed = parsePngRgba(fs.readFileSync(processedPath), expected.role + " processed PNG");
  if (!expected.backgroundRemoved) {
    assert.equal(original.colorType, 6, expected.role + " uploaded RGBA source is retained");
  }
  assert.equal(original.width, processed.width, expected.role + " source width remains stable");
  assert.equal(original.height, processed.height, expected.role + " source height remains stable");
  const sourceCoverage = alphaCoverage(processed.alpha, processed.width, processed.height,
    fixture.ddsProfile.transparentThreshold, fixture.ddsProfile.opaqueThreshold);
  assert.ok(sourceCoverage.transparent >= processed.width * processed.height * 0.01,
    expected.role + " processed RGBA contains transparent background");
  assert.ok(sourceCoverage.opaque >= processed.width * processed.height * 0.03 &&
    sourceCoverage.centralOpaque >= processed.width * processed.height * 0.02,
  expected.role + " processed RGBA retains a visible central subject");
  if (expected.backgroundRemoved) {
    assert.notEqual(actual.processed.file, actual.original.file,
      expected.role + " has a separately traceable checkerboard-removed image");
    assert.notEqual(actual.processed.sha256, actual.original.sha256,
      expected.role + " cleanup produces a distinct source artifact");
    const corners = [[0, 0], [processed.width - 1, 0], [0, processed.height - 1],
      [processed.width - 1, processed.height - 1]];
    for (const [x, y] of corners) {
      assert.ok(processed.alpha[y * processed.width + x] <= fixture.ddsProfile.transparentThreshold,
        expected.role + " cleaned PNG has transparent corners");
    }
  } else {
    assert.equal(actual.processed.file, actual.original.file,
      expected.role + " directly keeps its uploaded RGBA source");
    assert.equal(actual.processed.sha256, actual.original.sha256,
      expected.role + " source is unchanged");
  }
  decodeDdsAlpha(ddsBytes, expected.role + " DDS");
}

const traitEntries = parsePdx(fs.readFileSync(resolveRootFile(fixture.traitFile, "royal trait definitions"), "utf8"),
  "royal trait definitions");
const traits = new Map(traitEntries.filter(entry => Array.isArray(entry.value)).map(entry => [entry.key, entry.value]));
for (const [traitName, iconName] of Object.entries(fixture.fixedIcons)) {
  const trait = traits.get(traitName);
  assert.ok(trait, traitName + " trait exists");
  assert.equal(scalar(trait, "icon", traitName), iconName, traitName + " retains the correct fixed icon");
  assert.ok(fs.existsSync(path.join(iconRoot, iconName)), traitName + " icon is present in the kings module");
}
assert.ok(fs.existsSync(path.join(iconRoot, fixture.fallback.split("/").at(-1))),
  "royal crown placeholder remains available for context-free fallback");

const expectedIcons = new Map(fixture.throneIcons.map(entry => [String(entry.value), entry.dds]));
const branchMaps = new Map();
for (const traitName of fixture.dynamicTraits) {
  const trait = traits.get(traitName);
  assert.ok(trait, traitName + " dynamic royal trait exists");
  const icon = required(trait, "icon", traitName + " icon");
  assert.ok(Array.isArray(icon), traitName + " uses the native dynamic icon block");
  const firstValid = required(icon, "first_valid", traitName + " dynamic icon");
  assert.ok(Array.isArray(firstValid), traitName + " uses first_valid icon selection");
  const branches = all(firstValid, "triggered_desc");
  assert.equal(branches.length, fixture.throneIcons.length + 1,
    traitName + " has one no-context fallback and exactly four throne branches");
  const firstTrigger = required(branches[0].value, "trigger", traitName + " first fallback");
  assert.ok(Array.isArray(firstTrigger) && hasNoCharacterFallback(firstTrigger),
    traitName + " checks NOT exists=this before reading the throne variable");
  assert.equal(scalar(branches[0].value, "desc", traitName + " fallback"), fixture.fallback,
    traitName + " uses the crown fallback filename");
  assert.equal(scalar(firstValid, "desc", traitName + " final icon fallback"), fixture.fallback);
  const branchMap = new Map();
  for (const branch of branches.slice(1)) {
    const trigger = required(branch.value, "trigger", traitName + " throne branch");
    const matches = fixture.throneIcons.filter(entry => containsPair(trigger, "var:mm_royal_throne", String(entry.value)));
    assert.equal(matches.length, 1, traitName + " branch selects exactly one throne value");
    assert.ok(containsPair(trigger, "has_variable", "mm_royal_throne"), traitName + " checks throne existence before selecting the icon");
    const throne = String(matches[0].value);
    assert.ok(!branchMap.has(throne), traitName + " does not duplicate a throne icon branch");
    assert.equal(scalar(branch.value, "desc", traitName + " throne " + throne), expectedIcons.get(throne),
      traitName + " maps throne " + throne + " to its exact icon filename");
    branchMap.set(throne, scalar(branch.value, "desc", traitName + " throne " + throne));
  }
  assert.deepEqual([...branchMap.keys()].sort(), [...expectedIcons.keys()].sort(),
    traitName + " covers all and only four throne values");
  branchMaps.set(traitName, branchMap);
}
assert.deepEqual([...branchMaps.get(fixture.dynamicTraits[0])], [...branchMaps.get(fixture.dynamicTraits[1])],
  "the united royal trait follows the inherited throne and does not mix sibling icons");

// Story text follows the same guarded four throne selections for both royal traits.
const storyDetails = [
  [1, "fire", ["诺顿", "康斯坦丁", "炎汉"]],
  [2, "earth", ["耶梦加得", "芬里厄", "埃及"]],
  [3, "sea", ["利维坦", "贝西摩斯", "地中海"]],
  [4, "sky", ["奥丁", "瓦尔基里", "昆古尼尔"]],
];
const chinese = fs.readFileSync(path.join(root, "patches/wyvern-kings/mod/localization/simp_chinese/zzzzzzzz_mm_royal_l_simp_chinese.yml"), "utf8");
for (const [number, name, words] of storyDetails) {
  const key = "trait_mm_royal_" + name + "_desc";
  const lines = chinese.split(/\r?\n/).filter(line => new RegExp("^\\s*" + key + ":").test(line));
  assert.equal(lines.length, 1, key + " has exactly one Chinese story");
  for (const word of words) assert.ok(lines[0].includes(word), key + " includes " + word);
  for (const traitName of fixture.dynamicTraits) {
    const desc = required(traits.get(traitName), "desc", traitName + " description");
    const selection = required(desc, "first_valid", traitName + " description selection");
    const branches = all(selection, "triggered_desc");
    assert.equal(branches.length, 5, traitName + " description has fallback plus four stories");
    assert.ok(hasNoCharacterFallback(required(branches[0].value, "trigger", traitName + " description fallback")));
    const branch = branches.filter(item => containsPair(required(item.value, "trigger", "story trigger"), "var:mm_royal_throne", String(number)));
    assert.equal(branch.length, 1, traitName + " has one story for throne " + number);
    const trigger = required(branch[0].value, "trigger", "story trigger");
    assert.ok(containsPair(trigger, "has_variable", "mm_royal_throne"));
    assert.equal(scalar(branch[0].value, "desc", "story key"), key);
    const fallback = traitName === "mm_royal_complete" ? "trait_mm_royal_complete_desc" : "trait_mm_royal_dragon_king_desc";
    assert.equal(scalar(branches[0].value, "desc", "context-free story"), fallback);
    assert.equal(scalar(selection, "desc", "unknown-throne story"), fallback);
  }
}

console.log("v1.3.1 royal icon order, source provenance, DXT5 alpha, and dynamic throne icon checks passed");

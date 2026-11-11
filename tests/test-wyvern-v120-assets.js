"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dxt5 = require("./wyvern-dxt5-test-helper");

const projectRoot = path.resolve(__dirname, "..");
const humanModRoot = path.join(projectRoot, "patches", "wyvern-human-form", "mod");
const bloodlineModRoot = path.join(projectRoot, "patches", "wyvern-bloodline", "mod");
const captureModRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const portraitRoot = path.join(humanModRoot, "gfx", "models", "portraits", "mm_dragon_decor");
const nativeRigNodes = Object.freeze({ head: "bn_h_head", bodyRoot: "body_root" });

const traitIcons = [
  { trait: "mm_dragon_black_blood", icon: "mm_dragon_black_blood.dds", modRoot: bloodlineModRoot,
    file: path.join(bloodlineModRoot, "common", "traits", "mm_dragon_bloodline.txt") },
  { trait: "mm_dragon_half", icon: "mm_dragon_half_dragon.dds", modRoot: bloodlineModRoot,
    file: path.join(bloodlineModRoot, "common", "traits", "mm_dragon_bloodline.txt") },
  { trait: "mm_dragon_lineage_1", icon: "mm_dragon_lineage_1.dds", modRoot: bloodlineModRoot,
    file: path.join(bloodlineModRoot, "common", "traits", "mm_dragon_bloodline.txt") },
  { trait: "mm_dragon_lineage_2", icon: "mm_dragon_lineage_2.dds", modRoot: bloodlineModRoot,
    file: path.join(bloodlineModRoot, "common", "traits", "mm_dragon_bloodline.txt") },
  { trait: "mm_dragon_lineage_3", icon: "mm_dragon_lineage_3.dds", modRoot: bloodlineModRoot,
    file: path.join(bloodlineModRoot, "common", "traits", "mm_dragon_bloodline.txt") },
  { trait: "mm_dragon_lineage_4", icon: "mm_dragon_lineage_4.dds", modRoot: bloodlineModRoot,
    file: path.join(bloodlineModRoot, "common", "traits", "mm_dragon_bloodline.txt") },
  { trait: "mm_wyvern_bathed_in_dragon_blood", icon: "mm_dragon_bathed_blood.dds", modRoot: captureModRoot,
    file: path.join(captureModRoot, "common", "traits", "mm_wyvern_dragon_blood.txt") },
  { trait: "mm_dragon_horns", icon: "mm_dragon_horns.dds", modRoot: humanModRoot,
    file: path.join(humanModRoot, "common", "traits", "mm_dragon_features.txt") },
  { trait: "mm_dragon_tail", icon: "mm_dragon_tail.dds", modRoot: humanModRoot,
    file: path.join(humanModRoot, "common", "traits", "mm_dragon_features.txt") },
  { trait: "mm_dragon_pupils", icon: "mm_dragon_pupils.dds", modRoot: humanModRoot,
    file: path.join(humanModRoot, "common", "traits", "mm_dragon_features.txt") },
  { trait: "mm_dragon_scales", icon: "mm_dragon_scales.dds", modRoot: humanModRoot,
    file: path.join(humanModRoot, "common", "traits", "mm_dragon_features.txt") },
];

const decorators = [
  {
    kind: "horns",
    gene: "mm_dragon_horns_gene",
    visible: "mm_dragon_horns_visible",
    adultAccessory: "mm_dragon_horns_accessory",
    childAccessory: "mm_dragon_horns_child_accessory",
    adultEntity: "mm_dragon_horns_entity",
    childEntity: "mm_dragon_horns_child_entity",
    adultMesh: "mm_dragon_horns.mesh",
    childMesh: "mm_dragon_horns_child.mesh",
    adultPdxmesh: "mm_dragon_horns_mesh",
    childPdxmesh: "mm_dragon_horns_child_mesh",
    adultShape: "mm_dragon_horns_shape",
    childShape: "mm_dragon_horns_child_shape",
    node: nativeRigNodes.head,
    adultSha256: "7afe6cccf2c2200db46700503a5a196c53b3e80e3067c4f71d42fe6a4e8d986a",
    childSha256: "843fc406d7c3b1d18397f94d1304ebbe30f2ea00bcee3b87d9aca8e43ccd2922",
  },
  {
    kind: "tail",
    gene: "mm_dragon_tail_gene",
    visible: "mm_dragon_tail_visible",
    adultAccessory: "mm_dragon_tail_accessory",
    childAccessory: "mm_dragon_tail_child_accessory",
    adultEntity: "mm_dragon_tail_entity",
    childEntity: "mm_dragon_tail_child_entity",
    adultMesh: "mm_dragon_tail.mesh",
    childMesh: "mm_dragon_tail_child.mesh",
    adultPdxmesh: "mm_dragon_tail_mesh",
    childPdxmesh: "mm_dragon_tail_child_mesh",
    adultShape: "mm_dragon_tail_shape",
    childShape: "mm_dragon_tail_child_shape",
    node: nativeRigNodes.bodyRoot,
    adultSha256: "acea9ff95bb34f3902df776839137da05a4f577e522e305058c2ee3587480026",
    childSha256: "fc638cb489257fdc124410b3d8853dfb726b896ea6bdf49e742a8b99106f57c1",
  },
  {
    kind: "scales",
    gene: "mm_dragon_scales_gene",
    visible: "mm_dragon_scales_visible",
    adultAccessory: "mm_dragon_scales_accessory",
    childAccessory: "mm_dragon_scales_child_accessory",
    adultEntity: "mm_dragon_scales_entity",
    childEntity: "mm_dragon_scales_child_entity",
    adultMesh: "mm_dragon_scales.mesh",
    childMesh: "mm_dragon_scales_child.mesh",
    adultPdxmesh: "mm_dragon_scales_mesh",
    childPdxmesh: "mm_dragon_scales_child_mesh",
    adultShape: "mm_dragon_scales_shape",
    childShape: "mm_dragon_scales_child_shape",
    node: nativeRigNodes.head,
    adultSha256: "729c7cae3edb2e4983bb6542d71b70b67a975b48e7358e7b512e758657f3a52e",
    childSha256: "39242cc94e6f598ea98df46d84c1b898c00d5bff5e712c7ea2f51e25dff7e714",
  },
];
assert.equal(decorators.length, 3, "all three adult and child decoration mesh pairs are covered");

function tokenizePdx(source, label) {
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
  const tokens = tokenizePdx(source, label);
  let index = 0;
  function parseBlock(nested) {
    const entries = [];
    while (index < tokens.length && tokens[index] !== "}") {
      const key = tokens[index++];
      const operator = tokens[index];
      if (!["?=", ">=", "<=", "!=", "==", "=", ">", "<"].includes(operator)) {
        assert.ok(nested, label + " expected an operator after " + key);
        entries.push({ key: null, operator: null, value: key });
        continue;
      }
      index += 1;
      if (tokens[index] === "{") {
        index += 1;
        entries.push({ key, operator, value: parseBlock(true) });
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
  const result = parseBlock(false);
  assert.equal(index, tokens.length, label + " has trailing tokens");
  return result;
}

function parsePdxFile(filePath) {
  assert.ok(fs.existsSync(filePath), "missing PDX source: " + filePath);
  return parsePdx(fs.readFileSync(filePath, "utf8"), filePath);
}

function first(block, key) {
  return block.find(entry => entry.key === key);
}

function all(block, key) {
  return block.filter(entry => entry.key === key);
}

function definition(block, key, label) {
  const entry = first(block, key);
  assert.ok(entry && Array.isArray(entry.value), label + " is missing definition " + key);
  return entry.value;
}

function scalar(block, key, label) {
  const entry = first(block, key);
  assert.ok(entry && !Array.isArray(entry.value), label + " is missing scalar " + key);
  return entry.value;
}

function definitionByScalar(entries, type, field, expected, label) {
  const matches = all(entries, type).filter(entry => Array.isArray(entry.value) && scalar(entry.value, field, label) === expected);
  assert.equal(matches.length, 1, label + " must have exactly one " + type + " named " + expected);
  return matches[0].value;
}

function hasPair(block, key, expected) {
  return (block || []).some(entry => {
    if (entry.key === key && entry.value === expected) return true;
    return Array.isArray(entry.value) && hasPair(entry.value, key, expected);
  });
}

function parseDds(bytes, label, width, height) {
  assert.ok(bytes.length >= 128, label + " DDS header is truncated");
  assert.equal(bytes.toString("ascii", 0, 4), "DDS ", label + " is missing DDS magic");
  assert.equal(bytes.readUInt32LE(4), 124, label + " has an invalid header size");
  assert.equal(bytes.readUInt32LE(76), 32, label + " has an invalid pixel-format size");
  assert.ok((bytes.readUInt32LE(80) & 0x4) !== 0, label + " must declare FOURCC compression");
  assert.equal(bytes.toString("ascii", 84, 88), "DXT5", label + " must use DXT5/BC3");
  assert.equal(bytes.readUInt32LE(16), width, label + " has the wrong width");
  assert.equal(bytes.readUInt32LE(12), height, label + " has the wrong height");
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  assert.ok(bytes.length >= 128 + blocksWide * blocksHigh * 16, label + " base mip is truncated");
  return { width, height, mipCount: bytes.readUInt32LE(28) };
}

function decodeDxt5Alpha(bytes, width, height, label) {
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
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
      for (let localY = 0; localY < 4; localY += 1) {
        for (let localX = 0; localX < 4; localX += 1) {
          const x = blockX * 4 + localX;
          const y = blockY * 4 + localY;
          if (x >= width || y >= height) continue;
          const pixelIndex = localY * 4 + localX;
          const alphaIndex = Math.floor(selectors / (2 ** (pixelIndex * 3))) & 7;
          alpha[y * width + x] = palette[alphaIndex];
        }
      }
    }
  }
  assert.equal(alpha.length, width * height, label + " alpha decoder must visit the complete base mip");
  return alpha;
}

function alphaCoverage(alpha, width, height) {
  let transparent = 0;
  let opaque = 0;
  let centralOpaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = alpha[y * width + x];
      if (value <= 8) transparent += 1;
      if (value >= 224) {
        opaque += 1;
        if (x >= width * 0.25 && x < width * 0.75 && y >= height * 0.25 && y < height * 0.75) centralOpaque += 1;
      }
    }
  }
  return { transparent, opaque, centralOpaque };
}

// 1. Trait icons come from their owning modules and keep transparent corners plus visible central artwork.
const traitFiles = new Map();
for (const entry of traitIcons) {
  const traits = parsePdxFile(entry.file);
  const trait = definition(traits, entry.trait, entry.trait + " trait");
  assert.equal(scalar(trait, "icon", entry.trait), entry.icon, entry.trait + " references its declared icon");
  const iconPath = path.join(entry.modRoot, "gfx", "interface", "icons", "traits", entry.icon);
  assert.ok(fs.existsSync(iconPath), entry.trait + " icon exists in the same module as its trait");
  const bytes = fs.readFileSync(iconPath);
  parseDds(bytes, entry.trait + " icon", 128, 128);
  assert.equal(bytes.readUInt32LE(28), 0, entry.trait + " icon is a single-level texture");
  assert.equal(bytes.length, 128 + 32 * 32 * 16, entry.trait + " icon is a single 128x128 DXT5 image");
  const alpha = decodeDxt5Alpha(bytes, 128, 128, entry.trait + " icon");
  for (const [x, y] of [[0, 0], [127, 0], [0, 127], [127, 127]]) {
    assert.ok(alpha[y * 128 + x] <= 8, entry.trait + " icon corner (" + x + "," + y + ") remains transparent");
  }
  const coverage = alphaCoverage(alpha, 128, 128);
  assert.ok(coverage.transparent >= 128 * 128 * 0.30, entry.trait + " icon retains substantial transparent background");
  assert.ok(coverage.opaque >= 1000 && coverage.centralOpaque >= 500,
    entry.trait + " icon retains a visible central subject");
  traitFiles.set(entry.trait, trait);
}
assert.equal(traitIcons.length, 11, "all dragon traits, including the distinct Black Blood mutation, have icons");

// 2. Read only the PDX binary fields needed to verify actual mesh hashes, vertex caps and faces.
function requireBytes(buffer, offset, size, label) {
  assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + size <= buffer.length,
    label + " has a truncated PDX mesh field");
}

function readPdxCString(buffer, state, label) {
  const end = buffer.indexOf(0, state.offset);
  assert.notEqual(end, -1, label + " has an unterminated PDX string");
  const value = buffer.toString("latin1", state.offset, end);
  state.offset = end + 1;
  return value;
}

function readPdxString(buffer, state, size, label) {
  requireBytes(buffer, state.offset, size, label);
  let value = buffer.toString("latin1", state.offset, state.offset + size);
  state.offset += size;
  if (value.endsWith("\0")) value = value.slice(0, -1);
  return value;
}

function parseAttachmentMesh(buffer, label) {
  assert.ok(buffer.length > 8, label + " is empty");
  assert.equal(buffer.toString("ascii", 0, 4), "@@b@", label + " has the wrong PDX mesh header");
  const state = { offset: 4 };
  const root = { name: "File", props: {}, children: [] };
  const stack = [root];
  while (state.offset < buffer.length) {
    const marker = buffer.toString("ascii", state.offset, state.offset + 1);
    if (marker === "[") {
      let depth = 0;
      while (state.offset < buffer.length && buffer[state.offset] === 0x5b) {
        depth += 1;
        state.offset += 1;
      }
      assert.ok(depth > 0 && depth < 64, label + " has an invalid object depth");
      const node = { name: readPdxCString(buffer, state, label), props: {}, children: [] };
      assert.ok(depth <= stack.length, label + " has an object without its parent");
      stack[depth - 1].children.push(node);
      stack.length = depth + 1;
      stack[depth] = node;
      continue;
    }
    assert.equal(marker, "!", label + " has an invalid PDX marker at byte " + state.offset);
    state.offset += 1;
    requireBytes(buffer, state.offset, 1, label);
    const nameSize = buffer.readInt8(state.offset);
    state.offset += 1;
    assert.ok(nameSize > 0 && nameSize < 128, label + " has an invalid property name length");
    const name = readPdxString(buffer, state, nameSize, label);
    const type = buffer.toString("ascii", state.offset, state.offset + 1);
    state.offset += 1;
    requireBytes(buffer, state.offset, 4, label);
    const count = buffer.readInt32LE(state.offset);
    state.offset += 4;
    assert.ok(count >= 0 && count <= 1000000, label + " has an invalid element count for " + name);
    const node = stack[stack.length - 1];
    assert.ok(node && !Object.prototype.hasOwnProperty.call(node.props, name), label + " repeats property " + name);
    if (type === "f" || type === "i") {
      const byteCount = count * 4;
      requireBytes(buffer, state.offset, byteCount, label);
      if (node.name === "mesh" && (name === "p" || name === "tri")) {
        const values = new Array(count);
        for (let index = 0; index < count; index += 1) {
          values[index] = type === "f"
            ? buffer.readFloatLE(state.offset + index * 4)
            : buffer.readInt32LE(state.offset + index * 4);
        }
        node.props[name] = values;
      }
      state.offset += byteCount;
    } else if (type === "s") {
      for (let index = 0; index < count; index += 1) {
        requireBytes(buffer, state.offset, 4, label);
        const length = buffer.readInt32LE(state.offset);
        state.offset += 4;
        assert.ok(length >= 0 && length <= 1000000, label + " has an invalid string element size");
        readPdxString(buffer, state, length, label);
      }
    } else {
      assert.fail(label + " uses an unsupported PDX mesh property type " + type);
    }
  }
  return root;
}

function walkNodes(node, result = []) {
  result.push(node);
  for (const child of node.children) walkNodes(child, result);
  return result;
}

function attachmentGeometry(fileName, shapeName, expectedHash) {
  const filePath = path.join(portraitRoot, fileName);
  assert.ok(fs.existsSync(filePath), "missing portrait mesh " + fileName);
  const bytes = fs.readFileSync(filePath);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), expectedHash,
    fileName + " binary matches its frozen asset hash");
  const root = parseAttachmentMesh(bytes, fileName);
  const shapes = walkNodes(root).filter(node => node.name === shapeName);
  assert.equal(shapes.length, 1, fileName + " contains exactly one matching shape " + shapeName);
  const meshes = walkNodes(shapes[0]).filter(node => node.name === "mesh" && Array.isArray(node.props.p) && Array.isArray(node.props.tri));
  assert.ok(meshes.length > 0, fileName + " contains readable vertex and face arrays");
  let vertexCount = 0;
  let faceCount = 0;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    const positions = mesh.props.p;
    const triangles = mesh.props.tri;
    assert.equal(positions.length % 3, 0, fileName + " positions are complete vertex triples");
    assert.equal(triangles.length % 3, 0, fileName + " faces are complete triangles");
    const localVertices = positions.length / 3;
    assert.ok(Number.isInteger(localVertices) && localVertices >= 3 && localVertices <= 60000,
      fileName + " mesh part stays within the portrait vertex limit");
    assert.ok(triangles.length >= 3, fileName + " mesh part has at least one face");
    for (let index = 0; index < triangles.length; index += 1) {
      assert.ok(Number.isInteger(triangles[index]) && triangles[index] >= 0 && triangles[index] < localVertices,
        fileName + " contains an out-of-range face index");
    }
    for (let offset = 0; offset < positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const coordinate = positions[offset + axis];
        assert.ok(Number.isFinite(coordinate), fileName + " contains a non-finite vertex");
        minimum[axis] = Math.min(minimum[axis], coordinate);
        maximum[axis] = Math.max(maximum[axis], coordinate);
      }
    }
    vertexCount += localVertices;
    faceCount += triangles.length / 3;
  }
  assert.ok(vertexCount > 0 && vertexCount <= 60000, fileName + " aggregate vertex count stays within the portrait limit");
  assert.ok(faceCount > 0, fileName + " has non-empty faces");
  return { vertexCount, faceCount, minimum, maximum };
}

function getDefinitionByName(entries, type, field, expected, label) {
  return definitionByScalar(entries, type, field, expected, label);
}

const genes = parsePdxFile(path.join(humanModRoot, "common", "genes", "mm_dragon_decor.txt"));
const accessoryGenes = definition(definition(genes, "special_genes", "special genes"), "accessory_genes", "accessory genes");
const accessories = parsePdxFile(path.join(humanModRoot, "gfx", "portraits", "accessories", "mm_dragon_decor.txt"));
const portraitModifiers = parsePdxFile(path.join(humanModRoot, "gfx", "portraits", "portrait_modifiers", "mm_dragon_decor.txt"));
const assetDefinitions = parsePdxFile(path.join(portraitRoot, "mm_dragon_decor.asset"));
const modelTextures = ["mm_dragon_decor_diffuse.dds", "mm_dragon_decor_normal.dds", "mm_dragon_decor_properties.dds"];
for (const texture of modelTextures) {
  const filePath = path.join(portraitRoot, texture);
  assert.ok(fs.existsSync(filePath), "missing portrait material " + texture);
}

const decoratorGeometry = new Map();
for (const item of decorators) {
  const gene = definition(accessoryGenes, item.gene, item.kind + " gene");
  const visible = definition(gene, item.visible, item.kind + " visible template");
  for (const sex of ["male", "female"]) {
    assert.equal(scalar(definition(visible, sex, item.kind + " " + sex), "1", item.kind + " " + sex + " accessory"),
      item.adultAccessory, item.kind + " adult " + sex + " template maps to adult accessory");
  }
  for (const childSex of ["boy", "girl"]) {
    assert.equal(scalar(definition(visible, childSex, item.kind + " " + childSex), "1", item.kind + " child accessory"),
      item.childAccessory, item.kind + " child template maps to its smaller child accessory");
  }

  for (const [accessoryName, entityName] of [
    [item.adultAccessory, item.adultEntity],
    [item.childAccessory, item.childEntity],
  ]) {
    const accessory = definition(accessories, accessoryName, item.kind + " accessory");
    const entityReference = definition(accessory, "entity", item.kind + " accessory entity");
    assert.equal(scalar(entityReference, "entity", item.kind + " entity name"), entityName,
      item.kind + " accessory references the expected entity");
    assert.equal(scalar(entityReference, "node", item.kind + " native rig node"), item.node,
      item.kind + " accessory binds to its frozen native rig node");
  }

  const expectedModels = [
    { pdxmesh: item.adultPdxmesh, shape: item.adultShape, file: item.adultMesh, hash: item.adultSha256 },
    { pdxmesh: item.childPdxmesh, shape: item.childShape, file: item.childMesh, hash: item.childSha256 },
  ];
  const geometry = [];
  for (const model of expectedModels) {
    const pdxmesh = getDefinitionByName(assetDefinitions, "pdxmesh", "name", model.pdxmesh, item.kind + " model asset");
    assert.equal(scalar(pdxmesh, "file", item.kind + " mesh file"), model.file, item.kind + " PDX mesh points to the expected binary");
    const settings = definition(pdxmesh, "meshsettings", item.kind + " mesh material settings");
    assert.equal(scalar(settings, "name", item.kind + " shape name"), model.shape, item.kind + " shape name is complete");
    assert.equal(scalar(settings, "index", item.kind + " mesh index"), "0", item.kind + " material uses mesh index zero");
    assert.equal(scalar(settings, "texture_diffuse", item.kind + " diffuse"), modelTextures[0]);
    assert.equal(scalar(settings, "texture_normal", item.kind + " normal"), modelTextures[1]);
    assert.equal(scalar(settings, "texture_specular", item.kind + " properties"), modelTextures[2]);
    assert.equal(scalar(settings, "shader", item.kind + " shader"), "portrait_attachment");
    assert.equal(scalar(settings, "shader_file", item.kind + " shader file"), "gfx/FX/jomini/portrait.shader");

    const entity = getDefinitionByName(assetDefinitions, "entity", "name", model.pdxmesh === item.adultPdxmesh ? item.adultEntity : item.childEntity,
      item.kind + " entity asset");
    assert.equal(scalar(entity, "pdxmesh", item.kind + " entity mesh"), model.pdxmesh,
      item.kind + " entity references its PDX mesh");
    geometry.push(attachmentGeometry(model.file, model.shape, model.hash));
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const adultSpan = geometry[0].maximum[axis] - geometry[0].minimum[axis];
    const childSpan = geometry[1].maximum[axis] - geometry[1].minimum[axis];
    assert.ok(adultSpan > 1e-6 && childSpan > 1e-6, item.kind + " adult and child meshes have nonzero axis spans");
    assert.ok(Math.abs(childSpan / adultSpan - 0.55) <= 0.01,
      item.kind + " child mesh dimensions remain at the approved 55 percent scale on axis " + axis);
  }
  decoratorGeometry.set(item.kind, geometry);
}

// 3. Portrait modifiers add each inherited appearance trait and keep the eye override on the native eye gene.
for (const item of decorators) {
  const trait = "mm_dragon_" + item.kind;
  const modifier = definition(portraitModifiers, "mm_dragon_" + item.kind + "_portrait", item.kind + " portrait modifier");
  const group = definition(modifier, "dragon_feature", item.kind + " portrait group");
  const dna = definition(group, "dna_modifiers", item.kind + " portrait DNA modifiers");
  const accessory = definition(dna, "accessory", item.kind + " portrait accessory");
  assert.equal(scalar(accessory, "mode", item.kind + " portrait mode"), "add");
  assert.equal(scalar(accessory, "gene", item.kind + " portrait gene"), item.gene);
  assert.equal(scalar(accessory, "template", item.kind + " portrait template"), item.visible);
  assert.ok(hasPair(group, "TRAIT", trait), item.kind + " portrait modifier is tied to the matching trait");
  assert.ok(hasPair(group, "has_character_flag", "mm_wyvern_human_form"), item.kind + " portrait modifier supports tamed human form");
  assert.ok(hasPair(group, "has_character_flag", "mm_dragon_blood_human"), item.kind + " portrait modifier supports half-dragon humans");
}

const pupilModifier = definition(portraitModifiers, "mm_dragon_pupils_portrait", "pupil portrait modifier");
const pupilGroup = definition(pupilModifier, "dragon_pupils", "pupil portrait group");
const pupilDna = definition(pupilGroup, "dna_modifiers", "pupil portrait DNA modifiers");
const pupilAccessory = definition(pupilDna, "color", "pupil portrait color");
assert.equal(scalar(pupilAccessory, "mode", "pupil portrait mode"), "replace");
assert.equal(scalar(pupilAccessory, "gene", "pupil portrait gene"), "eye_color");
assert.ok(!pupilDna.some(node => node.key === "accessory"), "pupils preserve native eye mesh and injury templates");
assert.ok(hasPair(pupilGroup, "TRAIT", "mm_dragon_pupils"), "pupil modifier is tied to its trait");
assert.ok(hasPair(pupilGroup, "has_character_flag", "mm_wyvern_human_form"), "pupil modifier supports tamed human form");
// Evaluate the actual weight condition for representative forms; never assume
// a human-blood marker is present on ordinary people or older mixed saves.
const pupilWeight = definition(pupilGroup, "weight", "pupil weight");
assert.equal(Number(scalar(pupilWeight, "base", "pupil base weight")), 0);
const pupilCondition = definition(pupilWeight, "modifier", "pupil weight modifier");
assert.ok(Number(scalar(pupilCondition, "add", "pupil modifier weight")) > 0);
function pupilMatches(nodes, traits, flags) {
  return nodes.every(node => {
    if (node.key === "add") return true;
    if (node.key === "portrait_has_trait_trigger") return traits.has(scalar(node.value, "TRAIT", "portrait trait"));
    if (node.key === "has_character_flag") return flags.has(node.value);
    if (node.key === "OR") return node.value.some(child => pupilMatches([child], traits, flags));
    if (node.key === "NOR") return !node.value.some(child => pupilMatches([child], traits, flags));
    if (node.key === "AND") return pupilMatches(node.value, traits, flags);
    if (node.key === "NOT") return !pupilMatches(node.value, traits, flags);
    throw new Error("unsupported pupil predicate " + node.key);
  });
}
for (const [label, traits, flags, expected] of [
  ["ordinary person", ["mm_dragon_pupils"], [], true],
  ["mixed human", ["mm_dragon_pupils", "mm_dragon_half"], [], true],
  ["dragon in human form", ["mm_dragon_pupils", "myv_wyvern_tamed"], ["mm_wyvern_human_form"], true],
  ["ordinary without pupils", [], [], false],
  ["mixed without pupils", ["mm_dragon_half"], [], false],
  ["human form without pupils", ["myv_wyvern_tamed"], ["mm_wyvern_human_form"], false],
  ...["myv_wyvern", "myv_wyvern_tamed", "myv_wyvern_legendary"].map(trait => ["dragon body " + trait, ["mm_dragon_pupils", trait], [], false]),
]) {
  assert.equal(pupilMatches(pupilCondition, new Set(traits), new Set(flags)), expected, label + " pupil eligibility");
}

assert.ok(!accessoryGenes.some(node => node.key === "eye_accessory"), "dragon genes must not replace the shared native eye accessory");
const allPortraitAssets = fs.readFileSync(path.join(humanModRoot, "gfx", "models", "portraits", "mm_dragon_decor", "mm_dragon_decor.asset"), "utf8");
assert.doesNotMatch(allPortraitAssets, /mm_dragon_(?:male|female)_eyes_entity|mm_dragon_eyes_diffuse/);
console.log("Wyvern v1.2.0 portrait assets: trait icons, mesh hashes/bounds, bone and material wiring; native eye gene preserved.");
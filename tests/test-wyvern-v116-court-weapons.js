"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const modRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const blueprintRoot = path.join(modRoot, "common", "artifacts", "blueprints");
const visualsPath = path.join(modRoot, "common", "artifacts", "visuals", "mm_wyvern_dragon_court_weapons.txt");
const modelRoot = path.join(modRoot, "gfx", "models", "artifacts", "mm_dragon_weapons");
const sourceModelRoot = path.join(projectRoot, "artwork", "dragon-weapons", "models");
const nativeBlueprintFixturePath = path.join(projectRoot, "tests", "fixtures", "v116", "native-sword-reforge.txt");
const courtMaterialFixturePath = path.join(projectRoot, "tests", "fixtures", "v117", "court-material-shader-contract.json");
const courtMaterialFixture = JSON.parse(fs.readFileSync(courtMaterialFixturePath, "utf8"));
const ddsHelper = require("./wyvern-dxt5-test-helper");
const weaponTextureProfile = courtMaterialFixture.textureContract.profiles.weapon;
const textureGrid = {
  columns: courtMaterialFixture.textureContract.tileColumns,
  rows: courtMaterialFixture.textureContract.tileRows,
};
const expectedBlueprints = [
  {
    id: "mm_wyvern_sword_to_court",
    inputType: "sword",
    inputVisual: "mm_wyvern_dragon_sword",
    outputType: "pedestal",
    outputVisual: "mm_wyvern_dragon_sword_court",
    model: "draxel",
  },
  {
    id: "mm_wyvern_bow_to_court",
    inputType: "bow",
    inputVisual: "mm_wyvern_dragon_bow",
    outputType: "pedestal",
    outputVisual: "mm_wyvern_dragon_bow_court",
    model: "serind",
  },
];

function tokenizePdx(source, label) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (character === '"') {
      index += 1;
      let value = "";
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === "\\" && index < source.length) value += source[index++];
        else if (current === '"') {
          closed = true;
          break;
        } else value += current;
      }
      assert.ok(closed, label + " has an unterminated string");
      tokens.push(value);
    } else {
      const operator = source.slice(index).match(/^(?:>=|<=|!=|=|>|<)/);
      if (operator) {
        tokens.push(operator[0]);
        index += operator[0].length;
      } else if ("{}".includes(character)) {
        tokens.push(character);
        index += 1;
      } else {
        const start = index;
        while (index < source.length && !/[\s{}#"=<>!]/.test(source[index])) index += 1;
        assert.ok(index > start, label + " contains an invalid token at " + String(index));
        tokens.push(source.slice(start, index));
      }
    }
  }
  return tokens;
}

function parsePdxBlock(tokens, label, nested) {
  const entries = [];
  while (tokens.index < tokens.values.length) {
    const key = tokens.values[tokens.index++];
    if (key === "}") {
      assert.ok(nested, label + " has an unmatched closing brace");
      return entries;
    }
    assert.notEqual(key, "{", label + " has a block without a key");
    assert.notEqual(key, "=", label + " has a key without a name");
    const operator = tokens.values[tokens.index];
    if (!["=", ">=", "<=", "!=", ">", "<"].includes(operator)) {
      entries.push({ key: null, operator: null, value: key });
      continue;
    }
    tokens.index += 1;
    const valueToken = tokens.values[tokens.index++];
    assert.notEqual(valueToken, undefined, label + " has a key without a value");
    assert.notEqual(valueToken, "}", label + " has a key without a value");
    entries.push({
      key,
      operator,
      value: valueToken === "{" ? parsePdxBlock(tokens, label, true) : valueToken,
    });
  }
  assert.ok(!nested, label + " has an unclosed block");
  return entries;
}

function parsePdxText(source, label) {
  const tokens = { values: tokenizePdx(source.replace(/^\uFEFF/, ""), label), index: 0 };
  const entries = parsePdxBlock(tokens, label, false);
  assert.equal(tokens.index, tokens.values.length, label + " has trailing PDX tokens");
  return entries;
}

function parsePdxFile(filePath) {
  assert.ok(fs.existsSync(filePath), "missing PDX file: " + filePath);
  return parsePdxText(fs.readFileSync(filePath, "utf8"), filePath);
}

function values(block, key) {
  return block.filter(entry => entry.key === key).map(entry => entry.value);
}

function exactlyOne(block, key, label) {
  const matches = values(block, key);
  assert.equal(matches.length, 1, label + " must contain exactly one " + key);
  return matches[0];
}

function findDefinition(entries, key, label) {
  const matches = entries.filter(entry => entry.key === key && Array.isArray(entry.value));
  assert.equal(matches.length, 1, label + " must define " + key + " exactly once");
  return matches[0];
}

function listFilesRecursively(directory, extension) {
  assert.ok(fs.existsSync(directory), "missing directory: " + directory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFilesRecursively(fullPath, extension);
    return entry.isFile() && entry.name.toLowerCase().endsWith(extension) ? [fullPath] : [];
  });
}

function cloneAst(value) {
  if (Array.isArray(value)) return value.map(cloneAst);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAst(child)]));
  }
  return value;
}

function replaceScalar(block, key, value, label) {
  const matches = block.filter(entry => entry.key === key);
  assert.equal(matches.length, 1, label + " must contain one " + key);
  matches[0].value = value;
}

function assertBlueprintMatchesNative(actual, expected, nativeDefinition) {
  assert.equal(actual.key, expected.id, "blueprint ID is wrong");
  const expectedFields = {
    in_type: expected.inputType,
    in_visuals: expected.inputVisual,
    out_type: expected.outputType,
    out_visuals: expected.outputVisual,
  };
  const patchedNative = nativeDefinition.value.map(entry => {
    if (!Object.prototype.hasOwnProperty.call(expectedFields, entry.key)) return entry;
    return { ...entry, value: expectedFields[entry.key] };
  });
  assert.deepEqual(actual.value, patchedNative,
    expected.id + " must preserve the full native sword blueprint except its ID and four type/visual fields");
  for (const [field, value] of Object.entries(expectedFields)) {
    assert.equal(exactlyOne(actual.value, field, expected.id), value, expected.id + " has wrong " + field);
  }
}

function assertCourtVisualEntity(visual, expectedVisual, expectedEntity) {
  assert.equal(visual.key, expectedVisual, "court visual ID is wrong");
  assert.equal(exactlyOne(visual.value, "default_type", expectedVisual), "pedestal",
    expectedVisual + " must be a court pedestal visual");
  assert.equal(exactlyOne(visual.value, "asset", expectedVisual), expectedEntity,
    expectedVisual + " must bind its matching court model entity");
}

function assertBlueprintNegativeMutations(swordBlueprint, swordExpected, nativeDefinition) {
  const wrongInputVisual = cloneAst(swordBlueprint);
  replaceScalar(wrongInputVisual.value, "in_visuals", "sword", "mutated sword blueprint");
  assert.throws(() => assertBlueprintMatchesNative(wrongInputVisual, swordExpected, nativeDefinition),
    "the blueprint validator must reject a wrong input visual");

  const wrongOutputVisual = cloneAst(swordBlueprint);
  replaceScalar(wrongOutputVisual.value, "out_visuals", "sword_court", "mutated sword blueprint");
  assert.throws(() => assertBlueprintMatchesNative(wrongOutputVisual, swordExpected, nativeDefinition),
    "the blueprint validator must reject a wrong output visual");

  const omittedModifier = cloneAst(swordBlueprint);
  const disallowedModifiers = exactlyOne(omittedModifier.value, "disallowed_modifiers", "mutated sword blueprint");
  const prowessIndex = disallowedModifiers.findIndex(entry => entry.value === "prowess");
  assert.ok(prowessIndex >= 0, "negative fixture must find the native prowess modifier");
  disallowedModifiers.splice(prowessIndex, 1);
  assert.throws(() => assertBlueprintMatchesNative(omittedModifier, swordExpected, nativeDefinition),
    "the blueprint validator must reject an omitted native modifier");
}

function assertNativeBlueprintSource(sourceSha256, frozenDefinition) {
  const explicitGameDir = Object.prototype.hasOwnProperty.call(process.env, "CK3_GAME_DIR");
  const gameRoot = explicitGameDir
    ? process.env.CK3_GAME_DIR
    : "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
  assert.ok(!explicitGameDir || gameRoot,
    "CK3_GAME_DIR is explicitly set but empty; refusing to use the frozen blueprint fixture");
  const nativePath = path.join(gameRoot, "common", "artifacts", "blueprints", "00_reforge.txt");
  const nativeExists = fs.existsSync(nativePath);
  assert.ok(!explicitGameDir || nativeExists,
    "CK3_GAME_DIR is explicitly set but the native blueprint source is missing: " + nativePath);
  if (!nativeExists) return "frozen";

  const nativeBytes = fs.readFileSync(nativePath);
  const nativeSha256 = crypto.createHash("sha256").update(nativeBytes).digest("hex");
  assert.equal(nativeSha256, sourceSha256,
    "installed native blueprint file must match the frozen full-file SHA-256");
  const nativeEntries = parsePdxText(nativeBytes.toString("utf8"), nativePath);
  const liveDefinition = findDefinition(nativeEntries, "sword_to_court", "installed native blueprint file");
  assert.deepEqual(liveDefinition.value, frozenDefinition.value,
    "installed native sword blueprint AST must match the frozen fixture");
  return "live";
}

function assertBlueprintOverrides() {
  const fixtureSource = fs.readFileSync(nativeBlueprintFixturePath, "utf8");
  const sourcePath = fixtureSource.match(/^# source_path = (.+)$/m)?.[1];
  const sourceSha256 = fixtureSource.match(/^# source_sha256 = ([a-f0-9]{64})$/m)?.[1];
  assert.equal(sourcePath, "game/common/artifacts/blueprints/00_reforge.txt",
    "native sword blueprint fixture must identify its source path");
  assert.equal(sourceSha256, "02c224956abc6f6d2f43f33e690b77c73ef646901590901805cd025fa4dc4321",
    "native sword blueprint fixture must pin the local source file hash");

  const nativeEntries = parsePdxText(fixtureSource, nativeBlueprintFixturePath);
  const nativeDefinition = findDefinition(nativeEntries, "sword_to_court", "frozen native fixture");
  const sourceFields = {
    in_type: "sword",
    in_visuals: "sword",
    out_type: "pedestal",
    out_visuals: "sword_court",
  };
  for (const [field, expected] of Object.entries(sourceFields)) {
    assert.equal(exactlyOne(nativeDefinition.value, field, "native sword blueprint"), expected,
      "frozen native sword blueprint has unexpected " + field);
  }
  assert.equal(exactlyOne(nativeDefinition.value, "disallowed_modifiers", "native sword blueprint").length, 33,
    "frozen native sword blueprint must retain its disallowed modifier block");
  assert.equal(exactlyOne(nativeDefinition.value, "replacement_modifiers", "native sword blueprint").length, 4,
    "frozen native sword blueprint must retain all four replacement rarity tiers");
  const nativeSource = assertNativeBlueprintSource(sourceSha256, nativeDefinition);

  const blueprintFiles = listFilesRecursively(blueprintRoot, ".txt");
  const moduleEntries = blueprintFiles.flatMap(file => parsePdxFile(file));
  const definitions = moduleEntries.filter(entry => entry.key && Array.isArray(entry.value));
  assert.deepEqual(definitions.map(entry => entry.key).sort(), expectedBlueprints.map(entry => entry.id).sort(),
    "the mod must add exactly the two requested court weapon blueprints");

  const actualById = new Map();
  for (const expected of expectedBlueprints) {
    const actual = findDefinition(definitions, expected.id, "mod blueprint files");
    assertBlueprintMatchesNative(actual, expected, nativeDefinition);
    actualById.set(expected.id, actual);
  }
  assertBlueprintNegativeMutations(actualById.get("mm_wyvern_sword_to_court"), expectedBlueprints[0], nativeDefinition);
  return nativeSource;
}

function requireBytes(buffer, offset, size, label) {
  assert.ok(Number.isSafeInteger(size) && size >= 0, label + " has an invalid byte count");
  assert.ok(offset + size <= buffer.length, label + " is truncated");
}

function readPdxString(buffer, state, size, label) {
  requireBytes(buffer, state.offset, size, label);
  let value = buffer.toString("latin1", state.offset, state.offset + size);
  state.offset += size;
  if (value.endsWith("\0")) value = value.slice(0, -1);
  return value;
}

function readPdxCString(buffer, state, label) {
  const end = buffer.indexOf(0, state.offset);
  assert.notEqual(end, -1, label + " has an unterminated object name");
  const value = buffer.toString("latin1", state.offset, end);
  state.offset = end + 1;
  return value;
}

function readPdxData(buffer, state, label) {
  requireBytes(buffer, state.offset, 5, label);
  const type = buffer.toString("ascii", state.offset, state.offset + 1);
  state.offset += 1;
  const count = buffer.readInt32LE(state.offset);
  state.offset += 4;
  assert.ok(count >= 0 && count <= 100000000, label + " has an invalid element count");
  if (type === "f" || type === "i") {
    const byteCount = count * 4;
    requireBytes(buffer, state.offset, byteCount, label);
    const result = new Array(count);
    for (let index = 0; index < count; index += 1) {
      result[index] = type === "f"
        ? buffer.readFloatLE(state.offset + index * 4)
        : buffer.readInt32LE(state.offset + index * 4);
    }
    state.offset += byteCount;
    return result;
  }
  assert.equal(type, "s", label + " uses an unsupported property type");
  const result = new Array(count);
  for (let index = 0; index < count; index += 1) {
    requireBytes(buffer, state.offset, 4, label);
    const size = buffer.readInt32LE(state.offset);
    state.offset += 4;
    assert.ok(size >= 0 && size <= 10000000, label + " has an invalid string size");
    result[index] = readPdxString(buffer, state, size, label);
  }
  return result;
}

function parsePdxMesh(buffer, label) {
  assert.ok(buffer.length > 8, label + " is empty");
  assert.equal(buffer.toString("ascii", 0, 4), "@@b@", label + " has the wrong PDX binary header");
  const state = { offset: 4 };
  const root = { name: "File", depth: 0, props: {}, children: [] };
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
      const name = readPdxCString(buffer, state, label);
      assert.ok(depth <= stack.length, label + " has a child without a parent");
      const node = { name, depth, props: {}, children: [] };
      stack[depth - 1].children.push(node);
      stack.length = depth + 1;
      stack[depth] = node;
    } else if (marker === "!") {
      state.offset += 1;
      requireBytes(buffer, state.offset, 1, label);
      const nameSize = buffer.readInt8(state.offset);
      state.offset += 1;
      assert.ok(nameSize > 0 && nameSize < 128, label + " has an invalid property name size");
      const name = readPdxString(buffer, state, nameSize, label);
      const node = stack[stack.length - 1];
      assert.ok(node, label + " has a property without an object");
      assert.ok(!Object.prototype.hasOwnProperty.call(node.props, name), label + " repeats property " + name);
      node.props[name] = readPdxData(buffer, state, label + ":" + name);
    } else {
      assert.fail(label + " has an invalid PDX binary marker at byte " + String(state.offset));
    }
  }
  assert.deepEqual(root.props.pdxasset, [1, 0], label + " has an unsupported PDX asset version");
  return root;
}

function bufferStringCount(buffer, value) {
  const needle = Buffer.from(value, "latin1");
  let count = 0;
  let offset = 0;
  while ((offset = buffer.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function walkNodes(node, result = []) {
  result.push(node);
  for (const child of node.children) walkNodes(child, result);
  return result;
}

function assertFiniteArray(valuesArray, label) {
  assert.ok(Array.isArray(valuesArray) && valuesArray.length > 0, label + " is missing");
  for (const value of valuesArray) assert.ok(Number.isFinite(value), label + " contains a non-finite value");
}

function assertOutwardWinding(positions, normals, triangles, label) {
  const vertexCount = positions.length / 3;
  let validTriangles = 0;
  for (let index = 0; index < triangles.length; index += 3) {
    const ids = triangles.slice(index, index + 3);
    for (const id of ids) assert.ok(Number.isInteger(id) && id >= 0 && id < vertexCount,
      label + " triangle index is outside the vertex array");
    assert.equal(new Set(ids).size, 3, label + " has a triangle with repeated indices");
    const [a, b, c] = ids.map(id => id * 3);
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const crossLength = cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
    if (crossLength <= 1e-14) continue;
    const normal = [0, 1, 2].map(axis => (normals[a + axis] + normals[b + axis] + normals[c + axis]) / 3);
    assert.ok(cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0,
      label + " has inward or zero-facing triangle winding");
    validTriangles += 1;
  }
  assert.ok(validTriangles > 0, label + " has no nondegenerate triangles");
}

function assertMesh(model, metadata) {
  const meshName = "mm_dragon_" + model + ".mesh";
  const meshPath = path.join(modelRoot, meshName);
  const bytes = fs.readFileSync(meshPath);
  const root = parsePdxMesh(bytes, meshPath);
  const shapeName = "mm_dragon_" + model + "_shape";
  const shapes = walkNodes(root).filter(node => node.name === shapeName);
  assert.equal(shapes.length, 1, model + " mesh must contain its one expected shape");
  const meshes = walkNodes(shapes[0]).filter(node => node.name === "mesh");
  assert.ok(Array.isArray(metadata.submeshes) && metadata.submeshes.length > 0,
    model + " metadata must describe every runtime mesh part");
  assert.equal(meshes.length, metadata.submeshes.length, model + " shape parts disagree with models.json");
  const parts = [];
  for (let index = 0; index < meshes.length; index += 1) {
    const mesh = meshes[index];
    const partMetadata = metadata.submeshes[index];
    assert.equal(partMetadata.index, index, model + " submesh metadata indices must be contiguous");
    const label = model + " part " + index;
    const positions = mesh.props.p;
    const normals = mesh.props.n;
    const tangents = mesh.props.ta;
    const uv = mesh.props.u0;
    const triangles = mesh.props.tri;
    for (const [array, name] of [[positions, "positions"], [normals, "normals"], [tangents, "tangents"], [uv, "UVs"], [triangles, "triangle indices"]]) {
      assertFiniteArray(array, label + " " + name);
    }
    const vertices = positions.length / 3;
    const triangleCount = triangles.length / 3;
    assert.ok(Number.isInteger(vertices) && vertices >= 3 && vertices <= 60000, label + " must have 3-60000 vertices");
    assert.equal(normals.length, vertices * 3, label + " normals do not match positions");
    assert.equal(tangents.length, vertices * 4, label + " tangents do not match vertices");
    assert.equal(uv.length, vertices * 2, label + " UVs do not match vertices");
    assert.equal(triangles.length % 3, 0, label + " triangle indices must form triples");
    assert.equal(vertices, partMetadata.vertices, label + " vertex count disagrees with submesh metadata");
    assert.equal(triangleCount, partMetadata.triangles, label + " triangle count disagrees with submesh metadata");
    assertOutwardWinding(positions, normals, triangles, label);
    for (let offset = 0; offset < normals.length; offset += 3) {
      const norm2 = normals[offset] ** 2 + normals[offset + 1] ** 2 + normals[offset + 2] ** 2;
      assert.ok(norm2 > 1e-8, label + " has a zero-length normal");
    }
    for (let offset = 0; offset < tangents.length; offset += 4) {
      const tangent2 = tangents[offset] ** 2 + tangents[offset + 1] ** 2 + tangents[offset + 2] ** 2;
      assert.ok(tangent2 > 1e-8 && Math.abs(tangents[offset + 3]) > 0.5, label + " has a degenerate tangent");
    }
    const uvMin = [Infinity, Infinity];
    const uvMax = [-Infinity, -Infinity];
    for (let offset = 0; offset < uv.length; offset += 2) {
      uvMin[0] = Math.min(uvMin[0], uv[offset]);
      uvMin[1] = Math.min(uvMin[1], uv[offset + 1]);
      uvMax[0] = Math.max(uvMax[0], uv[offset]);
      uvMax[1] = Math.max(uvMax[1], uv[offset + 1]);
    }
    assert.ok(uvMax[0] - uvMin[0] > 1e-5 && uvMax[1] - uvMin[1] > 1e-5, label + " UVs are degenerate");

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let offset = 0; offset < positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], positions[offset + axis]);
        max[axis] = Math.max(max[axis], positions[offset + axis]);
      }
    }
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(min[axis] - partMetadata.min[axis]) < 1e-3, label + " minimum disagrees with submesh metadata");
      assert.ok(Math.abs(max[axis] - partMetadata.max[axis]) < 1e-3, label + " maximum disagrees with submesh metadata");
    }
    const aabbs = mesh.children.filter(node => node.name === "aabb");
    assert.equal(aabbs.length, 1, label + " mesh must have one AABB");
    assert.equal(aabbs[0].props.min.length, 3, label + " AABB minimum must contain three values");
    assert.equal(aabbs[0].props.max.length, 3, label + " AABB maximum must contain three values");
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(aabbs[0].props.min[axis] - min[axis]) < 1e-3, label + " AABB minimum differs from vertices");
      assert.ok(Math.abs(aabbs[0].props.max[axis] - max[axis]) < 1e-3, label + " AABB maximum differs from vertices");
    }
    assertFiniteArray(mesh.props.boundingsphere, label + " bounding sphere");
    assert.equal(mesh.props.boundingsphere.length, 4, label + " sphere must have four values");
    assert.ok(mesh.props.boundingsphere[3] > 0, label + " sphere radius is empty");
    for (let offset = 0; offset < positions.length; offset += 3) {
      const distance = Math.hypot(
        positions[offset] - mesh.props.boundingsphere[0],
        positions[offset + 1] - mesh.props.boundingsphere[1],
        positions[offset + 2] - mesh.props.boundingsphere[2],
      );
      assert.ok(distance <= mesh.props.boundingsphere[3] + 1e-3, label + " sphere does not enclose every vertex");
    }
    parts.push({ vertices, triangles: triangleCount, min, max });
  }
  const totalVertices = parts.reduce((sum, part) => sum + part.vertices, 0);
  const totalTriangles = parts.reduce((sum, part) => sum + part.triangles, 0);
  assert.equal(totalVertices, metadata.vertices, model + " aggregate runtime vertices disagree with models.json");
  assert.equal(totalTriangles, metadata.triangles, model + " aggregate runtime triangles disagree with models.json");
  const computedMin = [0, 1, 2].map(axis => Math.min(...parts.map(part => part.min[axis])));
  const computedMax = [0, 1, 2].map(axis => Math.max(...parts.map(part => part.max[axis])));
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(computedMin[axis] - metadata.min[axis]) < 1e-3, model + " minimum disagrees with models.json");
    assert.ok(Math.abs(computedMax[axis] - metadata.max[axis]) < 1e-3, model + " maximum disagrees with models.json");
  }
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, metadata.sha256, model + " mesh hash disagrees with models.json");
}

function assertWeaponDds(filePath, slot) {
  const bytes = fs.readFileSync(filePath);
  const label = "weapon " + slot;
  if (slot === "texture_normal") {
    ddsHelper.validateNormal(bytes, weaponTextureProfile, label);
  } else if (slot === "texture_specular") {
    ddsHelper.validateProperties(bytes, weaponTextureProfile, label, textureGrid);
  } else {
    ddsHelper.mipLayout(bytes, weaponTextureProfile, label);
  }
}

function assertModelSources(metadata) {
  assert.equal(metadata.format, "PDX binary @@b@ 1.0", "models.json must identify the tested PDX mesh format");
  assert.equal(metadata.shader, "court", "models.json must identify the court shader");
  assert.equal(metadata.axis, "Y-up; outward native triangle winding", "models.json must state axis and winding");
  assert.deepEqual(Object.keys(metadata.models).sort(), ["draxel", "serind"],
    "models.json must describe exactly the two court weapons");
  for (const model of ["draxel", "serind"]) {
    const entry = metadata.models[model];
    assert.ok(Number.isInteger(entry.vertices) && entry.vertices >= 3, model + " metadata needs a vertex count");
    assert.ok(Number.isInteger(entry.triangles) && entry.triangles > 0, model + " metadata needs a triangle count");
    assert.ok(Array.isArray(entry.min) && entry.min.length === 3, model + " metadata needs three minimum bounds");
    assert.ok(Array.isArray(entry.max) && entry.max.length === 3, model + " metadata needs three maximum bounds");
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, model + " metadata must contain a full mesh SHA-256");
    assert.ok(Number.isInteger(entry.editableVertices) && entry.editableVertices >= 3,
      model + " metadata must record the global editable vertex count");
    assertMesh(model, entry);

    const glb = fs.readFileSync(path.join(sourceModelRoot, model + ".glb"));
    assert.ok(glb.length >= 20, model + " GLB source is truncated");
    assert.equal(glb.toString("ascii", 0, 4), "glTF", model + " GLB source has the wrong magic");
    assert.equal(glb.readUInt32LE(4), 2, model + " GLB source must use glTF 2");
    assert.equal(glb.readUInt32LE(8), glb.length, model + " GLB length field is wrong");
    const obj = fs.readFileSync(path.join(sourceModelRoot, model + ".obj"), "utf8");
    assert.match(obj, /^v\s+-?\d/m, model + " OBJ source has no vertices");
    assert.match(obj, /^f\s+\d/m, model + " OBJ source has no faces");
    assert.equal((obj.match(/^v\s+/gm) || []).length, entry.editableVertices,
      model + " editable vertex count must match the global OBJ vertex list");
    const preview = fs.readFileSync(path.join(sourceModelRoot, model + "-preview.png"));
    assert.equal(preview.toString("hex", 0, 8), "89504e470d0a1a0a", model + " preview is not PNG");
  }
}

function assertMeshSettingsCoverage(settings, shapeName, partCount, label) {
  assert.equal(settings.length, partCount, label + " asset must bind every runtime submesh");
  for (let index = 0; index < settings.length; index += 1) {
    assert.equal(exactlyOne(settings[index], "name", label + " meshsettings"), shapeName,
      label + " meshsettings must reference one shared shape");
    assert.equal(exactlyOne(settings[index], "index", label + " meshsettings"), String(index),
      label + " meshsettings indices must be contiguous");
  }
}

function assertMeshSettingsMutationGuards() {
  const makeSettings = indices => indices.map(index => [
    { key: "name", value: "shape" },
    { key: "index", value: String(index) },
  ]);
  assertMeshSettingsCoverage(makeSettings([0, 1, 2]), "shape", 3, "probe");
  assert.throws(() => assertMeshSettingsCoverage(makeSettings([0, 1]), "shape", 3, "missing-part probe"),
    /bind every runtime submesh/, "settings validator must reject a missing part");
  assert.throws(() => assertMeshSettingsCoverage(makeSettings([0, 2, 2]), "shape", 3, "wrong-index probe"),
    /indices must be contiguous/, "settings validator must reject a skipped or duplicated index");
}

function assertWeaponTextureNegativeProbes() {
  const normalPath = path.join(modelRoot, "mm_dragon_weapons_normal.dds");
  const propertiesPath = path.join(modelRoot, "mm_dragon_weapons_properties.dds");
  const normal = fs.readFileSync(normalPath);
  const properties = fs.readFileSync(propertiesPath);
  assert.throws(() => ddsHelper.validateNormal(
    ddsHelper.replaceFirstColorBlock(normal, { r: 0, g: 0, b: 255 }), weaponTextureProfile, "weapon normal.B=255 probe"),
  /normal\.B must be zero/, "weapon normal validator must reject an emissive-channel mutation");
  assert.throws(() => ddsHelper.validateProperties(
    ddsHelper.replaceFirstColorBlock(properties, { r: 0, g: 128, b: 0 }), weaponTextureProfile, "weapon properties.G=128 probe", textureGrid),
  /global specular input limit/, "weapon properties validator must reject an overbright specular mutation");
}

const verifiedWeaponTextures = new Set();

function assertAssetVisualBindings(metadata) {
  const assetFiles = listFilesRecursively(modelRoot, ".asset");
  assert.equal(assetFiles.length, 1, "dragon weapon model directory must contain one .asset file");
  const assetEntries = parsePdxFile(assetFiles[0]);
  const pdxmeshes = values(assetEntries, "pdxmesh").filter(Array.isArray);
  const entities = values(assetEntries, "entity").filter(Array.isArray);
  assert.equal(pdxmeshes.length, 2, "weapon .asset must define two meshes");
  assert.equal(entities.length, 2, "weapon .asset must define two court entities");
  const meshByName = new Map(pdxmeshes.map(block => [exactlyOne(block, "name", "pdxmesh"), block]));
  const entityByName = new Map(entities.map(block => [exactlyOne(block, "name", "entity"), block]));
  const visuals = parsePdxFile(visualsPath);

  for (const expected of expectedBlueprints) {
    const model = expected.model;
    const entityName = "mm_dragon_" + model + "_court_entity";
    const shapeName = "mm_dragon_" + model + "_shape";
    const entity = entityByName.get(entityName);
    assert.ok(entity, model + " court entity is missing");
    const meshName = exactlyOne(entity, "pdxmesh", model + " entity");
    const meshBlock = meshByName.get(meshName);
    assert.ok(meshBlock, model + " entity points to an undefined pdxmesh");
    const meshFile = exactlyOne(meshBlock, "file", model + " pdxmesh");
    assert.equal(meshFile, "mm_dragon_" + model + ".mesh", model + " pdxmesh points to the wrong mesh file");
    const settings = values(meshBlock, "meshsettings").filter(Array.isArray);
    assertMeshSettingsCoverage(settings, shapeName, metadata.models[model].submeshes.length, model);
    const meshBytes = fs.readFileSync(path.join(modelRoot, meshFile));
    for (const setting of settings) {
      assert.equal(exactlyOne(setting, "shader", model + " meshsettings"), "court", model + " court shader is wrong");
      assert.equal(exactlyOne(setting, "shader_file", model + " meshsettings"), "gfx/FX/court_scene.shader",
        model + " court shader file is wrong");
      for (const [slot, texture] of [
        ["texture_diffuse", "mm_dragon_weapons_diffuse.dds"],
        ["texture_normal", "mm_dragon_weapons_normal.dds"],
        ["texture_specular", "mm_dragon_weapons_properties.dds"],
      ]) {
        assert.equal(exactlyOne(setting, slot, model + " meshsettings"), texture, model + " has wrong " + slot);
        const texturePath = path.join(modelRoot, texture);
        if (!verifiedWeaponTextures.has(texturePath)) {
          assertWeaponDds(texturePath, slot);
          verifiedWeaponTextures.add(texturePath);
        }
      }
    }
    for (const setting of settings) {
      for (const key of ["name", "shader", "texture_diffuse", "texture_normal", "texture_specular"]) {
        const value = exactlyOne(setting, key, model + " meshsettings");
        assert.equal(bufferStringCount(meshBytes, value), key === "name" ? 1 : settings.length,
          model + " runtime mesh must embed " + key + " once for every meshsettings index");
      }
    }

    const visual = findDefinition(visuals, expected.outputVisual, "weapon visuals");
    assertCourtVisualEntity(visual, expected.outputVisual, entityName);

    if (model === "draxel") {
      const wrongEntity = cloneAst(visual);
      replaceScalar(wrongEntity.value, "asset", "mm_dragon_serind_court_entity", expected.outputVisual);
      assert.throws(() => assertCourtVisualEntity(wrongEntity, expected.outputVisual, entityName),
        "visual validator must reject binding Draxel to Serind's entity");
    }
  }
}

const nativeBlueprintSource = assertBlueprintOverrides();
const modelMetadata = JSON.parse(fs.readFileSync(path.join(sourceModelRoot, "models.json"), "utf8"));
assert.deepEqual(weaponTextureProfile, {
  width: 4096,
  height: 4096,
  mipLevels: 13,
  propertiesGreenGlobalMax: 75,
  propertiesGreenNonGemTileMax: 32,
  gemTiles: [6, 13],
}, "court weapon textures must use the frozen 4096/13-mip low-spec profile");
assertModelSources(modelMetadata);
assertMeshSettingsMutationGuards();
assertAssetVisualBindings(modelMetadata);
assertWeaponTextureNegativeProbes();
console.log("Wyvern v1.1.6 court weapons: PASS (" + nativeBlueprintSource + " native blueprint, mutation guards, binary models, and court visual bindings)");

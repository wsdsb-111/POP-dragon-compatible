"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const captureRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const modelDir = path.join(captureRoot, "gfx", "models", "artifacts", "mm_wyvern_trophies");
const modelSourceDir = path.join(projectRoot, "artwork", "wyvern-trophies", "models");
const trophyEffectPath = path.join(captureRoot, "common", "scripted_effects", "mm_wyvern_trophies.txt");
const visualsPath = path.join(captureRoot, "common", "artifacts", "visuals", "mm_wyvern_trophies.txt");
const headSourceFixturePath = path.join(projectRoot, "tests", "fixtures", "v121", "head-source-contract.json");
const headSourceFixture = JSON.parse(fs.readFileSync(headSourceFixturePath, "utf8"));
const nativeMultiMeshFixturePath = path.join(projectRoot, "tests", "fixtures", "v117", "native-multi-mesh-contract.json");
const nativeMultiMeshFixture = JSON.parse(fs.readFileSync(nativeMultiMeshFixturePath, "utf8"));
const englishLocalePath = path.join(captureRoot, "localization", "english", "mm_wyvern_trophies_l_english.yml");
const chineseLocalePath = path.join(captureRoot, "localization", "simp_chinese", "mm_wyvern_trophies_l_simp_chinese.yml");
const kinds = ["fang", "eye", "scale", "head", "claw"];

function tokenizePdx(text, label) {
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (character === "\"") {
      index += 1;
      let value = "";
      let closed = false;
      while (index < text.length) {
        const current = text[index++];
        if (current === "\\" && index < text.length) value += text[index++];
        else if (current === "\"") {
          closed = true;
          break;
        } else value += current;
      }
      assert.ok(closed, label + " has an unterminated string");
      tokens.push(value);
    } else if ("{}=".includes(character)) {
      tokens.push(character);
      index += 1;
    } else {
      const start = index;
      while (index < text.length && !/[\s{}=#"]/.test(text[index])) index += 1;
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
      entries.push({
        key: token,
        value: valueToken === "{" ? parsePdxBlock(tokens, label, true) : valueToken,
      });
    } else {
      entries.push({ key: null, value: token });
    }
  }
  assert.ok(!nested, label + " has an unclosed block");
  return entries;
}

function parsePdxFile(filePath) {
  assert.ok(fs.existsSync(filePath), "missing PDX file: " + filePath);
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
  return values(block, key).find((value) => typeof value === "string");
}

function findDefinition(entries, key) {
  return entries.find((entry) => entry.key === key && Array.isArray(entry.value))?.value;
}

function containsScalar(block, key, expected) {
  for (const entry of block) {
    if (entry.key === key && entry.value === expected) return true;
    if (Array.isArray(entry.value) && containsScalar(entry.value, key, expected)) return true;
  }
  return false;
}

function hasDirectRarityCall(block, rarity) {
  const calls = values(block, "mm_wyvern_create_decorative_trophy_set_effect").filter(Array.isArray);
  return calls.length === 1 && firstScalar(calls[0], "RARITY") === rarity;
}

function findLegendaryRarityPair(block) {
  for (let index = 0; index < block.length; index += 1) {
    const entry = block[index];
    if (entry.key === "if" && Array.isArray(entry.value)) {
      const limit = values(entry.value, "limit").find(Array.isArray);
      if (limit
        && containsScalar(limit, "has_trait", "myv_wyvern_legendary")
        && containsScalar(limit, "has_character_flag", "mm_wyvern_legendary_origin")
        && hasDirectRarityCall(entry.value, "illustrious")) {
        return {
          ifBlock: entry.value,
          limit,
          pairedElse: block[index + 1]?.key === "else" && Array.isArray(block[index + 1].value)
            ? block[index + 1].value
            : null,
        };
      }
    }
    if (Array.isArray(entry.value)) {
      const nested = findLegendaryRarityPair(entry.value);
      if (nested) return nested;
    }
  }
  return null;
}

function parseLocale(filePath, expectedRoot) {
  assert.ok(fs.existsSync(filePath), "missing localization file: " + filePath);
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf], filePath + " must have a UTF-8 BOM");
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  assert.ok(text.startsWith(expectedRoot + ":"), filePath + " has the wrong localization root");
  const entries = new Map();
  for (const match of text.matchAll(/^\s*([A-Za-z0-9_.-]+):\d+\s+"((?:\\.|[^"\\])*)"\s*$/gm)) {
    assert.ok(!entries.has(match[1]), "duplicate localization key " + match[1] + " in " + filePath);
    entries.set(match[1], match[2]);
  }
  return entries;
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

function parsePdxMeshBuffer(buffer, label) {
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

function walkNodes(node, output) {
  output.push(node);
  for (const child of node.children) walkNodes(child, output);
  return output;
}

function assertFiniteNondegenerate(valuesArray, label) {
  assert.ok(Array.isArray(valuesArray) && valuesArray.length > 0, label + " is missing");
  for (const value of valuesArray) assert.ok(Number.isFinite(value), label + " contains a non-finite value");
}

function assertHeadFullSculptBounds(minimum, maximum) {
  const originalBounds = headSourceFixture.source.originalBounds;
  const scale = headSourceFixture.source.uniformScale;
  for (let axis = 0; axis < 3; axis += 1) {
    const originalSpan = originalBounds[1][axis] - originalBounds[0][axis];
    const actualSpan = maximum[axis] - minimum[axis];
    assert.ok(Math.abs(actualSpan - originalSpan * scale) <= originalSpan * scale * 0.01,
      "head runtime mesh axis " + axis + " must retain the full source extent at the current approved scale within 1%");
  }
  assert.ok(Math.abs(minimum[1]) <= 0.36, "head runtime mesh must retain the original base at minY approximately zero");
  assert.ok(Math.abs(maximum[1] - (originalBounds[1][1]-originalBounds[0][1])*scale) <= 0.36, "head runtime mesh must retain the original top at maxY at the complete scaled sculpt height");
}

function assertDds(filePath, label) {
  assert.ok(fs.existsSync(filePath), "missing " + label + " DDS: " + filePath);
  const bytes = fs.readFileSync(filePath);
  assert.ok(bytes.length >= 128, label + " DDS header is truncated");
  assert.equal(bytes.toString("ascii", 0, 4), "DDS ", label + " is not a DDS texture");
  assert.equal(bytes.readUInt32LE(4), 124, label + " has an invalid DDS header size");
  const height = bytes.readUInt32LE(12);
  const width = bytes.readUInt32LE(16);
  assert.ok(width > 0 && height > 0, label + " has empty DDS dimensions");
  assert.equal(bytes.toString("ascii", 84, 88), "DXT5", label + " must use the bundled DXT5 texture format");
}

function assertOutwardTriangleWinding(positions, normals, triangles, label) {
  assertFiniteNondegenerate(positions, label + " positions");
  assertFiniteNondegenerate(normals, label + " normals");
  assertFiniteNondegenerate(triangles, label + " triangle indices");
  assert.equal(positions.length % 3, 0, label + " positions must contain complete vertex triples");
  assert.equal(normals.length, positions.length, label + " normals must match the vertex positions");
  assert.equal(triangles.length % 3, 0, label + " indices must form complete triangles");
  const vertexCount = positions.length / 3;
  assert.ok(Number.isInteger(vertexCount) && vertexCount >= 3, label + " has an invalid vertex count");
  let nondegenerateCount = 0;

  for (let index = 0; index < triangles.length; index += 3) {
    const vertexIndices = triangles.slice(index, index + 3);
    for (const vertexIndex of vertexIndices) {
      assert.ok(Number.isInteger(vertexIndex) && vertexIndex >= 0 && vertexIndex < vertexCount,
        label + " has an out-of-range triangle index");
    }
    const offsets = vertexIndices.map((vertexIndex) => vertexIndex * 3);
    const a = offsets[0];
    const b = offsets[1];
    const c = offsets[2];
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2 <= 1e-14) continue;

    const averageNormal = [0, 1, 2].map((axis) =>
      (normals[a + axis] + normals[b + axis] + normals[c + axis]) / 3);
    const crossDotNormal = cross[0] * averageNormal[0]
      + cross[1] * averageNormal[1]
      + cross[2] * averageNormal[2];
    assert.ok(crossDotNormal > 0,
      label + " triangle " + String(index / 3) + " has inward or zero-facing winding");
    nondegenerateCount += 1;
  }
  assert.ok(nondegenerateCount > 0, label + " has no nondegenerate triangles");
  return nondegenerateCount;
}

function assertNativeGemWindingWhenAvailable() {
  const nativeGameRoot = process.env.CK3_GAME_DIR || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
  const nativeMeshPath = path.join(nativeGameRoot, "gfx", "models", "artifacts", "misc",
    "ep1_generic_diamond_massive_01_a.mesh");
  if (!fs.existsSync(nativeMeshPath)) return;

  const nativeRoot = parsePdxMeshBuffer(fs.readFileSync(nativeMeshPath), nativeMeshPath);
  const nativeMesh = walkNodes(nativeRoot, []).find((node) =>
    node.name === "mesh" && Array.isArray(node.props.p) && Array.isArray(node.props.n) && Array.isArray(node.props.tri));
  assert.ok(nativeMesh, "native diamond mesh has no readable vertex geometry");
  assertOutwardTriangleWinding(nativeMesh.props.p, nativeMesh.props.n, nativeMesh.props.tri, "native diamond");
}

function assertNativeMultiMeshExample() {
  const fixture = nativeMultiMeshFixture;
  assert.equal(fixture.formatVersion, 1);
  assert.equal(fixture.assetPath, "game/gfx/models/artifacts/thrones/pam_papal_throne.asset");
  assert.equal(fixture.assetSha256, "786e500abce1e186e401eddad8748ef5c31e68bc8f7fa9b6abb3208cfd1c658a");
  assert.equal(fixture.meshPath, "game/gfx/models/artifacts/thrones/pam_papal_throne_arch.mesh");
  assert.equal(fixture.meshSha256, "d43ca467ca035e76370176e771c99ad31db380942a249d51b1a573f46b5b841d");
  assert.equal(fixture.meshName, "pam_papal_throne_arch_mesh");
  assert.equal(fixture.shapeName, "pam_papal_throne_arch_LOD0Shape");
  assert.deepEqual(fixture.indices, [0, 1, 2, 3, 4]);
  assert.deepEqual(fixture.submeshes, [
    { vertices: 246, triangles: 190 },
    { vertices: 658, triangles: 800 },
    { vertices: 120, triangles: 66 },
    { vertices: 932, triangles: 1100 },
    { vertices: 291, triangles: 480 },
  ]);
  assert.match(fixture.assetSha256, /^[a-f0-9]{64}$/);
  assert.match(fixture.meshSha256, /^[a-f0-9]{64}$/);
  const nativeGameRoot = process.env.CK3_GAME_DIR || "D:/SteamLibrary/steamapps/common/Crusader Kings III/game";
  const assetRelativePath = fixture.assetPath.replace(/^game\//, "");
  const meshRelativePath = fixture.meshPath.replace(/^game\//, "");
  const assetPath = path.join(nativeGameRoot, ...assetRelativePath.split("/"));
  const meshPath = path.join(nativeGameRoot, ...meshRelativePath.split("/"));
  const assetExists = fs.existsSync(assetPath);
  const meshExists = fs.existsSync(meshPath);
  assert.equal(assetExists, meshExists, "native multi-mesh evidence source files must be present together");
  if (!assetExists) return;

  const assetBytes = fs.readFileSync(assetPath);
  const meshBytes = fs.readFileSync(meshPath);
  assert.equal(crypto.createHash("sha256").update(assetBytes).digest("hex"), fixture.assetSha256,
    "installed native multi-mesh asset must match the frozen evidence");
  assert.equal(crypto.createHash("sha256").update(meshBytes).digest("hex"), fixture.meshSha256,
    "installed native multi-mesh binary must match the frozen evidence");
  const assetEntries = parsePdxFile(assetPath);
  const nativeBlock = values(assetEntries, "pdxmesh").filter(Array.isArray)
    .find((block) => firstScalar(block, "name") === fixture.meshName);
  assert.ok(nativeBlock, "frozen native example must define the expected pdxmesh");
  assert.equal(firstScalar(nativeBlock, "file"), fixture.file);
  const settings = values(nativeBlock, "meshsettings").filter(Array.isArray)
    .filter((block) => firstScalar(block, "name") === fixture.shapeName);
  assert.deepEqual(settings.map((block) => Number(firstScalar(block, "index"))), fixture.indices,
    "native same-shape meshsettings must use ordered indices 0..4");

  const nativeMesh = parsePdxMeshBuffer(meshBytes, meshPath);
  const shape = walkNodes(nativeMesh, []).find((node) => node.name === fixture.shapeName);
  assert.ok(shape, "native binary must contain the frozen multi-part shape");
  const meshNodes = walkNodes(shape, []).filter((node) => node.name === "mesh");
  assert.equal(meshNodes.length, fixture.submeshes.length,
    "native same-shape mesh must contain one child mesh per meshsettings index");
  for (let index = 0; index < meshNodes.length; index += 1) {
    const mesh = meshNodes[index];
    const expected = fixture.submeshes[index];
    assert.equal(mesh.props.p.length / 3, expected.vertices, "native submesh vertex count evidence changed");
    assert.equal(mesh.props.tri.length / 3, expected.triangles, "native submesh triangle count evidence changed");
  }
}

function inspectModelPart(kind, partIndex, mesh, partMetadata) {
  const label = kind + " part " + partIndex;
  const positions = mesh.props.p;
  const normals = mesh.props.n;
  const tangents = mesh.props.ta;
  const uv = mesh.props.u0;
  const triangles = mesh.props.tri;
  for (const [array, name] of [[positions, "positions"], [normals, "normals"], [tangents, "tangents"], [uv, "UVs"], [triangles, "triangle indices"]]) {
    assertFiniteNondegenerate(array, label + " " + name);
  }
  const vertices = positions.length / 3;
  const triangleCount = triangles.length / 3;
  assert.ok(Number.isInteger(vertices) && vertices >= 3 && vertices <= 60000, label + " must have 3-60000 vertices");
  assert.equal(normals.length, vertices * 3, label + " normals do not match vertices");
  assert.equal(tangents.length, vertices * 4, label + " tangents do not match vertices");
  assert.equal(uv.length, vertices * 2, label + " UVs do not match vertices");
  assert.equal(triangles.length % 3, 0, label + " indices must form complete triangles");
  for (let offset = 0; offset < triangles.length; offset += 3) {
    assert.equal(new Set(triangles.slice(offset, offset + 3)).size, 3, label + " has a repeated-index triangle");
  }
  assertOutwardTriangleWinding(positions, normals, triangles, label);
  for (let offset = 0; offset < normals.length; offset += 3) {
    const lengthSquared = normals[offset] ** 2 + normals[offset + 1] ** 2 + normals[offset + 2] ** 2;
    assert.ok(lengthSquared > 1e-8, label + " has a zero-length normal");
  }
  for (let offset = 0; offset < tangents.length; offset += 4) {
    const lengthSquared = tangents[offset] ** 2 + tangents[offset + 1] ** 2 + tangents[offset + 2] ** 2;
    assert.ok(lengthSquared > 1e-8 && Math.abs(tangents[offset + 3]) > 0.5, label + " has a degenerate tangent");
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
  assert.equal(vertices, partMetadata.vertices, label + " vertex count disagrees with submesh metadata");
  assert.equal(triangleCount, partMetadata.triangles, label + " triangle count disagrees with submesh metadata");
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(min[axis] - partMetadata.min[axis]) < 1e-3, label + " minimum disagrees with submesh metadata");
    assert.ok(Math.abs(max[axis] - partMetadata.max[axis]) < 1e-3, label + " maximum disagrees with submesh metadata");
  }
  const aabbs = mesh.children.filter((node) => node.name === "aabb");
  assert.equal(aabbs.length, 1, label + " must have one AABB");
  assertFiniteNondegenerate(aabbs[0].props.min, label + " AABB minimum");
  assertFiniteNondegenerate(aabbs[0].props.max, label + " AABB maximum");
  assert.equal(aabbs[0].props.min.length, 3, label + " AABB minimum must contain three values");
  assert.equal(aabbs[0].props.max.length, 3, label + " AABB maximum must contain three values");
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(aabbs[0].props.min[axis] - min[axis]) < 1e-3, label + " AABB minimum disagrees with vertices");
    assert.ok(Math.abs(aabbs[0].props.max[axis] - max[axis]) < 1e-3, label + " AABB maximum disagrees with vertices");
  }
  assertFiniteNondegenerate(mesh.props.boundingsphere, label + " bounding sphere");
  assert.equal(mesh.props.boundingsphere.length, 4, label + " sphere must contain center and radius");
  assert.ok(mesh.props.boundingsphere[3] > 0, label + " sphere radius must be positive");
  for (let offset = 0; offset < positions.length; offset += 3) {
    const distance = Math.hypot(
      positions[offset] - mesh.props.boundingsphere[0],
      positions[offset + 1] - mesh.props.boundingsphere[1],
      positions[offset + 2] - mesh.props.boundingsphere[2],
    );
    assert.ok(distance <= mesh.props.boundingsphere[3] + 1e-3, label + " sphere does not enclose every vertex");
  }
  return { vertices, triangles: triangleCount, min, max };
}

function assertModelGeometry(kind, metadata) {
  const meshPath = path.join(modelDir, "mm_wyvern_trophy_" + kind + ".mesh");
  const buffer = fs.readFileSync(meshPath);
  const root = parsePdxMeshBuffer(buffer, meshPath);
  const shapeName = "mm_wyvern_" + kind + "_shape";
  const nodes = walkNodes(root, []);
  const shapes = nodes.filter((node) => node.name === shapeName);
  assert.equal(shapes.length, 1, kind + " mesh must contain exactly one matching meshsettings shape");
  const meshes = walkNodes(shapes[0], []).filter((node) => node.name === "mesh");
  assert.ok(Array.isArray(metadata.submeshes) && metadata.submeshes.length > 0,
    kind + " metadata must describe every runtime mesh part");
  assert.equal(meshes.length, metadata.submeshes.length, kind + " runtime mesh parts disagree with submeshes metadata");
  const parts = meshes.map((mesh, index) => {
    const partMetadata = metadata.submeshes[index];
    assert.equal(partMetadata.index, index, kind + " submesh indices must be contiguous and ordered");
    return inspectModelPart(kind, index, mesh, partMetadata);
  });
  const vertexCount = parts.reduce((sum, part) => sum + part.vertices, 0);
  const triangleCount = parts.reduce((sum, part) => sum + part.triangles, 0);
  const computedMin = [0, 1, 2].map((axis) => Math.min(...parts.map((part) => part.min[axis])));
  const computedMax = [0, 1, 2].map((axis) => Math.max(...parts.map((part) => part.max[axis])));
  assert.equal(vertexCount, metadata.vertices, kind + " aggregate vertex count disagrees with models.json");
  assert.equal(triangleCount, metadata.triangles, kind + " aggregate triangle count disagrees with models.json");
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(computedMin[axis] - metadata.min[axis]) < 1e-3, kind + " aggregate minimum disagrees with models.json");
    assert.ok(Math.abs(computedMax[axis] - metadata.max[axis]) < 1e-3, kind + " aggregate maximum disagrees with models.json");
  }
  if (kind === "head") assertHeadFullSculptBounds(computedMin, computedMax);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  assert.equal(digest, metadata.sha256, kind + " mesh digest disagrees with frozen model metadata");
  return vertexCount;
}

function assertTrophySourceFiles() {
  const metadataPath = path.join(modelSourceDir, "models.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.format, "PDX binary @@b@ 1.0", "models.json must describe the tested binary format");
  assert.equal(metadata.shader, "court", "models.json must identify the expected court shader");
  assert.equal(metadata.axis, "Y-up; outward native triangle winding", "models.json must freeze the model axis and winding");
  assertNativeGemWindingWhenAvailable();
  assertNativeMultiMeshExample();

  for (const kind of kinds) {
    assert.ok(metadata.models && metadata.models[kind], "models.json is missing " + kind);
    const glbPath = path.join(modelSourceDir, kind + ".glb");
    const glb = fs.readFileSync(glbPath);
    assert.ok(glb.length >= 20, kind + " source GLB is truncated");
    assert.equal(glb.toString("ascii", 0, 4), "glTF", kind + " source GLB has the wrong magic");
    assert.equal(glb.readUInt32LE(4), 2, kind + " source GLB must use glTF 2");
    assert.equal(glb.readUInt32LE(8), glb.length, kind + " source GLB length field is invalid");
    const objPath = path.join(modelSourceDir, kind + ".obj");
    const objText = fs.readFileSync(objPath, "utf8");
    assert.ok(objText.length > 0, kind + " source OBJ is empty");
    const editableVertices = (objText.match(/^v\s+/gm) || []).length;
    assert.equal(metadata.models[kind].editableVertices, editableVertices,
      kind + " editable vertex count must match its global OBJ vertex list");
    if (kind === "head") {
      const objectNames = objText.match(/^(?:o|g)\s+.+$/gm) || [];
      assert.ok(objectNames.length > 0, "full-bust editable OBJ must identify its head object");
      assert.ok(!objectNames.some((name) => /shield/i.test(name)),
        "full-bust editable geometry must not include an added shield object");
    }
    const previewPath = path.join(modelSourceDir, kind + "-preview.png");
    assert.equal(fs.readFileSync(previewPath).toString("hex", 0, 8), "89504e470d0a1a0a", kind + " preview is not a PNG");
    assertModelGeometry(kind, metadata.models[kind]);
  }
}

function assertMeshSettingsCoverage(settings, shapeName, expectedCount, label) {
  assert.equal(settings.length, expectedCount, label + " must bind every runtime mesh part");
  for (let index = 0; index < settings.length; index += 1) {
    assert.equal(firstScalar(settings[index], "name"), shapeName, label + " repeats the expected shape name");
    assert.equal(firstScalar(settings[index], "index"), String(index), label + " meshsettings indices must be contiguous");
  }
}

function assertMeshSettingsMutationGuards() {
  const makeSettings = (indices) => indices.map((index) => [
    { key: "name", value: "shape" },
    { key: "index", value: String(index) },
  ]);
  const expectedCount = 3;
  assertMeshSettingsCoverage(makeSettings([0, 1, 2]), "shape", expectedCount, "probe");
  assert.throws(() => assertMeshSettingsCoverage(makeSettings([0, 1]), "shape", expectedCount, "missing-part probe"),
    /bind every runtime mesh part/, "settings validator must reject a missing mesh part");
  assert.throws(() => assertMeshSettingsCoverage(makeSettings([0, 2, 2]), "shape", expectedCount, "wrong-index probe"),
    /indices must be contiguous/, "settings validator must reject a skipped or duplicated index");
}

function assertAssetsAndVisualBindings(metadata) {
  const assetPath = path.join(modelDir, "mm_wyvern_trophies.asset");
  const assetEntries = parsePdxFile(assetPath);
  const pdxmeshes = values(assetEntries, "pdxmesh").filter(Array.isArray);
  const entities = values(assetEntries, "entity").filter(Array.isArray);
  assert.equal(pdxmeshes.length, kinds.length, "asset file must define one pdxmesh per trophy");
  assert.equal(entities.length, kinds.length, "asset file must define one entity per trophy");

  const meshByName = new Map(pdxmeshes.map((block) => [firstScalar(block, "name"), block]));
  const entityByName = new Map(entities.map((block) => [firstScalar(block, "name"), block]));
  const visuals = parsePdxFile(visualsPath);
  assert.equal(visuals.filter((entry) => entry.key && Array.isArray(entry.value)).length, kinds.length,
    "visuals file must define all five trophy visuals");

  for (const kind of kinds) {
    const meshName = "mm_wyvern_trophy_" + kind + "_mesh";
    const entityName = "mm_wyvern_trophy_" + kind + "_entity";
    const visualName = "mm_wyvern_trophy_" + kind;
    const expectedShape = "mm_wyvern_" + kind + "_shape";
    const meshBlock = meshByName.get(meshName);
    assert.ok(meshBlock, kind + " pdxmesh definition is missing");
    assert.equal(firstScalar(meshBlock, "file"), "mm_wyvern_trophy_" + kind + ".mesh", kind + " pdxmesh points to the wrong mesh file");
    const meshFile = path.join(modelDir, firstScalar(meshBlock, "file"));
    assert.ok(fs.existsSync(meshFile), kind + " runtime mesh file is missing");

    const settings = values(meshBlock, "meshsettings").filter(Array.isArray);
    assertMeshSettingsCoverage(settings, expectedShape, metadata.models[kind].submeshes.length, kind);
    const meshBytes = fs.readFileSync(meshFile);
    for (const setting of settings) {
      assert.equal(firstScalar(setting, "shader"), "court", kind + " must use the court shader");
      assert.equal(firstScalar(setting, "shader_file"), "gfx/FX/court_scene.shader",
        kind + " asset must use the court shader file");
      for (const textureKey of ["texture_diffuse", "texture_normal", "texture_specular"]) {
        const texture = firstScalar(setting, textureKey);
        assert.ok(texture, kind + " is missing " + textureKey);
        assertDds(path.join(modelDir, texture), kind + " " + textureKey);
      }
    }
    for (const setting of settings) {
      for (const key of ["name", "shader", "texture_diffuse", "texture_normal", "texture_specular"]) {
        const value = firstScalar(setting, key);
        assert.ok(value, kind + " meshsettings is missing " + key);
        assert.equal(bufferStringCount(meshBytes, value), key === "name" ? 1 : settings.length,
          kind + " runtime mesh must embed " + key + " once for every meshsettings index");
      }
    }

    const entity = entityByName.get(entityName);
    assert.ok(entity, kind + " entity is missing");
    assert.equal(firstScalar(entity, "pdxmesh"), meshName, kind + " entity points to the wrong pdxmesh");
    const visual = findDefinition(visuals, visualName);
    assert.ok(visual, kind + " trophy visual definition is missing");
    assert.equal(firstScalar(visual, "asset"), entityName, kind + " visual must bind its own entity");
    if (kind === "head") {
      assert.equal(firstScalar(visual, "default_type"), "pedestal",
        "full-bust head visual must use pedestal placement");
      assert.equal(firstScalar(visual, "support_type"), "tall",
        "full-bust head pedestal visual must use tall support");
    }
  }
}

function assertTrophyCreationAndLocalization() {
  const trophyEntries = parsePdxFile(trophyEffectPath);
  const createEffect = findDefinition(trophyEntries, "mm_wyvern_create_decorative_trophy_set_effect");
  const grantEffect = findDefinition(trophyEntries, "mm_wyvern_grant_decorative_trophies_effect");
  assert.ok(createEffect, "decorative trophy creation effect is missing");
  assert.ok(grantEffect, "decorative trophy grant effect is missing");
  const artifacts = values(createEffect, "create_artifact").filter(Array.isArray);
  assert.equal(artifacts.length, 1, "new court rewards must create only the complete head bust");
  const sourceScopes = values(createEffect, "scope:mm_wyvern_trophy").filter(Array.isArray);
  assert.equal(sourceScopes.length, 1, "the created head must receive its source scope");

  const english = parseLocale(englishLocalePath, "l_english");
  const chinese = parseLocale(chineseLocalePath, "l_simp_chinese");
  for (const kind of kinds) {
    const nameKey = "mm_wyvern_trophy_" + kind + "_name";
    const descKey = "mm_wyvern_trophy_" + kind + "_desc";
    for (const [locale, keys] of [["English", english], ["Simplified Chinese", chinese]]) {
      for (const key of [nameKey, descKey]) {
        assert.ok(keys.has(key) && keys.get(key).includes("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]"),
          locale + " current and legacy trophy text must retain the source dragon: " + key);
      }
    }
    if (kind !== "head") {
      assert.ok(!artifacts.some((entry) => firstScalar(entry, "visuals") === "mm_wyvern_trophy_" + kind),
        kind + " must remain a legacy resource, not a new court drop");
      continue;
    }
    const artifact = artifacts.find((entry) => firstScalar(entry, "visuals") === "mm_wyvern_trophy_" + kind);
    assert.ok(artifact, kind + " create_artifact block is missing");
    assert.equal(firstScalar(artifact, "name"), nameKey, kind + " artifact name key is wrong");
    assert.equal(firstScalar(artifact, "description"), descKey, kind + " artifact description key is wrong");
    assert.equal(firstScalar(artifact, "rarity"), "$RARITY$", kind + " artifact must use the shared rarity parameter");
    assert.equal(firstScalar(artifact, "generate_history"), "no", kind + " artifact must use explicit creation history");
    assert.equal(firstScalar(artifact, "creator"), "root", kind + " history must not imply that the dragon created the artifact");
    const visual = findDefinition(parsePdxFile(visualsPath), "mm_wyvern_trophy_" + kind);
    const visualType = firstScalar(visual, "default_type");
    if (kind === "head") {
      assert.equal(firstScalar(artifact, "type"), "pedestal",
        "new full-bust head reward must be created for pedestal display");
      assert.equal(visualType, "pedestal",
        "new full-bust head visual must match its pedestal reward type");
    }
    assert.equal(firstScalar(artifact, "type"), visualType,
      kind + " artifact type must match its visual type");

    for (const [locale, keys] of [["English", english], ["Simplified Chinese", chinese]]) {
      for (const key of [nameKey, descKey]) {
        assert.ok(keys.has(key), "missing " + locale + " trophy localization: " + key);
        assert.ok(keys.get(key).includes("[mm_wyvern_trophy_source.GetFirstNameNoTooltip]"),
          locale + " " + key + " must name the source dragon");
      }
    }

    const sourceScope = sourceScopes[artifacts.indexOf(artifact)];
    assert.ok(containsScalar(sourceScope, "value", "scope:mm_wyvern_trophy_source"),
      kind + " artifact must retain its source dragon variable");
    const history = values(sourceScope, "add_artifact_history").find(Array.isArray);
    assert.ok(history, kind + " artifact must have native creation history");
    assert.equal(firstScalar(history, "actor"), "root", kind + " creation history actor must remain root");
    assert.equal(firstScalar(history, "recipient"), "root", kind + " creation history recipient must remain root");
  }

  const rarityPair = findLegendaryRarityPair(grantEffect);
  assert.ok(rarityPair, "nested legendary-source branch must grant illustrious trophies");
  assert.ok(containsScalar(rarityPair.limit, "has_trait", "myv_wyvern_legendary"),
    "legendary rarity branch must preserve the legendary trait source");
  assert.ok(containsScalar(rarityPair.limit, "has_character_flag", "mm_wyvern_legendary_origin"),
    "legendary rarity branch must preserve the legendary-origin flag source");
  assert.ok(rarityPair.pairedElse, "legendary rarity if must have its adjacent paired else");
  assert.ok(hasDirectRarityCall(rarityPair.pairedElse, "famed"),
    "the paired non-legendary else branch must grant famed trophies");
}

assertTrophySourceFiles();
assertMeshSettingsMutationGuards();
const modelMetadata = JSON.parse(fs.readFileSync(path.join(modelSourceDir, "models.json"), "utf8"));
assertAssetsAndVisualBindings(modelMetadata);
assertTrophyCreationAndLocalization();
console.log("WYVERN MODEL REGRESSIONS PASS: 5 native meshes, bindings, source trophy creation, and localization are structurally valid.");

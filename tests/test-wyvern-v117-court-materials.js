"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const modRoot = path.join(projectRoot, "patches", "wyvern-capture", "mod");
const shaderFixturePath = path.join(projectRoot, "tests", "fixtures", "v117", "court-material-shader-contract.json");
const headSourceFixturePath = path.join(projectRoot, "tests", "fixtures", "v121", "head-source-contract.json");
const shaderFixture = JSON.parse(fs.readFileSync(shaderFixturePath, "utf8"));
const headSourceFixture = JSON.parse(fs.readFileSync(headSourceFixturePath, "utf8"));
const contract = shaderFixture.textureContract;
const defaultInstallRoot = "D:/SteamLibrary/steamapps/common/Crusader Kings III";
const installRoot = process.env.CK3_INSTALL_ROOT
  ? path.resolve(process.env.CK3_INSTALL_ROOT)
  : process.env.CK3_GAME_DIR
    ? path.dirname(path.resolve(process.env.CK3_GAME_DIR))
    : defaultInstallRoot;

const textureSets = [
  {
    kind: "trophy",
    profile: "trophy",
    asset: "gfx/models/artifacts/mm_wyvern_trophies/mm_wyvern_trophies.asset",
    directory: "gfx/models/artifacts/mm_wyvern_trophies",
    diffuse: "mm_wyvern_trophies_diffuse.dds",
    normal: "mm_wyvern_trophies_normal.dds",
    properties: "mm_wyvern_trophies_properties.dds",
  },
  {
    kind: "head",
    profile: "head",
    asset: "gfx/models/artifacts/mm_wyvern_trophies/mm_wyvern_trophies.asset",
    directory: "gfx/models/artifacts/mm_wyvern_trophies",
    meshName: "mm_wyvern_trophy_head_mesh",
    meshFile: "mm_wyvern_trophy_head.mesh",
    shapeName: "mm_wyvern_head_shape",
    diffuse: "mm_wyvern_head_diffuse.dds",
    normal: "mm_wyvern_head_normal.dds",
    properties: "mm_wyvern_head_properties.dds",
  },
];

const sharedTrophyMaterial = {
  diffuse: "mm_wyvern_trophies_diffuse.dds",
  normal: "mm_wyvern_trophies_normal.dds",
  properties: "mm_wyvern_trophies_properties.dds",
};

const expectedShaderFragments = {
  "game/gfx/FX/court_scene.shader": [
    "SMaterialProperties MaterialProps = GetMaterialProperties( Diffuse.rgb, Normal, saturate( Properties.a ), Properties.g, Properties.b );",
    "float ScatteringMask = Properties.r;",
    "float emissiveMask = PdxTex2D( NormalMap, Input.UV0 ).b;",
    "Color = lerp(Color, emissiveColor, emissiveMask);",
    "Effect court { VertexShader = \"VS_standard\" PixelShader = \"PS_court\" Defines = { \"EMISSIVE\" } }",
  ],
  "game/gfx/FX/cw/lighting.fxh": [
    "return 0.25 * SampledSpec;",
    "return PerceptualRoughness * PerceptualRoughness;",
  ],
  "game/gfx/FX/cw/lighting_util.fxh": [
    "MaterialProps._Roughness = RoughnessFromPerceptualRoughness( MaterialProps._PerceptualRoughness );",
    "float SpecRemapped = RemapSpec( SampledSpec );",
    "MaterialProps._Metalness = SampledMetalness;",
    "MaterialProps._SpecularColor = MetalnessToSpec( MaterialProps._Metalness, SampledDiffuse, SpecRemapped );",
  ],
  "clausewitz/gfx/FX/cw/utility.fxh": [
    "float x = NormalMapSample.g * 2.0 - 1.0;",
    "float y = NormalMapSample.a * 2.0 - 1.0;",
    "y = -y;",
    "float z = sqrt( saturate( 1.0 - x * x - y * y ) );",
    "return float3( x, y, z );",
  ],
};

function normalizeShaderText(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertShaderFragments(text, fragments, label) {
  const normalized = normalizeShaderText(text);
  for (const fragment of fragments) {
    assert.ok(normalized.includes(normalizeShaderText(fragment)), label + " lacks frozen shader fragment: " + fragment);
  }
}

function assertShaderSourceFixture() {
  assert.equal(shaderFixture.formatVersion, 1, "shader fixture format must be version 1");
  assert.equal(shaderFixture.shaderSources.length, Object.keys(expectedShaderFragments).length,
    "shader fixture must freeze every court material source");
  const seenPaths = new Set();
  for (const source of shaderFixture.shaderSources) {
    assert.ok(Object.prototype.hasOwnProperty.call(expectedShaderFragments, source.path),
      "unexpected shader source path in fixture: " + source.path);
    assert.ok(!seenPaths.has(source.path), "duplicate shader source metadata: " + source.path);
    seenPaths.add(source.path);
    assert.match(source.sha256, /^[a-f0-9]{64}$/, source.path + " must freeze a SHA-256 digest");
    assert.deepEqual(source.fragments, expectedShaderFragments[source.path],
      source.path + " fixture must retain the reviewed shader contract fragments");
    assertShaderFragments(source.fragments.join("\n"), expectedShaderFragments[source.path],
      "frozen fixture " + source.path);

    const localPath = path.join(installRoot, ...source.path.split("/"));
    if (!fs.existsSync(localPath)) continue;
    const bytes = fs.readFileSync(localPath);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, source.sha256, source.path + " differs from frozen native shader SHA-256");
    assertShaderFragments(bytes.toString("utf8"), expectedShaderFragments[source.path], localPath);
  }
  assert.deepEqual([...seenPaths].sort(), Object.keys(expectedShaderFragments).sort());
}

function makeChannelStats() {
  return { min: 255, max: 0, sum: 0, count: 0 };
}

function addChannelValue(stats, value) {
  if (value < stats.min) stats.min = value;
  if (value > stats.max) stats.max = value;
  stats.sum += value;
  stats.count += 1;
}

function rgb565(value) {
  return {
    r: Math.round(((value >>> 11) & 31) * 255 / 31),
    g: Math.round(((value >>> 5) & 63) * 255 / 63),
    b: Math.round((value & 31) * 255 / 31),
  };
}

function color565(r, g, b) {
  const red = Math.round(r * 31 / 255);
  const green = Math.round(g * 63 / 255);
  const blue = Math.round(b * 31 / 255);
  return (red << 11) | (green << 5) | blue;
}

function dxt5MipLayout(bytes, label, profile) {
  assert.ok(bytes.length >= 128, label + " DDS header is truncated");
  assert.equal(bytes.toString("ascii", 0, 4), "DDS ", label + " is missing DDS magic");
  assert.equal(bytes.readUInt32LE(4), 124, label + " has an invalid DDS header size");
  assert.equal(bytes.readUInt32LE(76), 32, label + " has an invalid pixel-format header size");
  assert.ok((bytes.readUInt32LE(80) & 0x4) !== 0, label + " must use a FOURCC pixel format");
  assert.equal(bytes.toString("ascii", 84, 88), "DXT5", label + " must use DXT5/BC3 compression");

  const height = bytes.readUInt32LE(12);
  const width = bytes.readUInt32LE(16);
  const flags = bytes.readUInt32LE(8);
  const mipCount = bytes.readUInt32LE(28);
  const caps = bytes.readUInt32LE(108);
  assert.equal(width, profile.width, label + " must have the expected width");
  assert.equal(height, profile.height, label + " must have the expected height");
  assert.equal(mipCount, profile.mipLevels, label + " must include every mip down to 1x1");
  assert.ok((flags & 0x20000) !== 0, label + " must declare its mip count in the DDS header");
  assert.ok((caps & 0x400000) !== 0, label + " must mark DDS mipmap capability");
  assert.ok((caps & 0x8) !== 0, label + " must mark a mipmapped texture as complex");

  const mips = [];
  let offset = 128;
  let mipWidth = width;
  let mipHeight = height;
  for (let level = 0; level < mipCount; level += 1) {
    const blocksWide = Math.ceil(mipWidth / 4);
    const blocksHigh = Math.ceil(mipHeight / 4);
    const byteLength = blocksWide * blocksHigh * 16;
    assert.ok(Number.isSafeInteger(byteLength), label + " mip " + level + " has an invalid DXT5 block count");
    assert.ok(offset + byteLength <= bytes.length, label + " mip " + level + " is truncated");
    mips.push({ level, width: mipWidth, height: mipHeight, blocksWide, blocksHigh, offset, byteLength });
    offset += byteLength;
    mipWidth = Math.max(1, mipWidth >> 1);
    mipHeight = Math.max(1, mipHeight >> 1);
  }
  assert.equal(mips[mips.length - 1].width, 1, label + " mip tail must end at width 1");
  assert.equal(mips[mips.length - 1].height, 1, label + " mip tail must end at height 1");
  assert.equal(bytes.length, offset, label + " DDS byte length must exactly match all DXT5 mip blocks");
  return mips;
}

function decodeDxt5(bytes, label, materialKind, profile) {
  const mips = dxt5MipLayout(bytes, label, profile);
  const channels = { r: makeChannelStats(), g: makeChannelStats(), b: makeChannelStats(), a: makeChannelStats() };
  const vector = { saturated: 0, invalid: 0, maxRadial: 0, count: 0 };
  const tileStats = Array.from({ length: contract.tileColumns * contract.tileRows }, () => ({ maxGreen: 0, count: 0 }));
  let totalPixels = 0;

  for (const mip of mips) {
    for (let blockY = 0; blockY < mip.blocksHigh; blockY += 1) {
      for (let blockX = 0; blockX < mip.blocksWide; blockX += 1) {
        const blockOffset = mip.offset + (blockY * mip.blocksWide + blockX) * 16;
        const alpha0 = bytes[blockOffset];
        const alpha1 = bytes[blockOffset + 1];
        const alphaBits = bytes.readUIntLE(blockOffset + 2, 6);
        const alphaPalette = [alpha0, alpha1];
        if (alpha0 > alpha1) {
          for (let index = 2; index < 8; index += 1) {
            alphaPalette[index] = Math.floor(((8 - index) * alpha0 + (index - 1) * alpha1) / 7);
          }
        } else {
          for (let index = 2; index < 6; index += 1) {
            alphaPalette[index] = Math.floor(((6 - index) * alpha0 + (index - 1) * alpha1) / 5);
          }
          alphaPalette[6] = 0;
          alphaPalette[7] = 255;
        }

        const color0 = rgb565(bytes.readUInt16LE(blockOffset + 8));
        const color1 = rgb565(bytes.readUInt16LE(blockOffset + 10));
        const color2 = {
          r: Math.round((2 * color0.r + color1.r) / 3),
          g: Math.round((2 * color0.g + color1.g) / 3),
          b: Math.round((2 * color0.b + color1.b) / 3),
        };
        const color3 = {
          r: Math.round((color0.r + 2 * color1.r) / 3),
          g: Math.round((color0.g + 2 * color1.g) / 3),
          b: Math.round((color0.b + 2 * color1.b) / 3),
        };
        const colorBits = bytes.readUInt32LE(blockOffset + 12);

        for (let pixelY = 0; pixelY < 4; pixelY += 1) {
          const y = blockY * 4 + pixelY;
          if (y >= mip.height) continue;
          for (let pixelX = 0; pixelX < 4; pixelX += 1) {
            const x = blockX * 4 + pixelX;
            if (x >= mip.width) continue;
            const pixelIndex = pixelY * 4 + pixelX;
            const colorIndex = (colorBits >>> (pixelIndex * 2)) & 3;
            let red;
            let green;
            let blue;
            if (colorIndex === 0) {
              red = color0.r;
              green = color0.g;
              blue = color0.b;
            } else if (colorIndex === 1) {
              red = color1.r;
              green = color1.g;
              blue = color1.b;
            } else if (colorIndex === 2) {
              red = color2.r;
              green = color2.g;
              blue = color2.b;
            } else {
              red = color3.r;
              green = color3.g;
              blue = color3.b;
            }
            const alphaIndex = Math.floor(alphaBits / (2 ** (pixelIndex * 3))) & 7;
            const alpha = alphaPalette[alphaIndex];
            addChannelValue(channels.r, red);
            addChannelValue(channels.g, green);
            addChannelValue(channels.b, blue);
            addChannelValue(channels.a, alpha);
            totalPixels += 1;

            if (materialKind === "normal") {
              if (green <= 8 || green >= 247) vector.saturated += 1;
              if (alpha <= 8 || alpha >= 247) vector.saturated += 1;
              const normalX = green / 255 * 2 - 1;
              const normalY = -(alpha / 255 * 2 - 1);
              const radial = normalX * normalX + normalY * normalY;
              if (radial > vector.maxRadial) vector.maxRadial = radial;
              const normalZ = Math.sqrt(Math.max(0, 1 - radial));
              const length = Math.hypot(normalX, normalY, normalZ);
              if (!Number.isFinite(length) || radial > 1.02 || Math.abs(length - 1) > 0.011) vector.invalid += 1;
              vector.count += 1;
            }

            if (materialKind === "properties" && mip.level === 0) {
              const tileWidth = mip.width / contract.tileColumns;
              const tileHeight = mip.height / contract.tileRows;
              const tileIndex = Math.floor(y / tileHeight) * contract.tileColumns + Math.floor(x / tileWidth);
              const tile = tileStats[tileIndex];
              tile.maxGreen = Math.max(tile.maxGreen, green);
              tile.count += 1;
            }
          }
        }
      }
    }
  }

  assert.equal(totalPixels, mips.reduce((sum, mip) => sum + mip.width * mip.height, 0),
    label + " decoder must visit every texel in every mip");
  return { mips, channels, vector, tileStats, totalPixels };
}

function validateNormalDds(bytes, label, profile) {
  const decoded = decodeDxt5(bytes, label, "normal", profile);
  assert.equal(decoded.channels.b.max, 0, label + " normal.B must be zero on every texel and mip");
  const allowedSaturated = Math.max(4, Math.floor(decoded.vector.count * 0.00001));
  assert.ok(decoded.vector.saturated <= allowedSaturated,
    label + " normal RRxG G/A has too many saturated samples");
  assert.equal(decoded.vector.invalid, 0, label + " RRxG G/A samples must decode to valid unit normals");
  return decoded;
}

function validatePropertiesDds(bytes, label, profile) {
  const decoded = decodeDxt5(bytes, label, "properties", profile);
  assert.ok(decoded.channels.g.max <= profile.propertiesGreenGlobalMax,
    label + " properties.G exceeds the global specular input limit");
  const gemTiles = new Set(profile.gemTiles);
  if (profile.gemTiles.length === 0) assert.equal(gemTiles.size, 0, label + " must not declare gem tile exceptions");
  else assert.ok(gemTiles.size > 0, label + " must declare gem tile exceptions");
  for (let tileIndex = 0; tileIndex < decoded.tileStats.length; tileIndex += 1) {
    const tile = decoded.tileStats[tileIndex];
    assert.equal(tile.count, (profile.width / contract.tileColumns) * (profile.height / contract.tileRows),
      label + " tile " + tileIndex + " must be completely decoded");
    if (!gemTiles.has(tileIndex)) {
      assert.ok(tile.maxGreen <= profile.propertiesGreenNonGemTileMax,
        label + " non-gem tile " + tileIndex + " properties.G exceeds its limit");
    }
  }
  return decoded;
}

function replaceFirstDxt5ColorBlock(bytes, rgb) {
  const probe = Buffer.from(bytes);
  const endpoint = color565(rgb.r, rgb.g, rgb.b);
  probe.writeUInt16LE(endpoint, 128 + 8);
  probe.writeUInt16LE(endpoint, 128 + 10);
  probe.writeUInt32LE(0, 128 + 12);
  return probe;
}

function extractBalancedBlock(text, start, label) {
  const open = text.indexOf("{", start);
  assert.notEqual(open, -1, label + " has no opening brace");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  assert.fail(label + " has an unterminated block");
}

function namedAssetBlock(text, declaration, name, label) {
  const declarationPattern = new RegExp("\\b" + declaration + "\\s*=\\s*\\{", "g");
  for (const match of text.matchAll(declarationPattern)) {
    const block = extractBalancedBlock(text, match.index, label);
    if (new RegExp("\\bname\\s*=\\s*\\\"" + name + "\\\"").test(block)) {
      return block;
    }
  }
  assert.fail(label + " is missing named " + declaration + " " + name);
}

function assetString(block, key, label) {
  const match = block.match(new RegExp("\\b" + key + "\\s*=\\s*\\\"([^\\\"]+)\\\""));
  assert.ok(match, label + " is missing string field " + key);
  return match[1];
}

function assetScalar(block, key, label) {
  const match = block.match(new RegExp("\\b" + key + "\\s*=\\s*(?:\\\"([^\\\"]+)\\\"|([^\\s}]+))"));
  assert.ok(match, label + " is missing scalar field " + key);
  return match[1] || match[2];
}

function assetMeshSettings(block, label) {
  const settings = [...block.matchAll(/\bmeshsettings\s*=\s*\{([^{}]*)\}/gs)].map((match) => match[0]);
  assert.ok(settings.length > 0, label + " has no meshsettings");
  return settings;
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

function assertAssetBindings() {
  const trophySet = textureSets.find((set) => set.kind === "trophy");
  const trophyAssetPath = path.join(modRoot, trophySet.asset);
  const trophyAsset = fs.readFileSync(trophyAssetPath, "utf8");
  for (const kind of ["fang", "eye", "scale", "claw"]) {
    const block = namedAssetBlock(trophyAsset, "pdxmesh", "mm_wyvern_trophy_" + kind + "_mesh", kind + " shared-material asset");
    const settings = assetMeshSettings(block, kind + " shared-material meshsettings");
    assert.equal(settings.length, 1, kind + " old trophy mesh must remain single-part");
    for (const slot of ["texture_diffuse", "texture_normal", "texture_specular"]) {
      const expectedTexture = slot === "texture_diffuse" ? sharedTrophyMaterial.diffuse
        : slot === "texture_normal" ? sharedTrophyMaterial.normal
          : sharedTrophyMaterial.properties;
      assert.equal(assetString(settings[0], slot, kind), expectedTexture,
        kind + " must retain the shared trophy " + slot + " map");
    }
  }

  for (const set of textureSets) {
    if (set.kind === "trophy") continue;
    const assetPath = path.join(modRoot, set.asset);
    const asset = fs.readFileSync(assetPath, "utf8");
    const block = set.meshName
      ? namedAssetBlock(asset, "pdxmesh", set.meshName, set.kind + " dedicated-material asset")
      : asset;
    const settings = assetMeshSettings(block, set.kind + " meshsettings");
    if (set.kind === "head") {
      const models = JSON.parse(fs.readFileSync(path.join(projectRoot, "artwork", "wyvern-trophies", "models", "models.json"), "utf8"));
      assert.equal(settings.length, models.models.head.submeshes.length,
        "head asset meshsettings must cover every runtime mesh part");
    }
    for (let index = 0; index < settings.length; index += 1) {
      const setting = settings[index];
      assert.equal(assetString(setting, "name", set.kind), set.shapeName || "mm_wyvern_" + set.kind + "_shape",
        set.kind + " meshsettings shape name is wrong");
      assert.equal(assetScalar(setting, "index", set.kind), String(index),
        set.kind + " meshsettings indices must cover runtime mesh parts in order");
      assert.equal(assetString(setting, "texture_diffuse", set.kind), set.diffuse,
        set.kind + " model asset must bind its tested diffuse DDS");
      assert.equal(assetString(setting, "texture_normal", set.kind), set.normal,
        set.kind + " model asset must bind its tested normal DDS");
      assert.equal(assetString(setting, "texture_specular", set.kind), set.properties,
        set.kind + " model asset must bind its tested properties DDS");
      assert.equal(assetString(setting, "shader", set.kind), "court",
        set.kind + " model asset must retain the court emissive shader variant");
    }

    if (set.kind === "head") {
      assert.equal(assetString(block, "file", set.kind), set.meshFile, "head asset must bind the runtime head mesh");
      const meshPath = path.join(modRoot, set.directory, set.meshFile);
      const meshBytes = fs.readFileSync(meshPath);
      assert.equal(meshBytes.toString("ascii", 0, 4), "@@b@", "head runtime mesh must use PDX binary format");
      for (const [label, value] of [
        ["shape", set.shapeName],
        ["diffuse", set.diffuse],
        ["normal", set.normal],
        ["properties", set.properties],
        ["shader", "court"],
      ]) {
        assert.equal(bufferStringCount(meshBytes, value), label === "shape" ? 1 : settings.length,
          "head mesh embedded " + label + " must match every asset meshsettings index");
      }
    }
  }
}

function assertHeadProvenance() {
  assert.equal(headSourceFixture.formatVersion, 1, "head source fixture format must be version 1");
  const expected = headSourceFixture.source;
  assert.equal(expected.author, "winner_77");
  assert.equal(expected.originalTitle, "Screaming dragon head");
  assert.equal(expected.filename, "DragScream.fbx");
  assert.equal(expected.sha256, "e101ea332eb230ace37813c11b5ac76ee3b70992997ce5890df3d287eccb5298");
  assert.equal(expected.originalVertices, 651443);
  assert.equal(expected.originalTriangles, 1303950);
  assert.equal(expected.license, "CC BY 4.0");
  const headSet = textureSets.find((set) => set.kind === "head");
  assert.equal(headSourceFixture.runtimeModel, headSet.meshFile);
  assert.deepEqual(headSourceFixture.runtimeTextures, [headSet.diffuse, headSet.normal, headSet.properties]);

  const sourcePath = process.env.WYVERN_HEAD_FBX_PATH || "C:/Users/97330/Desktop/dragonhead/source/DragScream.fbx";
  if (fs.existsSync(sourcePath)) {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
    assert.equal(digest, expected.sha256, "provided original head FBX must match the frozen source SHA-256");
  }

  const sourceMetadataPath = path.join(projectRoot, "artwork", "wyvern-trophies", "models", "winner77-head-source.json");
  const sourceMetadata = JSON.parse(fs.readFileSync(sourceMetadataPath, "utf8"));
  assert.equal(sourceMetadata.author, expected.author);
  assert.equal(sourceMetadata.sourceFile, expected.filename);
  assert.equal(sourceMetadata.originalSha256, expected.sha256);
  assert.equal(sourceMetadata.originalVertices, expected.originalVertices);
  assert.equal(sourceMetadata.originalTriangles, expected.originalTriangles);
  assert.equal(sourceMetadata.fullSculptRetained, expected.fullSculptRetained,
    "source metadata must state that the full sculpt is retained");
  assert.deepEqual(sourceMetadata.originalBounds, expected.originalBounds,
    "source metadata must freeze the complete original FBX bounds");
  assert.equal(sourceMetadata.uniformScale, expected.uniformScale);
  assert.equal(sourceMetadata.optimizedTriangles, expected.optimizedTriangles);
  assert.deepEqual(sourceMetadata.palette, expected.palette,
    "source metadata must retain the frozen palette anchor colors");
  assert.ok(!("croppedTriangles" in sourceMetadata) || sourceMetadata.croppedTriangles === 0,
    "full-sculpt source metadata must not record cropped geometry");
  assert.ok(sourceMetadata.changes.some((change) => /preserv.*complete.*head.*neck.*base/i.test(change)),
    "source metadata must state that the original head, neck, and base are retained");
  assert.ok(!sourceMetadata.changes.some((change) => /remov.*(base|neck)|cropped\s+(base|neck)|裁[掉剪]/i.test(change)),
    "source metadata must not describe cropping away the base or neck");
  assert.ok(!sourceMetadata.changes.some((change) => /shield/i.test(change)),
    "source metadata must not describe adding a shield to the bust");

  const modelsPath = path.join(projectRoot, "artwork", "wyvern-trophies", "models", "models.json");
  const models = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
  assert.ok(models.models && models.models.head, "models.json must record the exported head model");
  const headMetadata = models.models.head;
  const exportedTriangles = expected.exportedTriangles;
  assert.equal(sourceMetadata.exportedTriangles, exportedTriangles,
    "source metadata must record the exported triangle count");
  assert.equal(headMetadata.triangles, exportedTriangles,
    "models.json must record the same exported triangle count as source metadata");
  assert.equal(headMetadata.triangles, sourceMetadata.optimizedTriangles,
    "runtime output must retain the requested optimized face count");
  assert.ok(exportedTriangles > 0 && exportedTriangles < expected.originalTriangles,
    "head export must record a reduced, non-empty triangle count");

  const embeddedSource = headMetadata.source || headMetadata.provenance;
  if (embeddedSource) {
    assert.equal(embeddedSource.fullSculptRetained, true,
      "embedded source metadata must not retain the previous cropped-head record");
    assert.deepEqual(embeddedSource.originalBounds, expected.originalBounds,
      "embedded head source metadata must use the full original bounds");
    assert.equal(embeddedSource.uniformScale, expected.uniformScale);
    assert.equal(embeddedSource.exportedTriangles, exportedTriangles);
    assert.deepEqual(embeddedSource.palette, expected.palette,
      "embedded source metadata must preserve palette anchors");
    assert.ok(!("croppedTriangles" in embeddedSource) || embeddedSource.croppedTriangles === 0,
      "embedded source metadata must not record cropped geometry");
  }

  assert.ok(Array.isArray(headMetadata.min) && headMetadata.min.length === 3);
  assert.ok(Array.isArray(headMetadata.max) && headMetadata.max.length === 3);
  const sourceMin = expected.originalBounds[0];
  const sourceMax = expected.originalBounds[1];
  const scale = expected.uniformScale;
  for (let axis = 0; axis < 3; axis += 1) {
    const originalSpan = sourceMax[axis] - sourceMin[axis];
    const actualSpan = headMetadata.max[axis] - headMetadata.min[axis];
    assert.ok(originalSpan > 0, "frozen source bounds must have a positive dimension");
    assert.ok(Math.abs(actualSpan - originalSpan * scale) <= originalSpan * scale * 0.01,
      "exported head axis " + axis + " bounds must preserve the full source extent at the current approved scale within 1%");
  }
  const expectedMinY = sourceMin[1] * scale;
  const expectedMaxY = sourceMax[1] * scale;
  assert.ok(Math.abs(headMetadata.min[1] - expectedMinY) <= 0.36,
    "head minY must remain at the original base after uniform scale");
  assert.ok(Math.abs(headMetadata.max[1] - expectedMaxY) <= 0.36,
    "head maxY must preserve the original top at uniform scale");
  assert.ok(Math.abs(headMetadata.min[1]) <= 0.36, "full-bust head minY must be approximately zero");
  assert.ok(Math.abs(headMetadata.max[1] - (sourceMax[1]-sourceMin[1])*scale) <= 0.36, "full-bust head maxY must equal the complete scaled sculpt height");

  const creditsPath = path.join(modRoot, headSourceFixture.creditsFile);
  assert.ok(fs.existsSync(creditsPath), "the mod must package the CC BY 4.0 head source attribution");
  const credits = fs.readFileSync(creditsPath, "utf8");
  assert.match(credits, /winner_77/i, "head credits must name the author");
  assert.match(credits, /Screaming\s+dragon\s+head/i, "head credits must preserve the original model name");
  assert.match(credits, /source|来源/i, "head credits must identify the source");
  assert.match(credits, /DragScream\.fbx/i, "head credits must name the supplied source file");
  assert.match(credits, /CC\s+BY\s+4\.0|Creative\s+Commons\s+Attribution\s+4\.0/i,
    "head credits must state the CC BY 4.0 license");
  assert.match(credits, /decimat|simplif|reduc|trim|crop|UV|normal|retop|裁|减面|简化|法线|修改/i,
    "head credits must describe the modifications made to the source model");
}

assert.equal(contract.tileColumns * contract.tileRows, 16);
assert.equal(contract.tileIndexing, "zero-based top-left row-major");
assert.deepEqual(contract.profiles.trophy, {
  width: 2048,
  height: 2048,
  mipLevels: 12,
  propertiesGreenGlobalMax: 75,
  propertiesGreenNonGemTileMax: 32,
  gemTiles: [6, 12],
});
assert.deepEqual(contract.profiles.head, {
  width: 4096,
  height: 4096,
  mipLevels: 13,
  propertiesGreenGlobalMax: 32,
  propertiesGreenNonGemTileMax: 32,
  gemTiles: [],
});
assertShaderSourceFixture();
assertAssetBindings();
assertHeadProvenance();

const decodedSets = [];
for (const set of textureSets) {
  const modelDir = path.join(modRoot, set.directory);
  const diffuseBytes = fs.readFileSync(path.join(modelDir, set.diffuse));
  const normalBytes = fs.readFileSync(path.join(modelDir, set.normal));
  const propertiesBytes = fs.readFileSync(path.join(modelDir, set.properties));
  const profile = contract.profiles[set.profile];
  dxt5MipLayout(diffuseBytes, set.kind + " diffuse", profile);
  const normal = validateNormalDds(normalBytes, set.kind + " normal", profile);
  const properties = validatePropertiesDds(propertiesBytes, set.kind + " properties", profile);
  decodedSets.push({ set, normalBytes, propertiesBytes, normal, properties });
}

for (const { set, normalBytes, propertiesBytes } of decodedSets) {
  const profile = contract.profiles[set.profile];
  const emissiveProbe = replaceFirstDxt5ColorBlock(normalBytes, { r: 0, g: 0, b: 255 });
  assert.throws(() => validateNormalDds(emissiveProbe, set.kind + " normal.B=255 regression probe", profile),
    /normal\.B must be zero/, set.kind + " validator must reject an emissive blue-channel regression");
  const specularProbe = replaceFirstDxt5ColorBlock(propertiesBytes, { r: 0, g: 128, b: 0 });
  assert.throws(() => validatePropertiesDds(specularProbe, set.kind + " properties.G=128 regression probe", profile),
    /global specular input limit/, set.kind + " validator must reject an overbright specular-channel regression");
}

console.log("Wyvern v1.1.7 court materials: PASS (2048 trophy and 4096 head full-mip decode, embedded materials, source attribution, native shader fixture, and negative probes)");

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dxt5 = require("./wyvern-dxt5-test-helper");

const projectRoot = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "v121", "head-material-contract.json"), "utf8"));
const diffusePath = "patches/wyvern-capture/mod/gfx/models/artifacts/mm_wyvern_trophies/mm_wyvern_head_diffuse.dds";
const sourceDiffusePath = "artwork/wyvern-trophies/models/mm_wyvern_head_diffuse.png";

function readJson(relativePath, label) {
  const filePath = path.join(projectRoot, relativePath);
  assert.ok(fs.existsSync(filePath), label + " is missing: " + relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hexColor(value) {
  assert.match(value, /^#[0-9a-f]{6}$/i, "palette anchor must be an RGB hex color");
  return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
}

function makeColorStats() {
  return { count: 0, r: 0, g: 0, b: 0, luminance: 0 };
}

function addColor(stats, r, g, b) {
  stats.count += 1;
  stats.r += r;
  stats.g += g;
  stats.b += b;
  stats.luminance += r * 0.299 + g * 0.587 + b * 0.114;
}

function averageColor(stats, label, totalPixels, minimumCoverage) {
  const coverage = stats.count / totalPixels;
  assert.ok(coverage >= minimumCoverage,
    label + " color zone coverage " + coverage.toFixed(5) + " is below " + minimumCoverage);
  return {
    coverage,
    r: stats.r / stats.count,
    g: stats.g / stats.count,
    b: stats.b / stats.count,
    luminance: stats.luminance / stats.count,
  };
}

function rgb565(value) {
  return [
    Math.round(((value >>> 11) & 31) * 255 / 31),
    Math.round(((value >>> 5) & 63) * 255 / 63),
    Math.round((value & 31) * 255 / 31),
  ];
}

function analyzeBaseMip(bytes, label) {
  const profile = { width: fixture.texture.width, height: fixture.texture.height, mipLevels: fixture.texture.mipLevels };
  const mips = dxt5.mipLayout(bytes, profile, label);
  const mip = mips[0];
  const zones = {
    skin: makeColorStats(),
    ventral: makeColorStats(),
    keratin: makeColorStats(),
    ivory: makeColorStats(),
    groove: makeColorStats(),
  };

  for (let blockY = 0; blockY < mip.blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < mip.blocksWide; blockX += 1) {
      const offset = mip.offset + (blockY * mip.blocksWide + blockX) * 16;
      const color0 = rgb565(bytes.readUInt16LE(offset + 8));
      const color1 = rgb565(bytes.readUInt16LE(offset + 10));
      const palette = [
        color0,
        color1,
        [0, 1, 2].map(channel => Math.round((2 * color0[channel] + color1[channel]) / 3)),
        [0, 1, 2].map(channel => Math.round((color0[channel] + 2 * color1[channel]) / 3)),
      ];
      const selectors = bytes.readUInt32LE(offset + 12);

      for (let pixelIndex = 0; pixelIndex < 16; pixelIndex += 1) {
        const color = palette[(selectors >>> (pixelIndex * 2)) & 3];
        const [r, g, b] = color;
        if (g >= r + 5 && r >= b + 4 && r >= 40 && r <= 150 && g >= 50 && g <= 165 && b >= 25 && b <= 125) {
          addColor(zones.skin, r, g, b);
        } else if (Math.abs(r - g) <= 20 && r >= 80 && r <= 165 && g >= 80 && g <= 165
          && b >= 50 && b <= 130 && r >= b + 8 && g >= b + 8) {
          addColor(zones.ventral, r, g, b);
        } else if (r >= g + 5 && g >= b + 4 && r >= 35 && r <= 155
          && g >= 25 && g <= 130 && b >= 20 && b <= 110) {
          addColor(zones.keratin, r, g, b);
        } else if (r >= 120 && g >= 95 && b >= 65 && r >= g + 4 && g >= b + 8) {
          addColor(zones.ivory, r, g, b);
        } else if (r >= 20 && r <= 75 && g >= 25 && g <= 85 && b >= 15 && b <= 70 && g >= r + 2) {
          addColor(zones.groove, r, g, b);
        }
      }
    }
  }

  return { zones, totalPixels: mip.width * mip.height };
}

function colorDistance(left, right) {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

// Freeze only the head's geometry/material/gameplay invariants. Bloodline work is
// intentionally outside this list and can evolve independently.
assert.equal(fixture.formatVersion, 1);
assert.equal(fixture.baselineEntryCount, 133, "fixture records the pre-1.2.1 baseline size");
assert.equal(fixture.immutableEntryCount, fixture.immutableAssets.length);
assert.equal(fixture.immutableEntryCount, 13, "fixture freezes the head model, material maps and trophy presentation");
assert.deepEqual(fixture.mutableAlbedoPaths, [sourceDiffusePath, diffusePath]);
assert.ok(!fixture.immutableAssets.some(entry => entry.path === diffusePath), "the recolored albedo is the sole mutable packaged asset");
assert.ok(!fixture.immutableAssets.some(entry => entry.path.includes("wyvern-bloodline")),
  "authorized bloodline work is not frozen by this material test");

for (const entry of fixture.immutableAssets) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/i, entry.path + " must have a frozen SHA-256");
  const filePath = path.join(projectRoot, entry.path);
  assert.ok(fs.existsSync(filePath), "missing immutable head asset " + entry.path);
  assert.equal(hashFile(filePath), entry.sha256, entry.path + " must remain byte-identical to the pre-material baseline");
}

// Geometry metadata may carry the new palette, but scale, face count, base and submesh layout stay fixed.
const models = readJson("artwork/wyvern-trophies/models/models.json", "head model metadata");
const head = models.models.head;
assert.equal(head.triangles, 520000, "head retains the existing 520k triangle model");
assert.equal(head.vertices, 360966, "head vertex count is unchanged");
assert.equal(head.submeshes.length, 7, "head retains all seven material submeshes");
assert.equal(head.sha256, fixture.immutableAssets.find(entry => entry.path.endsWith("mm_wyvern_trophy_head.mesh")).sha256,
  "model metadata keeps the frozen runtime mesh digest");
assert.equal(head.source.uniformScale, 0.73, "head keeps the approved 0.73 scale");
assert.ok(Math.abs(head.min[1]) <= 0.01, "pedestal base remains at the original Y origin");
assert.ok(Math.abs(head.max[1] - 73) <= 0.5, "head height remains at the original 0.73-scaled extent");

const expectedPalette = {
  main: fixture.colorAnchors.target.main,
  raised: fixture.colorAnchors.target.highlight,
  secondary: fixture.colorAnchors.target.secondary,
  grooves: fixture.colorAnchors.target.grooves,
  horn: fixture.colorAnchors.target.hornRoot,
  hornMiddle: fixture.colorAnchors.target.hornMid,
  hornTip: fixture.colorAnchors.target.hornTip,
  teeth: fixture.colorAnchors.target.teeth,
  tissue: fixture.colorAnchors.target.tissue,
  ventral: fixture.colorAnchors.target.ventral,
};
assert.deepEqual(head.source.palette, expectedPalette, "head metadata records the user-approved revision 2 palette");
const sourceMetadata = readJson("artwork/wyvern-trophies/models/winner77-head-source.json", "head source metadata");
assert.equal(sourceMetadata.uniformScale, 0.73);
assert.equal(sourceMetadata.exportedTriangles, 520000);
assert.deepEqual(sourceMetadata.palette, expectedPalette, "source palette matches the material revision anchors");

const sourcePngPath = path.join(projectRoot, sourceDiffusePath);
assert.ok(fs.existsSync(sourcePngPath), "editable head albedo source PNG exists");
const sourcePng = fs.readFileSync(sourcePngPath);
assert.deepEqual([...sourcePng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "source albedo is a PNG");
assert.equal(sourcePng.toString("ascii", 12, 16), "IHDR", "source albedo has a PNG IHDR");
assert.equal(sourcePng.readUInt32BE(16), fixture.texture.width);
assert.equal(sourcePng.readUInt32BE(20), fixture.texture.height);
assert.equal(sourcePng[24], 8, "source albedo stays 8-bit");
assert.notEqual(hashFile(sourcePngPath), fixture.oldSourcePngSha256, "editable source albedo contains the new hue and zoning");

const ddsPath = path.join(projectRoot, diffusePath);
assert.ok(fs.existsSync(ddsPath), "runtime head albedo DDS exists");
const ddsBytes = fs.readFileSync(ddsPath);
const ddsProfile = {
  width: fixture.texture.width,
  height: fixture.texture.height,
  mipLevels: fixture.texture.mipLevels,
};
assert.equal(ddsBytes.toString("ascii", 84, 88), fixture.texture.fourCC, "runtime albedo remains DXT5/BC3");
const decoded = dxt5.decode(ddsBytes, ddsProfile, "head albedo", null);
assert.equal(decoded.channels.a.min, 255, "all diffuse alpha texels remain opaque across every mip");
assert.equal(decoded.channels.a.max, 255, "all diffuse alpha texels remain opaque across every mip");
const newAlbedoSha256 = hashFile(ddsPath);
assert.notEqual(newAlbedoSha256, fixture.oldAlbedoSha256, "packaged albedo DDS changes with the approved color revision");

const analysis = analyzeBaseMip(ddsBytes, "head albedo base mip");
const skin = averageColor(analysis.zones.skin, "main grey-olive skin", analysis.totalPixels, 0.05);
const ventral = averageColor(analysis.zones.ventral, "grey-brown ventral", analysis.totalPixels, 0.01);
const keratin = averageColor(analysis.zones.keratin, "brown keratin", analysis.totalPixels, 0.02);
const ivory = averageColor(analysis.zones.ivory, "aged ivory", analysis.totalPixels, 0.0005);
const groove = averageColor(analysis.zones.groove, "dark green grooves", analysis.totalPixels, 0.001);

assert.ok(skin.g > skin.r && skin.r > skin.b, "main skin reads green over red over blue");
const previousMain = hexColor(fixture.colorAnchors.old.main);
const previousGreenRedRatio = previousMain[1] / previousMain[0];
assert.ok(skin.g / skin.r >= previousGreenRedRatio + 0.03,
  "main skin has a clear greenward hue shift, not only a uniform brightness reduction");
assert.ok(skin.r / skin.b > 1.08, "main skin retains a distinct olive rather than cyan hue");
assert.ok(skin.luminance >= 70, "main skin retains readable scale detail and is not crushed dark");
assert.ok(Math.abs(ventral.r - ventral.g) <= 20 && ventral.r - ventral.b >= 10,
  "ventral hide stays grey-brown olive and separate from green scales");
assert.ok(keratin.r > keratin.g + 6 && keratin.g > keratin.b + 6,
  "horn and spine keratin remain a distinct brown zone");
assert.ok(ivory.r > ivory.g && ivory.g > ivory.b,
  "teeth and horn tips retain an aged ivory/bone zone");
assert.ok(ivory.luminance > skin.luminance + 20,
  "light keratin and teeth remain visibly brighter than the main hide");
assert.ok(groove.luminance < skin.luminance - 5,
  "recesses remain darker than the hide without replacing all zones with one dark wash");
assert.ok(colorDistance(skin, keratin) >= 18 && colorDistance(skin, ventral) >= 18,
  "major material zones remain color-separated");

// Confirm the shipped manifest tracks the new albedo digest; no other manifest hashes are used as color controls.
const captureManifest = readJson("patches/wyvern-capture/sources.json", "capture source manifest");
const runtimeEntry = captureManifest.outputs.filter(entry => entry.path === "mod/gfx/models/artifacts/mm_wyvern_trophies/mm_wyvern_head_diffuse.dds");
assert.equal(runtimeEntry.length, 1, "capture manifest has one runtime head albedo entry");
assert.equal(runtimeEntry[0].sha256, newAlbedoSha256, "capture manifest contains the current head albedo digest");

// PS_court replaces sampled Properties.g before the common lighting call. Do not
// interpret the texture's G channel as the live specular control for this asset.
assert.match(fixture.nativeCourtShader.sha256, /^[a-f0-9]{64}$/i);
assert.equal(fixture.nativeCourtShader.specularOverride, "Properties.g = 0.16f;");
assert.equal(fixture.nativeCourtShader.materialCall,
  "float3 Color = CommonPixelShader( Diffuse, Properties, NormalSample, Input, HoverMult );");
const installRoot = process.env.CK3_INSTALL_ROOT
  ? path.resolve(process.env.CK3_INSTALL_ROOT)
  : process.env.CK3_GAME_DIR
    ? path.dirname(path.resolve(process.env.CK3_GAME_DIR))
    : "D:/SteamLibrary/steamapps/common/Crusader Kings III";
const shaderPath = path.join(installRoot, ...fixture.nativeCourtShader.path.split("/"));
if (fs.existsSync(shaderPath)) {
  const shaderBytes = fs.readFileSync(shaderPath);
  assert.equal(crypto.createHash("sha256").update(shaderBytes).digest("hex"), fixture.nativeCourtShader.sha256,
    "installed native court shader matches the frozen source");
  const shaderText = shaderBytes.toString("utf8");
  const mainCodeMatch = /^[ \t]*MainCode[ \t]+PS_court[ \t\r\n]+\{/m.exec(shaderText);
  assert.ok(mainCodeMatch, "native shader contains the exact PS_court block");
  const mainCodeStart = mainCodeMatch.index;
  const nextMainCodePattern = /^[ \t]*MainCode[ \t]+/gm;
  nextMainCodePattern.lastIndex = mainCodeStart + mainCodeMatch[0].length;
  const nextMainCodeMatch = nextMainCodePattern.exec(shaderText);
  const psCourt = shaderText.slice(mainCodeStart, nextMainCodeMatch ? nextMainCodeMatch.index : undefined);
  const propertyRead = psCourt.indexOf("float4 Properties = PdxTex2D( PropertiesMap, Input.UV0 );");
  const fixedSpecular = psCourt.indexOf(fixture.nativeCourtShader.specularOverride);
  const materialCall = psCourt.indexOf(fixture.nativeCourtShader.materialCall);
  assert.ok(propertyRead >= 0 && fixedSpecular > propertyRead && materialCall > fixedSpecular,
    "PS_court samples properties, fixes specular at 0.16, then calls the common material shader");
}

console.log("Wyvern v1.2.1 head material: immutable head assets, DXT5 albedo, color zoning and fixed PS_court specular.");

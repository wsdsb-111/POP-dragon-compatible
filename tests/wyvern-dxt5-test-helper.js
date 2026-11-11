"use strict";

const assert = require("node:assert/strict");

function channelStats() {
  return { min: 255, max: 0, sum: 0, count: 0 };
}

function addChannelValue(stats, value) {
  stats.min = Math.min(stats.min, value);
  stats.max = Math.max(stats.max, value);
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

function mipLayout(bytes, profile, label) {
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

function decode(bytes, profile, label, tileGrid, decodeNormals = false) {
  const mips = mipLayout(bytes, profile, label);
  const channels = { r: channelStats(), g: channelStats(), b: channelStats(), a: channelStats() };
  const vector = { saturated: 0, invalid: 0, maxRadial: 0, count: 0 };
  const tileColumns = tileGrid ? tileGrid.columns : 0;
  const tileRows = tileGrid ? tileGrid.rows : 0;
  const tileStats = Array.from({ length: tileColumns * tileRows }, () => ({ maxGreen: 0, count: 0 }));
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
            const color = [color0, color1, color2, color3][colorIndex];
            const alphaIndex = Math.floor(alphaBits / (2 ** (pixelIndex * 3))) & 7;
            const alpha = alphaPalette[alphaIndex];
            addChannelValue(channels.r, color.r);
            addChannelValue(channels.g, color.g);
            addChannelValue(channels.b, color.b);
            addChannelValue(channels.a, alpha);
            totalPixels += 1;

            if (decodeNormals) {
              if (color.g <= 8 || color.g >= 247 || alpha <= 8 || alpha >= 247) vector.saturated += 1;
              const normalX = color.g / 255 * 2 - 1;
              const normalY = -(alpha / 255 * 2 - 1);
              const radial = normalX * normalX + normalY * normalY;
              vector.maxRadial = Math.max(vector.maxRadial, radial);
              const normalZ = Math.sqrt(Math.max(0, 1 - radial));
              const length = Math.hypot(normalX, normalY, normalZ);
              if (!Number.isFinite(length) || radial > 1.02 || Math.abs(length - 1) > 0.011) vector.invalid += 1;
              vector.count += 1;
            }

            if (tileGrid && mip.level === 0) {
              const tileWidth = mip.width / tileColumns;
              const tileHeight = mip.height / tileRows;
              const tileIndex = Math.floor(y / tileHeight) * tileColumns + Math.floor(x / tileWidth);
              const tile = tileStats[tileIndex];
              tile.maxGreen = Math.max(tile.maxGreen, color.g);
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

function validateNormal(bytes, profile, label) {
  const decoded = decode(bytes, profile, label, null, true);
  assert.equal(decoded.channels.b.max, 0, label + " normal.B must be zero on every texel and mip");
  const allowedSaturated = Math.max(4, Math.floor(decoded.channels.g.count * 0.00001));
  assert.ok(decoded.vector.saturated <= allowedSaturated, label + " RRxG G/A has too many saturated samples");
  assert.equal(decoded.vector.invalid, 0, label + " RRxG G/A samples must decode to valid unit normals");
  return decoded;
}

function validateProperties(bytes, profile, label, grid) {
  const decoded = decode(bytes, profile, label, grid);
  assert.ok(decoded.channels.g.max <= profile.propertiesGreenGlobalMax,
    label + " properties.G exceeds the global specular input limit");
  const gemTiles = new Set(profile.gemTiles || []);
  for (let tileIndex = 0; tileIndex < decoded.tileStats.length; tileIndex += 1) {
    const tile = decoded.tileStats[tileIndex];
    assert.equal(tile.count, (profile.width / grid.columns) * (profile.height / grid.rows),
      label + " tile " + tileIndex + " must be completely decoded");
    if (!gemTiles.has(tileIndex)) {
      assert.ok(tile.maxGreen <= profile.propertiesGreenNonGemTileMax,
        label + " non-gem tile " + tileIndex + " properties.G exceeds its limit");
    }
  }
  return decoded;
}

function replaceFirstColorBlock(bytes, rgb) {
  const probe = Buffer.from(bytes);
  const endpoint = color565(rgb.r, rgb.g, rgb.b);
  probe.writeUInt16LE(endpoint, 128 + 8);
  probe.writeUInt16LE(endpoint, 128 + 10);
  probe.writeUInt32LE(0, 128 + 12);
  return probe;
}

module.exports = { mipLayout, decode, validateNormal, validateProperties, replaceFirstColorBlock };

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

function enabledModIds(playsetFile) {
  const playset = JSON.parse(fs.readFileSync(playsetFile, "utf8").replace(/^\uFEFF/, ""));
  assert(Array.isArray(playset.enabled_mods), "playset must contain enabled_mods");
  const base = path.dirname(path.resolve(playsetFile));
  return new Set(playset.enabled_mods.map(relative => {
    const descriptor = fs.readFileSync(path.resolve(base, relative), "utf8");
    const id = descriptor.match(/^\s*remote_file_id\s*=\s*"(\d+)"/m);
    return id ? id[1] : null;
  }).filter(Boolean));
}

function detectProfile(ids) {
  assert(ids.has("3811316052"), "Wyvern must be enabled");
  assert(ids.has("2216659254"), "Princes of Darkness must be enabled");
  assert(!["2506311074", "2592094512", "3684849062"].some(id => ids.has(id)), "PoD requires the Oriental mods disabled");
  return "wyvern-pod";
}

module.exports = { enabledModIds, detectProfile };

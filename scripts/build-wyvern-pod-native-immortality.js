"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const sourcePath = "patches/dragon-bond/mod/common/traits/zzzzzz_mm_dragon_bond_species.txt";
const sourceBytes = fs.readFileSync(path.join(root, sourcePath));
const source = sourceBytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const match = /^myv_wyvern_legendary\s*=\s*\{/m.exec(source);
assert(match, "legendary royal species definition");
let depth = 0, end;
for (let i = source.indexOf("{", match.index); i < source.length; i++) {
  if (source[i] === "{") depth++;
  if (source[i] === "}" && --depth === 0) { end = i + 1; break; }
}
assert(end, "complete trait definition");
const original = source.slice(match.index, end);
assert.match(original, /^\s*immortal = yes\s*$/m, "keep the game's real immortal property");
assert.equal((original.match(/^\s*life_expectancy = 666\s*$/gm) || []).length, 1);
const trait = original.replace(/^[\t ]*life_expectancy = 666\n/m, "");
assert.doesNotMatch(trait, /\blife_expectancy\s*=/);
const relative = "common/traits/" + "z".repeat(32) + "_mm_pod_native_immortality.txt";
const bytes = Buffer.from("\uFEFF" + trait + "\n");
fs.writeFileSync(path.join(root, "patches/wyvern-pod/mod", relative), bytes);
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
fs.writeFileSync(path.join(root, "patches/wyvern-pod/native-immortality-sources.json"), JSON.stringify({
  date: "2026-11-03", scope: "PoD-only legendary royal species: native immortality instead of a finite lifespan bonus",
  sourceFiles: [{ root: "repo", path: sourcePath, sha256: sha(sourceBytes) }],
  outputs: [{ path: relative, sha256: sha(bytes) }],
  behavior: "Only life_expectancy = 666 is removed. Native immortal = yes and all other species effects remain unchanged.",
  CK3Runtime: "NOT_RUN"
}, null, 2) + "\n");
console.log("PoD native immortality trait generated: 1 file");

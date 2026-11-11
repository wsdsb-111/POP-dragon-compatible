"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./wyvern-v132-finite-helper");
const requirements = require("./fixtures/v132/independent-requirements.json");
const protectedResources = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v132/protected-resource-hashes.json"), "utf8").replace(/^\ufeff/, ""));
const root = path.resolve(__dirname, "..");
const native = process.env.CK3_WYVERN_MOD_DIR || "D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052";
const royal = path.join(root, "patches/wyvern-kings/mod");
const bodyDirectory = path.join(royal, "gfx/models/portraits/myv_wyvern");
const h = createHarness(["wyvern-bloodline", "wyvern-kings", "wyvern-ascension"]);
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const walk = nodes => nodes.flatMap(node => [node, ...(Array.isArray(node.value) ? walk(node.value) : [])]);
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name); return entry.isDirectory() ? files(file) : [file];
  });
}
function parse(file) { return h.parsePdx(fs.readFileSync(file, "utf8"), file); }

for (const fingerprint of protectedResources.files) {
  const base = fingerprint.root === "native" ? native : root;
  assert.equal(sha256(fs.readFileSync(path.join(base, fingerprint.path))), fingerprint.sha256, "protected resource bytes remain unchanged: " + fingerprint.path);
}

const originalAlpha = fs.readFileSync(path.join(native, "gfx/models/portraits/myv_wyvern/myv_wyvern_diffuse_green.dds"));
const albedoHashes = new Set();
for (const family of requirements.palettes.families) {
  const file = path.join(bodyDirectory, "mm_royal_" + family + "_diffuse.dds");
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "DDS ");
  assert.equal(bytes.readUInt32LE(12), 2048, family + " keeps the original atlas height");
  assert.equal(bytes.readUInt32LE(16), 2048, family + " keeps the original atlas width");
  assert.equal(bytes.readUInt32LE(88), 32, family + " retains the uncompressed BGRA32 format");
  assert.equal(bytes.length, originalAlpha.length, family + " retains the original DDS surface size");
  let minimum = Infinity; let maximum = -Infinity;
  const sampledColors = new Set();
  for (let offset = 128; offset < bytes.length; offset += 4) {
    assert.equal(bytes[offset + 3], originalAlpha[offset + 3], family + " alpha must not change at byte " + offset);
    if ((offset - 128) % 4096 === 0) {
      const luma = bytes[offset] + bytes[offset + 1] + bytes[offset + 2];
      minimum = Math.min(minimum, luma); maximum = Math.max(maximum, luma);
      sampledColors.add(bytes.readUInt32LE(offset) & 0xffffff);
    }
  }
  assert.ok(sampledColors.size > 100 && maximum - minimum > 80, family + " retains texture detail rather than becoming one flat color");
  albedoHashes.add(sha256(bytes));
}
assert.equal(albedoHashes.size, 6, "six families have distinct albedo surfaces");

const assets = parse(path.join(bodyDirectory, "mm_royal_wyvern.asset"));
const assetNodes = walk(assets);
const meshes = new Map(assets.filter(node => node.key === "pdxmesh").map(node => [h.scalar(node.value, "name", "mesh"), node.value]));
const diffusePaths = new Set(assetNodes.filter(node => node.key === "texture_diffuse").map(node => path.basename(node.value)));
for (const family of requirements.palettes.families) assert.ok(diffusePaths.has("mm_royal_" + family + "_diffuse.dds"), family + " material actually references its new texture");
for (const node of assetNodes.filter(node => typeof node.value === "string")) {
  if (node.key === "file" && /\.mesh$/.test(node.value)) assert.ok(/(?:myv_wyvern|myv_compact_head)\.mesh$/.test(node.value), "royal uses the original mesh");
  if (node.key === "texture_normal") assert.ok(node.value.endsWith("myv_wyvern_normal.dds"), "normal is reused unchanged");
  if (node.key === "texture_specular") assert.ok(node.value.endsWith("myv_wyvern_properties.dds"), "properties are reused unchanged");
  if (["file", "type"].includes(node.key) && /\.anim$/.test(node.value)) assert.ok(fs.existsSync(path.join(native, "gfx/models/portraits/myv_wyvern", path.basename(node.value))), "animation references an existing original clip");
}
for (const mesh of assets.filter(node => node.key === "pdxmesh")) {
  const name = h.scalar(mesh.value, "name", "royal mesh");
  const settings = h.first(mesh.value, "meshsettings").value;
  assert.equal(h.scalar(settings, "shader", name), name.includes("compact") ? "portrait_attachment" : "myv_wyvern_double_sided", "original shader behavior stays intact");
}
for (const entity of assets.filter(node => node.key === "entity")) {
  const meshName = h.scalar(entity.value, "pdxmesh", "entity mesh");
  assert.ok(meshes.has(meshName), "entity references an actual royal mesh " + meshName);
  const animationIds = new Set(h.all(meshes.get(meshName), "animation").map(node => h.scalar(node.value, "id", "mesh animation")));
  for (const state of h.all(entity.value, "state")) {
    const animation = h.first(state.value, "animation");
    if (animation) assert.ok(animationIds.has(animation.value), "entity animation was registered on its actual mesh: " + animation.value);
  }
}
for (const file of files(bodyDirectory)) assert.ok(!/\.(?:mesh|anim|shader)$/.test(file), "palette delivery must not introduce re-exported geometry or animation");

const geneFiles = ["myv_wyvern_accessory_genes.txt", "myv_compact_head_genes.txt", "myv_wyvern_flying_genes.txt", "myv_wyvern_running_genes.txt", "myv_wyvern_mounted_genes.txt", "myv_wyvern_wild_aerial_flying_genes.txt"];
function preservesSequence(expected, actual) {
  let cursor = 0;
  for (const node of expected) {
    let found = false;
    while (cursor < actual.length) {
      const candidate = actual[cursor++];
      if (node.key === candidate.key && node.operator === candidate.operator &&
          (Array.isArray(node.value) ? Array.isArray(candidate.value) && preservesSequence(node.value, candidate.value) : candidate.value === node.value)) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}
let royalGeneText = "";
const royalTemplateNames = new Set();
for (const filename of geneFiles) {
  const target = path.join(royal, "common/genes", filename);
  assert.ok(preservesSequence(parse(path.join(native, "common/genes", filename)), parse(target)), filename + " preserves every existing template/index");
  royalGeneText += fs.readFileSync(target, "utf8");
  for (const node of walk(parse(target))) if (node.key.startsWith("mm_royal_") && Array.isArray(node.value)) royalTemplateNames.add(node.key);
}
const sizes = ["hatchling", ...Array.from({ length: 10 }, (_, index) => "tier_" + String(index + 1).padStart(2, "0"))];
for (const family of requirements.palettes.families) {
  for (const size of sizes) {
    assert.ok(royalGeneText.includes("mm_royal_" + family + "_" + size), family + " idle " + size + " has a template");
    for (const pose of ["flying", "running", "mounted", "wild_aerial"]) {
      assert.ok(royalGeneText.includes("mm_royal_" + pose + "_" + family + "_" + size), family + " " + pose + " " + size + " has a template");
    }
  }
  assert.ok(royalGeneText.includes("mm_royal_compact_" + family), family + " compact has a template");
}

const portraitFiles = [royal, path.join(root, "patches/wyvern-ascension/mod")]
  .flatMap(moduleRoot => files(path.join(moduleRoot, "gfx/portraits"))).filter(file => file.endsWith(".txt"));
for (const file of portraitFiles.filter(file => file.includes(path.join("gfx", "portraits", "portrait_animations")))) {
  const original = path.join(native, "gfx/portraits/portrait_animations", path.basename(file));
  assert.ok(fs.existsSync(original), "scene extends an actual native animation scene");
  assert.ok(preservesSequence(parse(original), parse(file)), "all original ordinary portrait branches remain intact: " + path.basename(file));
}
const portraitNodes = portraitFiles.flatMap(file => walk(parse(file)));
const portraitText = portraitFiles.map(file => fs.readFileSync(file, "utf8")).join("\n");
for (const node of portraitNodes.filter(node => node.key === "template" && typeof node.value === "string" && node.value.startsWith("mm_royal_"))) {
  assert.ok(royalTemplateNames.has(node.value), "portrait template resolves to an actual gene: " + node.value);
}
const entityNames = new Set(assets.filter(node => node.key === "entity").map(node => h.scalar(node.value, "name", "entity")));
for (const file of files(path.join(royal, "gfx/portraits/accessories")).filter(file => file.endsWith(".txt"))) {
  for (const node of walk(parse(file)).filter(node => node.key === "entity" && typeof node.value === "string" && node.value.startsWith("mm_royal_"))) assert.ok(entityNames.has(node.value), "accessory resolves to actual royal entity " + node.value);
}
assert.ok(portraitText.includes("mm_wyvern_human_form"), "human appearance has an explicit body-hiding gate");
const mountedScopeNodes = portraitNodes.filter(node => node.key === "var:myv_riding_portrait_wyvern" && Array.isArray(node.value));
assert.ok(mountedScopeNodes.length > 0, "mounted appearance reads the actual mount scope");
for (const family of requirements.palettes.families) {
  assert.ok(portraitText.includes("mm_royal_visual_" + family), family + " is wired to portrait selection");
  assert.ok(mountedScopeNodes.some(node => walk(node.value).some(child => child.key === "mm_royal_visual_" + family)), family + " mounted color is selected from the dragon rather than the rider");
}
for (const pose of ["flying", "running", "mounted", "wild_aerial", "compact"]) assert.ok(portraitText.includes("mm_royal_" + pose + "_"), pose + " has a royal portrait route");

for (const [family, throne, trait] of [["fire", 1, "mm_royal_dragon_king"], ["earth", 2, "mm_royal_dragon_king"], ["sea", 3, "mm_royal_dragon_king"], ["sky", 4, "mm_royal_dragon_king"], ["black", 0, "mm_royal_black_emperor"], ["white", 0, "mm_royal_white_empress"]]) {
  const character = h.character(family, { traits: [trait], vars: { mm_royal_throne: throne } });
  const env = h.environment({ root: character });
  assert.ok(h.trigger("mm_royal_visual_" + family, character, env), family + " royal identity selects its own palette");
  character.alive = false;
  assert.ok(h.trigger("mm_royal_visual_" + family, character, env), family + " identity survives on the dead memorial character");
  for (const other of requirements.palettes.families.filter(value => value !== family)) assert.ok(!h.trigger("mm_royal_visual_" + other, character, env), family + " cannot select " + other);
  character.flags.add("mm_wyvern_human_form");
  assert.ok(!h.trigger("mm_royal_visual_" + family, character, env), "human appearance hides the royal dragon body");
  const ordinary = h.character("ordinary-created-dragon", { traits: ["myv_wyvern_legendary"], vars: { mm_royal_creation_throne: throne } });
  assert.ok(!h.trigger("mm_royal_visual_" + family, ordinary, h.environment({ root: ordinary })), "creation lineage alone does not take royal palette");
  const fusion = h.character("fusion-source-" + family, { traits: ["mm_asc_dragon_body", "mm_wyvern_bathed_in_dragon_blood"], flags: ["mm_asc_dragon_form"], vars: { mm_royal_throne: throne === 1 ? 2 : 1, mm_asc_visual_family: family === "white" ? 5 : family === "black" ? 6 : throne } });
  assert.ok(h.trigger("mm_royal_visual_" + family, fusion, h.environment({ root: fusion })), "fusion without royal rank retains the actual source's palette");
  fusion.flags.add("mm_wyvern_human_form");
  assert.ok(!h.trigger("mm_royal_visual_" + family, fusion, h.environment({ root: fusion })), "human form wins over a stale dragon-form flag");
}
console.log("Wyvern v1.3.2 independent palette fingerprints, assets and routes passed; CK3 front/back material and animation are not certified.");

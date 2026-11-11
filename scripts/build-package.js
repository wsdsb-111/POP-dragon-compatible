"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "compatibility.json"), "utf8"));
const modules = JSON.parse(fs.readFileSync(path.join(root, "modules.json"), "utf8"));
const profiles = JSON.parse(fs.readFileSync(path.join(root, "package-profiles.json"), "utf8"));
const { enabledModIds, detectProfile } = require("./select-package-profile");
const { preparePodScript } = require("./prepare-pod-script");
const defaultProfile = "wyvern-pod";
const selection = process.argv.slice(2);
const options = new Map();
for (const argument of selection) {
  if (argument === "--dry-run") {
    assert(!options.has("dry-run"), "duplicate --dry-run");
    options.set("dry-run", true);
    continue;
  }
  const match = argument.match(/^--(modules|profile|playset)=(.+)$/);
  assert(match && !options.has(match[1]), "use --modules=id,id, --profile=wyvern-pod or --playset=path/to/dlc_load.json");
  options.set(match[1], match[2]);
}
assert(!options.has("playset") || (!options.has("profile") && !options.has("modules")), "--playset automatically selects both profile and optional modules");
const enabled = options.has("playset") ? enabledModIds(options.get("playset")) : null;
const profileId = enabled ? detectProfile(enabled) : (options.get("profile") || defaultProfile);
assert(profileId === defaultProfile, "This repository builds only " + defaultProfile);
const profile = profiles[profileId];
let requested = options.has("modules") ? options.get("modules").split(",") : (profile ? profile.modules : modules.map(module => module.id));
if (profile && options.has("modules")) {
  for (const id of requested) assert(profile.modules.includes(id), "module is not supported by profile: " + id);
  requested = [...profile.modules, ...requested];
}
if (enabled && !profile) requested = modules.filter(module => module.mods.every(id => enabled.has(id))).map(module => module.id);
const selected = new Set();
function select(id) {
  if (profile && profile.omitDependencies.includes(id)) return;
  const module = modules.find(module => module.id === id);
  assert(module, "unknown compatibility module: " + id);
  assert(!profile || profile.modules.includes(id), "module is not supported by profile: " + id);
  if (selected.has(id)) return;
  selected.add(id);
  for (const dependency of module.requires || []) select(dependency);
}
for (const id of requested) select(id);
// The v139 bloodline creation hooks share regional identity and faith definitions.
// Select their integrated extension explicitly, without a cyclic module graph.
if (selected.has("wyvern-bloodline")) select("dragon-culture");
const active = modules.filter(module => selected.has(module.id));
const dependencyIds = new Set(profile ? profile.mods : active.flatMap(module => module.mods));
if (enabled) for (const id of dependencyIds) assert(enabled.has(id), "selected compatibility requires an enabled mod: " + id);
const modName = profile ? profile.folder : "VOTC_Three_Mod_Character_Name_Compatibility";
const buildRoot = path.join(root, ".build");
const dryRun = options.has("dry-run");
if (!dryRun) fs.mkdirSync(buildRoot, { recursive: true });
const out = dryRun ? null : fs.mkdtempSync(path.join(buildRoot, "package-"));
const target = dryRun ? null : path.join(out, "mod", modName);
if (!dryRun) fs.mkdirSync(target, { recursive: true });
const owners = new Map();
const sourceFiles = new Map();
const ascensionPoseOverlays = new Set([
  "gfx/portraits/portrait_animations/myv_compact_head.txt",
  "gfx/portraits/portrait_animations/myv_wyvern_flying.txt",
  "gfx/portraits/portrait_animations/myv_wyvern_rider_flying.txt",
  "gfx/portraits/portrait_animations/myv_wyvern_running.txt",
  "gfx/portraits/portrait_animations/myv_wyvern_wild_aerial_flying.txt"
]);
function copy(source, relative, label) {
  const key = relative.replaceAll("\\", "/");
  if (key === "descriptor.mod") return;
  if (profile && profile.exclude.includes(label + ":" + key)) return;
  if (owners.has(key) && key !== "gui/shared/00_votc_trait_tooltip.gui") {
    assert(ascensionPoseOverlays.has(key) && owners.get(key) === "wyvern-kings" && label === "wyvern-ascension",
      "unreviewed overlay collision: " + key);
  }
  if (!dryRun) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, preparePodScript(profileId, key, fs.readFileSync(path.join(source, relative))));
  }
  owners.set(key, label);
  sourceFiles.set(key, path.join(source, relative));
}
function overlay(source, label, relative = "") {
  for (const entry of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "package sources must be ordinary files");
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) { overlay(source, label, name); continue; }
    copy(source, name, label);
  }
}
for (const module of active) {
  const source = path.join(root, module.source);
  if (module.files) for (const file of module.files) copy(source, file, module.id);
  else overlay(source, module.id);
}
if (profile) overlay(path.join(root, profile.overlay), profileId);
const modCatalog = [...config.mods, { id: "2216659254", name: "Princes of Darkness" }];
const dependencies = "dependencies={\n" + modCatalog.filter(mod => dependencyIds.has(mod.id)).map(mod => '\t"' + mod.name + '"').join("\n") + "\n}";
function descriptor(source) {
  assert(source.includes('name="' + config.name + '"'));
  assert(source.includes('version="' + config.version + '"'));
  source = source.replace(/dependencies=\{[\s\S]*?\}/, dependencies);
  if (profile) source = source.replace('name="' + config.name + '"', 'name="' + profile.name + '"').replaceAll("VOTC_Three_Mod_Character_Name_Compatibility", modName);
  return source;
}
const templateName = "VOTC_Three_Mod_Character_Name_Compatibility";
const internalDescriptor = descriptor(fs.readFileSync(path.join(root, "mod", templateName, "descriptor.mod"), "utf8"));
const externalDescriptor = descriptor(fs.readFileSync(path.join(root, "mod", templateName + ".mod"), "utf8"));
if (!dryRun) fs.writeFileSync(path.join(target, "descriptor.mod"), internalDescriptor);
owners.set("descriptor.mod", "package-metadata");
if (!dryRun) fs.writeFileSync(path.join(out, "mod", modName + ".mod"), externalDescriptor);
const files = [...owners].sort(([left], [right]) => left.localeCompare(right)).map(([file, source]) => {
  const bytes = file === "descriptor.mod" ? Buffer.from(internalDescriptor) : (dryRun ? preparePodScript(profileId, file, fs.readFileSync(sourceFiles.get(file))) : fs.readFileSync(path.join(target, file)));
  if (profileId === "wyvern-pod" && file.startsWith("localization/") && file.endsWith(".yml")) {
    assert(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "CK3 localization requires UTF-8 BOM: " + file);
  }
  return { path: file, source, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
});
const manifest = { version: config.version, campaign: config.campaign, profile: profileId, folder: modName, modules: active.map(module => module.id), dependencies: [...dependencyIds], obsoleteFiles: require("../package.json").config.obsoleteFiles || [], files };
if (!dryRun) fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
if (!dryRun) fs.writeFileSync(path.join(buildRoot, "latest-package.json"), JSON.stringify({ packageRoot: out, profile: profileId, files: files.length }) + "\n");
console.log(JSON.stringify(dryRun ? { ...manifest, descriptor: internalDescriptor, externalDescriptor } : { packageRoot: out, files: files.length, version: config.version, profile: profileId, modules: manifest.modules }));

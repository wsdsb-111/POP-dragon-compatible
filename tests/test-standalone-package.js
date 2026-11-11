"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const profileId = packageJson.config?.compatibilityProfile;
assert(["oriental", "wyvern-pod"].includes(profileId), "package.json config.compatibilityProfile must be oriental or wyvern-pod");

for (const file of ["scripts/build-package.js", "scripts/install-package.js", "README.md", "docs/MIGRATION.md"]) {
  assertRegularFile(path.join(root, file), file + " is required");
}

const fixture = readJson("tests/fixtures/migration-baseline.json");
assert.equal(fixture.profile, profileId, "migration baseline profile mismatch");
assert.equal(packageJson.version, fixture.version, "package version changed from the migration baseline");
assert(Array.isArray(fixture.modules) && Array.isArray(fixture.dependencies) && Array.isArray(fixture.files),
  "migration baseline must contain modules, dependencies, and files");

const result = spawnSync(process.execPath, [
  "--max-old-space-size=384",
  path.join(root, "scripts/build-package.js"),
  "--dry-run"
], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  env: process.env
});
assert.ifError(result.error);
assert.equal(result.status, 0, "build-package.js --dry-run failed:\n" + result.stderr);
const plan = parseLastJson(result.stdout);
assert.equal(plan.profile, profileId, "dry-run profile mismatch");
assert.equal(plan.version, fixture.version, "dry-run version mismatch");
assert(Array.isArray(plan.modules) && Array.isArray(plan.dependencies) && Array.isArray(plan.files),
  "dry-run output must contain modules, dependencies, and files");

assert(!plan.dependencies.map(String).includes("3346777360"), "default package must not depend on VOTC (3346777360)");
assert(!plan.modules.includes("wyvern-votc-dialogue"), "default package must not select the optional VOTC dialogue bridge");
assert(!plan.files.some((file) => normalizePackagePath(file.path) === "common/character_interactions/mcc_interactions.txt"),
  "default package must not contain mcc_interactions.txt");
assert(!plan.files.some((file) => normalizePackagePath(file.path).startsWith("tests/")),
  "migration QA tests must not enter the runtime package");

if (profileId === "oriental") {
  for (const id of ["chinese-core", "wyvern"]) assert(plan.modules.includes(id), "Oriental package must include " + id);
  for (const id of ["2506311074", "2592094512", "3684849062", "3811316052", "3717989134", "3614384002"]) {
    assert(plan.dependencies.map(String).includes(id), "Oriental + Wyvern package is missing dependency " + id);
  }
  assert(!plan.dependencies.map(String).includes("2216659254"), "Oriental package must not depend on Princes of Darkness");
} else {
  assert(plan.modules.includes("wyvern"), "PoD package must include wyvern");
  for (const id of ["chinese-core", "calendar-hud", "palace-estate"]) {
    assert(!plan.modules.includes(id), "PoD package must not include Oriental module " + id);
  }
  assert.deepEqual([...plan.dependencies].map(String).sort(), ["2216659254", "3811316052"],
    "PoD package must depend only on Wyvern and Princes of Darkness");
}

const expectedModules = fixture.modules.filter((id) => id !== "wyvern-votc-dialogue");
const expectedDependencies = fixture.dependencies.map(String).filter((id) => id !== "3346777360");
assert.deepEqual(plan.modules, expectedModules, "module list changed beyond removal of the optional VOTC bridge");
assert.deepEqual(plan.dependencies.map(String), expectedDependencies, "dependency list changed beyond removal of VOTC");

const expectedFiles = fileMap(fixture.files, "migration baseline");
const actualFiles = fileMap(plan.files, "dry-run manifest");
for (const [filePath] of expectedFiles) {
  if (isDescriptor(filePath)) expectedFiles.delete(filePath);
}
for (const [filePath] of actualFiles) {
  if (isDescriptor(filePath)) actualFiles.delete(filePath);
}
if (profileId === "oriental") expectedFiles.delete("common/character_interactions/mcc_interactions.txt");
assert.deepEqual([...actualFiles].sort(), [...expectedFiles].sort(),
  "runtime package paths and SHA-256 values must match the baseline, except the approved Oriental bridge removal");

for (const descriptor of [plan.descriptor, plan.externalDescriptor]) {
  if (typeof descriptor !== "string") continue;
  const dependencies = descriptor.match(/dependencies\s*=\s*\{([\s\S]*?)\}/i)?.[1] || "";
  assert(!/3346777360|Voices of the Court 2\.0/i.test(dependencies), "generated descriptor still declares VOTC as a dependency");
}

const moduleDefinitions = readJson("modules.json");
const modules = Array.isArray(moduleDefinitions) ? moduleDefinitions : moduleDefinitions.modules;
assert(Array.isArray(modules), "modules.json must contain a module list");
const profiles = readJson("package-profiles.json");
const sourceRoots = new Map();
for (const moduleId of plan.modules) {
  const module = modules.find((item) => item.id === moduleId);
  assert(module, "selected module is missing from modules.json: " + moduleId);
  sourceRoots.set(moduleId, resolveRepoPath(module.source, "module source " + moduleId));
}
if (profiles[profileId]?.overlay) sourceRoots.set(profileId, resolveRepoPath(profiles[profileId].overlay, "profile overlay"));

for (const file of plan.files) {
  const packagePath = normalizePackagePath(file.path);
  if (file.source === "package-metadata") {
    assert(isDescriptor(packagePath), "only descriptors may use generated package metadata sources");
    continue;
  }
  const sourceRoot = sourceRoots.get(file.source);
  assert(sourceRoot, "manifest source must name a selected in-repository module or profile: " + file.source);
  const module = modules.find((item) => item.id === file.source);
  if (module?.files) {
    assert(module.files.map(normalizePackagePath).includes(packagePath),
      "manifest path is not listed by source module " + file.source + ": " + packagePath);
  }
  const sourceFile = resolveRepoPath(path.relative(root, path.join(sourceRoot, ...packagePath.split("/"))),
    "manifest source file " + packagePath);
  assertRegularFile(sourceFile, "manifest source file is missing: " + packagePath);
  assertNoSymlinkPath(sourceFile);
  if (packagePath.startsWith("localization/") && /\.ya?ml$/i.test(packagePath)) {
    const bytes = fs.readFileSync(sourceFile);
    assert(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
      "localized YAML must retain its UTF-8 BOM: " + packagePath);
  }
}

scanRepositorySources();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assertRegularFile(filePath, message) {
  const stat = fs.lstatSync(filePath);
  assert(!stat.isSymbolicLink(), message + " (symlinks are forbidden)");
  assert(stat.isFile(), message);
}

function resolveRepoPath(relativePath, label) {
  assert(typeof relativePath === "string" && relativePath.length > 0, label + " must be a non-empty path");
  assert(!path.isAbsolute(relativePath) && !path.win32.isAbsolute(relativePath), label + " must be relative to the repository");
  const absolutePath = path.resolve(root, relativePath);
  const fromRoot = path.relative(root, absolutePath);
  assert(fromRoot && fromRoot !== ".." && !fromRoot.startsWith(".." + path.sep) && !path.isAbsolute(fromRoot),
    label + " escapes the repository: " + relativePath);
  return absolutePath;
}

function assertNoSymlinkPath(absolutePath) {
  const fromRoot = path.relative(root, absolutePath);
  let current = root;
  for (const part of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    assert(!fs.lstatSync(current).isSymbolicLink(), "symlink is forbidden in package sources: " + path.relative(root, current));
  }
}

function normalizePackagePath(filePath) {
  assert(typeof filePath === "string" && filePath.length > 0, "manifest path must be a non-empty string");
  const normalized = path.posix.normalize(filePath.replaceAll("\\", "/")).replace(/^\.\//, "");
  assert(!path.posix.isAbsolute(normalized) && normalized !== ".." && !normalized.startsWith("../"),
    "manifest path must stay within the package: " + filePath);
  return normalized;
}

function isDescriptor(filePath) {
  return filePath === "descriptor.mod" || path.posix.extname(filePath).toLowerCase() === ".mod";
}

function fileMap(files, label) {
  const result = new Map();
  for (const file of files) {
    const filePath = normalizePackagePath(file.path);
    assert(/^[a-f0-9]{64}$/i.test(file.sha256), label + " has an invalid SHA-256 for " + filePath);
    assert(!result.has(filePath), label + " repeats " + filePath);
    result.set(filePath, file.sha256.toLowerCase());
  }
  return result;
}

function parseLastJson(output) {
  for (const line of output.split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Build output may include progress text before its final JSON plan.
    }
  }
  assert.fail("build-package.js --dry-run did not print a JSON plan");
}

function scanRepositorySources() {
  const textExtensions = new Set([
    ".asset", ".bat", ".cfg", ".csv", ".gui", ".ini", ".js", ".json", ".md",
    ".mod", ".py", ".ps1", ".sh", ".settings", ".toml", ".txt", ".xml", ".yaml", ".yml"
  ]);
  const forbiddenRoot = ["c:", "users", "97330", "appdata", "local", "programs", "voices-of-the-court"].join("/");
  const skipDirectories = new Set([".build", ".git", "node_modules"]);
  function visit(relativePath) {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);
    assert(!stat.isSymbolicLink(), "repository source contains a symlink: " + relativePath);
    if (stat.isDirectory()) {
      if (skipDirectories.has(path.basename(relativePath).toLowerCase())) return;
      if (relativePath === "docs") {
        const migrationDoc = path.join(relativePath, "MIGRATION.md");
        if (fs.existsSync(path.join(root, migrationDoc))) visit(migrationDoc);
        return;
      }
      for (const name of fs.readdirSync(absolutePath)) visit(path.join(relativePath, name));
      return;
    }
    if (!textExtensions.has(path.extname(relativePath).toLowerCase())) return;
    const commentAware = [".txt", ".gui", ".asset"].includes(path.extname(relativePath).toLowerCase());
    for (const line of fs.readFileSync(absolutePath, "utf8").split(/\r?\n/)) {
      if (commentAware && /^\s*#/.test(line)) continue;
      const normalizedLine = line.toLowerCase().replace(/\\/g, "/").replace(/\/+/g, "/");
      assert(!normalizedLine.includes(forbiddenRoot),
        "source text must not retain an absolute VOTC repository path: " + relativePath);
    }
  }
  for (const name of fs.readdirSync(root)) visit(name);
}

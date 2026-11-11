"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const options = new Map(process.argv.slice(2).map(argument => {
  const match = /^--(package|user-dir)=(.+)$/.exec(argument);
  assert(match, "Use --package=build-folder and --user-dir=CK3-user-directory");
  return [match[1], match[2]];
}));
const latestFile = path.join(root, ".build/latest-package.json");
const build = options.has("package") ? path.resolve(options.get("package")) : JSON.parse(fs.readFileSync(latestFile, "utf8")).packageRoot;
const manifest = JSON.parse(fs.readFileSync(path.join(build, "manifest.json"), "utf8"));
assert(manifest.profile === require("../package.json").config.compatibilityProfile, "Package belongs to this repository");
assert(!manifest.dependencies.includes("3346777360"), "Standalone package cannot require VOTC");
assert(/^[A-Za-z0-9_-]+$/.test(manifest.folder), "Safe package folder");
let userDir = options.get("user-dir");
if (!userDir) {
  assert(process.platform === "win32", "Pass --user-dir on non-Windows systems");
  const documents = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8", windowsHide: true });
  assert(documents.status === 0, "Resolve Windows Documents folder");
  userDir = path.join(documents.stdout.trim(), "Paradox Interactive/Crusader Kings III");
}
userDir = path.resolve(userDir);
if (process.platform === "win32") {
  const processCheck = spawnSync("powershell", ["-NoProfile", "-Command", "if(Get-Process ck3,CrusaderKings3 -ErrorAction SilentlyContinue){exit 1}"], { windowsHide: true });
  assert(processCheck.status === 0, "Close CK3 before installing");
}
const modDir = path.join(userDir, "mod");
const destination = path.join(modDir, manifest.folder);
const source = path.join(build, "mod", manifest.folder);
function hashFile(file) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.alloc(65536);
  const descriptor = fs.openSync(file, "r");
  try {
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}
const safe = (base, relative) => {
  const resolved = path.resolve(base, relative);
  assert(resolved.startsWith(path.resolve(base) + path.sep), "Package path stays inside its mod directory");
  let segment = path.resolve(base);
  for (const part of ["", ...path.relative(base, resolved).split(path.sep)]) {
    segment = path.join(segment, part);
    assert(!fs.existsSync(segment) || !fs.lstatSync(segment).isSymbolicLink(), "Package path cannot traverse a symlink");
  }
  return resolved;
};
const staged = manifest.files;
for (const file of staged) {
  const input = safe(source, file.path);
  assert(fs.statSync(input).size === file.bytes && hashFile(input) === file.sha256, "Package hash: " + file.path);
}
fs.mkdirSync(modDir, { recursive: true });
assert(!fs.existsSync(destination) || !fs.lstatSync(destination).isSymbolicLink(), "Install destination cannot be a symlink");
const backup = fs.mkdtempSync(path.join(modDir, ".compat-backup-"));
function backupFile(file, relative) {
  if (!fs.existsSync(file)) return;
  assert(!fs.lstatSync(file).isSymbolicLink(), "Do not overwrite a symlink");
  const target = safe(backup, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}
for (const file of staged) {
  const target = safe(destination, file.path);
  if (fs.existsSync(target) && hashFile(target) === file.sha256) continue;
  backupFile(target, "mod/" + file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(safe(source, file.path), target + ".compat-tmp");
  fs.renameSync(target + ".compat-tmp", target);
}
// Only the old optional dialogue bridge is removed; custom unrelated files stay.
for (const obsolete of ["common/character_interactions/mcc_interactions.txt", ...(manifest.obsoleteFiles || [])]) {
  assert(!staged.some(file => file.path === obsolete), "Do not remove a current package file");
  const oldFile = safe(destination, obsolete);
  if (fs.existsSync(oldFile)) {
    const backupPath = obsolete.endsWith("/mcc_interactions.txt") ? "legacy-votc-bridge/mcc_interactions.txt" : "obsolete/" + obsolete;
    backupFile(oldFile, backupPath);
    fs.unlinkSync(oldFile);
  }
}
const external = path.join(modDir, manifest.folder + ".mod");
backupFile(external, "external.mod");
const descriptor = fs.readFileSync(path.join(build, "mod", manifest.folder + ".mod"), "utf8")
  .replace(/^path="[^"]*"/m, 'path="' + destination.replaceAll("\\", "/") + '"');
fs.writeFileSync(external + ".compat-tmp", descriptor);
fs.renameSync(external + ".compat-tmp", external);
for (const file of staged) assert(hashFile(safe(destination, file.path)) === file.sha256, "Installed hash: " + file.path);
const result = { profile: manifest.profile, folder: manifest.folder, target: destination, backup, verifiedFiles: staged.length, hashes: "PASS", playsetChanged: false, CK3Runtime: "NOT_RUN" };
fs.writeFileSync(path.join(backup, "installation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const profile = require("../package.json").config.compatibilityProfile;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-standalone-installer-"));
const folder = "Standalone_Installer_Test";
const build = path.join(temp, "build");
const source = path.join(build, "mod", folder);
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function write(file, bytes) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
const files = [
  { path: "descriptor.mod", bytes: Buffer.from('name="fixture"\n') },
  { path: "common/test.txt", bytes: Buffer.from("fixture_effect = {}\n") }
].map(file => {
  write(path.join(source, file.path), file.bytes);
  return { path: file.path, bytes: file.bytes.length, sha256: digest(file.bytes) };
});
const manifest = { profile, folder, files, dependencies: ["3811316052"], obsoleteFiles: ["common/old-duplicate.txt"] };
function saveManifest(value) { write(path.join(build, "manifest.json"), JSON.stringify(value)); }
saveManifest(manifest);
write(path.join(build, "mod", folder + ".mod"), 'name="fixture"\npath="mod/' + folder + '"\n');
function run(userDir) {
  return spawnSync(process.execPath, ["--max-old-space-size=384", path.join(root, "scripts/install-package.js"), "--package=" + build, "--user-dir=" + userDir], { cwd: root, encoding: "utf8" });
}
try {
  const user = path.join(temp, "valid-user");
  const destination = path.join(user, "mod", folder);
  write(path.join(destination, "common/test.txt"), "old bytes");
  write(path.join(destination, "custom-preserved.txt"), "custom bytes");
  write(path.join(destination, "common/character_interactions/mcc_interactions.txt"), "legacy bridge");
  write(path.join(destination, "common/old-duplicate.txt"), "legacy duplicate");
  write(path.join(user, "dlc_load.json"), "unchanged playset");
  const installed = run(user);
  assert.equal(installed.status, 0, installed.stderr);
  const receipt = JSON.parse(installed.stdout);
  assert.equal(receipt.verifiedFiles, 2);
  for (const file of files) assert.equal(digest(fs.readFileSync(path.join(destination, file.path))), file.sha256);
  assert.equal(fs.readFileSync(path.join(destination, "custom-preserved.txt"), "utf8"), "custom bytes");
  assert.equal(fs.readFileSync(path.join(user, "dlc_load.json"), "utf8"), "unchanged playset");
  assert(!fs.existsSync(path.join(destination, "common/character_interactions/mcc_interactions.txt")));
  assert.equal(fs.readFileSync(path.join(receipt.backup, "legacy-votc-bridge/mcc_interactions.txt"), "utf8"), "legacy bridge");
  assert.equal(fs.readFileSync(path.join(receipt.backup, "mod/common/test.txt"), "utf8"), "old bytes");
  assert(!fs.existsSync(path.join(destination, "common/old-duplicate.txt")));
  assert.equal(fs.readFileSync(path.join(receipt.backup, "obsolete/common/old-duplicate.txt"), "utf8"), "legacy duplicate");
  assert.equal(run(user).status, 0, "repeat installation succeeds without changing package bytes");

  const tamperedUser = path.join(temp, "tampered-user");
  write(path.join(source, "common/test.txt"), "tampered bytes");
  assert.notEqual(run(tamperedUser).status, 0, "reject corrupted package");
  assert(!fs.existsSync(tamperedUser), "reject before creating destination or backup");
  write(path.join(source, "common/test.txt"), "fixture_effect = {}\n");

  saveManifest({ ...manifest, files: [{ ...files[0], path: "../escape.txt" }] });
  assert.notEqual(run(path.join(temp, "escaped-user")).status, 0, "reject paths escaping the package root");
  saveManifest(manifest);

  let symlinks = "PASS";
  const outside = path.join(temp, "outside");
  write(path.join(outside, "test.txt"), "outside bytes");
  const linkedUser = path.join(temp, "linked-user");
  const linkedMod = path.join(linkedUser, "mod", folder);
  fs.mkdirSync(linkedMod, { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(linkedMod, "common"), process.platform === "win32" ? "junction" : "dir");
    assert.notEqual(run(linkedUser).status, 0, "reject symlinked parent directories");
    assert.equal(fs.readFileSync(path.join(outside, "test.txt"), "utf8"), "outside bytes");
    const leafUser = path.join(temp, "leaf-user");
    const leaf = path.join(leafUser, "mod", folder, "common/test.txt");
    fs.mkdirSync(path.dirname(leaf), { recursive: true });
    fs.symlinkSync(path.join(source, "common/test.txt"), leaf, "file");
    assert.notEqual(run(leafUser).status, 0, "reject same-hash symlink leaves");
  } catch (error) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    symlinks = "PARTIAL: OS did not allow creating a file symlink; junction test ran if available";
  }
  console.log("Standalone installer: package hashes, backup, repeat install, bridge removal, untouched playset, corrupt/path negatives PASS; links " + symlinks + "; CK3 runtime NOT_RUN");
} finally {
  assert(temp.startsWith(path.join(os.tmpdir(), "ck3-standalone-installer-")));
  fs.rmSync(temp, { recursive: true, force: true });
}

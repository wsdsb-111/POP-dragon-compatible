"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const tests = ["test-standalone-package.js", "test-installed-user-fixes.js", "test-standalone-installer.js", "test-wyvern-v138-black-inheritance.js", "test-v1320-black-trial.js", "test-v1310-hunger.js", "test-v1310-awakening-ritual.js", "test-wyvern-pod-identity.js", "test-wyvern-pod-species-independent-qa.js", "test-wyvern-pod-succession.js", "test-wyvern-pod-succession-independent-qa.js", "test-wyvern-pod-age-and-mokole-max.js", "test-wyvern-pod-age-display-independent-qa.js", "test-wyvern-pod-native-immortality-independent-qa.js", "test-wyvern-pod-mokole-max-independent-qa.js", "test-wyvern-pod-combat.js"];
for (const test of tests) {
  const result = spawnSync(process.execPath, ["--max-old-space-size=384", path.join(__dirname, test)], { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("Standalone source checks passed: " + tests.length + " groups; CK3 runtime NOT_RUN");

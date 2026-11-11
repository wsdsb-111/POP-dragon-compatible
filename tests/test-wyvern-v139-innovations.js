'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHarness } = require('./wyvern-v134-finite-helper');
const root = path.resolve(__dirname, '..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'patches/dragon-culture/innovation-inputs.json'), 'utf8'));
const game = 'D:/SteamLibrary/steamapps/common/Crusader Kings III/game';
const home = 'E:/Documents/Paradox Interactive/Crusader Kings III';
if (!fs.existsSync(snapshot.playset.path) || !fs.existsSync(game)) {
  console.log('SKIP local enabled-playset innovation audit: source paths unavailable');
  process.exit(0);
}
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert.equal(hash(snapshot.playset.path), snapshot.playset.sha256, 'enabled playset changed; regenerate the audited source list');
const playset = JSON.parse(fs.readFileSync(snapshot.playset.path, 'utf8')).enabled_mods;
assert.deepEqual(playset, snapshot.playset.enabled);
const files = new Map();
function add(source, folder) {
  const dir = path.join(folder, 'common/culture/innovations');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.txt')).sort()) {
    const file = path.join(dir, name);
    files.set(name, { source, path: file, sha256: hash(file) });
  }
}
add('game', game);
const contributorHashes = new Map(snapshot.descriptors.map(entry => [entry.name, entry.sha256]));
for (const item of playset) {
  const descriptor = path.join(home, item);
  if (contributorHashes.has(item)) assert.equal(hash(descriptor), contributorHashes.get(item), 'innovation source descriptor changed: ' + item);
  const contents = fs.readFileSync(descriptor, 'utf8');
  assert.doesNotMatch(contents, /replace_path\s*=\s*"(?:common|common\/culture|common\/culture\/innovations)"/i);
  const match = contents.match(/(?:^|\n)\s*path\s*=\s*"([^"]+)"/);
  assert.ok(match, 'enabled mod path: ' + item);
  add(item, match[1]);
}
const actualFiles = [...files.values()].sort((a,b) => a.path.localeCompare(b.path));
assert.deepEqual(actualFiles, snapshot.files, 'effective innovation files or input hashes changed');
const parser = createHarness([]);
const ids = new Set();
for (const file of actualFiles) {
  for (const entry of parser.parsePdx(fs.readFileSync(file.path, 'utf8'), file.path)) {
    if (Array.isArray(entry.value) && !entry.key.startsWith('@')) ids.add(entry.key);
  }
}
const history = parser.parsePdx(fs.readFileSync(path.join(root, 'patches/dragon-culture/mod/history/cultures/myv_wyvern_culture.txt'), 'utf8'), 'dragon culture history');
assert.equal(history.length, 1);
const entries = history[0].value;
assert.ok(entries.every(node => node.key === 'discover_innovation'));
const unlocked = Array.from(entries, node => node.value);
assert.equal(new Set(unlocked).size, unlocked.length, 'no duplicate innovation');
assert.deepEqual(unlocked.slice().sort(), [...ids].sort(), 'all and only active top-level innovations are unlocked');
assert.equal(ids.size, snapshot.count);
for (const id of ['innovation_world_cathay','innovation_target_region_liangjing','innovation_target_ZhongHuaLiZhi','fp3_innovation_fritware','fp3_innovation_mural_sextant']) assert.ok(ids.has(id));
console.log('v139 enabled-playset innovation audit passed: ' + ids.size + ' definitions, ' + actualFiles.length + ' effective source files');

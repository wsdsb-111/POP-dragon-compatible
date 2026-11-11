'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readBytes = relative => fs.readFileSync(path.join(root, ...relative.split('/')));
const read = relative => readBytes(relative).toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function blockAt(source, start, label) {
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, 'missing block opener ' + label);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '#') inComment = true;
    else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail('unclosed block ' + label);
}

function blocksNamed(source, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp('^' + escapedId + '\\s*=\\s*\\{', 'gm');
  return [...source.matchAll(expression)].map(match => blockAt(source, match.index, id));
}

function filesUnder(relativeDirectory) {
  const absoluteDirectory = path.join(root, ...relativeDirectory.split('/'));
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? filesUnder(relativePath) : [relativePath];
  });
}

const sourcePath = 'patches/dragon-bond/mod/common/traits/zzzzzz_mm_dragon_bond_species.txt';
const bondReceipt = JSON.parse(read('patches/dragon-bond/sources.json'));
const sourceOutput = bondReceipt.outputs.find(item => item.path === 'mod/common/traits/zzzzzz_mm_dragon_bond_species.txt');
assert.ok(sourceOutput, 'the Dragon Bond receipt identifies the source trait file');
assert.equal(sourceOutput.sha256, '60eebaf8a657d0b7eb3d16734f27ea041581582fdb03fe837c011afae15ad305',
  'the copied source trait is pinned');
assert.equal(sha256(readBytes(sourcePath)), sourceOutput.sha256, 'the Dragon Bond trait source matches its receipt');

const sourceTraitMatches = blocksNamed(read(sourcePath), 'myv_wyvern_legendary');
assert.equal(sourceTraitMatches.length, 1, 'the base dragon-bond trait is defined once');
const sourceTrait = sourceTraitMatches[0];
assert.match(sourceTrait, /^myv_wyvern_legendary\s*=\s*\{/);
assert.match(sourceTrait, /^\s*immortal\s*=\s*yes\s*$/m, 'the inherited legendary trait already uses native immortality');
const finiteLifeLines = sourceTrait.match(/^[\t ]*life_expectancy[\t ]*=\s*666[\t ]*$/gm) || [];
assert.equal(finiteLifeLines.length, 1, 'the source contains one finite 666-year life expectancy to remove');
assert.equal((sourceTrait.match(/^[\t ]*life_expectancy[\t ]*=/gm) || []).length, 1,
  'the copied source has no other finite life expectancy field');
const expectedOverride = sourceTrait.replace(/^[\t ]*life_expectancy[\t ]*=\s*666[\t ]*\n/m, '');

const traitFiles = filesUnder('patches/wyvern-pod/mod/common/traits').filter(file => file.endsWith('.txt'));
const overlayDefinitions = traitFiles.flatMap(file => blocksNamed(read(file), 'myv_wyvern_legendary').map(definition => ({ file, definition })));
assert.equal(overlayDefinitions.length, 1, 'the PoD profile supplies one actual same-ID late trait root');
const overlayTrait = overlayDefinitions[0].definition;
assert.equal(overlayTrait, expectedOverride,
  'the PoD override is the source trait block with only life_expectancy = 666 removed');
assert.match(overlayTrait, /^\s*immortal\s*=\s*yes\s*$/m, 'the PoD trait root retains native immortal = yes');
assert.doesNotMatch(overlayTrait, /^\s*life_expectancy\s*=/m, 'the PoD trait root has no finite life expectancy');
assert.doesNotMatch(overlayTrait, /^\s*desc\s*=/m, 'the override adds no description or new trait presentation');
for (const line of [
  'elderly_health = 666',
  'epidemic_resistance = 100',
  'health = 5',
  'character_travel_safety = 1000',
  'character_travel_speed = 200',
  'fertility = -1000',
  'can_have_children = no',
  'inheritance_blocker = all',
  'claim_inheritance_blocker = all'
]) {
  assert.ok(overlayTrait.includes(line), 'preserve Dragon Bond trait property: ' + line);
}

const overlayRelativePath = path.relative(
  path.join(root, 'patches/wyvern-pod/mod'),
  path.join(root, overlayDefinitions[0].file)
).replace(/\\/g, '/');
const sourceReceipts = fs.readdirSync(path.join(root, 'patches/wyvern-pod'))
  .filter(file => file.endsWith('sources.json'))
  .map(file => JSON.parse(read('patches/wyvern-pod/' + file)));
const outputEntries = sourceReceipts.flatMap(receipt => receipt.outputs || []).filter(output => {
  const outputPath = output.path.replace(/^mod\//, '');
  return outputPath === overlayRelativePath;
});
assert.equal(outputEntries.length, 1, 'one PoD generator receipt owns the late trait override');
assert.equal(sha256(readBytes(overlayDefinitions[0].file)), outputEntries[0].sha256,
  'the generated trait file matches its owner receipt');

console.log('PoD native immortality override independent static QA passed; CK3 runtime remains NOT_RUN.');

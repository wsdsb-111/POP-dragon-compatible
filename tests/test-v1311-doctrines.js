const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('node:crypto');
const base = path.join(__dirname, '..', 'patches', 'dragon-creed', 'mod', 'common', 'religion');
const rite = fs.readFileSync(path.join(base, 'rite_types', 'mm_dragon_creed.txt'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const tenets = fs.readFileSync(path.join(base, 'tenet_types', 'mm_dragon_creed.txt'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const doctrines = fs.readFileSync(path.join(base, 'doctrine_types', 'mm_dragon_creed.txt'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const game = 'D:/SteamLibrary/steamapps/common/Crusader Kings III/game/common/religion/doctrine_types';
const native = fs.readdirSync(game).filter(f => f.endsWith('.txt')).map(f => fs.readFileSync(path.join(game, f), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')).join('\n');
for (const name of ['black', 'white', 'fire', 'earth', 'sea', 'sky']) {
  const block = rite.match(new RegExp(`mm_dragon_${name} = \\{([\\s\\S]*?)\\n\\}`))[1];
  assert(block.includes('faith = mm_dragon_creed'));
  const list = block.match(/tenets = \{([^}]*)\}/)[1].trim().split(/\s+/);
  assert.deepStrictEqual(list, [`mm_tenet_${name}`, `mm_tenet_${name}_second`, `mm_tenet_${name}_third`]);
  for (const key of list) assert(new RegExp(`^${key} = \\{`, 'm').test(tenets));
  const choices = block.match(/doctrines = \{([^}]*)\}/)[1].trim().split(/\s+/);
  for (const key of choices) assert(new RegExp(`^${key} = \\{`, 'm').test(key.startsWith('mm_') ? doctrines : native), key);
}
assert(!/traits = \{/.test(fs.readFileSync(path.join(base, 'religion_types', 'mm_dragon_creed.txt'), 'utf8')));
// User amendment (2026-10-29): Black Blood moves from sin to virtue.
const expected = { black: 7, white: 6, fire: 5, earth: 5, sea: 5, sky: 5 };
for (const [name, virtueCount] of Object.entries(expected)) {
  const blocks = ['', '_second', '_third'].map(suffix => tenets.match(new RegExp(`mm_tenet_${name}${suffix} = \\{([\\s\\S]*?)\\n\\}`))[1]);
  const traits = kind => blocks.flatMap(block => [...block.match(new RegExp(`${kind} = \\{(.*?) \\}\\n`))[1].matchAll(/(\w+) = \{ weight/g)].map(match => match[1]));
  assert.equal(traits('virtues').length, virtueCount);
  assert.equal(traits('sins').length, 5);
  assert.equal(new Set(traits('virtues')).size, virtueCount);
  assert.equal(new Set(traits('sins')).size, 5);
  assert(!traits('virtues').some(key => ['mm_royal_dragon_king', 'mm_royal_complete'].includes(key)));
}

const currentFaiths = fs.readFileSync(path.join(base, 'faith_types', 'mm_dragon_creed.txt'), 'utf8');
assert.deepStrictEqual([...currentFaiths.matchAll(/^(\w+) = \{/gm)].map(m => m[1]), ['mm_dragon_creed']);
for (const name of Object.keys(expected)) {
  const legacy = rite.match(new RegExp(`mm_dragon_legacy_${name} = \\{([\\s\\S]*?)\\n\\}`))[1];
  assert.match(legacy, /faith = mm_dragon_creed\b/);
  assert.match(legacy, /create = no/);
  assert.match(legacy, /history = yes/);
}
const group = fs.readFileSync(path.join(base, 'doctrine_group_types', 'mm_dragon_creed.txt'), 'utf8');
assert.match(group, /mm_dragon_rite_doctrine = \{/);
assert.match(group, /category = special/);
assert.match(group, /is_available_on_create = \{ religion = religion:mm_dragon_creed_religion \}/);
assert.deepStrictEqual(fs.readFileSync(path.join(base, '..', '..', 'gfx/interface/icons/faith_doctrine_groups/mm_dragon_rite_doctrine.dds')), fs.readFileSync(path.join(base, '..', '..', 'gfx/interface/icons/faith/mm_dragon_creed.dds')));
const project = path.resolve(__dirname, '..');
const artwork = JSON.parse(fs.readFileSync(path.join(project, 'artwork/dragon-creed/manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
for (const asset of artwork.assets) {
  for (const [file, expectedHash] of [[asset.png, asset.sourceSha256], [asset.gameFile, asset.gameSha256]]) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(project, file))).digest('hex'), expectedHash, file);
  }
}
for (const lang of ['english', 'simp_chinese']) {
  const folder = path.join(base, '..', '..', 'localization', lang);
  const loc = fs.readdirSync(folder).filter(f => f.endsWith('.yml')).map(f => fs.readFileSync(path.join(folder, f), 'utf8')).join('\n');
  for (const branch of Object.keys(expected)) {
    for (const suffix of ['', '_second', '_third']) {
      for (const field of ['name', 'desc']) {
        const key = `mm_tenet_${branch}${suffix}_${field}`;
        assert.equal([...loc.matchAll(new RegExp(`^\\s*${key}:`, 'gm'))].length, 1, `unique ${lang} ${key}`);
      }
    }
  }
}

console.log('v1.3.11 doctrine definition checks passed');


'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./wyvern-v135-finite-helper');
const h = createHarness([]);
const base = path.resolve(__dirname, '..');
const native = 'D:/SteamLibrary/steamapps/workshop/content/1158310/3811316052';
function parse(file) { return h.parsePdx(fs.readFileSync(file, 'utf8'), file); }
function definition(file, name) { const n = parse(file).find(x => x.key === name); assert.ok(n, name); return n.value; }
const trigger = definition(path.join(native, 'common/scripted_triggers/myv_wyvern_triggers.txt'), 'myv_is_actual_wyvern_raid_recipient');
const event = definition(path.join(base, 'patches/wyvern-capture/mod/events/myv_wyvern_events.txt'), 'myv_wyvern.0100');
const eventTrigger = h.first(event, 'trigger').value;
const original = definition(path.join(native, 'events/myv_wyvern_events.txt'), 'myv_wyvern.0100');
assert.deepEqual(JSON.parse(JSON.stringify(eventTrigger)), JSON.parse(JSON.stringify(h.first(original, 'trigger').value)));
const news = definition(path.join(base, 'patches/dragon-news/mod/common/scripted_effects/myv_wyvern_notification_effects.txt'), 'myv_notify_wyvern_success_effect');
function deep(nodes, key) { return nodes.flatMap(n => [ ...(n.key === key ? [n] : []), ...(Array.isArray(n.value) ? deep(n.value, key) : []) ]); }
const players = deep(news, 'every_player');
assert.equal(players.length, 1);
assert.equal(deep(players[0].value, 'send_interface_toast').length, 1);
const newsLimit = h.first(players[0].value, 'limit').value;
function execute(nodes, current, scopes, params = {}) {
 const resolve = raw => {
  if (raw.startsWith('$')) { const parts = raw.split('$'); return (parts[2] || '').split('.').filter(Boolean).reduce((x, k) => x?.[k], params[parts[1]]); }
  if (raw.startsWith('scope:')) return raw.slice(6).split('.').reduce((x, k) => x?.[k], scopes);
  throw Error('unsupported path ' + raw);
 };
 function node(n) {
  const v = n.value;
  switch (n.key) {
   case 'OR': return v.some(node);
   case 'AND': return v.every(node);
   case 'NOT': return !v.every(node);
   case 'exists': return resolve(v) != null;
   case 'this': return current === resolve(v);
   case 'is_alive': return current.alive === (v === 'yes');
   case 'myv_is_wyvern': return current.wyvern === (v === 'yes');
   case 'is_liege_or_above_of': { for (let c = resolve(v)?.liege; c; c = c.liege) if (c === current) return true; return false; }
   case 'myv_is_actual_wyvern_raid_recipient': return execute(trigger, current, scopes, { COUNTY: resolve(h.first(v, 'COUNTY').value) });
   case 'trigger_if': { const limit = h.first(v, 'limit'); return !execute(limit.value, current, scopes, params) || execute(v.filter(x => x.key !== 'limit'), current, scopes, params); }
   case 'trigger_else': return resolve('$COUNTY$.holder') != null || execute(v, current, scopes, params);
   case 'always': return v === 'yes';
   case 'scope:myv_raided_county.holder':
   case 'scope:myv_raided_county.holder.liege': { const target = resolve(n.key); return !!target && execute(v, target, scopes, params); }
   default: throw Error('unsupported production selector node ' + n.key);
  }
 }
 return nodes.every(node);
}
const china = { alive: true, wyvern: false }, foreign = { alive: true, wyvern: false };
const king = { alive: true, wyvern: false }, duke = { alive: true, wyvern: false, liege: king }, count = { alive: true, wyvern: false, liege: duke };
const scopes = { myv_raided_county: { holder: count }, mm_wyvern_news_county: { holder: count }, myv_wyvern_news_actor: foreign };
for (const p of [count, duke, king]) { scopes.myv_raid_victim = p; assert.equal(execute(eventTrigger, p, scopes), true); assert.equal(execute(newsLimit, p, scopes), true); }
for (const p of [china, foreign]) { scopes.myv_raid_victim = p; assert.equal(execute(eventTrigger, p, scopes), false); assert.equal(execute(newsLimit, p, scopes), false); }
scopes.mm_wyvern_news_keeper = china;
assert.equal(execute(newsLimit, china, scopes), true);
scopes.myv_raid_victim = count;
assert.equal(execute(eventTrigger, duke, scopes), false, 'event only fires for selected victim');
scopes.myv_raided_county = {};
assert.equal(execute(eventTrigger, count, scopes), false, 'unheld county fails closed');
// Execute the actual production selection branches, including their limits and
// save_scope_as targets. Unknown structures fail rather than silently pass.
const raid = definition(path.join(base, 'patches/dragon-news/mod/common/scripted_effects/zzzz_mm_dragon_raid_effects.txt'), 'myv_wyvern_attack_herds_effect');
const outer = h.first(raid, 'if').value;
const branches = outer.filter(n => n.key === 'if' || n.key === 'else_if');
assert.equal(branches.length, 3);
assert.equal(branches[0].key, 'if');
assert.equal(branches[1].key, 'else_if');
function choose(holder) {
 const context = { myv_raided_county: { holder } };
 for (const branch of branches.slice(0, 2)) {
  if (!execute(h.first(branch.value, 'limit').value, {}, context)) continue;
  const action = branch.value.find(n => n.key !== 'limit');
  assert.ok(['scope:myv_raided_county.holder', 'scope:myv_raided_county.holder.liege'].includes(action.key));
  assert.equal(h.first(action.value, 'save_scope_as').value, 'myv_raid_victim');
  return action.key.endsWith('.liege') ? holder.liege : holder;
 }
 return undefined;
}
assert.equal(choose(count), count, 'county holder is selected even when duke and king are players');
assert.equal(choose({ alive: false, wyvern: false, liege: duke }), duke, 'only direct actual liege is fallback');
assert.equal(choose(undefined), undefined, 'unheld county has no guessed de jure fallback');
assert.equal(choose({ alive: false, wyvern: false, liege: { alive: false, wyvern: false, liege: king } }), undefined, 'do not skip an invalid liege to a distant ruler');
assert.equal(deep(raid, 'random_list').length, 0);
assert.equal(deep(raid, 'myv_resolve_wyvern_raid_victim_effect').length, 1);
assert.equal(deep(raid, 'myv_change_wyvern_food_reserve_effect').length, 1);
console.log('dragon news and raid event production selector AST fixtures passed; CK3 engine unverified');


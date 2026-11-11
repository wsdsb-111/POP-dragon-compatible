"use strict";

// Independent finite-model regression: these assertions do not claim CK3 engine validation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { createHarness } = require("./wyvern-v132-finite-helper");
const fixture = require("./fixtures/v132/v138-lineage-families.json");
const h = createHarness(["wyvern-bloodline", "wyvern-kings"]);
// Preserve the explicit fixture identity; creation assignment is covered separately.
h.scriptedEffects.set("mm_dragon_creation_source_hook_effect", []);
const list = c => Array.from(c.variableLists.get("mm_dragon_origins") || []);
const branches = c => ["fire", "white", "black"].filter(b => c.traits.has("mm_dragon_branch_" + b));
const biological = c => ["fire", "white", "black"].filter(b => c.vars.has("mm_dragon_bio_" + b));
function environment(root, scopes = {}) { return h.environment({ root, scopes, randomChoices: [false] }); }
function refresh(c) { h.run("mm_dragon_refresh_branch_traits_effect", c, environment(c)); }
function birth(mother, father) {
  const child = h.character("newborn");
  const env = environment(child, { mother, real_father: father });
  h.run("mm_dragon_inherit_natural_blood_effect", child, env);
  return { child, env };
}
function family() {
  const white = h.character(fixture.whiteEmpress, { traits: ["myv_wyvern_legendary", "mm_royal_white_empress"] });
  const black = h.character(fixture.blackEmperor, { traits: ["myv_wyvern_legendary", "mm_royal_black_emperor"] });
  const norton = h.character(fixture.fireKing, { traits: ["myv_wyvern_legendary", "mm_royal_dragon_king"], vars: { mm_royal_throne: fixture.fireThrone }, mother: white, realFather: black });
  const constantine = h.character(fixture.fireTwin, { traits: ["myv_wyvern_legendary", "mm_royal_dragon_king"], vars: { mm_royal_throne: fixture.fireThrone }, mother: white, realFather: black });
  return { norton, constantine, white, black };
}
function mixed(id, sources, extra = {}) {
  return h.character(id, { traits: ["mm_dragon_half", ...(extra.traits || [])], vars: extra.vars || {}, variableLists: { mm_dragon_origins: sources } });
}

// Historical black/white royal genealogy must remain intact while their fire king
// children register themselves as exact sources, not their own royal parents.
for (const name of ["norton", "constantine"]) {
  const f = family();
  const king = f[name];
  const env = environment(king);
  h.run("mm_dragon_register_true_dragon_origins_effect", king, env);
  assert.deepEqual(list(king), [king], name + " registers only its own royal origin");
  assert.equal(king.mother, f.white);
  assert.equal(king.realFather, f.black);
  h.run("mm_dragon_register_true_dragon_origins_effect", king, env);
  assert.deepEqual(list(king), [king], "royal registration is idempotent");
}

// Reproduce a save in which the fire source acquired the parents' old flags.
{
  const { norton, white, black } = family();
  norton.vars.set("mm_dragon_bio_fire", true);
  norton.vars.set("mm_dragon_bio_white", true);
  norton.vars.set("mm_dragon_bio_black", true);
  const seed = mixed("fire-seed", [norton]);
  const { child, env } = birth(seed, h.character("ordinary-human"));
  assert.deepEqual(list(child), [norton]);
  assert.deepEqual(biological(child), ["fire"], "a fire source's polluted royal-parent flags cannot propagate");
  assert.deepEqual(branches(child), ["fire"]);
  h.run("mm_dragon_inherit_natural_blood_effect", child, env);
  assert.deepEqual(list(child), [norton], "repeated natural-birth hook does not duplicate sources");
  assert.deepEqual(branches(child), ["fire"]);

  const second = mixed("independent-white-line", [white]);
  const both = birth(seed, second).child;
  assert.deepEqual(list(both), [norton, white]);
  assert.deepEqual(branches(both), ["fire", "white"], "an independently sourced white line remains inheritable");
  assert.ok(!both.vars.has("mm_dragon_bio_black"));
  assert.notEqual(white, black);
}

// Reprojection removes provably unsupported old flags, not acquired branches.
{
  const { norton, white } = family();
  norton.vars.set("mm_dragon_bio_white", true);
  norton.vars.set("mm_dragon_bio_black", true);
  const old = mixed("old-polluted-fire", [norton], { traits: ["mm_dragon_branch_fire", "mm_dragon_branch_white", "mm_dragon_branch_black"], vars: { mm_dragon_bio_fire: true, mm_dragon_bio_white: true, mm_dragon_bio_black: true, mm_dragon_absorbed_white: true } });
  refresh(old);
  assert.deepEqual(biological(old), ["fire"]);
  assert.deepEqual(branches(old), ["fire", "white"], "absorbed white stays visible but is not biological");
  assert.deepEqual(list(old), [norton]);
  refresh(old);
  assert.deepEqual(branches(old), ["fire", "white"]);
  assert.deepEqual(branches(birth(old, h.character("human")).child), ["fire"], "absorption never becomes inherited");
  const legitimate = mixed("old-legitimate-mixed", [norton, white], { traits: ["mm_dragon_branch_fire", "mm_dragon_branch_white"], vars: { mm_dragon_bio_fire: true, mm_dragon_bio_white: true } });
  refresh(legitimate);
  assert.deepEqual(list(legitimate), [norton, white]);
  assert.deepEqual(branches(legitimate), ["fire", "white"], "preserve the independent white origin");
  const unknown = mixed("old-unknown", [], { traits: ["mm_dragon_branch_white"], vars: { mm_dragon_bio_white: true } });
  refresh(unknown);
  assert.ok(unknown.vars.has("mm_dragon_bio_white"), "missing sources are not evidence to erase old blood");
}

// Direct human/dragon birth retains its own source and correct generation.
for (const royal of [true, false]) {
  const { norton, white, black } = family();
  const dragon = royal ? norton : h.character("ordinary-dragon", { traits: ["myv_wyvern_tamed"], vars: { mm_royal_creation_throne: 1 }, variableLists: { mm_dragon_origins: [norton] } });
  if (royal) dragon.variableLists.set("mm_dragon_origins", [dragon, white, black]); // legacy ambiguous source list
  const { child, env } = birth(dragon, h.character("human"));
  assert.ok(child.traits.has(royal ? "mm_dragon_half" : "mm_dragon_lineage_1"));
  assert.ok(list(child).includes(dragon));
  if (royal) assert.deepEqual(list(child), [dragon], "royal genealogy is not copied to direct mixed offspring");
  assert.deepEqual(branches(child), ["fire"]);
  h.run("mm_dragon_inherit_natural_blood_effect", child, env);
  assert.equal(new Set(list(child)).size, list(child).length);
}


// A true dragon's source list includes itself. Clearing the target before
// reading an unclassified self source would destroy the only old evidence.
{
  const unknown = h.character("legacy-unclassified-dragon", { traits: ["myv_wyvern_tamed", "mm_dragon_branch_fire", "mm_dragon_branch_white"], vars: { mm_dragon_bio_fire: true, mm_dragon_bio_white: true } });
  unknown.variableLists.set("mm_dragon_origins", [unknown]);
  refresh(unknown);
  assert.deepEqual(biological(unknown), ["fire", "white"], "unknown self source keeps its evidence");
  assert.deepEqual(branches(unknown), ["fire", "white"]);
  refresh(unknown);
  assert.deepEqual(biological(unknown), ["fire", "white"]);

  const defined = h.character("defined-fire-dragon", { traits: ["myv_wyvern_tamed", "mm_dragon_branch_fire", "mm_dragon_branch_white"], vars: { mm_royal_creation_throne: 1, mm_dragon_bio_fire: true, mm_dragon_bio_white: true } });
  defined.variableLists.set("mm_dragon_origins", [defined]);
  refresh(defined);
  assert.deepEqual(biological(defined), ["fire"], "self source with an explicit identity remains repairable");
  assert.deepEqual(branches(defined), ["fire"]);
}



// Each sovereign has an explicit branch identity. Old ancestor flags must not
// expand that identity, including for the black and white sovereign themselves.
{
  const cases = [
    { branch: "fire", throne: 1 },
    { branch: "earth", throne: 2 },
    { branch: "sea", throne: 3 },
    { branch: "sky", throne: 4 },
    { branch: "white", trait: "mm_royal_white_empress" },
    { branch: "black", trait: "mm_royal_black_emperor" },
  ];
  const names = ["fire", "earth", "sea", "sky", "white", "black"];
  for (const sample of cases) {
    const whiteParent = h.character("white-parent", { traits: ["myv_wyvern_legendary", "mm_royal_white_empress"] });
    const blackParent = h.character("black-parent", { traits: ["myv_wyvern_legendary", "mm_royal_black_emperor"] });
    const contaminated = Object.fromEntries(names.map(name => ["mm_dragon_bio_" + name, true]));
    if (sample.throne) contaminated.mm_royal_throne = sample.throne;
    const sovereign = h.character("sovereign-" + sample.branch, {
      traits: ["myv_wyvern_legendary", sample.trait || "mm_royal_dragon_king"],
      vars: contaminated,
      mother: whiteParent,
      realFather: blackParent,
    });
    const env = environment(sovereign);
    h.run("mm_dragon_register_true_dragon_origins_effect", sovereign, env);
    assert.deepEqual(list(sovereign), [sovereign], sample.branch + " registers its own source only");
    assert.equal(sovereign.mother, whiteParent);
    assert.equal(sovereign.realFather, blackParent);
    const seed = mixed("seed-" + sample.branch, [sovereign]);
    const child = birth(seed, h.character("human-" + sample.branch)).child;
    assert.deepEqual(list(child), [sovereign]);
    assert.deepEqual(names.filter(name => child.vars.has("mm_dragon_bio_" + name)), [sample.branch], sample.branch + " projects its own identity only");
    assert.deepEqual(names.filter(name => child.traits.has("mm_dragon_branch_" + name)), [sample.branch], sample.branch + " displays only its own branch");
    refresh(child);
    assert.deepEqual(names.filter(name => child.vars.has("mm_dragon_bio_" + name)), [sample.branch], "reprojection preserves " + sample.branch);
  }
}

// An existing promoted sovereign may already have real, independent ancestry.
// Registration must not erase these records, even though its descendants inherit
// the sovereign identity rather than automatically copying the whole list.
{
  const { norton, white, black } = family();
  const sovereign = h.character("promoted-sovereign", {
    traits: ["myv_wyvern_legendary", "mm_royal_dragon_king"],
    vars: { mm_royal_throne: 1, mm_dragon_origin_count: 2, mm_dragon_origin_1: white, mm_dragon_origin_2: black },
    variableLists: { mm_dragon_origins: [white, black] },
  });
  const env = environment(sovereign);
  h.run("mm_dragon_register_true_dragon_origins_effect", sovereign, env);
  assert.deepEqual(list(sovereign), [white, black, sovereign], "retain independent ancestral identities when registering a sovereign");
  assert.equal(sovereign.vars.get("mm_dragon_origin_1"), white);
  assert.equal(sovereign.vars.get("mm_dragon_origin_2"), black);
  h.run("mm_dragon_register_true_dragon_origins_effect", sovereign, env);
  assert.deepEqual(list(sovereign), [white, black, sovereign], "repeat registration preserves the old list without duplicates");
  const child = birth(sovereign, h.character("ordinary-human")).child;
  assert.deepEqual(list(child), [sovereign], "royal offspring receive the royal identity, not its stored ancestral list");
  assert.deepEqual(branches(child), ["fire"]);
  assert.notEqual(norton, sovereign);
}

{
  const hooks = h.parsePdx(fs.readFileSync(path.join(root, "patches/wyvern-bloodline/mod/common/on_action/mm_dragon_branch_projection.txt"), "utf8"), "projection load hook");
  const pulse = hooks.find(n => n.key === "mm_dragon_restore_branch_projections");
  assert.ok(pulse);
  h.scriptedEffects.set("qa_v138_projection_load", h.first(pulse.value, "effect").value);
  const source = h.character("load-source", { traits: ["mm_royal_dragon_king"], vars: { mm_royal_throne: 1 } });
  const people = ["player", "child", "courtier", "outside-player-court"].map(id => h.character(id, {
    traits: ["mm_dragon_lineage_2", "mm_dragon_branch_fire", "mm_dragon_branch_white", "mm_dragon_branch_black"],
    vars: { mm_dragon_bio_fire: true, mm_dragon_bio_white: true, mm_dragon_bio_black: true },
    variableLists: { mm_dragon_origins: [source] }
  }));
  people[0].children = [people[1]]; people[0].courtiers.add(people[2]);
  const env = h.environment({ root: people[0] }); env.players = [people[0]];
  h.run("qa_v138_projection_load", people[0], env);
  for (const person of people.slice(0, 3)) {
    assert.ok(person.traits.has("mm_dragon_branch_fire"));
    assert.ok(!person.traits.has("mm_dragon_branch_white") && !person.traits.has("mm_dragon_branch_black"));
  }
  assert.ok(people[3].traits.has("mm_dragon_branch_white"), "targeted load does not scan unrelated world characters");
}
console.log("v1.3.8 lineage independent finite regression passed");

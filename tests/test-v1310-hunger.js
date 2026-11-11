"use strict";
const assert = require("node:assert/strict");
const { createHarness } = require("./wyvern-v135-finite-helper");
const h = createHarness(["wyvern-capture", "wyvern-bloodline", "wyvern-kings"]);
const rows = [[100,1,1],[50,1,1],[49,.9,.95],[30,.9,.95],[29,.7,.8],[20,.7,.8],[19,.5,.6],[10,.5,.6],[9,.25,.5],[0,.25,.5]];
for (const [satiety, ordinary, royal] of rows) {
  for (const [trait, expected] of [["myv_wyvern",ordinary],["myv_wyvern_legendary",royal],["mm_wyvern_legendary_origin",royal]]) {
    const c = h.character(trait, {traits:[trait],vars:{myv_wyvern_hunger:satiety}});
    assert.equal(h.value("mm_wyvern_hunger_power_multiplier", c, h.environment()), expected, trait + ":" + satiety);
  }
}
const missing = h.character("missing", {traits:["myv_wyvern"]});
assert.equal(h.value("mm_wyvern_hunger_power_multiplier", missing, h.environment()), 1);
const malnourished = h.character("malnourished", {traits:["myv_wyvern"],vars:{myv_wyvern_hunger:100,myv_wyvern_malnutrition:40}});
assert.equal(h.value("mm_wyvern_hunger_power_multiplier", malnourished, h.environment()), 1, "malnutrition does not secretly change satiety tier");
console.log("V1310 hunger: strict boundaries, four ordinary/royal tiers and separate nutrition passed");

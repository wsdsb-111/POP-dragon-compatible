# PoD Wyvern Combat Benchmark — 2026-11-03

## Scope and status

This is a PoD-only static compatibility override in `.build/compat-v111`. Its only gameplay override is `patches/wyvern-pod/mod/common/script_values/zzzzzzzzzzzz_mm_pod_combat.txt`. The existing native `myv_refresh_wyvern_prowess_effect` already writes the target value into CK3's native Prowess, so this patch does not duplicate it in a new scripted effect. It adds no prowess trait, no flat minimum, and no hunter-tier cap.

The figures below are static source calculations. No game or save was opened, no runtime value was observed, and no test was run. `combat-sources.json` records the exact source files and static fixtures. The current local PoD history and traits are not a guarantee of a live save's final sheet: save changes, equipment, other dynamic bonuses, load order, and runtime script evaluation are outside this evidence.

## Vampire elder reference and calculation

All figures use native CK3 Prowess points. In this document `M` means the selected 186-point balancing reference; it does not mean millions.

The living historical elder used to normalize dragon size power is Ur-Shulgi (`790356`), whose history begins in 60 and has no death before its 2200 death date. His source has base `prowess = 100`, vampire `+5`, and these direct discipline bonuses: Celerity +10, Obfuscate +5, Quietus +10, Auspex +1, Fortitude +10, Animalism advanced +7, Presence +5, Dominate +5, Necromancy +5, Potence +10, Blood Sorcery +5. The discipline subtotal is 73. His listed `sadistic +2`, `vengeful +2`, and `torturer +4` add 8 more, so the complete awake static reference is `100 + 5 + 73 + 2 + 2 + 4 = M = 186`.

The current `torpor` trait subtracts 20, giving Ur-Shulgi `166` in torpor and `186` awake. M=186 is this checked character's complete awake static trait calculation; it is not a claim about PoD's absolute maximum or a live save's final sheet.

Ur-Shulgi and Nergal also receive `lifestyle_mystic` with 100 XP in their histories. The trait's additional Prowess is conditional on the culture parameter `prowess_from_religious_traits`; the reviewed Levantine and Assyrian culture definitions do not list a tradition that grants that parameter, so no such conditional bonus is included above.

Nergal (`790368`) is another living 100-base candidate in the reviewed history. His listed direct traits calculate to 163 with torpor and 183 without it. Haqim (`505009`) would calculate to 157 with torpor and 177 without it (`100 base + 10 martial education + 5 vampire + 55 disciplines + 7 blademaster/hunter - 20 torpor`), but his history records `death_disappearance` on 100.1.1, so he is not treated as alive in the 1230 context. These are source-level calculations, not runtime measurements or an exhaustive maximum claim.

## Target values

The target values are fixed native Prowess caps for the named historical identities. The script selects the black and white emperor IDs, their trait fallbacks, the existing Complete King cap, the eight elemental character IDs, exact inherited seat-anchor matches, then the branch fallbacks. Ordinary dragons use 190. Each elemental king ID has its own value, including both members of each twin pair.

| Dragon identity | PoD history name | Character ID | Native Prowess cap |
| --- | --- | ---: | ---: |
| Ordinary dragon | — | — | 190 |
| Fire King | Constantine | `99001001` | 275 |
| Fire King | Norton | `99001305` | 225 |
| Earth King | Jormungandr | `99001306` | 215 |
| Earth King | Fenrir | `99001002` | 285 |
| Sea King | Leviathan | `99001307` | 230 |
| Sea King | Behemoth | `99001003` | 265 |
| Sky King | Hrist | `99001304` | 260 |
| Sky King | Vidar / Odin | `99001308` | 240 |
| Complete King | — | — | 298 (existing cap) |
| White Empress | White Empress | `99001310` | 350 |
| Black Emperor | Black Emperor | `99001309` | 400 |

The checked history names pair `99001001` Constantine with `99001305` Norton; `99001002` Fenrir with `99001306` Jormungandr; `99001003` Behemoth with `99001307` Leviathan; and `99001304` Hrist with `99001308` Vidar. The fixed caps follow the requested names after checking these history IDs: Constantine 275 and Norton 225; Fenrir 285 and Jormungandr 215; Behemoth 265 and Leviathan 230; Hrist 260 and Vidar/Odin 240. Simplified Chinese localization labels Hrist as “瓦尔基里” and Vidar as “奥丁”. No history or localization files were changed.

Uncatalogued branch-trait fallbacks are Fire 250, Earth 250, Sea 248, and Sky 250. White and Black trait-only identities use 350 and 400. The existing Complete King cap remains 298 and precedes the eight elemental identity checks, preserving that cap for a completed king.

Inherited elemental successors keep the original throne's individual cap through the existing ascension source chain. The claimant's `mm_asc_blood_source` points to the predecessor; that source's `mm_asc_seat_anchor` points to the original historical seat, including after multiple successions. Each route requires the matching elemental king trait, an existing blood-source variable and character, an existing seat-anchor variable and character, and an exact original character-ID match. This distinguishes both twins within a branch. If the exact route is unavailable, the existing branch midpoint remains the fallback. Black/White successors keep their 400/350 trait caps, and `mm_royal_complete` keeps 298 before inherited seat routes. The routing is outcome-agnostic and does not require `mm_asc_dragon_body`, so it can apply while the claimant remains in ascension progression; the ascension effect owns the trait and race awards.

The current ascension contract still lists the same ten original seat IDs: `99001001`, `99001002`, `99001003`, `99001304`, `99001305`, `99001306`, `99001307`, `99001308`, `99001309`, and `99001310`. Its existing source assertion iterates the fixture's `seatIds` and checks seat initialization for each one. The cap change reuses these IDs and does not alter root identity or the source-ID contract. It only reads the inherited trait/source/anchor state; the ascension effect remains responsible for granting the claimant's royal trait and PoD dragon race. The cap route does not require `mm_asc_dragon_body`, leaving candidate progression available.

The native size curve remains the source of growth; its documented anchors include 0.5m/5, 4m/20, 8m/30, 10m/40, 20m/80, and 30m/100, with larger sizes continuing up to its existing 150 size-power bound. A 1.86 size scale maps the 30m/100 anchor to M=186 while retaining the same size interpolation for juveniles. Royal scaling uses `fixed identity cap / M`, so a fed 30m dragon reaches its selected cap before physique and temperament. Ordinary dragons use the same size scaling with a 190 cap; juvenile Prowess continues to grow with size.

For all identities the fully fed size/physique/temperament/enrage value is capped first. Wing, hind-leg, and tail injury multipliers, hunger, and malnutrition are applied after that cap. Hunger exactly 0 explicitly yields final Prowess 0; ordinary nonzero hunger still follows the existing hunger multipliers. The final result is rounded and clamped from 0 to the identity cap. Torpor retains the existing zero-target behavior.

Static arithmetic fixtures:

| Case | Calculation | Expected target |
| --- | --- | ---: |
| Juvenile size anchor, ordinary | `5 × 1.86` | 9 after rounding |
| Adult 20m anchor, ordinary, neutral body | `80 × 1.86` | 149 |
| Adult 30m anchor, ordinary, neutral body | `min(100 × 1.86, 190)` | 186 |
| Adult 30m, strongest physique/temperament | `min(100 × 1.86 × 1.1 × 1.1, 190)` | 190 |
| Adult 30m, all three severe injury multipliers | `190 × 0.75 × 0.75 × 0.90` | 96 after rounding |
| Adult 30m, hunger 0 | fully composed value, then explicit hunger-zero branch | 0 |
| Constantine `99001001`, severe wing injury | `275 × 0.75` | 206 after rounding |
| Norton `99001305`, no injury | fixed character-ID cap | 225 |
| Jormungandr `99001306` / Fenrir `99001002` | their separate fixed character-ID caps | 215 / 285 |
| Hrist `99001304` / Vidar (“奥丁”) `99001308` | their separate fixed character-ID caps | 260 / 240 |

These fixtures prove the intended arithmetic/order in the static definition only. They do not prove CK3 script parsing or live-save behavior.

## Native refresh and combat tiers

The native source defines `myv_wyvern_prowess_delta` as `myv_wyvern_target_prowess - prowess`. `myv_refresh_wyvern_prowess_effect` forces a skill recalculation, applies `add_prowess_skill = myv_wyvern_prowess_delta`, then recalculates again. Existing native call sites refresh after initialisation, growth, injury, recovery, identity, and hunger/maintenance changes. This is why the PoD patch only overrides the target calculation; a separate effect would duplicate the native writer.

If a future change modifies size, hunger, injuries, identity, or torpor outside existing native call sites, call `myv_refresh_wyvern_prowess_effect = yes` in that same character scope after the state change. Changing the displayed/script-value target alone does not immediately synchronize native Prowess until that refresh runs.

The native source calculates hunter tiers in five-point steps and dragon tiers in ten-point steps. The current R capture overlay recalculates both tiers in ten-point steps; its wyvern tier reads `myv_wyvern_target_prowess`, while the native tier reads synced native `prowess`. Both use `min = 0` and neither has `max = 3`. The PoD `mm_wyvern_hunter_can_finish` gate is a separate human Prowess threshold (`>30`, or `>60` for legendary-blood targets), not a combat-tier cap. This patch leaves all tier and gate definitions intact. Existing combat odds and wound amounts consume the resulting tier difference and retain their own min/max bounds; injury and hunger lower the target value before the R overlay calculates its target tier, and the native refresh synchronizes that value before native tier reads.

## Verification boundary

Static source inspection and arithmetic fixtures only. No test/game execution, save inspection, deployment, or runtime confirmation was performed; no current save or melt export was used, and no tool was downloaded. In particular, the figures do not establish in-game prowess, combat win rates, or save migration behavior.

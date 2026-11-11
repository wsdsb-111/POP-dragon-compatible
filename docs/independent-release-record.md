# Independent release record

## Candidate identity

- Compatibility mod: VOTC Three-Mod Character Name Compatibility 1.0.6.
- Source commit: 3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4.
- Local repository target: C:\Users\97330\Documents\Codex\CK3-Three-Mod-Compatibility.
- GitHub remote configured locally: https://github.com/wsdsb-111/CK3-Three-Mod-Compatibility.git.
- Publication state: local-only; no commit, push or Workshop upload.

## Evidence for this export

- The 12 files in the mod folder and adjacent descriptor were verified byte-for-byte against the source; all 13 SHA-256 pairs are in migration-manifest.json.
- The three test scripts were transformed only at their modRoot paths. Their source hash, before hash, after hash and exact path transformation are recorded in the manifest.
- From a separate clean temporary copy with no VOTC checkout or .git directory, node tests/run-tests.js passed all 3 groups under Node.js v24.13.0 with exit 0.
- Negative fixture: removing common/scripted_effects/zzzz_votc_celestial_office_release.txt caused the runner to fail on ENOENT with exit 1, as expected.
- The test suite uses Node built-ins only. The GitHub Actions workflow specifies Node.js 22.

## Open gates

- GitHub Actions: CI_PENDING. No remote workflow run exists.
- Real CK3 behavior: CK3_PENDING. The independent export has not been loaded by CK3.
- VOTC retirement: LOCAL_PASS (2026-10-11). The root agent removed 19 source files and three test-manifest groups after all 19 source/target SHA-256 pairs passed.
- License review: PENDING. No license is inferred or assigned by this snapshot.

## Release boundary

This record describes a local source migration and local VOTC decommission completed on 2026-10-11 after all 19 source/target SHA-256 pairs passed and three test-manifest groups were removed. It does not claim CK3 engine acceptance, a successful remote CI run, public redistribution rights or final V9 acceptance. The optional Tianjia repair archive is outside the 1.0.6 package and automated test runner.
# Migration from VOTC

## Source snapshot

The export source is VOTC commit 3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4. The selected source paths matched that commit when copied. VOTC later gained unrelated in-progress V9 worktree files; immediately before writing this manifest, a Git comparison confirmed that every selected export path still had zero staged or unstaged difference from the frozen commit. The 12 files inside the compatibility mod directory and the adjacent launcher descriptor were copied without content changes into mod/. Their complete source paths and SHA-256 values, destination paths and target hashes are recorded in migration-manifest.json.

The three existing tests were copied into tests/. Each transformation changes only the relative modRoot path from compatibility-mods/ to mod/. The manifest records each source hash and the resulting target hash. Their runtime imports are limited to node:assert/strict, node:fs and node:path; they do not import VOTC code or shared helpers.

## Optional Tianjia patch audit

The VOTC compatibility-patches/tianjia-benji-repair directory contains its README, one decision script and one Simplified Chinese localization file. A repository search of resources/, scripts/ and compatibility-mods/ found no production reference to that directory or its repair identifiers. The patch is manually deployed data, not an Electron runtime dependency. A byte-identical copy is kept under patches/tianjia-benji-repair as a separately labeled optional archive; it is not included by the Three-Mod package descriptor or the three test groups.

This audit does not establish compatibility with a current Workshop release or permission to redistribute. On 2026-10-11, the root agent retired the 19 hash-verified source files from VOTC and removed the three corresponding test-manifest groups. The root verified all 19 sourceSha256/targetSha256 pairs before removal; the installed CK3 Mod and native Bridge were unchanged. The original source paths and hashes remain recorded in migration-manifest.json.

## Data and change boundary

Only the selected source code and documentation needed for this independent project were copied. No CK3 save, AppData/VOTC runtime data, API credentials, logs, summaries, queues or settings were included. The installed CK3 mod directory was not used as a copy source and this export issued no writes there.

The export copy itself did not edit the VOTC source tree; the root agent performed the separate source retirement on 2026-10-11, after the hash checks described above. The three test groups passed in a separate clean temporary copy under Node.js v24.13.0; an expected-failure run confirmed that removing a required office script produces ENOENT and runner exit 1. This export is local-only: no Git commit, Git push, Workshop upload or GitHub Actions run was performed. CK3_PENDING and CI_PENDING remain open. See migration-manifest.json for file-level provenance and hashes.
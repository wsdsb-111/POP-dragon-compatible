# License provenance

This file records the source inspection for the independent export. It does not grant rights or provide a legal conclusion.

At VOTC source commit 3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4, the exported 13-file Three-Mod source tree and its two descriptors contain no license declaration, copyright notice or license metadata. The VOTC checkout has license and notice files for packaged Electron/Chromium components, but those files do not identify a license for this CK3 mod source and were not copied into this repository.

The optional Tianjia patch archive also has no license declaration in its source files or directory README. The compatibility mod names three upstream mods as dependencies; the descriptor does not state their licenses.

Accordingly, this repository intentionally has no LICENSE file and does not assign an open-source license, claim upstream authorship or imply redistribution permission. Before public distribution, verify the rights and required notices for each included source and any embedded third-party material with the respective authors. Record the verified source and exact permission before adding a license or publishing.
## 1.1.0 additional merge sources (2026-10-21)

The optional overlays contain merged copies of installed CK3 GUI/gene/type files from the game and the Workshop items listed in compatibility.json. Original authorship is retained. Source SHA-256 records are kept in patches/current-playset-ui/sources.json, patches/weight-of-crown/sources.json and patches/wyvern/sources.json.

No new redistribution license is inferred from local availability or this compatibility work. Local installation and source verification do not establish rights for a public Workshop reupload. No public upload was performed.

## Verified dragon-head asset (1.1.7)

The adapted dragon-head geometry comes from **Screaming dragon head 3D print** by **winner_77**, https://skfb.ly/6TrJ8, under **Creative Commons Attribution 4.0 International**, https://creativecommons.org/licenses/by/4.0/. The source page identifies CC Attribution and allows project use. The user supplied `DragScream.fbx`; its SHA-256 is frozen in `artwork/wyvern-trophies/models/winner77-head-source.json`.

The full head, neck and original base are retained. The derivative reduces mesh complexity, adds UVs, projects sculpt normals, changes surface materials to the user's palette and converts/scales the result for CK3. The runtime package includes `CREDITS-winner_77-dragon-head.txt`; editable exports retain attribution. This verified asset permission does not assign a license to unrelated upstream mod components discussed above.

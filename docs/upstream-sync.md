# Manual upstream comparison

Compared on 2026-10-14 against `https://github.com/kunkka19xx/look`, branch
`main`, at `c794b96` (full commit available through `upstream/main`).
The fork snapshot is `6dbb2c7`; the common ancestor is `72806bf`.

## Commits reviewed

| Commit | Upstream change | Result |
| --- | --- | --- |
| `c1e042f` | GPUI port and shared desktop backend (#594) | Already present in the snapshot |
| `c5d29c8` | Empty Trash icon when Trash is empty (#593) | Already present |
| `37e27c2` | More visible banner (#597) | Already present |
| `a2a456e` | Background images for tiles (#601) | Already present |
| `42842e7` | Configurable linows keybindings (#602) | Already present |
| `8a9279e` | GPUI documentation, CI and pre-commit updates (#603) | Already present |
| `c794b96` | Native GPUI refinements (#606) | Already present |

## Comparison and resolution

- Counted both sides of renames separately: upstream changes 364 paths from the
  common ancestor. Of these, 346 match the snapshot exactly, including deletions;
  18 retain fork changes.
- The entire `apps/linows/gpui` tree matches upstream. Upstream changes to CI,
  scripts, packaging and macOS are also present.
- Reviewed a three-way merge tree without modifying the checkout. Outside the
  conflicting files, it adds no changes to the snapshot. The eight conflicts
  concern the lockfile, fork dependencies and commands, todo search, and docs;
  preserving the fork content keeps the note/agent/snippet commands and fixes.
- Clarified shortcut documentation manually: the Tauri backup supports the
  config-based row shortcuts, while GPUI has the full shortcut recorder. Kept
  the fork's additional launch modes and feature documentation.
- No upstream functional patch remained to port. No merge, rebase or reset was
  applied; Git ancestry therefore still lists the seven upstream commits as
  unmerged, despite their changes already being present in the fork snapshot.

## Validation scope

The snapshot had passed 239 JavaScript tests, four Tauri tests, the image
save/note reload/cleanup test, the backend code-highlighting test and 14 snippet
tests. Its Windows Tauri release build succeeded. This comparison changes only
documentation; it does not establish Linux, macOS or GPUI runtime validation.

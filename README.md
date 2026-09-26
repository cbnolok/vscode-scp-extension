# SphereScript for SphereServer-X

VS Code language support for SphereServer-X `.scp` script files.

This is a from-scratch consolidation, not a fork: it pulls the best
individual pieces out of three community forks of the original extension
(and fixes real bugs in all of them - see `CHANGELOG.md`) rather than
building on any single one. Keyword/property/trigger data is sourced
directly from a scan of the SphereServer-X engine source, not scraped
from a wiki - see `tools/keyword_scan/README.md` if you're maintaining
that data.

## Provenance

- [SphereServer/vscode-scp-extension](https://github.com/SphereServer/vscode-scp-extension) - the original extension.
- [BlackBoxEngineering/vscode-scp-extension](https://github.com/BlackBoxEngineering/vscode-scp-extension) - fork.
- [Prapilk/vscode-scp-extension](https://github.com/Prapilk/vscode-scp-extension) - fork.
- [LuxionUO/vscode-scp-extension-luxion](https://github.com/LuxionUO/vscode-scp-extension-luxion) - fork.

Every feature below was compared across all four before deciding what to
build on; none of the four was both correct and complete on its own.

| Area | Primarily from | What was kept / fixed |
| --- | --- | --- |
| Grammar structure | LuxionUO | Per-engine-class scoping (`citem-props`, `cchar-functions`, ...) instead of one flat alternation list. |
| Grammar correctness | Prapilk, +2 found here | Operator alternation ordering, the section-close regex, the `functiony` scope typo, the `ref\d+` fix; plus a missing `#` on an `#include` and an unescaped `.` in `barding.diff`, both only caught by actually running the grammar test suite. |
| Grammar string escapes | BlackBoxEngineering | Escape-sequence whitelist and a negative-lookbehind string-end pattern. |
| `language-configuration.json` | Prapilk | Original's block-comment end marker and `[`/`]` bracket entries were broken/missing; folding and indent rules added on top. |
| Completion | LuxionUO (ideas) + Prapilk (caching) | Deliberately combined, not a straight pick of one - see `CHANGELOG.md`. Extended prefix coverage beyond either (Prapilk only handled `i.`/`src.`/`serv.`/`new.`/`argo.`). |
| Signature help | LuxionUO | The only one of the four that implemented this at all; ported to read from the cached symbol index instead of rescanning per keystroke. |
| Workspace symbol index | Prapilk + LuxionUO | Union of section-type coverage - neither alone covered what the other did. |
| Diagnostics / code actions / formatting | Prapilk, substantially rebuilt | Original had popup-spam reporting, three duplicated Levenshtein implementations, a fake `DISCOVERED_RULES` list, and a real `BEGIN`/`END` block-tracking bug (the formatter knew about it, the structure validator didn't) - all removed or fixed. |
| Keyword/property/trigger data | New | Scanned from the SphereServer-X engine source rather than scraped from a wiki - none of the four did this. |
| Unit tests | New | None of the four had real tests beyond an unmodified scaffold placeholder. |

## Features

- **Syntax highlighting** - class-scoped grammar (separate rules per
  engine class - `CItem`, `CChar`, `CObjBase`, ...) rather than one flat
  set of alternations, so highlighting tracks what's actually valid on
  each object type.
- **Completion** - context-aware suggestions after `[`, `@`, and
  `prefix.` (properties/functions bucketed by object prefix - `i.`,
  `src.`, `serv.`, `cont.`, `new.`, `ref1.`, ...), plus every
  `FUNCTION`/`ITEMDEF`/`CHARDEF`/`TYPEDEF`/`DIALOG`/... symbol defined
  anywhere in the open workspace, labeled by kind.
- **Signature help** - for user-defined `[FUNCTION]` blocks, parameter
  names are inferred from `local.X = <argv[N]>` lines in the function
  body and shown as you type a call.
- **Hover** - descriptions for triggers, properties, section keywords,
  and user-defined symbols (jump-to-definition info included).
- **Go to Definition** - for `FUNCTION`/`ITEMDEF`/`CHARDEF`/`DEFNAME`/...
  across the whole workspace, with an incremental, debounced symbol
  index (not a re-scan per keystroke). Resolves any symbol name under
  the cursor, case-insensitively, wherever it appears - section headers,
  `ID=`/`TYPE=` values, `RESOURCES` lines, function calls - including
  numeric/hex item ids (`ID=01b78`). Use `Ctrl+Click`, `F12`, or the
  right-click menu. If the index ever looks stale, run
  **SphereScript: Reindex Workspace Symbols** from the Command Palette.
- **Diagnostics** - unclosed/mismatched `IF`/`WHILE`/`FOR*`/`DORAND`/
  `DOSWITCH` blocks (including `BEGIN`/`END` case blocks), unbalanced
  `()`/`<>`, `DEFNAME` mismatches, unknown section keywords/properties
  with "did you mean" suggestions. Runs on a background workspace scan
  plus debounced per-file updates - reported through the Problems panel
  and an output channel, never as popups.
- **Quick fixes** - one-click correction for the typos diagnostics
  catches, and an "Add DEFNAME" action on `[ITEMDEF]`/`[CHARDEF]`
  headers that don't have one yet.
- **Format Document** (`Ctrl+Alt+L` / `Cmd+Alt+L`) - reindents based on
  block structure, honoring your tabs/spaces editor settings.

## Customizing colors

Highlighting uses standard TextMate scopes (`source.scp`), so you can
recolor them in `settings.json`, for example:

```json
"editor.tokenColorCustomizations": {
    "textMateRules": [
        { "scope": "entity.name.section.scp", "settings": { "foreground": "#80DFFF" } },
        { "scope": "support.class.section.header.scp", "settings": { "foreground": "#80DFFF" } }
    ]
}
```

Run **Developer: Inspect Editor Tokens and Scopes** on any token to see
which scope to target.

## Requirements

None - no external runtime dependencies.

## Known gaps

- Most property/trigger descriptions are now filled (1608/1908, ~84%
  overall), grounded in real usage from a Scripts-X script-base scan
  and the SphereServer-X mediawiki docs - never guessed or
  machine-translated. `controlKeywords` and `regionProperties` are
  fully filled; `definitionProperties` (88/91) and `sectionKeywords`
  (57/63) are essentially done. `triggers` is at 210/248 (85%),
  `itemProperties` at 489/626 (78%), `charProperties` at 495/581
  (85%), `servProperties` at 83/104 (80%), `expressionFunctions` at
  80/87, `commands` at 31/33. The remaining blanks in each bucket are
  disproportionately champion-system and house-customization
  internals, and a handful of AOS-era equip-bonus properties, for
  which neither the script base nor the mediawiki docs have a
  documented effect - a plausible-sounding but wrong description is
  worse than no description, so these were deliberately left blank
  rather than guessed. See `tools/keyword_scan/README.md` for the
  review workflow and its English-only, hand-written-preferred,
  Doxygen-only-for-C++-sourced-text policy (note: reading the C++
  engine source directly - even non-Doxygen identifiers/comments, not
  just quoting them - turned out to be worth calling out explicitly as
  off-limits for this work too, since it's easy for a research pass to
  drift into "inferring from an enum name," which is guessing by
  another name).

## Development

See `CONTRIBUTING.md`. `npm run compile`, `npm run lint`, and
`npm run test:unit` should all pass clean before a PR.

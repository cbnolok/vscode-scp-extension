# SphereScript for SphereServer-X

VS Code language support for SphereServer-X `.scp` script files.

This is a from-scratch consolidation, not a fork: it pulls the best
individual pieces out of three community forks of the original extension
(and fixes real bugs in all of them - see `CHANGELOG.md`) rather than
building on any single one. Keyword/property/trigger data is sourced
directly from a scan of the SphereServer-X engine source, not scraped
from a wiki - see `tools/keyword_scan/README.md` if you're maintaining
that data.

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
  index (not a re-scan per keystroke).
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

## Requirements

None - no external runtime dependencies.

## Known gaps

- Property/function/trigger descriptions are sourced from inline C++
  comments in the engine source where one exists; many entries don't
  have one yet, so hover text is blank for those. See
  `tools/keyword_scan/README.md` for how to fill these in (English only).
- A handful of source classes discovered by the keyword scanner
  (`CRegion`, `CDialogDef`, `CSkillDef`, `CSpellDef`, and others) aren't
  yet bucketed into a specific completion prefix - their keywords are
  still known to diagnostics and the general-fallback completion list,
  just not offered after a specific `prefix.`.

## Development

See `CONTRIBUTING.md`. `npm run compile`, `npm run lint`, and
`npm run test:unit` should all pass clean before a PR.

# Contributing

## Layout

- `syntaxes/scp.tmLanguage.json` - TextMate grammar, scoped per engine
  class (`citem-props`, `cchar-functions`, ...) rather than one flat rule
  set. Test changes with `npx vscode-tmgrammar-test@0.0.11 -s source.scp -g
  syntaxes/scp.tmLanguage.json -t "test/**/*.scp"` before committing -
  it'll catch a broken `#include` (grammar entries silently no-op if the
  `#` prefix is missing) or a JSON error that `json.load` alone won't.
- `language-configuration.json` - brackets, comments, folding, and
  editor auto-indent rules (independent of `src/formatting.ts`'s
  `Format Document` command - both exist, they do different things).
- `src/keywordData.ts` - compiled keyword/property/trigger data. Don't
  hand-write this from scratch; see `tools/keyword_scan/README.md`.
- `src/types.ts` - the `KnowledgeBase`/`SymbolLookup` interfaces most
  other modules depend on, by injection, not by importing a concrete data
  source. `diagnostics.ts`, `codeActions.ts` and `completion.ts`'s
  general fallback all take these as parameters rather than importing
  `keywordData.ts`/`symbolProvider.ts` directly - keep that boundary if
  you're adding a new consumer, it's what makes these modules testable
  without spinning up the VS Code extension host.
- `src/blockKeywords.ts` - the *only* place SphereScript's control-flow
  block structure (`IF`→`ENDIF`, `DOSWITCH`+`BEGIN`/`END`+`ENDDO`, ...) is
  defined. Both `diagnostics.ts` and `formatting.ts` import from here -
  don't let them each grow their own copy again (they used to, and it's
  why `BEGIN`/`END` case blocks used to format correctly but never get
  validated).
- `src/symbolProvider.ts` - the workspace symbol index. Cached and
  debounced (rebuilds 1s after you stop typing, immediately on save) -
  completion/hover/signature-help/go-to-definition all read from this
  cache, none of them re-scan the workspace per keystroke.

## Before a PR

```
npm install
npm run compile   # tsc, must be clean
npm run lint      # eslint, must be clean
npm run test:unit # pure-logic tests (stringUtils, blockKeywords) - fast, no VS Code host needed
```

## Language policy

All user-facing text - diagnostic messages, hover descriptions, code
comments - is English only. This has come up before (a prior fork's data
was partly French); don't reintroduce it.

## Extending the keyword scanner

If you're changing what counts as a script keyword (new engine version,
new table format, expanding a completion bucket), start at
`tools/keyword_scan/README.md` - it documents the detection heuristic,
current known gaps, and the manual review workflow. Don't hand-edit
`src/keywordData.ts`'s bulk content without going through
`divergence_report.csv` first; individual description fixes are fine to
edit directly.

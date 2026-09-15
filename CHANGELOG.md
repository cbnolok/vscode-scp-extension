# Change Log

## [0.1.0] - Unreleased

Initial release of the consolidated extension. Built by comparing the
original extension against three community forks (BlackBoxEngineering,
Prapilk, LuxionUO) feature by feature and combining the best individual
implementation of each, rather than adopting any one fork wholesale -
none of the four was both correct and complete on its own.

### Added

- Completion, hover, go-to-definition, workspace symbol indexing
  (cached and debounced, not a re-scan per keystroke).
- Signature help for user-defined `[FUNCTION]` blocks, inferring
  parameter names from `local.X = <argv[N]>` lines.
- Diagnostics: block structure (including `DOSWITCH` `BEGIN`/`END` case
  blocks, previously untracked), bracket balance, `DEFNAME` mismatches,
  unknown section keywords/properties with suggestions - reported via
  the Problems panel and an output channel, never as popups.
- Quick fixes for the typos diagnostics catches, plus "Add DEFNAME".
- `Format Document` support, honoring the editor's tabs/spaces setting.
- Keyword/property/trigger data sourced from a scan of the SphereServer-X
  engine source (`tools/keyword_scan/`) instead of a wiki scrape.
- Grammar fixes: operator alternation ordering (`<=`/`>=`/`==`/`!=` were
  unreachable - a shorter prefix always matched first), a malformed
  section-close regex, a missing `#` on an `#include` (silently
  no-op'd, caught by actually running the grammar test suite), an
  unescaped `.` in `barding.diff`, a `ref[1-255]`-style bug (character
  class, not a numeric range) replaced with `ref\d+`, and a
  `functiony` scope-name typo present since the original extension.
- `language-configuration.json` fixes: block comments were unclosable
  (`end` pattern was a stray `/`, not `*/`), `[`/`]` were missing from
  bracket matching entirely; added folding markers and indent rules.
- Real unit tests (`stringUtils`, `blockKeywords`) - none of the four
  prior codebases had tests beyond an unmodified scaffold placeholder.

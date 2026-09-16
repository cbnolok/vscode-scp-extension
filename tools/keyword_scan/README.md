# Keyword scanner - maintenance guide

`scan_keywords.py` scans a SphereServer-X (Source-X) engine checkout for
every script-facing keyword it can find (properties, functions, triggers,
control keywords, commands, expression functions...) and diffs them
against the extension's current keyword data, so a human can review what
changed and update descriptions accordingly.

**This is a manual, occasional tool. It is never run as part of a build,
and nothing it produces is applied automatically.** A prior fork's
approach (regenerating its data file wholesale on every run from a wiki
scrape) silently destroyed hand-written description text its own
generator couldn't reproduce - see the divergence-report workflow below
for why we don't do that.

## The two-step pipeline

1. **`scan_keywords.py`** - scans the engine source, diffs against the
   extension's current `../../src/keywordData.ts`, writes
   `output/scan_raw.csv` and `output/divergence_report.csv` for review.
2. **`compile_keyword_data.py`** - (re-)bootstraps `keywordData.ts` from a
   `scan_raw.csv`. This is what generated the current `keywordData.ts` in
   the first place. Re-running it wholesale would blow away any hand
   edits made since (translated descriptions, manually reclassified
   `unclassified` entries) - treat it as a one-time bootstrap tool, not
   something to re-run casually. Ongoing maintenance is: run
   `scan_keywords.py`, review `divergence_report.csv`, hand-edit
   `keywordData.ts` for the rows you accept.

## Running the scanner

```
python3 scan_keywords.py \
  --source /path/to/Source-X/src \
  --baseline ../../src/keywordData.ts \
  --out ./output
```

`--source` must point at the engine's `src/` directory (the one containing
`tables/`, `game/`, `common/`, ...). `--baseline` is `keywordData.ts` (the
compiled bucket arrays of `{ name, description, sourceClass }` - see
`parse_baseline()`, which is written for *this* schema specifically, not
any other extension's data format). The script prints the git commit of
the source checkout it scanned - **note that commit hash somewhere**
(issue/PR description, commit message) when you act on a report, so a
future run can tell what's changed since. Last known-good run: commit
`7e46c5aeb62ec1e0f8d9b1aa8c2c4095cd95eb20`.

## Output

- **`scan_raw.csv`** - every keyword found this run: `name, category,
  source_class, source_file, source_line, comment`. Reference data, not
  meant to be read top-to-bottom.
- **`divergence_report.csv`** - the actual review artifact, one row per
  difference from the baseline. Every row also carries `comment_is_doxygen`
  (`True`/`False`) - whether `scanned_comment` was tagged `///`/`//!` (see
  the language/description policy below):
  - `NEW` - keyword the scanner found but the baseline doesn't have. Add it.
  - `NOT_FOUND_IN_SCAN` - baseline keyword the scanner didn't find this run.
    **Read this as "the scanner didn't find it," not "the engine removed
    it."** Coverage is heuristic (see below) - check the known-gaps list
    before assuming something was actually removed from the engine.
  - `DESCRIPTION_AVAILABLE` - keyword exists in the baseline without a
    description, and the source has a **Doxygen-tagged** (`///`/`//!`)
    comment next to it - ready to use as description text (still worth a
    read before pasting it in).
  - `DESCRIPTION_DIFF` - keyword has a baseline description AND a Doxygen
    source comment differs from it. Deliberately not auto-applied: the
    baseline description is very often better prose than the raw source
    comment (expanded, corrected) - review before overwriting.
  - `COMMENT_AVAILABLE_NON_DOXYGEN` - keyword has a plain `//` comment next
    to it in the source. This is **not** usable as description text as-is
    (see the policy below) - it's shown only as context for writing a real,
    hand-authored description; never copy it in verbatim.

## How to review a report

There's no separate curated master file - `../../src/keywordData.ts` **is**
the master copy (and what the extension actually imports at runtime, via
`knowledgeBase.ts`). Reviewing a report means: open `divergence_report.csv`,
decide row by row what to do, and edit `keywordData.ts` directly:

1. `NEW` rows → add a `{ name, description, sourceClass }` entry to the
   right bucket array (see `compile_keyword_data.py`'s `classify()` and the
   special-cased `sourceClass` checks right above it in `main()` for which
   bucket a given `sourceClass` maps to - `itemProperties`/`charProperties`/
   `servProperties` for anything object-prefix-accessed, `regionProperties`
   for `REGION.xxx`, `definitionProperties` for a keyword set one-per-line
   inside a definition section body (`[SPELL]`, `[SKILL]`, `[DIALOG]`, ...),
   `unclassified` if none of those fit).
2. `DESCRIPTION_AVAILABLE` / `DESCRIPTION_DIFF` → rewrite the Doxygen source
   comment into a proper English sentence (see policy below) and set it as
   that entry's `description`, or leave the existing one as-is if it's
   already better. `COMMENT_AVAILABLE_NON_DOXYGEN` rows never get pasted in
   directly - read the comment for context, then write the description
   yourself; if you're not confident what the keyword does, leave it blank
   rather than guess.
3. `NOT_FOUND_IN_SCAN` → check the file/line it last came from (in a
   previous `scan_raw.csv`, or `git log -S<name>` on the engine repo)
   before removing anything from `keywordData.ts`. Not every gap is real -
   see the known-gaps list below.
4. Not every `NEW`/`unclassified` row is worth keeping - some `scan_raw.csv`
   noise slips through the content-shape heuristic (e.g. C++ method names,
   file extensions, phrases with spaces, all caught inside an otherwise-real
   table's initializer). `compile_keyword_data.py` already rejects anything
   not matching `^[A-Za-z_][A-Za-z0-9_.]*$` as a name, but use judgment on
   what's left too.

## Description/comment language and sourcing policy

**All descriptions and comments added to the extension's data - hover
text, property/trigger/section descriptions, code comments in the scanner
or the extension itself - must be English only.** No French or any other
language, in new content or in translations of existing content.

**Prefer a hand-written description over anything lifted from the C++
source.** A plain `// ...` comment in the engine source is a note from one
engine contributor to another (implementation detail, a `TODO`, a version
tag) - it isn't written for a scripter and usually reads poorly as hover
text. The scanner (`scan_keywords.py`) only ever treats a **Doxygen-tagged**
comment (`///`, `//!`, or their `///<`/`//!<` member-doc forms) as a
candidate description; a plain `//` comment is still captured (visible in
`divergence_report.csv` as `COMMENT_AVAILABLE_NON_DOXYGEN`, and in
`scan_raw.csv`'s `comment_is_doxygen` column) purely as context for a human
writing the real description, never as text to paste in directly. This is
enforced in `compile_keyword_data.py`'s `clean_comment()` too, for the rare
case of re-bootstrapping from scratch.

Most entries currently have an empty `description` (no confident,
hand-written text has been added yet); that's an honest gap to fill via
this workflow, not something to paper over with a guessed or
machine-translated description. A small number of `sectionKeywords`/
`expressionFunctions`/`commands` entries still carry a description sourced
from a plain (non-Doxygen) comment from before this policy was written down
- they were kept because they read fine as user-facing text, not because
the policy doesn't apply to them; don't use them as a precedent for adding
more the same way.

## Coverage: what the scanner catches, and how to extend it

**`src/tables/*.tbl`**: always scanned, every file. This is the clean,
centralized case (the classic `#define ADD(a,b) ...` X-macro trick) and
needs no maintenance - if the engine adds a new `.tbl` file, it's picked
up automatically. `defmessages.tbl` and `classnames.tbl` are scanned but
excluded from the diff (not comparable to any baseline category; see
`TBL_DIFF_EXCLUDE` in the script) - counts still show in the console output.

**Everywhere else (`.cpp`/`.h`)**: the whole tree is walked automatically
- there is no per-file list to maintain when new source files are added.
Two things *do* need maintainer attention:

1. **`EXCLUDE_DIRS`** at the top of the script skips `common/sqlite`,
   `common/crypto`, `common/crashdump`, and `network` - engine plumbing
   that only produces noise (SQL keyword lists, crypto constants). If a
   subsystem under one of these later grows genuine script-facing keyword
   tables, remove it from that list. Similarly, `compile_keyword_data.py`'s
   `EXCLUDE_SOURCE_CLASSES` drops whole source classes post-scan for the
   same reason - e.g. `CUOInstall`, whose "table" is actually a list of
   client `.mul`/`.idx` filenames, not script keywords, but happens to match
   the shape heuristic below.

2. **The detection heuristic itself.** It does not match on a naming
   convention (Sphere isn't consistent - `sm_sz...`, `sm_ptc...`,
   `s_ptc...`, or no prefix at all all occur), it matches on *shape*:
   any `identifier[optional size] = { ... }` initializer whose body is
   mostly short, space-free, quoted tokens (`IDENTIFIER_LIKE_RE`,
   `MIN_TABLE_ENTRIES`, `MIN_KEYWORD_SHAPE_RATIO` in the script). This
   will **not** catch a keyword table implemented as a `std::map`
   initializer, a chain of `if (!strcmpi(...))` comparisons, or a table
   assembled at runtime rather than as a static initializer. If a
   `NOT_FOUND_IN_SCAN` row turns out to be one of these, that's a gap in
   the heuristic, not a stale baseline entry - fix the script, don't just
   patch the data.

### Known gaps (current source-x checkout)

As of commit `7e46c5aeb62ec1e0f8d9b1aa8c2c4095cd95eb20`, these baseline
entries are legitimate scanner gaps rather than removed keywords - update
this list as gaps get fixed or new ones are found:

- `BC`, `CHUNK`, `MUSIC`, `PROPS`, `HEALING` - these appeared in an older,
  pre-consolidation data source (a prior fork's hand-collected/wiki data,
  not this scanner) but were not found anywhere in this engine checkout -
  not as a static table entry, not as an `IsKey("...")`/`strcmpi` dispatch,
  nothing (`grep -rw` across the whole `src/` tree, case-sensitive, turns up
  nothing but unrelated substrings, e.g. `PEACEMAKING_...` message text for
  `MUSIC`). Deliberately **not** added to `keywordData.ts`: they may be
  aliases or commands from an older Sphere version this checkout no longer
  has. Don't add them back without confirming what target engine version
  they're for.
- `DEFMESSAGE`, `EOF` (section keywords) - sentinel/special-cased section
  types, not present in `CResourceHolder::sm_szResourceBlocks` itself
  (`DEFMESSAGE` is special-cased in `CServerConfig.cpp`'s resource-section
  dispatch; `EOF` is checked directly in `CScript.cpp`'s section-header
  parser and stops parsing when seen). Added by hand, `sourceClass`
  `CServerConfig`/`CScript` respectively, since the scanner's static-table
  heuristic can't and won't find either.
- `TEST`, `TESTIF` - not item/char properties as the old data implied;
  they're line keywords used inside a `[SKILLMENU]`/menu-style section body
  (`game/clients/CClientUse.cpp`, alongside `ON`/`MAKEITEM`), gating the
  option(s) that follow on a skill/resource check or a script expression.
  Added by hand to `controlKeywords`, `sourceClass` `CClientUse`.
- Source classes the scanner finds but that aren't accessed via
  `object.property` syntax at all - `CDialogDef`, `CSpellDef`, `CSkillDef`,
  `CSkillClassDef`, `CRandGroupDef`, `CWebPageDef`, `CCChampionDef`,
  `CRegionResourceDef` - are bucketed into `definitionProperties` (keywords
  set one per line inside a definition section body: `[SPELL]`, `[SKILL]`,
  `[DIALOG]`, `[WEBPAGE]`, `[CHAMPION]`, a region's `[REGIONRESOURCE]`
  block). `CRegion` is a real dot-accessible prefix (`REGION.xxx`, verified
  against `CRegion`'s own reference-dispatch code) and gets its own
  `regionProperties` bucket instead. See `compile_keyword_data.py`'s
  `DEFINITION_PROPERTY_CLASSES` and the `source_class == 'CRegion'` check.

Also expect a low rate of false positives in `scan_raw.csv` - e.g. an
unrelated error-message string, a qualified C++ method name
(`CItemMulti::r_Write`), a file extension (`.BMP`), or a space-containing
phrase (`"DROP ALL"`) caught inside an otherwise-real table's initializer.
`compile_keyword_data.py`'s name-format check filters most of this out
before it reaches `keywordData.ts` (so it'll show up as a `NEW` row you can
just ignore), but not all of it - use judgment. This is expected and
acceptable: the report is reviewed by a human, not consumed automatically.

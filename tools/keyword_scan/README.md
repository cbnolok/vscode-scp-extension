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
  difference from the baseline:
  - `NEW` - keyword the scanner found but the baseline doesn't have. Add it.
  - `NOT_FOUND_IN_SCAN` - baseline keyword the scanner didn't find this run.
    **Read this as "the scanner didn't find it," not "the engine removed
    it."** Coverage is heuristic (see below) - check the known-gaps list
    before assuming something was actually removed from the engine.
  - `DESCRIPTION_AVAILABLE` - keyword exists in the baseline without a
    description, and the source has an inline `//` comment next to it.
    Candidate description text, not a ready-to-use one - the comment is
    often a terse engine-dev note, not user-facing prose.
  - `DESCRIPTION_DIFF` - keyword has a baseline description AND the source
    comment differs. Deliberately not auto-applied: the baseline
    description is very often better prose than the raw source comment
    (translated, expanded, corrected) - review before overwriting.

## How to review a report

There's no separate curated master file - `../../src/keywordData.ts` **is**
the master copy (and what the extension actually imports at runtime, via
`knowledgeBase.ts`). Reviewing a report means: open `divergence_report.csv`,
decide row by row what to do, and edit `keywordData.ts` directly:

1. `NEW` rows → add a `{ name, description, sourceClass }` entry to the
   right bucket array (see `compile_keyword_data.py`'s `classify()` for
   which bucket a given `sourceClass` maps to - `itemProperties`/
   `charProperties`/`servProperties` for anything object-prefix-accessed,
   `unclassified` if none of those fit).
2. `DESCRIPTION_AVAILABLE` / `DESCRIPTION_DIFF` → rewrite the source
   comment into a proper English sentence (see policy below) and set it as
   that entry's `description`, or leave the existing one as-is if it's
   already better (raw C++ comments are often terse engine-dev notes, not
   user-facing prose - don't paste them in verbatim without a look).
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

## Description/comment language policy

**All descriptions and comments added to the extension's data - hover
text, property/trigger/section descriptions, code comments in the scanner
or the extension itself - must be English only.** No French or any other
language, in new content or in translations of existing content.

`keywordData.ts` was bootstrapped straight from English inline C++ comments
in the engine source (never from a prior fork's wiki-scraped, partly-French
data), so it starts clean - keep it that way. Most entries currently have
an empty `description` (no usable source comment existed); that's an
honest gap to fill via this workflow, not something to paper over with a
guessed or machine-translated description.

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
   tables, remove it from that list.

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

- `BC`, `CHUNK`, `MUSIC`, `PROPS` (commands) - not found in any static
  initializer the scanner recognizes; likely dispatched some other way.
- `DEFMESSAGE`, `EOF` (section keywords) - sentinel/special-cased section
  types, not present in `CResourceHolder::sm_szResourceBlocks` itself.
- `HEALING`, `TEST`, `TESTIF` (item/char properties) - not found; worth a
  manual `grep` in the engine source before assuming removal.

Also expect a low rate of false positives in `scan_raw.csv` - e.g. an
unrelated error-message string, a qualified C++ method name
(`CItemMulti::r_Write`), a file extension (`.BMP`), or a space-containing
phrase (`"DROP ALL"`) caught inside an otherwise-real table's initializer.
`compile_keyword_data.py`'s name-format check filters most of this out
before it reaches `keywordData.ts` (so it'll show up as a `NEW` row you can
just ignore), but not all of it - use judgment. This is expected and
acceptable: the report is reviewed by a human, not consumed automatically.

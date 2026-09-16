#!/usr/bin/env python3
"""
Scans a SphereServer-X (Source-X) C++ checkout for script-facing keyword
tables (properties, functions, triggers, control keywords, commands,
expression functions...) and diffs them against the vscode-scp-extension's
current autocompleteData.ts baseline.

Two categories of source are scanned:

  1. src/tables/*.tbl - the clean case. Consumed via the classic X-macro
     trick: `#define ADD(a,b) ...` + two #includes of the same .tbl file
     (once to emit an enum, once to emit the matching string). Each line
     is `ADD(NAME, "STRING")` or `ADD(NAME)`.

  2. Everywhere else (.cpp/.h) - per-class keyword tables hand-written as
     class static members, e.g. `lpctstr const Class::sm_szLoadKeys[N] =
     { "A", "B", ... };`. Sphere's naming for these isn't consistent
     (sm_sz..., sm_ptc..., s_ptc..., or no prefix at all), so this does
     NOT match on a name pattern. Instead it looks for the *shape* of any
     initializer - `[qualified-]identifier[optional size] = { ... }` -
     and then decides whether the body is a keyword table by its content:
     >= MIN_TABLE_ENTRIES quoted entries, >= MIN_KEYWORD_SHAPE_RATIO of
     them looking like a single identifier token (no spaces - rules out
     prose/help text/paths). This also covers the common case where the
     array is *declared* `static ... x[];` in a .h and only *defined*
     (with the actual strings) in a .cpp - it never needs to see a
     matching enum or declaration, only the initializer with the strings
     in it. Fine to under- or slightly over-match (this feeds a
     human-reviewed report, not a runtime pipeline) - see README.md for
     the current known coverage gaps.

Output (written to --out):
  scan_raw.csv         every keyword this run found, with provenance
  divergence_report.csv  the diff against the baseline, for manual triage

This script is meant to be run occasionally by hand, never as part of a
build. Nothing it produces is auto-applied to the extension's data files.
"""
import argparse
import csv
import os
import re
import subprocess
import sys
from collections import defaultdict

# Directories under `src/` that are engine plumbing, not script-facing,
# and produce only noise (SQL keyword tables, crypto constants, etc.)
EXCLUDE_DIRS = {
    os.path.join("common", "sqlite"),
    os.path.join("common", "crypto"),
    os.path.join("common", "crashdump"),
    "network",
}

# .tbl files that are not script keyword tables in the sense the extension
# cares about (or are too large to usefully diff row-by-row). Still scanned
# and written to scan_raw.csv, just excluded from the divergence report.
TBL_DIFF_EXCLUDE = {"defmessages.tbl", "classnames.tbl"}

STRING_LINE_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')
ADD_STR_RE = re.compile(r'ADD(?:PROP)?\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*"((?:[^"\\]|\\.)*)"')
ADD_BARE_RE = re.compile(r'ADD\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)')

# Doxygen-style trailing comments (///, //!, and their "///<"/"//!<" member-
# doc forms) vs. a plain "//" comment. This distinction matters: plain "//"
# comments in this codebase are contributor notes ("// static", "// TODO"),
# not user-facing prose, so only a Doxygen-tagged comment is ever offered as
# description text - see the language policy in README.md. Block-comment
# Doxygen forms (/** ... */, /*! ... */) are not handled: none were found
# anywhere near a keyword table as of the commit this was written against
# (see README.md), so it wasn't worth the complexity - revisit if that changes.
DOXYGEN_TRAILING_RE = re.compile(r'^\s*//([/!])<?\s*(.*)$')
PLAIN_TRAILING_RE = re.compile(r'^\s*//\s*(.*)$')


def parse_trailing_comment(rest):
    """rest: the text of a line after the token being commented. Returns
    (comment_text, is_doxygen)."""
    m = DOXYGEN_TRAILING_RE.match(rest)
    if m:
        return m.group(2).strip(), True
    m = PLAIN_TRAILING_RE.match(rest)
    if m:
        return m.group(1).strip(), False
    return '', False

# Sphere's static keyword tables don't follow one consistent naming
# convention (sm_sz..., sm_ptc..., or no prefix at all), so instead of
# matching a name pattern this looks for the *shape* of an initializer:
# "[qualified-]identifier[optional size] = {" - then decides whether the
# body looks like a keyword table by its content (see IDENTIFIER_LIKE_RE
# below), not by how the variable was named. This also naturally covers
# the case where the array is declared `static ... x[];` in a .h and
# only defined (with the actual strings) in a .cpp, since it doesn't
# need to see a matching enum/declaration at all.
INIT_RE = re.compile(
    # "= {" with optional whitespace, and tolerating one trailing "// ..."
    # line comment in between (e.g. "sm_szResourceBlocks[RES_QTY] =\t// static\n{").
    r'([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)?)\s*(?:\[[^\]\n]*\])?\s*=\s*(?://[^\n]*\n\s*)?\{'
)
IDENTIFIER_LIKE_RE = re.compile(r'^[A-Za-z0-9_.]{1,40}$')
MIN_TABLE_ENTRIES = 3
MIN_KEYWORD_SHAPE_RATIO = 0.8


def find_matching_brace(text, open_pos, open_ch='{', close_ch='}', track_char_literal=True):
    """Given the index of an opening brace, return the index just past its
    matching closing brace. Ignores braces inside string literals (and, for
    C++ source, char literals). `track_char_literal` must be False for
    prose text (e.g. French comments), where a lone apostrophe is not a
    char-literal delimiter and would otherwise desync the tracker."""
    depth = 0
    i = open_pos
    n = len(text)
    in_str = False
    in_char = False
    while i < n:
        c = text[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                in_str = False
        elif in_char:
            if c == '\\':
                i += 2
                continue
            if c == "'":
                in_char = False
        else:
            if c == '"':
                in_str = True
            elif track_char_literal and c == "'":
                in_char = True
            elif c == open_ch:
                depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    return i + 1
        i += 1
    return -1


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def parse_string_array(body):
    """body: text between array's { and }. Returns list of (string, comment,
    is_doxygen) in order. Handles both one-entry-per-line tables (the common
    case in this codebase) and short arrays written on a single line - a
    trailing comment on a line is attached to the last entry on that line."""
    out = []
    for raw_line in body.split('\n'):
        matches = list(STRING_LINE_RE.finditer(raw_line))
        if not matches:
            continue
        rest = raw_line[matches[-1].end():]
        comment, is_doxygen = parse_trailing_comment(rest)
        for i, sm in enumerate(matches):
            last = i == len(matches) - 1
            out.append((sm.group(1), comment if last else '', is_doxygen if last else False))
    return out


def scan_tbl_file(path, rows):
    fname = os.path.basename(path)
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()

    if fname.endswith('_props.tbl'):
        category, source_class = 'property', fname[:-len('_props.tbl')]
    elif fname.endswith('_functions.tbl'):
        category, source_class = 'function', fname[:-len('_functions.tbl')]
    elif fname == 'triggers.tbl':
        category, source_class = 'trigger', ''
    elif fname == 'classnames.tbl':
        category, source_class = 'classname', ''
    elif fname == 'defmessages.tbl':
        category, source_class = 'defmessage', ''
    else:
        category, source_class = 'tbl_other', fname

    for lineno, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith('//'):
            continue
        m = ADD_STR_RE.search(line)
        if m:
            name, value = m.group(1), m.group(2)
        else:
            m = ADD_BARE_RE.search(line)
            if not m:
                continue
            name, value = m.group(1), m.group(1)
        comment, is_doxygen = parse_trailing_comment(line[m.end():])
        rows.append({
            'name': value,
            'category': category,
            'source_class': source_class,
            'source_file': os.path.relpath(path, start=SRC_ROOT),
            'source_line': lineno,
            'comment': comment,
            'comment_is_doxygen': is_doxygen,
        })


def scan_cpp_h_file(path, rows):
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()

    file_class_name = os.path.splitext(os.path.basename(path))[0]
    rel = os.path.relpath(path, start=SRC_ROOT)

    for m in INIT_RE.finditer(text):
        open_pos = m.end() - 1
        close_pos = find_matching_brace(text, open_pos)
        if close_pos == -1:
            continue
        entries = parse_string_array(text[open_pos + 1:close_pos - 1])
        if len(entries) < MIN_TABLE_ENTRIES:
            continue

        keyword_shaped = sum(1 for v, _, _ in entries if IDENTIFIER_LIKE_RE.match(v))
        if keyword_shaped / len(entries) < MIN_KEYWORD_SHAPE_RATIO:
            continue  # looks like prose / paths / message text, not a keyword table

        ident = m.group(1)
        if '::' in ident:
            source_class, category = ident.split('::', 1)
        else:
            source_class, category = file_class_name, ident

        lineno = line_of(text, m.start())
        for value, comment, is_doxygen in entries:
            rows.append({
                'name': value,
                'category': category,
                'source_class': source_class,
                'source_file': rel,
                'source_line': lineno,
                'comment': comment,
                'comment_is_doxygen': is_doxygen,
            })


def walk_source(src_root):
    rows = []
    tables_dir = os.path.join(src_root, 'tables')
    if os.path.isdir(tables_dir):
        for fname in sorted(os.listdir(tables_dir)):
            if fname.endswith('.tbl'):
                scan_tbl_file(os.path.join(tables_dir, fname), rows)

    for root, dirs, files in os.walk(src_root):
        rel_root = os.path.relpath(root, src_root)
        if rel_root == 'tables':
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if os.path.join(rel_root, d) not in EXCLUDE_DIRS and rel_root not in EXCLUDE_DIRS]
        if rel_root in EXCLUDE_DIRS or any(rel_root.startswith(ex + os.sep) for ex in EXCLUDE_DIRS):
            continue
        for fname in files:
            if fname.endswith('.cpp') or fname.endswith('.h'):
                scan_cpp_h_file(os.path.join(root, fname), rows)
    return rows


# --- Baseline (src/keywordData.ts, compiled by compile_keyword_data.py) ---
#
# Note: this is NOT the same schema as the Prapilk fork's autocompleteData.ts
# (plain name arrays + separate *_descriptions dicts). keywordData.ts holds
# one array of { name, description, sourceClass } objects per bucket - see
# compile_keyword_data.py. If you're diffing against a pre-consolidation
# autocompleteData.ts for some reason, this parser won't understand it.

BUCKET_KEYS = [
    'itemProperties', 'charProperties', 'servProperties', 'triggers',
    'sectionKeywords', 'controlKeywords', 'expressionFunctions',
    'commands', 'regionProperties', 'definitionProperties', 'unclassified',
]

ENTRY_RE = re.compile(
    r'\{\s*name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*description:\s*"((?:[^"\\]|\\.)*)"\s*,\s*sourceClass:\s*"((?:[^"\\]|\\.)*)"\s*\}'
)


def extract_block(text, key, open_ch='{', close_ch='}'):
    m = re.search(r'\b' + re.escape(key) + r'\s*:\s*\[?\s*' + re.escape(open_ch), text)
    if not m:
        # try without requiring the exact open_ch right after (array case: "key: [")
        m = re.search(r'\b' + re.escape(key) + r'\s*:\s*(\[|\{)', text)
        if not m:
            return None
        open_ch = m.group(1)
        close_ch = ']' if open_ch == '[' else '}'
    open_pos = text.index(open_ch, m.start())
    close_pos = find_matching_brace(text, open_pos, open_ch, close_ch, track_char_literal=False)
    if close_pos == -1:
        return None
    return text[open_pos + 1:close_pos - 1]


def parse_baseline(ts_path):
    with open(ts_path, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()

    root = extract_block(text, 'keywordData')
    if root is None:
        root = text  # fall back to scanning the whole file

    arrays = {}
    descriptions = {}
    for key in BUCKET_KEYS:
        block = extract_block(root, key, open_ch='[', close_ch=']')
        names = set()
        if block:
            for name, description, _source_class in ENTRY_RE.findall(block):
                upper = name.upper()
                names.add(upper)
                if description and upper not in descriptions:
                    descriptions[upper] = description
        arrays[key] = names

    return arrays, {'descriptions': descriptions}


# --- Diff --------------------------------------------------------------

def build_diff(scan_rows, baseline_arrays, baseline_dicts):
    known_names = set()
    name_to_baseline_categories = defaultdict(set)
    for key in BUCKET_KEYS:
        for n in baseline_arrays.get(key, ()):
            known_names.add(n)
            name_to_baseline_categories[n].add(key)

    all_descriptions = dict(baseline_dicts.get('descriptions', {}))

    diff_rows = []
    scanned_names_upper = set()

    for row in scan_rows:
        if row['category'] in ('defmessage', 'classname'):
            continue
        name_upper = row['name'].upper()
        scanned_names_upper.add(name_upper)

        if name_upper not in known_names:
            diff_rows.append({
                'change_type': 'NEW',
                'name': row['name'],
                'category': row['category'],
                'source_class': row['source_class'],
                'source_file': row['source_file'],
                'source_line': row['source_line'],
                'baseline_categories': '',
                'scanned_comment': row['comment'],
                'comment_is_doxygen': row['comment_is_doxygen'],
                'baseline_description': '',
            })
            continue

        baseline_desc = all_descriptions.get(name_upper, '')
        if row['comment'] and row['comment'] != baseline_desc:
            # Only a Doxygen-tagged comment (///, //!) is ever a candidate to
            # become description text - a plain "//" comment is a contributor
            # note, not user-facing prose (see README.md). Non-Doxygen diffs
            # are still reported, just under a type that makes clear they're
            # context for a human-written description, not a ready one.
            if row['comment_is_doxygen']:
                change_type = 'DESCRIPTION_DIFF' if baseline_desc else 'DESCRIPTION_AVAILABLE'
            else:
                change_type = 'COMMENT_AVAILABLE_NON_DOXYGEN'
            diff_rows.append({
                'change_type': change_type,
                'name': row['name'],
                'category': row['category'],
                'source_class': row['source_class'],
                'source_file': row['source_file'],
                'source_line': row['source_line'],
                'baseline_categories': '|'.join(sorted(name_to_baseline_categories[name_upper])),
                'scanned_comment': row['comment'],
                'comment_is_doxygen': row['comment_is_doxygen'],
                'baseline_description': baseline_desc,
            })

    for name_upper in sorted(known_names - scanned_names_upper):
        diff_rows.append({
            'change_type': 'NOT_FOUND_IN_SCAN',
            'name': name_upper,
            'category': '',
            'source_class': '',
            'source_file': '',
            'source_line': '',
            'baseline_categories': '|'.join(sorted(name_to_baseline_categories[name_upper])),
            'scanned_comment': '',
            'comment_is_doxygen': False,
            'baseline_description': all_descriptions.get(name_upper, ''),
        })

    return diff_rows


def main():
    global SRC_ROOT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', required=True, help='Path to Source-X src/ root')
    ap.add_argument('--baseline', required=True, help='Path to autocompleteData.ts')
    ap.add_argument('--out', required=True, help='Output directory')
    args = ap.parse_args()

    SRC_ROOT = os.path.abspath(args.source)
    os.makedirs(args.out, exist_ok=True)

    try:
        commit = subprocess.check_output(
            ['git', '-C', os.path.dirname(SRC_ROOT), 'rev-parse', 'HEAD'],
            text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        commit = 'unknown'

    print(f'Scanning {SRC_ROOT} (commit {commit}) ...')
    scan_rows = walk_source(SRC_ROOT)
    print(f'  {len(scan_rows)} keyword rows found')

    by_category = defaultdict(int)
    for r in scan_rows:
        by_category[r['category']] += 1
    for cat, n in sorted(by_category.items(), key=lambda kv: -kv[1])[:15]:
        print(f'    {n:5d}  {cat}')

    raw_path = os.path.join(args.out, 'scan_raw.csv')
    with open(raw_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['name', 'category', 'source_class', 'source_file', 'source_line', 'comment', 'comment_is_doxygen'])
        w.writeheader()
        w.writerows(scan_rows)
    print(f'Wrote {raw_path}')

    print(f'Parsing baseline {args.baseline} ...')
    baseline_arrays, baseline_dicts = parse_baseline(args.baseline)
    for key in BUCKET_KEYS:
        print(f'    {len(baseline_arrays.get(key, ())):5d}  {key}')
    print(f'    {len(baseline_dicts.get("descriptions", {})):5d}  entries with a description')

    diff_rows = build_diff(scan_rows, baseline_arrays, baseline_dicts)
    diff_by_type = defaultdict(int)
    for r in diff_rows:
        diff_by_type[r['change_type']] += 1
    print('Divergences:')
    for t, n in sorted(diff_by_type.items(), key=lambda kv: -kv[1]):
        print(f'    {n:5d}  {t}')

    diff_path = os.path.join(args.out, 'divergence_report.csv')
    with open(diff_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=[
            'change_type', 'name', 'category', 'source_class', 'source_file',
            'source_line', 'baseline_categories', 'scanned_comment', 'comment_is_doxygen',
            'baseline_description',
        ])
        w.writeheader()
        w.writerows(diff_rows)
    print(f'Wrote {diff_path}')
    print(f'(source-x commit: {commit})')


if __name__ == '__main__':
    main()

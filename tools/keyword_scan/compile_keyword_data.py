#!/usr/bin/env python3
"""
Compiles scan_raw.csv (from scan_keywords.py) into keywordData.ts, the
extension's actual runtime keyword data - buckets every scanned keyword
by the SphereScript object prefix it's accessed through (item/char/serv),
or into a handful of special buckets for things that aren't accessed via
object.property syntax at all (triggers, section keywords, control-flow
keywords, expression functions, console commands).

Descriptions are taken ONLY from a Doxygen-tagged inline C++ comment
(///, //!, or their ///<///!< forms - see scan_keywords.py's
comment_is_doxygen) that the scanner already captured (already English,
straight from the engine source) - this script does not write, translate,
or otherwise invent any prose itself, and it never uses a plain "//"
comment, which is a contributor note rather than user-facing text. Entries
with no usable comment simply get an empty description; that's an honest
gap, meant to be filled by hand (see tools/keyword_scan/README.md), not
papered over with a guess.

This is a one-time bootstrap compile, not a build step - see
tools/keyword_scan/README.md for why the ongoing workflow is manual
review of divergence_report.csv, not blind regeneration.
"""
import csv
import re
import sys
from collections import defaultdict

# Classes attributed to each script-side object prefix bucket, matched by
# substring against source_class (mirrors, and extends, the heuristic the
# Prapilk fork's parser.py used). CObjBase/CBaseBaseDef are the common
# ancestor of both items and chars, so they feed both buckets.
# CPointBase (position/coordinate accessors) and CContainer (container
# content accessors) are valid on both items and chars, like CObjBase.
BOTH_ITEM_AND_CHAR = ['CObjBase', 'CBaseBaseDef', 'CPointBase', 'CContainer']
CHAR_CLASSES = ['CChar', 'CClient', 'CStoneMember', 'CParty', 'CAccount', 'CCPropsChar']
# CCPropsItem* (equippable/weapon/ranged-weapon property components),
# CCMultiMovable (ship verbs) and CCChampion (live champion-spawn verbs,
# not to be confused with CCChampionDef below) are all item-side.
ITEM_CLASSES = ['CItem', 'CCPropsItem', 'CCMultiMovable', 'CCChampion']
SERV_CLASSES = ['CServer', 'CSector', 'CSFileObj', 'CDataBase', 'CWorld', 'CGMPage']

# Internal engine subsystems that showed up in the scan but are not
# script-facing at all - drop entirely rather than dumping into
# "unclassified" for review. CUOInstall is client .mul/.idx *filenames*
# (anim.mul, gumpart.mul, ...), not script keywords - a scanner false
# positive caught by their content shape, not a naming pattern.
EXCLUDE_SOURCE_CLASSES = {'UnixTerminal', 'ProfileData', 'CServerTime', 'CUOInstall'}

# Categories from the .tbl scan that aren't script keyword data.
EXCLUDE_CATEGORIES = {'classname', 'defmessage'}

# Source classes whose keywords are section-body properties (set one per
# line inside a definition block: [SPELL], [SKILL], [DIALOG], ...) rather
# than accessed as object.property - not one of the object-prefix buckets,
# but still real, still worth surfacing (general completion fallback).
DEFINITION_PROPERTY_CLASSES = {
    'CDialogDef', 'CSpellDef', 'CSkillDef', 'CSkillClassDef',
    'CRandGroupDef', 'CWebPageDef', 'CCChampionDef', 'CRegionResourceDef',
}

MIN_COMMENT_LEN = 3


def classify(source_class):
    if any(c in source_class for c in BOTH_ITEM_AND_CHAR):
        return ('item_properties', 'char_properties')
    if any(c in source_class for c in ITEM_CLASSES):
        return ('item_properties',)
    if any(c in source_class for c in CHAR_CLASSES):
        return ('char_properties',)
    if any(c in source_class for c in SERV_CLASSES):
        return ('serv_properties',)
    return None


def clean_comment(comment, is_doxygen):
    # Only a Doxygen-tagged comment is ever usable as description text - a
    # plain "//" comment is a contributor note, not user-facing prose (see
    # tools/keyword_scan/README.md's language/description policy).
    if not is_doxygen:
        return ''
    comment = comment.strip()
    if len(comment) < MIN_COMMENT_LEN:
        return ''
    # Drop comments that are just a repeat of a preprocessor/version tag
    # or pure punctuation - not useful as a description.
    if re.match(r'^[\W_]*$', comment):
        return ''
    return comment


def load_rows(path):
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def main():
    if len(sys.argv) != 3:
        print('usage: compile_keyword_data.py <scan_raw.csv> <out_dir>')
        sys.exit(1)
    raw_path, out_dir = sys.argv[1], sys.argv[2]

    rows = load_rows(raw_path)
    buckets = defaultdict(dict)  # bucket -> {UPPER_NAME: (name, description, source_class)}

    def add(bucket, name, description, source_class):
        key = name.upper()
        existing = buckets[bucket].get(key)
        if existing and existing[1] and not description:
            return  # keep the existing entry if it already has a description
        buckets[bucket][key] = (name, description, source_class)

    for row in rows:
        category = row['category']
        source_class = row['source_class']
        name = row['name']
        is_doxygen = str(row.get('comment_is_doxygen', '')).strip().lower() == 'true'
        comment = clean_comment(row['comment'], is_doxygen)

        if category in EXCLUDE_CATEGORIES:
            continue
        if source_class in EXCLUDE_SOURCE_CLASSES:
            continue
        if not re.match(r'^[A-Za-z_][A-Za-z0-9_.]*$', name):
            continue

        if category == 'trigger':
            add('triggers', name, comment, source_class)
            continue

        if source_class == 'CResourceHolder':
            add('section_keywords', name, comment, source_class)
            continue

        if source_class == 'CScriptObj' and category == 'sm_szScriptKeys':
            add('control_keywords', name, comment, source_class)
            continue

        # CScriptObj_functions.tbl (sm_szLoadKeys) - intrinsic functions
        # available on any script object, same nature as CExpression's.
        if source_class == 'CScriptObj' and category == 'function':
            add('expression_functions', name, comment, source_class)
            continue

        if source_class == 'CExpression':
            add('expression_functions', name, comment, source_class)
            continue

        # Reserved trigger-context variables (ARGN/ARGO/ARGS/ARGV/LOCAL/...) -
        # used bare, like a control keyword, not accessed via object.property.
        if source_class == 'CScriptTriggerArgs':
            add('control_keywords', name, comment, source_class)
            continue

        if category == 'sm_szVerbKeys' and source_class in ('CClient', 'CServer'):
            add('commands', name, comment, source_class)
            continue

        # REGION.xxx - a real dot-accessible object prefix (verified against
        # CRegion's own r_GetRef-style dispatch), not a definition-body
        # property like the classes below.
        if source_class == 'CRegion':
            add('region_properties', name, comment, source_class)
            continue

        # Properties set one per line inside various definition section
        # bodies ([SPELL], [SKILL], [DIALOG], [WEBPAGE], [CHAMPION], a
        # region's [REGIONRESOURCE] block, ...) - not object.property syntax,
        # so they don't belong in item/char/serv_properties, but they're
        # real and worth surfacing (general completion fallback).
        if source_class in DEFINITION_PROPERTY_CLASSES:
            add('definition_properties', name, comment, source_class)
            continue

        targets = classify(source_class)
        if targets:
            for t in targets:
                add(t, name, comment, source_class)
        else:
            add('unclassified', name, comment, source_class)

    order = ['item_properties', 'char_properties', 'serv_properties', 'triggers',
              'section_keywords', 'control_keywords', 'expression_functions',
              'commands', 'region_properties', 'definition_properties', 'unclassified']

    print('Bucket counts (with description coverage):')
    total = 0
    for bucket in order:
        entries = buckets[bucket]
        n = len(entries)
        total += n
        with_desc = sum(1 for _, d, _ in entries.values() if d)
        pct = (with_desc / n * 100) if n else 0
        print(f'  {n:5d}  {bucket:<22} {with_desc:5d} with description ({pct:5.1f}%)')
    print(f'  {total:5d}  TOTAL')

    def ts_literal(s):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

    lines = []
    lines.append('// Generated by tools/keyword_scan/compile_keyword_data.py from a SphereServer-X')
    lines.append('// source scan - see tools/keyword_scan/README.md before editing by hand.')
    lines.append('// Descriptions are sourced only from Doxygen-tagged (///, //!) English inline C++')
    lines.append('// comments in the engine source, never a plain "//" comment (a contributor note,')
    lines.append("// not user-facing prose); many entries have none yet (description: '') - that's an")
    lines.append('// honest gap, fill in by hand via the divergence-report review workflow.')
    lines.append('')
    lines.append('export interface KeywordEntry {')
    lines.append('    name: string;')
    lines.append('    description: string;')
    lines.append('    sourceClass: string;')
    lines.append('}')
    lines.append('')
    lines.append('export interface KeywordData {')
    for bucket in order:
        lines.append(f'    {to_camel(bucket)}: KeywordEntry[];')
    lines.append('}')
    lines.append('')
    lines.append('export const keywordData: KeywordData = {')
    for bucket in order:
        entries = sorted(buckets[bucket].values(), key=lambda e: e[0].upper())
        lines.append(f'    {to_camel(bucket)}: [')
        for name, desc, source_class in entries:
            lines.append(
                f'        {{ name: {ts_literal(name)}, description: {ts_literal(desc)}, '
                f'sourceClass: {ts_literal(source_class)} }},'
            )
        lines.append('    ],')
    lines.append('};')
    lines.append('')

    out_path = f'{out_dir}/keywordData.ts'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'\nWrote {out_path}')


def to_camel(snake):
    parts = snake.split('_')
    return parts[0] + ''.join(p.title() for p in parts[1:])


if __name__ == '__main__':
    main()

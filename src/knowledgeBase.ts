import { keywordData, KeywordEntry } from './keywordData';
import { KnowledgeBase } from './types';

function names(entries: KeywordEntry[]): string[] {
    return entries.map(e => e.name.toUpperCase());
}

/**
 * Builds the flat KnowledgeBase (keywords/properties/events/commands)
 * that diagnostics, code actions and completion's general fallback all
 * consume, out of the bucketed keywordData compiled from the engine
 * source scan. See tools/keyword_scan/README.md for provenance.
 */
export function buildKnowledgeBase(): KnowledgeBase {
    return {
        keywords: new Set(names(keywordData.sectionKeywords)),
        properties: new Set([
            ...names(keywordData.itemProperties),
            ...names(keywordData.charProperties),
            ...names(keywordData.servProperties),
            ...names(keywordData.expressionFunctions),
            ...names(keywordData.unclassified),
        ]),
        events: new Set(names(keywordData.triggers)),
        commands: new Set(names(keywordData.commands)),
    };
}

/** Description lookup, case-insensitive, across every keywordData bucket. */
export function buildDescriptionIndex(): Map<string, string> {
    const index = new Map<string, string>();
    const allBuckets: KeywordEntry[] = [
        ...keywordData.itemProperties,
        ...keywordData.charProperties,
        ...keywordData.servProperties,
        ...keywordData.triggers,
        ...keywordData.sectionKeywords,
        ...keywordData.controlKeywords,
        ...keywordData.expressionFunctions,
        ...keywordData.commands,
        ...keywordData.unclassified,
    ];
    for (const entry of allBuckets) {
        if (!entry.description) {
            continue;
        }
        const key = entry.name.toUpperCase();
        if (!index.has(key)) {
            index.set(key, entry.description);
        }
    }
    return index;
}

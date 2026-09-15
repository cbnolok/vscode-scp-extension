/**
 * Case-insensitive Levenshtein (edit) distance. Single shared implementation -
 * the old codebase had this duplicated three times (extension.ts twice over,
 * codeActions.ts once), all identical.
 */
export function levenshteinDistance(a: string, b: string): number {
    const s1 = a.toUpperCase();
    const s2 = b.toUpperCase();
    const len1 = s1.length;
    const len2 = s2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[len1][len2];
}

/**
 * Finds the closest matches to `value` within `candidates`, sorted by
 * distance, excluding exact matches (distance 0). Used to build "did you
 * mean X?" suggestions for diagnostics and quick fixes.
 */
export function findClosest(value: string, candidates: Iterable<string>, maxDistance: number, limit = 3): string[] {
    const scored: Array<{ candidate: string; distance: number }> = [];
    for (const candidate of candidates) {
        const distance = levenshteinDistance(value, candidate);
        if (distance > 0 && distance <= maxDistance) {
            scored.push({ candidate, distance });
        }
    }
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, limit).map(s => s.candidate);
}

/**
 * Finds a candidate that matches `value` case-insensitively but not
 * byte-for-byte (i.e. only the casing is wrong) - used to offer a
 * higher-confidence "correct the casing" fix before falling back to
 * Levenshtein suggestions.
 */
export function findCaseInsensitiveMatch(value: string, candidates: Iterable<string>): string | null {
    const upper = value.toUpperCase();
    for (const candidate of candidates) {
        if (candidate.toUpperCase() === upper) {
            return candidate;
        }
    }
    return null;
}

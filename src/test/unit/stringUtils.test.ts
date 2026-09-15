import * as assert from 'assert';
import { levenshteinDistance, findClosest, findCaseInsensitiveMatch } from '../../stringUtils';

suite('stringUtils', () => {
    test('levenshteinDistance is 0 for identical strings, case-insensitively', () => {
        assert.strictEqual(levenshteinDistance('ITEMDEF', 'itemdef'), 0);
    });

    test('levenshteinDistance counts a single substitution', () => {
        assert.strictEqual(levenshteinDistance('CHARDEF', 'CHARDEG'), 1);
    });

    test('levenshteinDistance counts insertions/deletions', () => {
        assert.strictEqual(levenshteinDistance('ENDIF', 'ENDIFF'), 1);
        assert.strictEqual(levenshteinDistance('ENDIF', 'ENDI'), 1);
    });

    test('findClosest excludes exact matches and respects maxDistance', () => {
        const candidates = ['ITEMDEF', 'CHARDEF', 'TYPEDEF', 'ITEMDEF2'];
        const result = findClosest('ITEMDE', candidates, 1);
        assert.deepStrictEqual(result, ['ITEMDEF']);
    });

    test('findClosest returns nothing beyond maxDistance', () => {
        assert.deepStrictEqual(findClosest('ZZZZZZZ', ['ITEMDEF'], 2), []);
    });

    test('findClosest sorts by distance and respects the limit', () => {
        const result = findClosest('ENDIF', ['ENDIFX', 'ENDIFXY', 'ENDIFXYZ', 'ENDIFXYZW'], 3, 2);
        assert.deepStrictEqual(result, ['ENDIFX', 'ENDIFXY']);
    });

    test('findCaseInsensitiveMatch finds a casing-only difference', () => {
        assert.strictEqual(findCaseInsensitiveMatch('itemdef', ['ITEMDEF', 'CHARDEF']), 'ITEMDEF');
    });

    test('findCaseInsensitiveMatch returns null when nothing matches', () => {
        assert.strictEqual(findCaseInsensitiveMatch('typedef', ['ITEMDEF', 'CHARDEF']), null);
    });
});

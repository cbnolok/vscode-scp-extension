/**
 * Single source of truth for SphereScript's control-flow block structure.
 * Both diagnostics.ts (block matching) and formatting.ts (indentation)
 * import from here. In the old codebase these two maintained separate,
 * independently hand-typed keyword lists that had drifted apart - the
 * formatter knew about BEGIN/END pairs (used for DOSWITCH case blocks),
 * the structure validator didn't, so a file with mismatched BEGIN/END
 * inside a DOSWITCH would format "correctly" but never get flagged by
 * diagnostics. Fixed here by having exactly one definition.
 */

export const OPENING_KEYWORDS = [
    'IF', 'WHILE', 'FOR', 'FORCHARS', 'FORITEMS', 'FOROBJS', 'FORCONT',
    'FORCONTID', 'FORCONTTYPE', 'FORCHARLAYER', 'FORCHARMEMORYTYPE',
    'FORINSTANCES', 'FORPLAYERS', 'FORCLIENTS', 'DORAND', 'DOSWITCH', 'BEGIN',
] as const;

/** Maps every opening keyword to the keyword that closes it. */
export const CLOSING_FOR: Record<string, string> = {
    IF: 'ENDIF',
    WHILE: 'ENDWHILE',
    FOR: 'ENDFOR',
    FORCHARS: 'ENDFOR',
    FORITEMS: 'ENDFOR',
    FOROBJS: 'ENDFOR',
    FORCONT: 'ENDFOR',
    FORCONTID: 'ENDFOR',
    FORCONTTYPE: 'ENDFOR',
    FORCHARLAYER: 'ENDFOR',
    FORCHARMEMORYTYPE: 'ENDFOR',
    FORINSTANCES: 'ENDFOR',
    FORPLAYERS: 'ENDFOR',
    FORCLIENTS: 'ENDFOR',
    DORAND: 'ENDDO',
    DOSWITCH: 'ENDDO',
    BEGIN: 'END',
};

// ENDRAND/ENDSWITCH aren't CLOSING_FOR's canonical closer for DORAND/DOSWITCH
// (ENDDO is), but the engine accepts all END* keywords interchangeably as a
// block terminator (CScriptObj::OnTriggerRun treats SK_ENDDO/SK_ENDFOR/
// SK_ENDIF/SK_ENDRAND/SK_ENDSWITCH/SK_ENDWHILE identically) - omitting them
// here made a block closed with ENDRAND/ENDSWITCH register as unclosed
// instead of just non-canonical.
export const CLOSING_KEYWORDS = ['ENDIF', 'ENDWHILE', 'ENDFOR', 'ENDDO', 'END', 'ENDRAND', 'ENDSWITCH'] as const;

/** ELSE/ELSEIF/ELIF only make sense directly inside an IF block. */
export const MIDDLE_KEYWORDS = ['ELSE', 'ELSEIF', 'ELIF'] as const;

const OPENING_SET = new Set<string>(OPENING_KEYWORDS);
const CLOSING_SET = new Set<string>(CLOSING_KEYWORDS);
const MIDDLE_SET = new Set<string>(MIDDLE_KEYWORDS);

export function isOpeningKeyword(word: string): boolean {
    return OPENING_SET.has(word.toUpperCase());
}

export function isClosingKeyword(word: string): boolean {
    return CLOSING_SET.has(word.toUpperCase());
}

export function isMiddleKeyword(word: string): boolean {
    return MIDDLE_SET.has(word.toUpperCase());
}

export function getExpectedClosing(openingKeyword: string): string | undefined {
    return CLOSING_FOR[openingKeyword.toUpperCase()];
}

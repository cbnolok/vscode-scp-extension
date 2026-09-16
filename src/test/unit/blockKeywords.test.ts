import * as assert from 'assert';
import {
    isOpeningKeyword,
    isClosingKeyword,
    isMiddleKeyword,
    getExpectedClosing,
} from '../../blockKeywords';

suite('blockKeywords', () => {
    test('recognizes every FOR* variant as an opening keyword', () => {
        for (const kw of ['FOR', 'FORCHARS', 'FORITEMS', 'FOROBJS', 'FORCONT', 'FORCONTID', 'FORCONTTYPE',
            'FORCHARLAYER', 'FORCHARMEMORYTYPE', 'FORINSTANCES', 'FORPLAYERS', 'FORCLIENTS']) {
            assert.ok(isOpeningKeyword(kw), `${kw} should be an opening keyword`);
            assert.strictEqual(getExpectedClosing(kw), 'ENDFOR', `${kw} should close with ENDFOR`);
        }
    });

    test('DORAND and DOSWITCH close with ENDDO', () => {
        assert.strictEqual(getExpectedClosing('DORAND'), 'ENDDO');
        assert.strictEqual(getExpectedClosing('DOSWITCH'), 'ENDDO');
    });

    test('ENDRAND/ENDSWITCH are recognized closers, even though ENDDO is canonical', () => {
        // The engine accepts every END* keyword as an interchangeable block
        // terminator (CScriptObj::OnTriggerRun), so these must still count
        // as *a* closing keyword even though getExpectedClosing() only ever
        // suggests ENDDO for DORAND/DOSWITCH.
        assert.ok(isClosingKeyword('ENDRAND'));
        assert.ok(isClosingKeyword('ENDSWITCH'));
    });

    test('BEGIN/END is tracked as its own pair (DOSWITCH case blocks)', () => {
        assert.ok(isOpeningKeyword('BEGIN'));
        assert.strictEqual(getExpectedClosing('BEGIN'), 'END');
        assert.ok(isClosingKeyword('END'));
    });

    test('IF/WHILE close with ENDIF/ENDWHILE', () => {
        assert.strictEqual(getExpectedClosing('IF'), 'ENDIF');
        assert.strictEqual(getExpectedClosing('WHILE'), 'ENDWHILE');
    });

    test('ELSE/ELSEIF/ELIF are middle keywords, not opening or closing', () => {
        for (const kw of ['ELSE', 'ELSEIF', 'ELIF']) {
            assert.ok(isMiddleKeyword(kw));
            assert.ok(!isOpeningKeyword(kw));
            assert.ok(!isClosingKeyword(kw));
        }
    });

    test('keyword checks are case-insensitive', () => {
        assert.ok(isOpeningKeyword('dorand'));
        assert.ok(isClosingKeyword('endif'));
    });

    test('unknown words are neither opening, closing nor middle', () => {
        assert.ok(!isOpeningKeyword('DEFNAME'));
        assert.ok(!isClosingKeyword('DEFNAME'));
        assert.ok(!isMiddleKeyword('DEFNAME'));
        assert.strictEqual(getExpectedClosing('DEFNAME'), undefined);
    });
});

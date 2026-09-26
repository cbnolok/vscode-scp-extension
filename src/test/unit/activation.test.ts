import * as assert from 'assert/strict';
import { startDiagnosticsAfterIndex } from '../../activation';

suite('activation', () => {
    test('starts diagnostics after a successful index scan', async () => {
        const calls: string[] = [];
        await startDiagnosticsAfterIndex(
            async () => { calls.push('index'); },
            () => { calls.push('diagnostics'); },
            () => { calls.push('error'); }
        );
        assert.deepEqual(calls, ['index', 'diagnostics']);
    });

    test('reports scan failure and still starts diagnostics', async () => {
        const calls: string[] = [];
        const failure = new Error('scan failed');
        await startDiagnosticsAfterIndex(
            async () => { calls.push('index'); throw failure; },
            () => { calls.push('diagnostics'); },
            error => { assert.equal(error, failure); calls.push('error'); }
        );
        assert.deepEqual(calls, ['index', 'error', 'diagnostics']);
    });
});

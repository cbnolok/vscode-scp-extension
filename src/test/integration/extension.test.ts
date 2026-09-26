import * as assert from 'assert/strict';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SphereScriptSymbolProvider } from '../../symbolProvider';

const workspacePath = process.env.SPHERESCRIPT_TEST_WORKSPACE;

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for ${label}`);
}

suite('SphereScript extension', () => {
    suiteSetup(async () => {
        assert.ok(workspacePath);
        const extension = vscode.extensions.getExtension('sphereserver-uo.scp-spherex');
        assert.ok(extension, 'extension should be loaded in the test host');
        await extension.activate();
        await waitFor(() => SphereScriptSymbolProvider.isReady(), 'initial symbol index');
    });

    test('DEFNAME aliases belong to their section and accept indentation', () => {
        const uri = vscode.Uri.file(path.join(workspacePath!, 'aliases.scp'));
        SphereScriptSymbolProvider.buildSymbolTableFromText(
            '[ITEMDEF i_first]\n  DEFNAME=i_alias\n[UNKNOWN section]\nDEFNAME=wrong_alias\n[CHARDEF c_second]\n\tDEFNAME=c_alias\n',
            uri
        );
        assert.equal(SphereScriptSymbolProvider.getLocation('i_alias')?.range.start.line, 1);
        assert.equal(SphereScriptSymbolProvider.getLocation('c_alias')?.range.start.line, 5);
        assert.equal(SphereScriptSymbolProvider.getLocation('wrong_alias'), undefined);
        SphereScriptSymbolProvider.clearSymbolsForDocument(uri);
    });

    test('Reindex can run repeatedly', async () => {
        await vscode.commands.executeCommand('spherescript.reindexSymbols');
        await vscode.commands.executeCommand('spherescript.reindexSymbols');
        assert.ok(SphereScriptSymbolProvider.isReady());
    });

    test('edits in two documents both reach the symbol index', async () => {
        const a = vscode.Uri.file(path.join(workspacePath!, 'first.scp'));
        const b = vscode.Uri.file(path.join(workspacePath!, 'second.scp'));
        await fs.writeFile(a.fsPath, '[FUNCTION old_first]\n');
        await fs.writeFile(b.fsPath, '[FUNCTION old_second]\n');
        const docA = await vscode.workspace.openTextDocument(a);
        const docB = await vscode.workspace.openTextDocument(b);
        await waitFor(() => !!SphereScriptSymbolProvider.getLocation('old_first')
            && !!SphereScriptSymbolProvider.getLocation('old_second'), 'initial symbols');
        // Let any open/file watcher callbacks settle before testing the
        // independent change timers.
        await new Promise(resolve => setTimeout(resolve, 1100));
        const edit = new vscode.WorkspaceEdit();
        edit.replace(a, docA.lineAt(0).range, '[FUNCTION new_first]');
        edit.replace(b, docB.lineAt(0).range, '[FUNCTION new_second]');
        assert.ok(await vscode.workspace.applyEdit(edit));
        assert.equal(SphereScriptSymbolProvider.getLocation('new_first'), undefined);
        assert.equal(SphereScriptSymbolProvider.getLocation('new_second'), undefined);
        await waitFor(() => !!SphereScriptSymbolProvider.getLocation('new_first')
            && !!SphereScriptSymbolProvider.getLocation('new_second'), 'both edited symbols');
        await fs.unlink(a.fsPath);
        await fs.unlink(b.fsPath);
    });

    test('file creation, rename, and deletion refresh symbols', async () => {
        const uri = vscode.Uri.file(path.join(workspacePath!, 'watched.scp'));
        const renamed = vscode.Uri.file(path.join(workspacePath!, 'renamed.scp'));
        await fs.writeFile(uri.fsPath, '[FUNCTION watched_symbol]\n');
        await waitFor(() => !!SphereScriptSymbolProvider.getLocation('watched_symbol'), 'created symbol');
        await fs.rename(uri.fsPath, renamed.fsPath);
        await waitFor(() => SphereScriptSymbolProvider.getLocation('watched_symbol')?.uri.toString() === renamed.toString(), 'renamed symbol');
        await fs.unlink(renamed.fsPath);
        await waitFor(() => !SphereScriptSymbolProvider.getLocation('watched_symbol'), 'deleted symbol');
    });

    test('deleting one duplicate symbol reveals the other definition', () => {
        const first = vscode.Uri.file(path.join(workspacePath!, 'duplicate-first.scp'));
        const second = vscode.Uri.file(path.join(workspacePath!, 'duplicate-second.scp'));
        SphereScriptSymbolProvider.buildSymbolTableFromText('[FUNCTION duplicate_name]\n', first);
        SphereScriptSymbolProvider.buildSymbolTableFromText('[FUNCTION duplicate_name]\n', second);
        assert.equal(SphereScriptSymbolProvider.getLocation('duplicate_name')?.uri.toString(), first.toString());
        SphereScriptSymbolProvider.clearSymbolsForDocument(first);
        assert.equal(SphereScriptSymbolProvider.getLocation('duplicate_name')?.uri.toString(), second.toString());
        SphereScriptSymbolProvider.clearSymbolsForDocument(second);
    });

    test('uppercase SCP diagnostics survive closing the editor', async () => {
        const uri = vscode.Uri.file(path.join(workspacePath!, 'UPPER.SCP'));
        await waitFor(() => vscode.languages.getDiagnostics(uri).some(d => d.code === 'unknown-section-keyword'), 'uppercase diagnostics');
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        assert.ok(vscode.languages.getDiagnostics(uri).some(d => d.code === 'unknown-section-keyword'));
    });

    test('external file changes refresh diagnostics', async () => {
        const uri = vscode.Uri.file(path.join(workspacePath!, 'external.scp'));
        await fs.writeFile(uri.fsPath, '[UNKNOWN_SECTION]\n');
        await waitFor(() => vscode.languages.getDiagnostics(uri).some(d => d.code === 'unknown-section-keyword'), 'new file diagnostics');
        await fs.writeFile(uri.fsPath, '[FUNCTION valid_function]\n');
        await waitFor(() => vscode.languages.getDiagnostics(uri).length === 0, 'changed file diagnostics');
        await fs.writeFile(uri.fsPath, '[UNKNOWN_SECTION]\n');
        await waitFor(() => vscode.languages.getDiagnostics(uri).some(d => d.code === 'unknown-section-keyword'), 'restored diagnostics');
        await fs.unlink(uri.fsPath);
        await waitFor(() => vscode.languages.getDiagnostics(uri).length === 0, 'deleted file diagnostics');
    });
});

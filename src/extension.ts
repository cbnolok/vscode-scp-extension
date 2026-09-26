import * as vscode from 'vscode';
import { SphereScriptSymbolProvider, SphereScriptDefinitionProvider } from './symbolProvider';
import { SphereScriptCompletionItemProvider } from './completion';
import { SphereScriptHoverProvider } from './hoverProvider';
import { SphereScriptSignatureHelpProvider } from './signatureHelp';
import { getOutputChannel } from './outputChannel';
import { buildKnowledgeBase } from './knowledgeBase';
import { activateDiagnostics } from './diagnostics';
import { SphereScriptCodeActionProvider } from './codeActions';
import { SphereScriptDocumentFormattingEditProvider } from './formatting';
import { SymbolLookup } from './types';
import { startDiagnosticsAfterIndex } from './activation';

export function activate(context: vscode.ExtensionContext): void {
    const out = getOutputChannel();
    context.subscriptions.push(out);
    out.appendLine('SphereScript extension activated.');

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'scp',
            new SphereScriptCompletionItemProvider(),
            '[', '.', '@'
        ),
        vscode.languages.registerHoverProvider('scp', new SphereScriptHoverProvider()),
        vscode.languages.registerDefinitionProvider('scp', new SphereScriptDefinitionProvider()),
        vscode.languages.registerSignatureHelpProvider(
            'scp',
            new SphereScriptSignatureHelpProvider(),
            ' ', ',', '='
        )
    );

    const knowledgeBase = buildKnowledgeBase();
    const symbolLookup: SymbolLookup = {
        getLocation: name => SphereScriptSymbolProvider.getLocation(name),
        isReady: () => SphereScriptSymbolProvider.isReady(),
        onDidIndex: SphereScriptSymbolProvider.onDidIndex,
    };

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            'scp',
            new SphereScriptCodeActionProvider(knowledgeBase),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        ),
        vscode.languages.registerDocumentFormattingEditProvider(
            'scp',
            new SphereScriptDocumentFormattingEditProvider()
        )
    );

    // Wait for the initial symbol scan when possible. If it fails, keep
    // structural diagnostics available and let Reindex recover the symbol
    // dependent checks later.
    void startDiagnosticsAfterIndex(
        () => SphereScriptSymbolProvider.initialize(context),
        () => activateDiagnostics(context, knowledgeBase, symbolLookup),
        error => out.appendLine(`[extension] initial symbol indexing failed: ${error}. Run "SphereScript: Reindex Workspace Symbols" to retry.`)
    ).catch(error => out.appendLine(`[extension] diagnostics initialization failed: ${error}`));
}

export function deactivate(): void {
    // Nothing to tear down explicitly - all listeners are registered via
    // context.subscriptions and disposed by VS Code on deactivation.
}

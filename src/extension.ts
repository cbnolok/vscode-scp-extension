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

    // Diagnostics do a workspace-wide scan on activation and check
    // symbols via symbolLookup, so they must not start until the symbol
    // index has finished its own initial scan - otherwise the first pass
    // would misreport every user-defined symbol as unknown.
    SphereScriptSymbolProvider.initialize(context).then(() => {
        activateDiagnostics(context, knowledgeBase, symbolLookup);
    });
}

export function deactivate(): void {
    // Nothing to tear down explicitly - all listeners are registered via
    // context.subscriptions and disposed by VS Code on deactivation.
}

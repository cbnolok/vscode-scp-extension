import * as vscode from 'vscode';
import { SphereScriptSymbolProvider } from './symbolProvider';
import { WorkspaceSymbolInfo } from './types';

/**
 * Signature help for user-defined FUNCTION sections, inferring parameter
 * names from `local.X = <argv[N]>` lines inside the function body -
 * a_fork_luxion's idea (no other fork implements signature help at all),
 * ported to read from the cached symbol index instead of re-scanning the
 * whole workspace on every keystroke.
 */
export class SphereScriptSignatureHelpProvider implements vscode.SignatureHelpProvider {
    provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.SignatureHelp> {
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const invocationMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_.]*)\s+([^]*)$/);
        if (!invocationMatch) {
            return null;
        }

        const functionName = invocationMatch[1];
        const argsText = invocationMatch[2] ?? '';
        const activeParameter = argsText.trim() ? argsText.split(',').length - 1 : 0;

        const symbol: WorkspaceSymbolInfo | undefined = SphereScriptSymbolProvider
            .getFunctionSymbols()
            .find(s => s.name.toLowerCase() === functionName.toLowerCase());
        if (!symbol) {
            return null;
        }

        const locals = symbol.locals.length > 0 ? symbol.locals : ['arg1'];
        const parameters = locals.map(local => new vscode.ParameterInformation(local));
        const signature = new vscode.SignatureInformation(`${symbol.name}(${locals.join(', ')})`);
        signature.parameters = parameters;

        const help = new vscode.SignatureHelp();
        help.signatures = [signature];
        help.activeSignature = 0;
        help.activeParameter = Math.min(activeParameter, Math.max(parameters.length - 1, 0));
        return help;
    }
}

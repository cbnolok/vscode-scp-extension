import * as vscode from 'vscode';
import { KnowledgeBase } from './types';
import { findCaseInsensitiveMatch, findClosest } from './stringUtils';
import { DIAGNOSTIC_SOURCE } from './diagnostics';

/**
 * Quick fixes for SphereScript diagnostics. Dispatches on `diagnostic.code`
 * (a stable identifier assigned in diagnostics.ts) rather than matching
 * substrings of the diagnostic message - the ported-from implementation
 * matched on message text (originally French, e.g. `includes("L'événement")`
 * for an "unknown trigger" fix and a message string for "DEFNAME is
 * missing"), and neither of those diagnostics was actually ever produced
 * by its own validators, so those two code-action paths were dead code.
 * This only implements fixes for diagnostics this extension's own
 * diagnostics.ts actually emits.
 */
export class SphereScriptCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private readonly knowledgeBase: KnowledgeBase) {}

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== DIAGNOSTIC_SOURCE) {
                continue;
            }
            switch (diagnostic.code) {
                case 'unknown-section-keyword':
                    actions.push(...this.buildCorrectionActions(document, diagnostic, this.knowledgeBase.keywords, 3));
                    break;
                case 'unknown-property':
                case 'unknown-object-member':
                    actions.push(...this.buildCorrectionActions(document, diagnostic, this.knowledgeBase.properties, 2));
                    break;
                case 'defname-mismatch':
                    actions.push(...this.fixDefnameMismatch(document, diagnostic));
                    break;
            }
        }

        const addDefnameAction = this.suggestAddDefname(document, range);
        if (addDefnameAction) {
            actions.push(addDefnameAction);
        }

        return actions;
    }

    private buildCorrectionActions(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        knownSet: Set<string>,
        maxDistance: number
    ): vscode.CodeAction[] {
        const original = document.getText(diagnostic.range);

        const exact = findCaseInsensitiveMatch(original, knownSet);
        if (exact && exact !== original) {
            return [this.buildFix(document, diagnostic, exact, true)];
        }

        return findClosest(original, knownSet, maxDistance, 3)
            .map((suggestion, i) => this.buildFix(document, diagnostic, suggestion, i === 0));
    }

    private fixDefnameMismatch(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
        const sectionName = findEnclosingSectionName(document, diagnostic.range.start.line);
        if (!sectionName) {
            return [];
        }
        return [this.buildFix(document, diagnostic, sectionName, true)];
    }

    private buildFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic, replacement: string, preferred: boolean): vscode.CodeAction {
        const fix = new vscode.CodeAction(`Change to '${replacement}'`, vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(document.uri, diagnostic.range, replacement);
        fix.diagnostics = [diagnostic];
        fix.isPreferred = preferred;
        return fix;
    }

    /**
     * Offers to insert a DEFNAME property under the cursor's [ITEMDEF]/
     * [CHARDEF] header, if that section doesn't already have one. Not
     * tied to a diagnostic - it's offered whenever the code action range
     * sits on a qualifying header line, since a missing DEFNAME isn't
     * itself flagged as an error (only a *mismatched* one is).
     */
    private suggestAddDefname(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction | undefined {
        const line = document.lineAt(range.start.line);
        const match = line.text.match(/^\s*\[(ITEMDEF|CHARDEF)\b/i);
        if (!match) {
            return undefined;
        }

        for (let i = range.start.line + 1; i < document.lineCount; i++) {
            const text = document.lineAt(i).text.trim();
            if (text.startsWith('[')) {
                break;
            }
            if (/^DEFNAME\s*=/i.test(text)) {
                return undefined;
            }
        }

        const defType = match[1].toUpperCase();
        const defnamePrefix = defType === 'ITEMDEF' ? 'i_' : 'c_';
        const fix = new vscode.CodeAction('Add DEFNAME property', vscode.CodeActionKind.QuickFix);
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.insert(document.uri, new vscode.Position(range.start.line + 1, 0), `DEFNAME=${defnamePrefix}new_${defType.toLowerCase()}\n`);
        return fix;
    }
}

function findEnclosingSectionName(document: vscode.TextDocument, fromLine: number): string | undefined {
    for (let i = fromLine; i >= 0; i--) {
        const text = document.lineAt(i).text.trim();
        const match = text.match(/^\[(ITEMDEF|CHARDEF)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
        if (match) {
            return match[2];
        }
        if (text.startsWith('[') && i !== fromLine) {
            return undefined;
        }
    }
    return undefined;
}

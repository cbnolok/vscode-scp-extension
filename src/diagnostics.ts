import * as vscode from 'vscode';
import { KnowledgeBase, SymbolLookup } from './types';
import { findClosest } from './stringUtils';
import {
    isOpeningKeyword,
    isClosingKeyword,
    isMiddleKeyword,
    getExpectedClosing,
} from './blockKeywords';
import { getOutputChannel } from './outputChannel';

export const DIAGNOSTIC_SOURCE = 'SphereScript';

function isScpDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'scp' || /\.scp$/i.test(document.uri.path);
}

function makeDiagnostic(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity, code: string): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = code;
    return diagnostic;
}

/**
 * Wires up diagnostics for SphereScript documents: a workspace-wide scan on
 * activation, plus incremental per-document updates on open/change/save.
 *
 * Unlike the old implementation, this never calls
 * `vscode.window.showInformationMessage` for routine operation - progress
 * goes to a status bar item (transient) and an output channel (verbose log,
 * never auto-shown). A popup on every debounced keystroke was real, and bad.
 */
export function activateDiagnostics(
    context: vscode.ExtensionContext,
    knowledgeBase: KnowledgeBase,
    symbolLookup: SymbolLookup
): void {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('sphereScript');
    context.subscriptions.push(diagnosticCollection);

    const outputChannel = getOutputChannel();

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBarItem);

    let isScanningWorkspace = false;
    let scanAgain = false;
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{scp,SCP}');
    context.subscriptions.push(watcher);

    function cancelPendingUpdate(uri: vscode.Uri): void {
        const key = uri.toString();
        const timer = debounceTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            debounceTimers.delete(key);
        }
    }

    function log(message: string): void {
        outputChannel.appendLine(message);
    }

    function runAllChecks(document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        validateSymbols(document, diagnostics, knowledgeBase, symbolLookup);
        validateCodeStructure(document, diagnostics);
        validateSectionDefnames(document, diagnostics);
        validateBrackets(document, diagnostics);
        return diagnostics;
    }

    function updateDiagnostics(document: vscode.TextDocument): void {
        log(`Updating diagnostics for: ${document.uri.fsPath}`);
        diagnosticCollection.set(document.uri, runAllChecks(document));
    }

    async function scanAllWorkspaceForDiagnostics(): Promise<void> {
        if (isScanningWorkspace) {
            scanAgain = true;
            return;
        }
        isScanningWorkspace = true;
        try {
            const allScpFiles = await vscode.workspace.findFiles('**/*.{scp,SCP}', '**/{.git,node_modules}/**');
            const total = allScpFiles.length;
            let processed = 0;
            if (total > 0) {
                statusBarItem.show();
            }
            for (const fileUri of allScpFiles) {
                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    updateDiagnostics(document);
                } catch (error) {
                    log(`Error processing diagnostics for ${fileUri.fsPath}: ${error}`);
                } finally {
                    processed++;
                    statusBarItem.text = `$(sync~spin) SphereScript: ${processed}/${total}`;
                }
            }
            for (const document of vscode.workspace.textDocuments) {
                if (isScpDocument(document)) {
                    updateDiagnostics(document);
                }
            }
            log(`Finished full workspace diagnostic scan. Processed ${processed} files.`);
        } catch (error) {
            log(`Full workspace diagnostic scan failed: ${error}`);
        } finally {
            statusBarItem.hide();
            isScanningWorkspace = false;
            if (scanAgain) {
                scanAgain = false;
                void scanAllWorkspaceForDiagnostics();
            }
        }
    }

    if (symbolLookup.onDidIndex) {
        context.subscriptions.push(symbolLookup.onDidIndex(() => {
            void scanAllWorkspaceForDiagnostics();
        }));
    }

    const updateDiagnosticsTrigger = (document: vscode.TextDocument) => {
        if (isScpDocument(document) && !isScanningWorkspace) {
            updateDiagnostics(document);
        }
    };

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        updateDiagnosticsTrigger(document);
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (!isScpDocument(event.document)) {
            return;
        }
        cancelPendingUpdate(event.document.uri);
        const key = event.document.uri.toString();
        const timer = setTimeout(() => {
            debounceTimers.delete(key);
            updateDiagnosticsTrigger(event.document);
        }, 300);
        debounceTimers.set(key, timer);
    }));

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        cancelPendingUpdate(document.uri);
        updateDiagnosticsTrigger(document);
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        cancelPendingUpdate(document.uri);
        if (isScpDocument(document) && document.uri.scheme === 'untitled') {
            diagnosticCollection.delete(document.uri);
        }
    }));

    const refreshFile = (uri: vscode.Uri): void => {
        void vscode.workspace.openTextDocument(uri).then(updateDiagnosticsTrigger, error => {
            log(`Error processing diagnostics for ${uri.fsPath}: ${error}`);
        });
    };
    context.subscriptions.push(
        watcher.onDidCreate(refreshFile),
        watcher.onDidChange(refreshFile),
        watcher.onDidDelete(uri => {
            cancelPendingUpdate(uri);
            diagnosticCollection.delete(uri);
        })
    );

    context.subscriptions.push({
        dispose() {
            for (const timer of debounceTimers.values()) {
                clearTimeout(timer);
            }
            debounceTimers.clear();
        },
    });

    void scanAllWorkspaceForDiagnostics();
}

// --- Individual checks ------------------------------------------------

function validateSymbols(
    document: vscode.TextDocument,
    diagnostics: vscode.Diagnostic[],
    knowledgeBase: KnowledgeBase,
    symbolLookup: SymbolLookup
): void {
    const symbolIndexReady = symbolLookup.isReady?.() ?? true;
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex);

        const leadingWhitespaceMatch = line.text.match(/^(\s+)\[/);
        if (leadingWhitespaceMatch) {
            const range = new vscode.Range(lineIndex, 0, lineIndex, leadingWhitespaceMatch[1].length);
            diagnostics.push(makeDiagnostic(
                range,
                'Section declarations (e.g. [ITEMDEF]) must not be preceded by spaces or tabs.',
                vscode.DiagnosticSeverity.Warning,
                'leading-whitespace-section'
            ));
        }

        const insideWhitespaceMatch = line.text.match(/^\s*\[(\s+)/);
        if (insideWhitespaceMatch) {
            const bracketIndex = line.text.indexOf('[');
            const range = new vscode.Range(lineIndex, bracketIndex + 1, lineIndex, bracketIndex + 1 + insideWhitespaceMatch[1].length);
            diagnostics.push(makeDiagnostic(
                range,
                'No space is allowed between the bracket and the section keyword.',
                vscode.DiagnosticSeverity.Warning,
                'inner-whitespace-section'
            ));
        }

        const text = line.text.trim();
        if (text.length === 0 || text.startsWith('//')) {
            continue;
        }

        const sectionMatch = text.match(/^\s*\[([a-zA-Z0-9_]+)/);
        if (sectionMatch) {
            const keyword = sectionMatch[1];
            const upperKeyword = keyword.toUpperCase();
            if (!knowledgeBase.keywords.has(upperKeyword) && upperKeyword !== 'EOF'
                && symbolIndexReady && !symbolLookup.getLocation(upperKeyword)) {
                const bracketPos = line.text.indexOf('[');
                const keywordStartPos = bracketPos + 1;
                const range = new vscode.Range(lineIndex, keywordStartPos, lineIndex, keywordStartPos + keyword.length);
                diagnostics.push(makeDiagnostic(
                    range,
                    `The section keyword '[${keyword}]' is unknown or not defined in the workspace.`,
                    vscode.DiagnosticSeverity.Error,
                    'unknown-section-keyword'
                ));
            }
            continue;
        }

        const propMatch = text.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/);
        if (propMatch && !text.includes('.')) {
            const propertyName = propMatch[1];
            const upperProp = propertyName.toUpperCase();

            if (symbolIndexReady && upperProp !== 'ON'
                && !knowledgeBase.properties.has(upperProp)
                && !knowledgeBase.commands.has(upperProp)
                && !symbolLookup.getLocation(upperProp)
                && !/\d$/.test(upperProp)
            ) {
                const [bestMatch] = findClosest(upperProp, knowledgeBase.properties, 2, 1);
                if (bestMatch) {
                    const propertyStartPos = line.text.indexOf(propertyName);
                    const range = new vscode.Range(lineIndex, propertyStartPos, lineIndex, propertyStartPos + propertyName.length);
                    diagnostics.push(makeDiagnostic(
                        range,
                        `The property '${propertyName}' is unknown or not defined. Did you mean '${bestMatch}'?`,
                        vscode.DiagnosticSeverity.Error,
                        'unknown-property'
                    ));
                    continue;
                }
            }
        }

        if (text.match(/^[a-z_][a-z0-9_]*\s+/i) && !text.includes('=')) {
            continue;
        }

        const objectMemberRegex = /\b([A-Z_][A-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)\b/gi;
        let match: RegExpExecArray | null;
        while ((match = objectMemberRegex.exec(line.text)) !== null) {
            const objectPrefix = match[1];
            const memberName = match[2];

            const commentIndex = line.text.indexOf('//');
            if (commentIndex !== -1 && match.index > commentIndex) {
                continue;
            }

            const textBefore = line.text.substring(0, match.index);
            const quoteCount = (textBefore.match(/"/g) || []).length;
            if (quoteCount % 2 !== 0) {
                continue;
            }

            const upperMember = memberName.toUpperCase();
            const isKnown = knowledgeBase.properties.has(upperMember)
                || knowledgeBase.events.has(upperMember)
                || knowledgeBase.commands.has(upperMember)
                || !!symbolLookup.getLocation(upperMember);

            if (!isKnown && symbolIndexReady) {
                const startCol = match.index + objectPrefix.length + 1;
                const range = new vscode.Range(lineIndex, startCol, lineIndex, startCol + memberName.length);
                diagnostics.push(makeDiagnostic(
                    range,
                    `The property/function '${memberName}' on object '${objectPrefix}' is potentially unknown or not defined.`,
                    vscode.DiagnosticSeverity.Hint,
                    'unknown-object-member'
                ));
            }
        }
    }
}

function validateSectionDefnames(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
    let currentSection: { name: string; line: number } | null = null;

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex);
        const text = line.text.trim();

        if (text.length === 0 || text.startsWith('//')) {
            continue;
        }

        const sectionMatch = text.match(/^\s*\[(ITEMDEF|CHARDEF)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
        if (sectionMatch) {
            currentSection = { name: sectionMatch[2], line: lineIndex };
            continue;
        }

        if (text.startsWith('[')) {
            currentSection = null;
        }

        if (currentSection) {
            const defnameMatch = text.match(/^DEFNAME\s*=\s*(.*)/i);
            if (defnameMatch) {
                const defnameValue = defnameMatch[1].trim();
                if (defnameValue.toLowerCase() !== currentSection.name.toLowerCase()) {
                    const valueStartIndex = line.text.toUpperCase().indexOf(defnameValue.toUpperCase());
                    const range = new vscode.Range(lineIndex, valueStartIndex, lineIndex, valueStartIndex + defnameValue.length);
                    diagnostics.push(makeDiagnostic(
                        range,
                        `DEFNAME "${defnameValue}" does not match the section's declared name "${currentSection.name}".`,
                        vscode.DiagnosticSeverity.Error,
                        'defname-mismatch'
                    ));
                }
                currentSection = null;
            }
        }
    }
}

/** Same keyword typos as the old structureValidator.ts, English messages. */
const KEYWORD_TYPOS: Record<string, string> = {
    ELSIF: 'ELSEIF',
    EIF: 'ELSEIF',
    ELE: 'ELSE',
    ENIF: 'ENDIF',
};

function validateCodeStructure(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
    const blockStack: Array<{ keyword: string; line: number; column: number }> = [];

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex);
        const text = line.text.trim();
        if (text.length === 0 || text.startsWith('//')) {
            continue;
        }

        const firstWordMatch = text.match(/^([A-Za-z]+)\b/);
        if (!firstWordMatch) {
            continue;
        }
        const word = firstWordMatch[1].toUpperCase();
        const col = line.firstNonWhitespaceCharacterIndex;
        const wordRange = new vscode.Range(lineIndex, col, lineIndex, col + word.length);

        if (KEYWORD_TYPOS[word]) {
            diagnostics.push(makeDiagnostic(
                wordRange,
                `Invalid syntax: "${word}" is not a valid keyword. Use "${KEYWORD_TYPOS[word]}" instead.`,
                vscode.DiagnosticSeverity.Error,
                'invalid-syntax'
            ));
            continue;
        }

        if (isOpeningKeyword(word)) {
            blockStack.push({ keyword: word, line: lineIndex, column: col });
            continue;
        }

        if (isMiddleKeyword(word)) {
            const top = blockStack[blockStack.length - 1];
            if (!top || top.keyword !== 'IF') {
                diagnostics.push(makeDiagnostic(wordRange, `${word} without a matching IF.`, vscode.DiagnosticSeverity.Error, 'mismatched-block'));
            }
            continue;
        }

        if (isClosingKeyword(word)) {
            if (blockStack.length === 0) {
                diagnostics.push(makeDiagnostic(wordRange, `${word} without a matching block.`, vscode.DiagnosticSeverity.Error, 'mismatched-block'));
                continue;
            }
            const lastBlock = blockStack.pop()!;
            const expectedClosing = getExpectedClosing(lastBlock.keyword);
            if (word !== expectedClosing) {
                diagnostics.push(makeDiagnostic(
                    wordRange,
                    `${word} does not match ${lastBlock.keyword} opened at line ${lastBlock.line + 1}.`,
                    vscode.DiagnosticSeverity.Error,
                    'mismatched-block'
                ));
            }
        }
    }

    for (const block of blockStack) {
        const expectedClosing = getExpectedClosing(block.keyword);
        const range = new vscode.Range(block.line, block.column, block.line, block.column + block.keyword.length);
        diagnostics.push(makeDiagnostic(
            range,
            `${block.keyword} at line ${block.line + 1} has no matching ${expectedClosing}.`,
            vscode.DiagnosticSeverity.Error,
            'unclosed-block'
        ));
    }
}

/**
 * Validates that `<>` and `()` are balanced, per line, using a small
 * tokenizer so a lone `<` used as a "less than" operator isn't mistaken
 * for the start of a `<VARIABLE.ACCESS>` block.
 */
function validateBrackets(document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex);
        const lineText = line.text;

        if (lineText.trim().startsWith('//') || lineText.trim().length === 0) {
            continue;
        }

        const parenStack: number[] = [];
        const angleStack: number[] = [];
        const tokens = Array.from(tokenize(lineText));

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            switch (token.type) {
                case 'PAREN_OPEN':
                    parenStack.push(token.index);
                    break;
                case 'PAREN_CLOSE':
                    if (parenStack.length > 0) {
                        parenStack.pop();
                    } else {
                        const pos = new vscode.Position(lineIndex, token.index);
                        diagnostics.push(makeDiagnostic(
                            new vscode.Range(pos, pos.translate(0, 1)),
                            'Unexpected closing parenthesis `)`.',
                            vscode.DiagnosticSeverity.Error,
                            'unbalanced-parens'
                        ));
                    }
                    break;
                case 'LT': {
                    const prevToken = i > 0 ? tokens[i - 1] : null;
                    if (!prevToken || ['OPERATOR', 'OPERATOR_COMPARE', 'PAREN_OPEN', 'COMMA'].includes(prevToken.type)) {
                        angleStack.push(token.index);
                    }
                    break;
                }
                case 'GT':
                    if (angleStack.length > 0) {
                        angleStack.pop();
                    }
                    break;
            }
        }

        angleStack.forEach(index => {
            const pos = new vscode.Position(lineIndex, index);
            diagnostics.push(makeDiagnostic(
                new vscode.Range(pos, pos.translate(0, 1)),
                'Unclosed opening angle bracket `<`.',
                vscode.DiagnosticSeverity.Error,
                'unbalanced-angle-brackets'
            ));
        });

        parenStack.forEach(index => {
            const pos = new vscode.Position(lineIndex, index);
            diagnostics.push(makeDiagnostic(
                new vscode.Range(pos, pos.translate(0, 1)),
                'Unclosed opening parenthesis `(`.',
                vscode.DiagnosticSeverity.Error,
                'unbalanced-parens'
            ));
        });
    }
}

interface Token {
    type: string;
    value: string;
    index: number;
}

function* tokenize(text: string): Generator<Token> {
    const tokenDefinitions: Array<{ type: string; regex: RegExp }> = [
        { type: 'COMMENT', regex: /^\/\/.*/ },
        { type: 'STRING', regex: /^"[^"]*"/ },
        { type: 'OPERATOR_COMPARE', regex: /^>>|^<<|^>=|^<=|^==|^!=/ },
        { type: 'KEYWORD', regex: /^\b(if|elif|elseif|else|endif|return|while|for|serv|src|new|argo|args|argn|argn1|i|def|local|argv|ref1|ref2|act|function|rand|magicresistance|healing|npc)\b/i },
        { type: 'PAREN_OPEN', regex: /^\(/ },
        { type: 'PAREN_CLOSE', regex: /^\)/ },
        { type: 'BRACKET_OPEN', regex: /^\[/ },
        { type: 'BRACKET_CLOSE', regex: /^\]/ },
        // Distinct LT/GT types (not a merged "OPERATOR_SINGLE") so the
        // switch in validateBrackets below can actually match on them -
        // the ported-from implementation used one merged type here, which
        // meant its own 'LT'/'GT' switch cases were unreachable dead code
        // and a standalone unbalanced `<` or `>` was never flagged.
        { type: 'LT', regex: /^</ },
        { type: 'GT', regex: /^>/ },
        { type: 'OPERATOR', regex: /^[&|^~=!+\-*/%?:]/ },
        { type: 'IDENTIFIER', regex: /^[a-zA-Z_][a-zA-Z0-9_.]*/ },
        { type: 'NUMBER', regex: /^0x[0-9a-fA-F]+|^\d+(\.\d+)?/ },
        { type: 'COMMA', regex: /^,/ },
        { type: 'WHITESPACE', regex: /^\s+/ },
        { type: 'UNKNOWN', regex: /^./ },
    ];

    let currentIndex = 0;
    let remainingText = text;

    while (remainingText.length > 0) {
        if (remainingText[0] === '<') {
            let depth = 1;
            let i = 1;
            while (i < remainingText.length && depth > 0) {
                if (remainingText[i] === '<') {
                    depth++;
                } else if (remainingText[i] === '>') {
                    depth--;
                }
                i++;
            }
            if (depth === 0 && i > 1) {
                const value = remainingText.substring(0, i);
                const content = value.substring(1, value.length - 1).trim();
                if (content.length > 0 && (/[a-zA-Z_]/.test(content) || content.includes('.') || content.includes(','))) {
                    yield { type: 'VARIABLE_ACCESS', value, index: currentIndex };
                    currentIndex += value.length;
                    remainingText = remainingText.substring(value.length);
                    continue;
                }
            }
        }

        let matched = false;
        for (const def of tokenDefinitions) {
            const match = remainingText.match(def.regex);
            if (match) {
                const value = match[0];
                if (def.type !== 'WHITESPACE') {
                    yield { type: def.type, value, index: currentIndex };
                }
                currentIndex += value.length;
                remainingText = remainingText.substring(value.length);
                matched = true;
                break;
            }
        }

        if (!matched) {
            yield { type: 'UNKNOWN', value: remainingText[0], index: currentIndex };
            currentIndex++;
            remainingText = remainingText.substring(1);
        }
    }
}

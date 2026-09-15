import * as vscode from 'vscode';
import { OPENING_KEYWORDS, MIDDLE_KEYWORDS, CLOSING_KEYWORDS as SHARED_CLOSING_KEYWORDS } from './blockKeywords';

interface IndentFrame {
    type: string;
    level: number;
}

// Formatting has its own notion of "closing": ENDIF/ENDWHILE/ENDFOR/ENDDO
// pop exactly one indent frame (ENDIF pops through trailing elif/else
// frames too); END is handled separately below since it only closes a
// BEGIN frame (DOSWITCH case blocks) and needs its own indent-level logic.
const SIMPLE_CLOSING_KEYWORDS = new Set<string>(SHARED_CLOSING_KEYWORDS.filter(k => k !== 'END'));
const OPENING_SET = new Set<string>(OPENING_KEYWORDS);
const MIDDLE_SET = new Set<string>([...MIDDLE_KEYWORDS, 'END']);
const SECTION_PATTERN = /^\s*\[/;

export class SphereScriptDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions
    ): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        const indentStack: IndentFrame[] = [];

        // Honors options.insertSpaces/tabSize - the ported-from
        // implementation always emitted spaces regardless of this setting.
        const indentFor = (level: number): string =>
            options.insertSpaces ? ' '.repeat(level * options.tabSize) : '\t'.repeat(level);

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const trimmedText = line.text.trim();

            if (trimmedText.length === 0) {
                if (line.text.length > 0) {
                    edits.push(vscode.TextEdit.replace(line.range, ''));
                }
                continue;
            }

            if (trimmedText.startsWith('//')) {
                const currentIndent = indentStack.length > 0 ? indentStack[indentStack.length - 1].level + 1 : 0;
                const newText = indentFor(currentIndent) + trimmedText;
                if (newText !== line.text) {
                    edits.push(vscode.TextEdit.replace(line.range, newText));
                }
                continue;
            }

            if (SECTION_PATTERN.test(trimmedText)) {
                indentStack.length = 0;
                if (line.text !== trimmedText) {
                    edits.push(vscode.TextEdit.replace(line.range, trimmedText));
                }
                continue;
            }

            const upperCaseText = trimmedText.toUpperCase();

            if (upperCaseText.startsWith('ON=')) {
                while (indentStack.length > 0 && indentStack[indentStack.length - 1].type === 'on') {
                    indentStack.pop();
                }
                const lineIndent = indentStack.length > 0 ? indentStack[indentStack.length - 1].level + 1 : 0;
                const newText = indentFor(lineIndent) + trimmedText;
                if (newText !== line.text) {
                    edits.push(vscode.TextEdit.replace(line.range, newText));
                }
                indentStack.push({ type: 'on', level: lineIndent });
                continue;
            }

            // Extract the exact leading keyword and classify by set
            // membership rather than iterating candidates with startsWith()
            // - the ported-from implementation iterated an array where
            // 'FOR' was listed before 'FORCHARS'/'FORITEMS'/'FORCONT*'/etc,
            // so e.g. a line starting with "FORCHARS" matched the bare
            // 'FOR' entry first (startsWith('FOR') is true for it too).
            // It happened to be harmless there (nothing downstream branched
            // on which FOR-variant was pushed), but it's the same ordering
            // bug class as the grammar's `<` vs `<=` issue, so fixing it
            // rather than reproducing it.
            const wordMatch = trimmedText.match(/^([A-Za-z]+)\b/);
            const word = wordMatch ? wordMatch[1].toUpperCase() : '';

            let lineIndent = indentStack.length > 0 ? indentStack[indentStack.length - 1].level + 1 : 0;
            let blockType = 'normal';
            let isClosing = false;
            let isMiddle = false;
            let isOpening = false;

            if (SIMPLE_CLOSING_KEYWORDS.has(word)) {
                isClosing = true;
                if (word === 'ENDIF' && indentStack.length > 0) {
                    while (indentStack.length > 0) {
                        const top = indentStack[indentStack.length - 1];
                        if (top.type === 'if' || top.type === 'elif' || top.type === 'else') {
                            lineIndent = top.level;
                            indentStack.pop();
                            if (top.type === 'if') {
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                } else if (indentStack.length > 0) {
                    const top = indentStack.pop()!;
                    lineIndent = top.level;
                } else {
                    lineIndent = 0;
                }
            } else if (MIDDLE_SET.has(word)) {
                isMiddle = true;
                if (word === 'END') {
                    if (indentStack.length > 0 && indentStack[indentStack.length - 1].type === 'begin') {
                        const top = indentStack.pop()!;
                        lineIndent = top.level;
                    } else {
                        lineIndent = indentStack.length > 0 ? indentStack[indentStack.length - 1].level + 1 : 0;
                    }
                    blockType = 'end';
                } else {
                    let ifLevel = 0;
                    while (indentStack.length > 0) {
                        const top = indentStack[indentStack.length - 1];
                        if (top.type === 'elif' || top.type === 'else') {
                            indentStack.pop();
                        } else if (top.type === 'if') {
                            ifLevel = top.level;
                            break;
                        } else {
                            break;
                        }
                    }
                    lineIndent = ifLevel;
                    blockType = word.toLowerCase();
                }
            } else if (OPENING_SET.has(word)) {
                isOpening = true;
                blockType = word.toLowerCase();
            }

            const newText = indentFor(lineIndent) + trimmedText;
            if (newText !== line.text) {
                edits.push(vscode.TextEdit.replace(line.range, newText));
            }

            if (isOpening) {
                indentStack.push({ type: blockType, level: lineIndent });
            } else if (isMiddle && blockType !== 'end') {
                indentStack.push({ type: blockType, level: lineIndent });
            }

            if (word === 'RETURN') {
                while (indentStack.length > 0 && indentStack[indentStack.length - 1].type === 'on') {
                    indentStack.pop();
                }
            }
        }

        return edits;
    }
}

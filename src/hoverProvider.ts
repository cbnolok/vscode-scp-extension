import * as vscode from 'vscode';
import { buildDescriptionIndex } from './knowledgeBase';
import { SphereScriptSymbolProvider } from './symbolProvider';

const WORD_RE = /([a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*)|(0x[0-9a-fA-F]+)|(\b[0-9a-fA-F]{4,}\b)|(@[a-zA-Z0-9_() ]+)/;

export class SphereScriptHoverProvider implements vscode.HoverProvider {
    private descriptions = buildDescriptionIndex();

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
        if (!wordRange) {
            return undefined;
        }
        const word = document.getText(wordRange);

        if (word.startsWith('@')) {
            const key = word.substring(1).toUpperCase().replace(/ /g, '_').replace(/[()]/g, '');
            const description = this.descriptions.get(key);
            if (description) {
                return new vscode.Hover(new vscode.MarkdownString(`**@${key}**\n\n${description}`), wordRange);
            }
        }

        const propertyMatch = word.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (propertyMatch) {
            const [, prefix, property] = propertyMatch;
            const description = this.descriptions.get(property.toUpperCase());
            if (description) {
                return new vscode.Hover(
                    new vscode.MarkdownString(`**${prefix.toUpperCase()}.${property.toUpperCase()}**\n\n${description}`),
                    wordRange
                );
            }
        }

        const key = word.toUpperCase();
        const description = this.descriptions.get(key);
        if (description) {
            return new vscode.Hover(new vscode.MarkdownString(`**${key}**\n\n${description}`), wordRange);
        }

        const symbol = SphereScriptSymbolProvider.getSymbol(key);
        if (symbol) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**${symbol.kind}: ${word}**\n\n`);
            if (symbol.kind === 'FUNCTION' && symbol.locals.length > 0) {
                markdown.appendMarkdown(`\`${symbol.name}(${symbol.locals.join(', ')})\`\n\n`);
            }
            markdown.appendMarkdown(`Defined in \`${symbol.file}\` (line ${symbol.range.start.line + 1})\n\n`);
            markdown.appendMarkdown('_Ctrl+Click or F12 to go to definition_');
            return new vscode.Hover(markdown, wordRange);
        }

        return undefined;
    }
}

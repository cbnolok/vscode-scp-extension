import * as vscode from 'vscode';
import { keywordData, KeywordData } from './keywordData';
import { SphereScriptSymbolProvider } from './symbolProvider';
import { WorkspaceSymbolInfo } from './types';

type Bucket = keyof KeywordData;

/**
 * Object prefix -> property bucket(s). Wider than any single fork covered
 * (the Prapilk fork only handled i./src./serv./new./argo.) - extended with
 * cont./act./c./topobj./region./ref\d+ per the language's actual prefix set
 * (see the "object" patterns in syntaxes/scp.tmLanguage.json).
 */
const PREFIX_TO_BUCKETS: Record<string, Bucket[]> = {
    i: ['itemProperties'],
    item: ['itemProperties'],
    itemdef: ['itemProperties'],
    cont: ['itemProperties'],
    topobj: ['itemProperties'],
    src: ['charProperties'],
    c: ['charProperties'],
    act: ['charProperties'],
    argo: ['charProperties'],
    chardef: ['charProperties'],
    client: ['charProperties'],
    serv: ['servProperties'],
    region: ['regionProperties'],
    new: ['itemProperties', 'charProperties'],
    targ: ['itemProperties', 'charProperties'],
};

// Free-form tag/variable accessors - any name is valid after these, so we
// deliberately offer no property suggestions (matches the LuxionUO fork's
// fix for `local.*` false suggestions, generalized to the other accessors).
const FREEFORM_PREFIXES = new Set(['tag', 'ctag', 'local', 'var', 'dtag', 'dvar', 'dlocal', 'argv']);

function bucketsForPrefix(prefix: string): Bucket[] | undefined {
    const lower = prefix.toLowerCase();
    if (FREEFORM_PREFIXES.has(lower)) {
        return [];
    }
    if (/^ref\d+$/.test(lower)) {
        return ['charProperties'];
    }
    return PREFIX_TO_BUCKETS[lower];
}

function replacementRange(position: vscode.Position, startChar: number): vscode.Range {
    return new vscode.Range(position.line, startChar, position.line, position.character);
}

function propertyItems(bucket: Bucket, partial: string, range: vscode.Range): vscode.CompletionItem[] {
    const upperPartial = partial.toUpperCase();
    return keywordData[bucket]
        .filter(e => e.name.toUpperCase().startsWith(upperPartial))
        .map(e => {
            const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Property);
            item.insertText = e.name;
            item.range = range;
            if (e.description) {
                item.documentation = new vscode.MarkdownString(e.description);
            }
            return item;
        });
}

function symbolCompletionKind(kind: string): vscode.CompletionItemKind {
    switch (kind) {
        case 'FUNCTION': return vscode.CompletionItemKind.Function;
        case 'ITEMDEF': return vscode.CompletionItemKind.Field;
        case 'AREADEF':
        case 'REGIONTYPE': return vscode.CompletionItemKind.Module;
        case 'TYPEDEF': return vscode.CompletionItemKind.Class;
        case 'DIALOG': return vscode.CompletionItemKind.Interface;
        default: return vscode.CompletionItemKind.Text;
    }
}

function symbolCompletionItem(symbol: WorkspaceSymbolInfo): vscode.CompletionItem {
    const params = symbol.kind === 'FUNCTION' ? symbol.locals.join(', ') : '';
    const label: vscode.CompletionItemLabel = {
        label: symbol.name,
        detail: ` ${symbol.kind.toLowerCase()}`,
    };
    const item = new vscode.CompletionItem(label, symbolCompletionKind(symbol.kind));
    item.insertText = symbol.name;
    item.detail = `From ${symbol.file}`;
    item.sortText = `0_${symbol.kind}_${symbol.name}`;
    item.documentation = new vscode.MarkdownString(
        symbol.kind === 'FUNCTION'
            ? (params ? `\`${symbol.name}(${params})\`` : `\`${symbol.name}()\``)
            : `\`${symbol.kind}: ${symbol.name}\``
    );
    return item;
}

export class SphereScriptCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const line = document.lineAt(position.line).text;
        const textBeforeCursor = line.substring(0, position.character);

        // [SECTION
        const sectionMatch = textBeforeCursor.match(/\[([a-zA-Z0-9_]*)$/);
        if (sectionMatch) {
            const partial = sectionMatch[1].toUpperCase();
            const range = replacementRange(position, textBeforeCursor.lastIndexOf('[') + 1);
            const items = keywordData.sectionKeywords
                .filter(e => e.name.startsWith(partial))
                .map(e => {
                    const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Keyword);
                    item.insertText = `${e.name} `;
                    item.range = range;
                    if (e.description) {
                        item.documentation = new vscode.MarkdownString(e.description);
                    }
                    return item;
                });
            return new vscode.CompletionList(items, true);
        }

        // @trigger
        const triggerMatch = textBeforeCursor.match(/@([a-zA-Z0-9_]*)$/);
        if (triggerMatch) {
            const partial = triggerMatch[1].toUpperCase();
            const range = replacementRange(position, textBeforeCursor.lastIndexOf('@') + 1);
            const items = keywordData.triggers
                .filter(e => e.name.startsWith(partial))
                .map(e => {
                    const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Event);
                    item.insertText = e.name;
                    item.range = range;
                    if (e.description) {
                        item.documentation = new vscode.MarkdownString(e.description);
                    }
                    return item;
                });
            return new vscode.CompletionList(items, true);
        }

        // prefix.property  (also covers prefix.partialSymbolName - merged below)
        const propertyMatch = textBeforeCursor.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/);
        if (propertyMatch) {
            const prefix = propertyMatch[1];
            const partial = propertyMatch[2];
            const buckets = bucketsForPrefix(prefix);
            const range = replacementRange(position, textBeforeCursor.lastIndexOf('.') + 1);

            if (buckets === undefined) {
                // Unknown prefix - most likely a user-defined DEFNAME/local
                // being chained (e.g. `i_mycustomitem.`); nothing to
                // suggest from static data, fall through to no items
                // rather than guessing.
                return new vscode.CompletionList([], true);
            }
            const items = buckets.flatMap(b => propertyItems(b, partial, range));
            return new vscode.CompletionList(items, true);
        }

        // General fallback: bare word - control keywords, commands, and
        // workspace symbols (functions/items/types/... defined anywhere
        // in the project), matched by prefix.
        const wordMatch = textBeforeCursor.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
        if (!wordMatch) {
            return undefined;
        }
        const partial = wordMatch[1].toUpperCase();
        const range = replacementRange(position, position.character - wordMatch[1].length);

        const items: vscode.CompletionItem[] = [];
        for (const entry of [...keywordData.controlKeywords, ...keywordData.commands, ...keywordData.definitionProperties]) {
            if (entry.name.startsWith(partial)) {
                const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Keyword);
                item.insertText = entry.name;
                item.range = range;
                if (entry.description) {
                    item.documentation = new vscode.MarkdownString(entry.description);
                }
                items.push(item);
            }
        }
        for (const symbol of SphereScriptSymbolProvider.getAllSymbols()) {
            const shortName = symbol.name.split('.').pop() ?? symbol.name;
            if (symbol.name.toUpperCase().startsWith(partial) || shortName.toUpperCase().startsWith(partial)) {
                const item = symbolCompletionItem(symbol);
                item.range = range;
                items.push(item);
            }
        }
        return new vscode.CompletionList(items, false);
    }
}

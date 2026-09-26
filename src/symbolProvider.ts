import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { WorkspaceSymbolInfo, SymbolLocation } from './types';
import { getOutputChannel } from './outputChannel';

/**
 * Section types recognized as workspace symbols, normalized to one label
 * each (ITEM/ITEMDEF -> ITEMDEF, TYPE/TYPEDEF -> TYPEDEF). Union of what
 * the Prapilk fork's symbol provider covered and what the LuxionUO fork's
 * completion covered - neither alone had the other's coverage.
 */
const SECTION_TYPE_ALIASES = new Map<string, string>([
    ['function', 'FUNCTION'],
    ['itemdef', 'ITEMDEF'],
    ['item', 'ITEMDEF'],
    ['chardef', 'CHARDEF'],
    ['spell', 'SPELL'],
    ['skill', 'SKILL'],
    ['dialog', 'DIALOG'],
    ['menu', 'MENU'],
    ['skillmenu', 'SKILLMENU'],
    ['template', 'TEMPLATE'],
    ['regiontype', 'REGIONTYPE'],
    ['areadef', 'AREADEF'],
    ['spawn', 'SPAWN'],
    ['typedef', 'TYPEDEF'],
    ['type', 'TYPEDEF'],
    ['defmessage', 'DEFMESSAGE'],
    ['speech', 'SPEECH'],
    ['events', 'EVENTS'],
]);

const SECTION_HEADER_RE = /^\s*\[([A-Za-z0-9_]+)\s+([^\]]*)\]/;
const DEFNAME_RE = /^\s*DEFNAME\s*=\s*([a-zA-Z0-9_]+)/i;
const LOCAL_ARGV_RE = /^\s*local\.([A-Za-z0-9_]+).*<argv\[/i;

function parseDocumentSymbols(text: string, uri: vscode.Uri, fileBaseName: string): WorkspaceSymbolInfo[] {
    const symbols: WorkspaceSymbolInfo[] = [];
    const lines = text.split(/\r?\n/);
    let current: WorkspaceSymbolInfo | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const sectionMatch = line.match(SECTION_HEADER_RE);

        if (/^\s*\[/.test(line)) {
            current = null;
            if (!sectionMatch) {
                continue;
            }
            const kind = SECTION_TYPE_ALIASES.get(sectionMatch[1].toLowerCase());
            const name = sectionMatch[2].trim().split(/\s+/)[0];
            if (!kind || !name) {
                continue;
            }
            const startCol = line.indexOf('[');
            const range = new vscode.Range(i, startCol, i, line.length);
            const info: WorkspaceSymbolInfo = { name, kind, uri, range, locals: [], file: fileBaseName };
            symbols.push(info);
            current = info;
            continue;
        }

        const defnameMatch = line.match(DEFNAME_RE);
        if (defnameMatch && current && current.kind !== 'FUNCTION') {
            const startCol = line.toUpperCase().indexOf(defnameMatch[1].toUpperCase(), line.indexOf('='));
            const range = new vscode.Range(i, startCol, i, startCol + defnameMatch[1].length);
            symbols.push({ ...current, name: defnameMatch[1], range });
            continue;
        }

        if (current?.kind === 'FUNCTION') {
            const localMatch = line.match(LOCAL_ARGV_RE);
            if (localMatch) {
                current.locals.push(localMatch[1]);
            }
        }
    }

    return symbols;
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function findProjectRoot(startDir: string): Promise<string> {
    let dir = startDir;
    let detected: string | null = null;
    for (;;) {
        if (await pathExists(path.join(dir, '.git')) || await pathExists(path.join(dir, 'package.json'))) {
            detected = dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return detected ?? startDir;
}

async function collectScpFilesFromDirectory(rootDir: string): Promise<string[]> {
    const files: string[] = [];
    const ignored = new Set(['.git', 'node_modules']);
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!ignored.has(entry.name)) {
                    stack.push(path.join(dir, entry.name));
                }
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.scp')) {
                files.push(path.join(dir, entry.name));
            }
        }
    }
    return files;
}

export class SphereScriptSymbolProvider {
    private static symbolsByUri = new Map<string, WorkspaceSymbolInfo[]>();
    private static byName = new Map<string, WorkspaceSymbolInfo>();
    private static ready = false;
    private static listenersRegistered = false;
    private static debounceTimers = new Map<string, NodeJS.Timeout>();
    private static indexCompleteEmitter = new vscode.EventEmitter<void>();
    static readonly onDidIndex = SphereScriptSymbolProvider.indexCompleteEmitter.event;

    static isReady(): boolean {
        return SphereScriptSymbolProvider.ready;
    }

    static getLocation(name: string): SymbolLocation | undefined {
        const symbol = SphereScriptSymbolProvider.byName.get(name.toUpperCase());
        return symbol ? { uri: symbol.uri, range: symbol.range } : undefined;
    }

    static getSymbol(name: string): WorkspaceSymbolInfo | undefined {
        return SphereScriptSymbolProvider.byName.get(name.toUpperCase());
    }

    static getAllSymbols(): WorkspaceSymbolInfo[] {
        return [...SphereScriptSymbolProvider.byName.values()];
    }

    static getFunctionSymbols(): WorkspaceSymbolInfo[] {
        return SphereScriptSymbolProvider.getAllSymbols().filter(s => s.kind === 'FUNCTION');
    }

    private static indexSymbols(uri: vscode.Uri, symbols: WorkspaceSymbolInfo[]): void {
        const uriKey = uri.toString();
        const previous = SphereScriptSymbolProvider.symbolsByUri.get(uriKey);
        SphereScriptSymbolProvider.symbolsByUri.set(uriKey, symbols);
        if (previous) {
            for (const s of previous) {
                if (SphereScriptSymbolProvider.byName.get(s.name.toUpperCase())?.uri.toString() === uriKey) {
                    SphereScriptSymbolProvider.byName.delete(s.name.toUpperCase());
                    // A second file may define the same name. Restore it when
                    // the current file changes or disappears.
                    for (const entries of SphereScriptSymbolProvider.symbolsByUri.values()) {
                        const replacement = entries.find(entry => entry.name.toUpperCase() === s.name.toUpperCase());
                        if (replacement) {
                            SphereScriptSymbolProvider.byName.set(s.name.toUpperCase(), replacement);
                            break;
                        }
                    }
                }
            }
        }
        for (const s of symbols) {
            const key = s.name.toUpperCase();
            if (!SphereScriptSymbolProvider.byName.has(key)) {
                SphereScriptSymbolProvider.byName.set(key, s);
            }
        }
    }

    static buildSymbolTableFromText(text: string, uri: vscode.Uri): void {
        const symbols = parseDocumentSymbols(text, uri, path.basename(uri.fsPath));
        SphereScriptSymbolProvider.indexSymbols(uri, symbols);
    }

    static async buildSymbolTable(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'scp') {
            return;
        }
        SphereScriptSymbolProvider.buildSymbolTableFromText(document.getText(), document.uri);
    }

    static clearSymbolsForDocument(uri: vscode.Uri): void {
        const uriKey = uri.toString();
        SphereScriptSymbolProvider.cancelPendingUpdate(uri);
        const previous = SphereScriptSymbolProvider.symbolsByUri.get(uriKey);
        if (!previous) {
            return;
        }
        SphereScriptSymbolProvider.symbolsByUri.delete(uriKey);
        for (const s of previous) {
            if (SphereScriptSymbolProvider.byName.get(s.name.toUpperCase())?.uri.toString() === uriKey) {
                SphereScriptSymbolProvider.byName.delete(s.name.toUpperCase());
                for (const entries of SphereScriptSymbolProvider.symbolsByUri.values()) {
                    const replacement = entries.find(entry => entry.name.toUpperCase() === s.name.toUpperCase());
                    if (replacement) {
                        SphereScriptSymbolProvider.byName.set(s.name.toUpperCase(), replacement);
                        break;
                    }
                }
            }
        }
    }

    private static cancelPendingUpdate(uri: vscode.Uri): void {
        const key = uri.toString();
        const timer = SphereScriptSymbolProvider.debounceTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            SphereScriptSymbolProvider.debounceTimers.delete(key);
        }
    }

    private static async refreshFile(uri: vscode.Uri): Promise<void> {
        const openDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
        if (openDocument?.languageId === 'scp') {
            SphereScriptSymbolProvider.buildSymbolTableFromText(openDocument.getText(), uri);
            return;
        }
        try {
            const content = await fs.readFile(uri.fsPath, 'utf8');
            SphereScriptSymbolProvider.buildSymbolTableFromText(content, uri);
        } catch (error) {
            getOutputChannel().appendLine(`[symbolProvider] failed to read ${uri.fsPath}: ${error}`);
        }
    }

    static async reinitialize(): Promise<void> {
        for (const timer of SphereScriptSymbolProvider.debounceTimers.values()) {
            clearTimeout(timer);
        }
        SphereScriptSymbolProvider.debounceTimers.clear();
        SphereScriptSymbolProvider.symbolsByUri.clear();
        SphereScriptSymbolProvider.byName.clear();
        SphereScriptSymbolProvider.ready = false;
        await SphereScriptSymbolProvider.scanWorkspace();
    }

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (SphereScriptSymbolProvider.listenersRegistered) {
            return;
        }
        SphereScriptSymbolProvider.listenersRegistered = true;
        SphereScriptSymbolProvider.registerListeners(context);
        await SphereScriptSymbolProvider.scanWorkspace();
    }

    private static async scanWorkspace(): Promise<void> {
        const out = getOutputChannel();

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'SphereScript: indexing symbols' },
            async progress => {
                const openDocs = vscode.workspace.textDocuments.filter(d => d.languageId === 'scp');
                for (const doc of openDocs) {
                    await SphereScriptSymbolProvider.buildSymbolTable(doc);
                }

                const seen = new Set<string>(openDocs.map(d => d.uri.fsPath));
                const diskPaths: string[] = [];

                if (vscode.workspace.workspaceFolders?.length) {
                    const uris = await vscode.workspace.findFiles('**/*.{scp,SCP}', '**/{.git,node_modules}/**');
                    for (const uri of uris) {
                        if (!seen.has(uri.fsPath)) {
                            seen.add(uri.fsPath);
                            diskPaths.push(uri.fsPath);
                        }
                    }
                } else {
                    // No workspace folder open - fall back to a manual walk
                    // from the active document's project root, so the
                    // extension still indexes something useful for single-
                    // file/no-folder usage.
                    const active = vscode.window.activeTextEditor?.document;
                    if (active && active.languageId === 'scp') {
                        const root = await findProjectRoot(path.dirname(active.uri.fsPath));
                        for (const p of await collectScpFilesFromDirectory(root)) {
                            if (!seen.has(p)) {
                                seen.add(p);
                                diskPaths.push(p);
                            }
                        }
                    }
                }

                const batchSize = 25;
                let processed = 0;
                for (let i = 0; i < diskPaths.length; i += batchSize) {
                    const batch = diskPaths.slice(i, i + batchSize);
                    await Promise.allSettled(batch.map(async filePath => {
                        try {
                            const content = await fs.readFile(filePath, 'utf8');
                            SphereScriptSymbolProvider.buildSymbolTableFromText(content, vscode.Uri.file(filePath));
                        } catch (error) {
                            out.appendLine(`[symbolProvider] failed to read ${filePath}: ${error}`);
                        }
                    }));
                    processed += batch.length;
                    if (diskPaths.length > 0) {
                        progress.report({ message: `${processed}/${diskPaths.length} files` });
                    }
                }

                out.appendLine(`[symbolProvider] indexed ${SphereScriptSymbolProvider.byName.size} symbols from ${openDocs.length + diskPaths.length} files`);
            }
        );

        SphereScriptSymbolProvider.ready = true;
        SphereScriptSymbolProvider.indexCompleteEmitter.fire();

    }

    private static registerListeners(context: vscode.ExtensionContext): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{scp,SCP}');
        context.subscriptions.push(watcher);
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(document => {
                if (document.languageId === 'scp') {
                    void SphereScriptSymbolProvider.buildSymbolTable(document);
                }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.languageId !== 'scp') {
                    return;
                }
                SphereScriptSymbolProvider.cancelPendingUpdate(event.document.uri);
                const key = event.document.uri.toString();
                const timer = setTimeout(() => {
                    SphereScriptSymbolProvider.debounceTimers.delete(key);
                    void SphereScriptSymbolProvider.buildSymbolTable(event.document);
                }, 1000);
                SphereScriptSymbolProvider.debounceTimers.set(key, timer);
            }),
            vscode.workspace.onDidSaveTextDocument(document => {
                if (document.languageId === 'scp') {
                    SphereScriptSymbolProvider.cancelPendingUpdate(document.uri);
                    void SphereScriptSymbolProvider.buildSymbolTable(document);
                }
            }),
            watcher.onDidCreate(uri => { void SphereScriptSymbolProvider.refreshFile(uri); }),
            watcher.onDidChange(uri => { void SphereScriptSymbolProvider.refreshFile(uri); }),
            watcher.onDidDelete(uri => SphereScriptSymbolProvider.clearSymbolsForDocument(uri)),
            vscode.commands.registerCommand('spherescript.reindexSymbols', async () => {
                await SphereScriptSymbolProvider.reinitialize();
                vscode.window.setStatusBarMessage('SphereScript: symbols reindexed', 3000);
            }),
            { dispose: () => {
                for (const timer of SphereScriptSymbolProvider.debounceTimers.values()) {
                    clearTimeout(timer);
                }
                SphereScriptSymbolProvider.debounceTimers.clear();
                SphereScriptSymbolProvider.listenersRegistered = false;
            } }
        );
    }
}

export class SphereScriptDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Location> {
        const range = document.getWordRangeAtPosition(
            position,
            /\b[a-zA-Z_][a-zA-Z0-9_]*\b|0x[0-9a-fA-F]+|\b[0-9a-fA-F]{4,}\b/
        );
        if (!range || !SphereScriptSymbolProvider.isReady()) {
            return undefined;
        }
        const location = SphereScriptSymbolProvider.getLocation(document.getText(range));
        return location ? new vscode.Location(location.uri, location.range) : undefined;
    }
}

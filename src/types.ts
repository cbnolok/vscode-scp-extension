import * as vscode from 'vscode';

/**
 * Generic keyword/property/trigger lookup used by diagnostics, code
 * actions, completion and hover. Built once from keywordData.ts by
 * knowledgeBase.ts and passed around by injection so every consumer
 * (including the diagnostics/codeActions/formatting subsystem) stays
 * decoupled from where the data actually comes from.
 */
export interface KnowledgeBase {
    /** Section keywords, e.g. ITEMDEF, CHARDEF, FUNCTION. */
    keywords: Set<string>;
    /** All known property/function names, any object prefix. */
    properties: Set<string>;
    /** Trigger names, e.g. CREATE, DCLICK, HITTRY. */
    events: Set<string>;
    /** Console/GM verb commands. */
    commands: Set<string>;
}

export interface SymbolLocation {
    uri: vscode.Uri;
    range: vscode.Range;
}

export interface SymbolLookup {
    getLocation(name: string): SymbolLocation | undefined;
    /** False when the initial scan failed; symbol-dependent diagnostics wait. */
    isReady?(): boolean;
    /** Fires after a successful scan, including a manual reindex. */
    onDidIndex?: vscode.Event<void>;
}

/** A user-defined FUNCTION/ITEMDEF/CHARDEF/... symbol found in the workspace. */
export interface WorkspaceSymbolInfo {
    name: string;
    /** Resource section type, e.g. FUNCTION, ITEMDEF, ITEM, DIALOG, TYPEDEF. */
    kind: string;
    uri: vscode.Uri;
    range: vscode.Range;
    /** For FUNCTION symbols only: parameter names inferred from `local.X = <argv[N]>`. */
    locals: string[];
    /** Basename of the file the symbol was found in, for completion detail text. */
    file: string;
}

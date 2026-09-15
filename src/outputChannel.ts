import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/** One shared output channel for the whole extension - never used for popups. */
export function getOutputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('SphereScript');
    }
    return channel;
}

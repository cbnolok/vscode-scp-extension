import { runTests } from '@vscode/test-electron';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

async function main(): Promise<void> {
    // Chromium needs a private display in headless Linux test environments.
    if (process.platform === 'linux' && process.env.SPHERESCRIPT_TEST_XVFB !== '1' && existsSync('/usr/bin/xvfb-run')) {
        const exitCode = await new Promise<number>((resolve, reject) => {
            const child = spawn('/usr/bin/xvfb-run', ['-a', process.execPath, __filename], {
                stdio: 'inherit',
                env: { ...process.env, SPHERESCRIPT_TEST_XVFB: '1' },
            });
            child.on('error', reject);
            child.on('exit', code => resolve(code ?? 1));
        });
        process.exitCode = exitCode;
        return;
    }

    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, 'integration');
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'scp-spherex-test-'));
    const installedCode = '/opt/visual-studio-code/code';
    const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH
        ?? (existsSync(installedCode) ? installedCode : undefined);

    try {
        await writeFile(path.join(workspacePath, 'UPPER.SCP'), '[UNKNOWN_SECTION]\n');
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            vscodeExecutablePath,
            launchArgs: [workspacePath, '--disable-extensions', '--no-sandbox'],
            extensionTestsEnv: { SPHERESCRIPT_TEST_WORKSPACE: workspacePath },
        });
    } finally {
        await rm(workspacePath, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

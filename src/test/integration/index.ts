import * as path from 'path';
import { readdir } from 'fs/promises';
import Mocha from 'mocha';

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', timeout: 10000, color: true });
    const files = (await readdir(__dirname)).filter(file => file.endsWith('.test.js'));
    for (const file of files) {
        mocha.addFile(path.join(__dirname, file));
    }
    await new Promise<void>((resolve, reject) => {
        mocha.run(failures => failures ? reject(new Error(`${failures} integration tests failed`)) : resolve());
    });
}

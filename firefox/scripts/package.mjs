import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { root, filesUnder, readJson } from './common.mjs';

const info = await readJson(path.join(root, 'artifacts/build-info.json'));
async function archive(directory, target, exclude = () => false) {
    const entries = {};
    async function visit(current) {
        for (const entry of await fs.readdir(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            const relative = path.relative(directory, full).replaceAll('\\', '/');
            if (exclude(relative)) continue;
            if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${relative}`);
            if (entry.isDirectory()) await visit(full);
            else entries[relative] = [new Uint8Array(await fs.readFile(full)), { mtime: new Date('2020-01-01T00:00:00Z') }];
        }
    }
    await visit(directory);
    await fs.writeFile(target, zipSync(entries, { level: 9 }));
}
await archive(path.join(root, 'dist/firefox'), path.join(root, `artifacts/rovalra-firefox-${info.version}-unsigned.zip`));
const source = path.join(root, '.cache/build-source');
await fs.writeFile(path.join(source, 'BUILD-FIREFOX.txt'), 'This is the complete prepared Firefox source, including compatibility and privacy changes and replacement artwork.\nUse Node.js 22 or newer.\nRun: npm ci --ignore-scripts\nThen: node build.js\nCopy LICENSE, PrivacyPolicy.md and FIREFOX-NOTICE.txt into dist.\nThe package version is synchronized by build.js.\nThe generated dist directory is the Firefox extension.\n');
await archive(source, path.join(root, `artifacts/rovalra-firefox-${info.version}-source.zip`), (name) => /^(node_modules|dist|\.git)(\/|$)/.test(name));
console.log(`Packaged unsigned preview and corresponding source for ${info.version}. Permanent installation requires the signed XPI.`);

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export const writeJson = async (file, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
};
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
    });
}
export async function cleanGenerated(relative) {
    const target = path.resolve(root, relative);
    const allowed = ['.cache/build-source', 'dist/firefox', 'artifacts/signed'];
    if (!allowed.includes(relative) || !target.startsWith(root + path.sep)) throw new Error('Unsafe cleanup target');
    await fs.rm(target, { recursive: true, force: true });
}
export function validateRepository(repository) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Configure a GitHub owner/repository first.');
    return repository;
}
export function updateUrl(repository) {
    return `https://github.com/${validateRepository(repository)}/releases/latest/download/updates.json`;
}
export function portVersion(version, revision) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || !Number.isInteger(revision) || revision < 1 || revision > 65535) throw new Error('Expected a three-part upstream version and positive portRevision <= 65535');
    const parts = version.split('.').map(Number);
    if (parts.some((n) => n > 65535)) throw new Error('Version component exceeds Firefox limit');
    return [...parts, revision].join('.');
}
export async function filesUnder(directory) {
    const files = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${full}`);
        if (entry.isDirectory()) files.push(...await filesUnder(full));
        else files.push(full);
    }
    return files.sort();
}

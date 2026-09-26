import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, writeJson } from './common.mjs';

const result = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [path.join(root, 'node_modules/web-ext/bin/web-ext.js'), 'lint', '--source-dir', path.join(root, 'dist/firefox'), '--self-hosted', '--output', 'json'], { cwd: root, windowsHide: true, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
});
let report;
try { report = JSON.parse(result.stdout); }
catch { throw new Error(`Firefox validator did not return JSON: ${result.stderr}`); }
await writeJson(path.join(root, 'artifacts/firefox-lint.json'), report);
const warningCounts = {};
for (const warning of report.warnings) warningCounts[warning.code] = (warningCounts[warning.code] || 0) + 1;
console.log(JSON.stringify({ summary: report.summary, warningCounts, errors: report.errors }, null, 2));
if (result.code || report.summary.errors) process.exitCode = 1;

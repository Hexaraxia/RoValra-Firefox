import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { root, readJson, writeJson, run, cleanGenerated, sha256, updateUrl, portVersion, filesUnder } from './common.mjs';
import { replaceArtwork } from './artwork.mjs';
import { applyCompatibility } from './compatibility.mjs';
import { applyPrivacy, REQUIRED_DATA_COLLECTION } from './privacy.mjs';

const args = process.argv.slice(2);
const lockIndex = args.indexOf('--lock');
const lock = await readJson(path.resolve(root, lockIndex >= 0 ? args[lockIndex + 1] : 'upstream.lock.json'));
const config = await readJson(path.join(root, 'firefox.config.json'));
if (lock.repository !== 'NotValra/RoValra' || lock.repository !== config.upstreamRepository || !/^[a-f0-9]{40}$/.test(lock.commit)) throw new Error('Invalid upstream source lock');
const version = portVersion(lock.version, config.portRevision);
const source = path.join(root, '.cache/build-source');
const archivePath = path.join(root, `.cache/upstream-${lock.commit}.zip`);
await fs.mkdir(path.dirname(archivePath), { recursive: true });
let archive;
try { archive = await fs.readFile(archivePath); }
catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://codeload.github.com/${lock.repository}/zip/${lock.commit}`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Source download failed: ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(archivePath, archive);
}
await cleanGenerated('.cache/build-source');
for (const [name, data] of Object.entries(unzipSync(archive))) {
    const relative = name.split('/').slice(1).join('/');
    if (!relative || relative.endsWith('/') || relative.startsWith('.github/')) continue;
    const target = path.resolve(source, relative);
    if (!target.startsWith(source + path.sep) || relative.includes('\\')) throw new Error('Unsafe archive path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
}
const manifest = await readJson(path.join(source, 'manifest.json'));
if (manifest.version !== lock.version || manifest.manifest_version !== 3 || manifest.background?.service_worker !== 'background.js') throw new Error('Upstream manifest requires a compatibility review');
const baseline = await readJson(path.join(root, 'upstream-surface.json'));
for (const key of ['permissions', 'optional_permissions', 'host_permissions', 'content_scripts', 'web_accessible_resources']) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(baseline[key])) throw new Error(`Upstream ${key} changed. Review and update upstream-surface.json before release.`);
}
console.log(`Building upstream ${lock.version} (${lock.commit}) as Firefox ${version}`);
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await run(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(root, '.cache/npm')], { cwd: source });
const privacyChanges = await applyPrivacy(source);
const compatibilityChanges = await applyCompatibility(source);
const artwork = await replaceArtwork(source);
manifest.name = config.name;
manifest.description = 'Personal Firefox port of RoValra, with a signed automatic update pipeline.';
manifest.version = version;
manifest.background = { scripts: ['background.js'] };
manifest.optional_permissions = manifest.optional_permissions.filter((permission) => permission !== 'contextMenus');
manifest.permissions.push('menus');
const isolatedContent = manifest.content_scripts.find((entry) => entry.js.includes('content.js'));
isolatedContent.js.unshift('draco_decoder.js');
manifest.host_permissions = [...new Set([...manifest.host_permissions, 'https://*.rbxcdn.com/*', 'https://rbxcdn.com/*', 'https://apis.rovalra.com/*', 'https://status.rovalra.com/*', 'https://flagcdn.com/*'])];
manifest.browser_specific_settings = { gecko: {
    id: config.addonId,
    strict_min_version: config.minimumFirefoxVersion,
    data_collection_permissions: { required: REQUIRED_DATA_COLLECTION },
    ...(config.repository ? { update_url: updateUrl(config.repository) } : {}),
} };
delete manifest.update_url;
await writeJson(path.join(source, 'manifest.json'), manifest);
await fs.writeFile(path.join(source, 'FIREFOX-NOTICE.txt'), 'Unofficial personal Firefox adaptation of RoValra.\nUpstream: https://github.com/NotValra/RoValra\nSource commit: ' + lock.commit + '\nThe upstream restricted artwork has been replaced with original geometric artwork.\nSource code and modifications are distributed under GPL-3.0-only.\n');
await run(process.execPath, ['build.js'], { cwd: source });
await cleanGenerated('dist/firefox');
await fs.cp(path.join(source, 'dist'), path.join(root, 'dist/firefox'), { recursive: true });
for (const name of ['LICENSE', 'PrivacyPolicy.md', 'FIREFOX-NOTICE.txt']) await fs.copyFile(path.join(source, name), path.join(root, 'dist/firefox', name));
const built = await readJson(path.join(root, 'dist/firefox/manifest.json'));
for (const required of ['background.js', 'content.js', 'intercept.js', 'css/sitewide.css', 'css/rovalra.css', built.action.default_popup]) await fs.access(path.join(root, 'dist/firefox', required));
const hashes = {};
for (const file of await filesUnder(path.join(root, 'dist/firefox'))) hashes[path.relative(path.join(root, 'dist/firefox'), file).replaceAll('\\', '/')] = sha256(await fs.readFile(file));
await writeJson(path.join(root, 'artifacts/build-info.json'), {
    upstream: lock, version, addonId: config.addonId,
    updateUrl: built.browser_specific_settings.gecko.update_url ?? null,
    minFirefoxVersion: config.minimumFirefoxVersion,
    sourceArchiveSha256: sha256(archive),
    upstreamPackageLockSha256: sha256(await fs.readFile(path.join(source, 'package-lock.json'))),
    compatibilityChanges, privacyChanges, replacedArtwork: artwork, files: hashes,
});
console.log(`Firefox build complete: dist/firefox (${config.repository ? 'update feed configured' : 'local preview; configure a repository before signing'})`);

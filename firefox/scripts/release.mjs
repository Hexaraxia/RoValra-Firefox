import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { unzipSync } from 'fflate';
import { root, readJson, writeJson, sha256, updateUrl, validateRepository } from './common.mjs';

export function validateBuildInfo(info, repository) {
    validateRepository(repository);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(info.version ?? '') || info.version.split('.').some((part) => Number(part) > 65535)) throw new Error('Invalid Firefox release version');
    if (typeof info.addonId !== 'string' || !info.addonId) throw new Error('Missing add-on ID');
    if (info.updateUrl !== updateUrl(repository)) throw new Error('Build update URL does not match the release repository');
    if (!/^\d+(?:\.\d+)*$/.test(info.minFirefoxVersion ?? '')) throw new Error('Invalid minimum Firefox version');
    if (!/^[a-f0-9]{40}$/.test(info.upstream?.commit ?? '')) throw new Error('Invalid upstream commit');
    validateRepository(info.upstream.repository);
    return info;
}

export function validateArchive(bytes, info) {
    const entries = unzipSync(bytes);
    for (const name of Object.keys(entries)) {
        if (name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => part === '..') || /^[A-Za-z]:/.test(name)) throw new Error(`Unsafe archive path: ${name}`);
    }
    if (!entries['manifest.json']) throw new Error('Archive is missing manifest.json');
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
    const gecko = manifest.browser_specific_settings?.gecko;
    if (manifest.version !== info.version) throw new Error('Archive version does not match build');
    if (gecko?.id !== info.addonId) throw new Error('Archive add-on ID does not match build');
    if (gecko?.update_url !== info.updateUrl) throw new Error('Archive update URL does not match build');
    if (gecko?.strict_min_version !== info.minFirefoxVersion) throw new Error('Archive minimum Firefox version does not match build');
    return entries;
}

export function validateSignedArchive(signedBytes, unsignedBytes, info) {
    const signed = validateArchive(signedBytes, info);
    const unsigned = validateArchive(unsignedBytes, info);
    const jar = ['META-INF/mozilla.rsa', 'META-INF/mozilla.sf', 'META-INF/manifest.mf'];
    const cose = ['META-INF/cose.manifest', 'META-INF/cose.sig'];
    const signatureNames = new Set([...jar, ...cose]);
    if (Object.keys(unsigned).some((name) => signatureNames.has(name))) throw new Error('Unsigned package unexpectedly contains signing metadata');
    const hasJar = jar.every((name) => signed[name]?.length > 0);
    const hasCose = cose.every((name) => signed[name]?.length > 0);
    if (!hasJar && !hasCose) throw new Error('Signed XPI is missing Mozilla signature entries');
    const payload = (entries) => Object.keys(entries).filter((name) => !name.endsWith('/') && !signatureNames.has(name)).sort();
    const names = payload(unsigned);
    if (JSON.stringify(names) !== JSON.stringify(payload(signed))) throw new Error('Signed XPI file list does not match the tested unsigned package');
    for (const name of names) {
        if (name === 'manifest.json') {
            const parse = (bytes) => JSON.parse(Buffer.from(bytes).toString('utf8'));
            if (!isDeepStrictEqual(parse(signed[name]), parse(unsigned[name]))) throw new Error('Signed XPI manifest values differ from the tested package');
            continue;
        }
        if (!Buffer.from(signed[name]).equals(Buffer.from(unsigned[name]))) throw new Error(`Signed XPI content differs from the tested package: ${name}`);
    }
    return sha256(signedBytes);
}

export function makeUpdateManifest(info, repository, hash) {
    validateBuildInfo(info, repository);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid signed XPI SHA-256');
    return {
        addons: {
            [info.addonId]: {
                updates: [{
                    version: info.version,
                    update_link: `https://github.com/${repository}/releases/download/firefox-v${info.version}/rovalra-firefox-${info.version}.xpi`,
                    update_hash: `sha256:${hash}`,
                    applications: { gecko: { strict_min_version: info.minFirefoxVersion } }
                }]
            }
        }
    };
}

export function compareVersions(left, right) {
    for (const [index, value] of left.split('.').map(Number).entries()) {
        const other = Number(right.split('.')[index] ?? 0);
        if (value !== other) return value > other ? 1 : -1;
    }
    return 0;
}

export async function releaseContext() {
    const config = await readJson(path.join(root, 'firefox.config.json'));
    const repository = validateRepository(config.repository);
    if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== repository) throw new Error('Configured repository differs from GITHUB_REPOSITORY');
    const info = validateBuildInfo(await readJson(path.join(root, 'artifacts/build-info.json')), repository);
    if (info.addonId !== config.addonId) throw new Error('Build add-on ID differs from configuration');
    return { info, repository };
}

export async function prepareRelease() {
    const { info, repository } = await releaseContext();
    const directory = path.join(root, 'artifacts');
    const signedDir = path.join(directory, 'signed');
    const signedFiles = (await fs.readdir(signedDir)).filter((name) => name.endsWith('.xpi'));
    if (signedFiles.length !== 1) throw new Error('Expected exactly one signed XPI');
    const signed = await fs.readFile(path.join(signedDir, signedFiles[0]));
    const unsigned = await fs.readFile(path.join(directory, `rovalra-firefox-${info.version}-unsigned.zip`));
    const hash = validateSignedArchive(signed, unsigned, info);
    const filename = `rovalra-firefox-${info.version}.xpi`;
    const sourceName = `rovalra-firefox-${info.version}-source.zip`;
    const source = await fs.readFile(path.join(directory, sourceName));
    await fs.writeFile(path.join(directory, filename), signed);
    await writeJson(path.join(directory, 'updates.json'), makeUpdateManifest(info, repository, hash));
    const release = {
        tag: `firefox-v${info.version}`,
        title: `RoValra for Firefox ${info.version}`,
        repository,
        version: info.version,
        assets: [filename, sourceName, 'updates.json', 'build-info.json', 'SHA256SUMS'],
        body: `Unofficial Firefox port of RoValra ${info.upstream.version}.\n\nInstall ${filename} in Firefox. Existing installations update through the signed update feed.\n\nUpstream: https://github.com/${info.upstream.repository}/commit/${info.upstream.commit}\n\nMinimum Firefox: ${info.minFirefoxVersion}\nSigned XPI SHA-256: ${hash}\nSource SHA-256: ${sha256(source)}`
    };
    const checksums = [];
    for (const name of release.assets.filter((name) => name !== 'SHA256SUMS')) checksums.push(`${sha256(await fs.readFile(path.join(directory, name)))}  ${name}`);
    await fs.writeFile(path.join(directory, 'SHA256SUMS'), checksums.join('\n') + '\n');
    await writeJson(path.join(directory, 'release.json'), release);
    console.log(`Prepared signed release ${release.tag}`);
    return release;
}

async function github(route, options = {}, allowMissing = false) {
    const response = await fetch(`https://api.github.com${route}`, {
        ...options,
        headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'rovalra-firefox-release',
            ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        },
        signal: AbortSignal.timeout(60000)
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${options.method ?? 'GET'} ${route} returned ${response.status}`);
    return response.status === 204 ? null : response.json();
}

export async function checkRelease() {
    const { info, repository } = await releaseContext();
    const release = await github(`/repos/${repository}/releases/tags/firefox-v${info.version}`, {}, true);
    const needed = !release || release.draft;
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `needed=${needed}\nversion=${info.version}\n`);
    console.log(needed ? `Release ${info.version} needs signing and publication` : `Release ${info.version} is already published`);
}

export async function publishRelease() {
    if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required to publish a release');
    const release = await prepareRelease();
    const base = `/repos/${release.repository}/releases`;
    const latest = await github(`${base}/latest`, {}, true);
    const latestVersion = latest?.tag_name?.match(/^firefox-v(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (latestVersion && compareVersions(release.version, latestVersion) < 0) throw new Error('Refusing to replace the update feed with an older Firefox version');
    let draft = await github(`${base}/tags/${release.tag}`, {}, true);
    if (draft && !draft.draft) throw new Error(`${release.tag} is already public; published releases are immutable. Increment portRevision for changes.`);
    if (!draft) {
        const payload = { tag_name: release.tag, name: release.title, body: release.body, draft: true, prerelease: false };
        if (process.env.GITHUB_SHA) payload.target_commitish = process.env.GITHUB_SHA;
        draft = await github(base, { method: 'POST', body: JSON.stringify(payload) });
    }
    if (draft.assets.some((asset) => !release.assets.includes(asset.name))) throw new Error('Draft contains unexpected assets; inspect them before publishing');
    for (const name of release.assets) {
        const existing = draft.assets.find((asset) => asset.name === name);
        if (existing) await github(`${base}/assets/${existing.id}`, { method: 'DELETE' });
        const bytes = await fs.readFile(path.join(root, 'artifacts', name));
        const url = new URL(draft.upload_url.split('{')[0]);
        if (url.origin !== 'https://uploads.github.com') throw new Error('Unexpected GitHub upload origin');
        url.searchParams.set('name', name);
        const response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/octet-stream', 'User-Agent': 'rovalra-firefox-release' },
            body: bytes,
            signal: AbortSignal.timeout(120000)
        });
        if (!response.ok) throw new Error(`Uploading ${name} failed with ${response.status}; the release remains a draft`);
        const asset = await response.json();
        if (asset.size !== bytes.length || (asset.digest && asset.digest !== `sha256:${sha256(bytes)}`)) throw new Error(`Uploaded asset verification failed for ${name}`);
    }
    const assets = await github(`${base}/${draft.id}/assets?per_page=100`);
    if (!release.assets.every((name) => assets.some((asset) => asset.name === name && asset.state === 'uploaded'))) throw new Error('Release assets are incomplete; the release remains a draft');
    const published = await github(`${base}/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ draft: false, make_latest: 'true', name: release.title, body: release.body }) });
    console.log(`Published ${published.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        if (process.argv.includes('--publish')) await publishRelease();
        else if (process.argv.includes('--check')) await checkRelease();
        else await prepareRelease();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

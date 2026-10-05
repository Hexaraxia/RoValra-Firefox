import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, readJson, writeJson, validateRepository, upstreamVersionParts, portVersion } from './common.mjs';

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'rovalra-firefox-builder' };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
async function get(url) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${url}`);
    return response.json();
}
export async function resolveLatestRelease(repository, request = get) {
    const base = `https://api.github.com/repos/${validateRepository(repository)}`;
    const release = await request(`${base}/releases/latest`);
    if (release.draft || release.prerelease || typeof release.tag_name !== 'string') throw new Error('Latest release is not a stable version');
    const version = release.tag_name.replace(/^v/, '');
    upstreamVersionParts(version);
    const commit = await request(`${base}/commits/${encodeURIComponent(release.tag_name)}`);
    if (!/^[a-f0-9]{40}$/.test(commit.sha ?? '')) throw new Error('Invalid upstream commit');
    return { repository, commit: commit.sha, version, tag: release.tag_name };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const config = await readJson(path.join(root, 'firefox.config.json'));
    const candidate = await resolveLatestRelease(config.upstreamRepository);
    portVersion(candidate.version, config.portRevision);
    await writeJson(path.join(root, '.cache/candidate.json'), candidate);
    console.log(JSON.stringify(candidate, null, 2));
}

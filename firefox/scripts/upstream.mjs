import path from 'node:path';
import { root, readJson, writeJson } from './common.mjs';

const config = await readJson(path.join(root, 'firefox.config.json'));
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'rovalra-firefox-builder' };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
async function get(url) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${url}`);
    return response.json();
}
const base = `https://api.github.com/repos/${config.upstreamRepository}`;
const release = await get(`${base}/releases/latest`);
if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Latest release is not a stable three-part version');
const commit = await get(`${base}/commits/${encodeURIComponent(release.tag_name)}`);
const candidate = { repository: config.upstreamRepository, commit: commit.sha, version: release.tag_name.replace(/^v/, ''), tag: release.tag_name };
if (!/^[a-f0-9]{40}$/.test(candidate.commit)) throw new Error('Invalid upstream commit');
await writeJson(path.join(root, '.cache/candidate.json'), candidate);
console.log(JSON.stringify(candidate, null, 2));

import test from 'node:test';
import assert from 'node:assert/strict';
import { portVersion, updateUrl, validateRepository, upstreamManifestVersionMatches } from '../scripts/common.mjs';
import { resolveLatestRelease } from '../scripts/upstream.mjs';
import { compareVersions } from '../scripts/release.mjs';

test('port versions increase independently and reject ambiguous upstream versions', () => {
    assert.equal(portVersion('2.6.13', 1), '2.6.13.1');
    assert.equal(portVersion('2.6.13', 2), '2.6.13.2');
    assert.equal(portVersion('2.6.14.1', 3), '2.6.14.103');
    assert.equal(portVersion('2.6.14.0', 3), portVersion('2.6.14', 3));
    assert.equal(portVersion('2.6.14.655', 35), '2.6.14.65535');
    for (const [version, revision] of [['2.6.13.1.1', 1], ['2.6.13beta', 1], ['2.06.13', 1], ['2.6.14.01', 1], ['65536.0.0', 1], ['2.6.14.655', 36], ['2.6.14.656', 1], ['2.6.13', 0], ['2.6.13', 100], ['2.6.13', 1.5]]) assert.throws(() => portVersion(version, revision));
});

test('upstream hotfixes and port corrections preserve Firefox update ordering', () => {
    const versions = [['2.6.13', 3], ['2.6.14', 3], ['2.6.14', 99], ['2.6.14.1', 1], ['2.6.14.1', 3], ['2.6.14.1', 99], ['2.6.14.2', 1], ['2.6.15', 1]];
    for (let i = 1; i < versions.length; i++) assert.equal(compareVersions(portVersion(...versions[i]), portVersion(...versions[i - 1])), 1);
});

test('a hotfix release may retain its base manifest version without accepting unrelated sources', () => {
    for (const [manifest, tag] of [['2.6.13', '2.6.13'], ['2.6.14.1', '2.6.14.1'], ['2.6.14', '2.6.14.1']]) assert.equal(upstreamManifestVersionMatches(manifest, tag), true);
    for (const [manifest, tag] of [['2.6.13', '2.6.14.1'], ['2.6.15', '2.6.14.1'], ['2.6.14.2', '2.6.14.1'], ['2.6.14.1', '2.6.14'], ['2.7.14', '2.6.14.1']]) assert.equal(upstreamManifestVersionMatches(manifest, tag), false);
    assert.throws(() => upstreamManifestVersionMatches('2.6.14-beta', '2.6.14.1'));
});

test('release discovery accepts stable three- and four-part tags and locks their commit', async () => {
    for (const tag of ['v2.6.13', 'v2.6.14.1', '2.6.14.1']) {
        const calls = [];
        const candidate = await resolveLatestRelease('NotValra/RoValra', async (url) => {
            calls.push(url);
            return calls.length === 1 ? { tag_name: tag, draft: false, prerelease: false } : { sha: 'a'.repeat(40) };
        });
        assert.deepEqual(candidate, { repository: 'NotValra/RoValra', version: tag.replace(/^v/, ''), tag, commit: 'a'.repeat(40) });
        assert.deepEqual(calls, ['https://api.github.com/repos/NotValra/RoValra/releases/latest', `https://api.github.com/repos/NotValra/RoValra/commits/${tag}`]);
    }
});

test('release discovery rejects drafts, prereleases, invalid tags, and invalid commits', async () => {
    for (const release of [{ tag_name: 'v2.6.14.1', draft: true }, { tag_name: 'v2.6.14.1', prerelease: true }, { tag_name: 'v2.6.14-beta' }, { tag_name: 'v2.06.14' }, { tag_name: 'v2.6.14.1.1' }, { tag_name: null }]) {
        let calls = 0;
        await assert.rejects(resolveLatestRelease('NotValra/RoValra', async () => { calls++; return release; }));
        assert.equal(calls, 1);
    }
    await assert.rejects(resolveLatestRelease('NotValra/RoValra', async (url) => url.endsWith('/releases/latest') ? { tag_name: 'v2.6.14.1' } : { sha: 'main' }), /Invalid upstream commit/);
});
test('release feed stays on stable HTTPS latest-release endpoint', () => {
    assert.equal(updateUrl('example/rovalra-firefox'), 'https://github.com/example/rovalra-firefox/releases/latest/download/updates.json');
    for (const repo of [null, '', 'https://evil.test', 'owner/repo?token=x', 'owner/repo/extra']) assert.throws(() => validateRepository(repo));
});

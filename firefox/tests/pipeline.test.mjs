import test from 'node:test';
import assert from 'node:assert/strict';
import { portVersion, updateUrl, validateRepository } from '../scripts/common.mjs';

test('port versions increase independently and reject ambiguous upstream versions', () => {
    assert.equal(portVersion('2.6.13', 1), '2.6.13.1');
    assert.equal(portVersion('2.6.13', 2), '2.6.13.2');
    for (const [version, revision] of [['2.6.13.1', 1], ['2.6.13beta', 1], ['2.6.13', 0], ['2.6.13', 65536]]) assert.throws(() => portVersion(version, revision));
});
test('release feed stays on stable HTTPS latest-release endpoint', () => {
    assert.equal(updateUrl('example/rovalra-firefox'), 'https://github.com/example/rovalra-firefox/releases/latest/download/updates.json');
    for (const repo of [null, '', 'https://evil.test', 'owner/repo?token=x', 'owner/repo/extra']) assert.throws(() => validateRepository(repo));
});

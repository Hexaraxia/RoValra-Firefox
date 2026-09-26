import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { validateBuildInfo, validateSignedArchive, makeUpdateManifest, compareVersions } from '../scripts/release.mjs';
import { existingVersionState } from '../scripts/sign.mjs';
import { sha256 } from '../scripts/common.mjs';

const repository = 'example/rovalra-firefox';
const info = {
    version: '2.6.13.1',
    addonId: '{12345678-1234-1234-1234-123456789abc}',
    minFirefoxVersion: '140.0',
    updateUrl: `https://github.com/${repository}/releases/latest/download/updates.json`,
    upstream: { repository: 'NotValra/RoValra', commit: 'a'.repeat(40), version: '2.6.13' }
};
const manifest = {
    manifest_version: 3,
    name: 'Test fixture',
    version: info.version,
    browser_specific_settings: { gecko: { id: info.addonId, strict_min_version: info.minFirefoxVersion, update_url: info.updateUrl } }
};
const payload = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'background.js': strToU8('globalThis.example = true;')
};
const signatures = {
    'META-INF/mozilla.rsa': strToU8('fixture signature marker'),
    'META-INF/mozilla.sf': strToU8('fixture signature metadata'),
    'META-INF/manifest.mf': strToU8('fixture file metadata')
};

test('signed payload must exactly match the tested package', () => {
    const unsigned = zipSync(payload);
    const signed = zipSync({ ...payload, ...signatures });
    assert.equal(validateSignedArchive(signed, unsigned, info), sha256(signed));
    assert.throws(() => validateSignedArchive(unsigned, unsigned, info), /missing Mozilla signature/);
    assert.throws(() => validateSignedArchive(zipSync({ ...payload, ...signatures, 'background.js': strToU8('different') }), unsigned, info), /content differs/);
    assert.throws(() => validateSignedArchive(zipSync({ ...payload, ...signatures, 'extra.js': strToU8('extra') }), unsigned, info), /file list/);
    assert.throws(() => validateSignedArchive(zipSync({ ...payload, ...signatures, 'META-INF/extra.js': strToU8('extra') }), unsigned, info), /file list/);
    assert.throws(() => validateSignedArchive(signed, signed, info), /unexpectedly contains signing metadata/);
});

test('Mozilla may reformat manifest JSON without changing any values', () => {
    const unsigned = zipSync(payload);
    const reordered = Object.fromEntries(Object.entries(manifest).reverse());
    reordered.browser_specific_settings = {
        gecko: Object.fromEntries(Object.entries(manifest.browser_specific_settings.gecko).reverse())
    };
    const signed = zipSync({ ...payload, ...signatures, 'manifest.json': strToU8(JSON.stringify(reordered, null, 4) + '\n') });
    assert.equal(validateSignedArchive(signed, unsigned, info), sha256(signed));
    for (const changed of [
        { ...manifest, name: 'Changed name' },
        { ...manifest, permissions: ['cookies'] },
        { ...manifest, browser_specific_settings: { ...manifest.browser_specific_settings, gecko_android: {} } },
        { ...manifest, manifest_version: '3' }
    ]) {
        assert.throws(() => validateSignedArchive(zipSync({ ...payload, ...signatures, 'manifest.json': strToU8(JSON.stringify(changed)) }), unsigned, info), /manifest values differ/);
    }
    const arrays = { ...manifest, permissions: ['storage', 'alarms'] };
    const arrayUnsigned = zipSync({ ...payload, 'manifest.json': strToU8(JSON.stringify(arrays)) });
    arrays.permissions.reverse();
    assert.throws(() => validateSignedArchive(zipSync({ ...payload, ...signatures, 'manifest.json': strToU8(JSON.stringify(arrays)) }), arrayUnsigned, info), /manifest values differ/);
});

test('a mismatched add-on ID, version, URL, or minimum Firefox version cannot reach the feed', () => {
    const unsigned = zipSync(payload);
    for (const [field, replacement] of [['id', 'other@example'], ['update_url', 'https://example.org/updates.json'], ['strict_min_version', '1.0']]) {
        const changed = structuredClone(manifest);
        changed.browser_specific_settings.gecko[field] = replacement;
        const signed = zipSync({ ...payload, ...signatures, 'manifest.json': strToU8(JSON.stringify(changed)) });
        assert.throws(() => validateSignedArchive(signed, unsigned, info), /does not match build/);
    }
    const changed = { ...manifest, version: '2.6.12.1' };
    assert.throws(() => validateSignedArchive(zipSync({ ...payload, ...signatures, 'manifest.json': strToU8(JSON.stringify(changed)) }), unsigned, info), /version does not match/);
});

test('update feeds advertise only the signed versioned XPI with its hash', () => {
    const hash = 'b'.repeat(64);
    const update = makeUpdateManifest(info, repository, hash).addons[info.addonId].updates[0];
    assert.equal(update.update_link, `https://github.com/${repository}/releases/download/firefox-v2.6.13.1/rovalra-firefox-2.6.13.1.xpi`);
    assert.equal(update.update_hash, `sha256:${hash}`);
    assert.equal(update.applications.gecko.strict_min_version, '140.0');
    assert.throws(() => makeUpdateManifest(info, 'other/repo', hash), /update URL/);
    assert.throws(() => makeUpdateManifest(info, repository, 'invalid'), /SHA-256/);
});

test('invalid release identity or archive paths are rejected', () => {
    assert.throws(() => validateBuildInfo({ ...info, version: '../escape' }, repository), /release version/);
    assert.throws(() => validateBuildInfo({ ...info, version: '2.6.13.65536' }, repository), /release version/);
    assert.throws(() => validateBuildInfo({ ...info, upstream: { ...info.upstream, commit: 'main' } }, repository), /upstream commit/);
    assert.throws(() => validateSignedArchive(zipSync({ ...payload, ...signatures, '../escape.js': strToU8('bad') }), zipSync(payload), info), /Unsafe archive path/);
});

test('AMO retries distinguish missing, pending, approved, and rejected versions', () => {
    assert.equal(existingVersionState(null, info.version), 'missing');
    const version = { version: info.version, channel: 'unlisted', file: { status: 'unreviewed' } };
    assert.equal(existingVersionState(version, info.version), 'pending');
    assert.equal(existingVersionState({ ...version, file: { status: 'public' } }, info.version), 'approved');
    assert.throws(() => existingVersionState({ ...version, file: { status: 'disabled' } }, info.version), /disabled or rejected/);
    assert.throws(() => existingVersionState({ ...version, channel: 'listed' }, info.version), /unlisted release/);
    assert.throws(() => existingVersionState({ ...version, version: '1.0' }, info.version), /unlisted release/);
});

test('numeric version ordering prevents an older feed from replacing a newer feed', () => {
    assert.equal(compareVersions('2.6.13.1', '2.6.13.1'), 0);
    assert.equal(compareVersions('2.6.13.2', '2.6.13.1'), 1);
    assert.equal(compareVersions('2.6.14.1', '2.6.13.9'), 1);
    assert.equal(compareVersions('2.6.9.1', '2.6.13.1'), -1);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fixAuthenticatedUserDomReady } from '../scripts/compatibility.mjs';

const source = await readFile(new URL('./fixtures/upstream-user.js', import.meta.url), 'utf8');
const fixedSource = await readFile(new URL('./fixtures/upstream-user-2.6.15.js', import.meta.url), 'utf8');

function createUserLookup(source, readyState, userId = null) {
    const document = new EventTarget();
    document.readyState = readyState;
    let queries = 0;
    document.querySelector = () => {
        queries++;
        return userId === null ? null : { getAttribute: () => String(userId) };
    };
    const stored = {};
    const chrome = { storage: { local: {
        async get() { return { ...stored }; },
        async set(values) { Object.assign(stored, values); },
    } } };
    const code = fixAuthenticatedUserDomReady(source).replace(/^import .*;\r?\n/gm, '').replaceAll('export async function ', 'async function ');
    const lookup = vm.runInNewContext(code + '\ngetAuthenticatedUserId;', { document, chrome });
    return { lookup, document, stored, queryCount: () => queries };
}

for (const [label, fixture] of [['legacy', source], ['upstream-fixed', fixedSource]]) {
test(`${label}: fresh logged-out content initialization resolves after DOMContentLoaded already fired`, { timeout: 1000 }, async () => {
    for (const readyState of ['interactive', 'complete']) {
        const { lookup, queryCount } = createUserLookup(fixture, readyState);
        assert.equal(await lookup(), null);
        assert.equal(queryCount(), 1);
    }
});

test(`${label}: fresh user lookup still waits for DOMContentLoaded and caches the user`, { timeout: 1000 }, async () => {
    const { lookup, document, stored, queryCount } = createUserLookup(fixture, 'loading', 123);
    let resolved = false;
    const result = lookup().then((id) => { resolved = true; return id; });
    await new Promise(setImmediate);
    assert.equal(resolved, false);
    assert.equal(queryCount(), 0);
    document.readyState = 'interactive';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    assert.equal(await result, 123);
    assert.equal(stored.rovalra_authed_user_id, 123);
});

test(`${label}: user lookup handles DOMContentLoaded firing during its storage read`, { timeout: 1000 }, async () => {
    const { lookup, document } = createUserLookup(fixture, 'loading');
    const result = lookup();
    document.readyState = 'complete';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    assert.equal(await result, null);
});
}

test('upstream-ready lookup is unchanged and unexpected readiness code still fails', () => {
    assert.equal(fixAuthenticatedUserDomReady(fixedSource), fixedSource);
    assert.throws(() => fixAuthenticatedUserDomReady(fixedSource.replace("document.readyState !== 'loading'", "document.readyState === 'loading'")), /ready-state helper/);
    assert.throws(() => fixAuthenticatedUserDomReady(fixedSource.replace('    const scrapedId = await scrapeAndCacheId();', '    const scrapedId = null;')), /DOM readiness/);
    assert.throws(() => fixAuthenticatedUserDomReady(fixedSource + fixedSource), /ready-state helper/);
});

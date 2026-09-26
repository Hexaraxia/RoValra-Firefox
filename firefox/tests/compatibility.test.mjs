import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../compatibility/api.js';
import { allowedFetchUrl, authorizedSender } from '../compatibility/policy.js';
import { ExtensionResponse, fetch as extensionFetch, fromLegacyResponse } from '../compatibility/fetch.js';
import { fetchWithValidatedRedirects, launch } from '../compatibility/background.js';
import { replaceExactly } from '../scripts/compatibility.mjs';
import { headerEntries, headersToObject } from '../compatibility/headers.js';

test('header serialization does not inspect a foreign realm iterator', () => {
    const headers = {
        forEach(callback) { callback('application/json', 'content-type'); callback('test-only', 'x-csrf-token'); },
        entries() { throw new Error('XrayWrapper iterator denied'); },
        get [Symbol.iterator]() { throw new Error('XrayWrapper iterator denied'); },
    };
    assert.deepEqual(headerEntries(headers), [['content-type', 'application/json'], ['x-csrf-token', 'test-only']]);
    assert.deepEqual(headersToObject(headers), { 'content-type': 'application/json', 'x-csrf-token': 'test-only' });
    assert.deepEqual(headerEntries([['X-Test', 'a'], ['X-Test', 'b']]), [['x-test', 'a, b']]);
});

test('API adapter preserves callback and Promise contracts and receiver', async () => {
    const chromeStorage = { get(key, callback) { assert.equal(this, chromeStorage); callback({ [key]: 1 }); } };
    const browserStorage = { get(key) { assert.equal(this, browserStorage); return Promise.resolve({ [key]: 2 }); } };
    const api = createApi({ storage: { local: chromeStorage } }, { storage: { local: browserStorage } });
    const callbackResult = await new Promise((resolve) => api.storage.local.get('test', resolve));
    assert.deepEqual(callbackResult, { test: 1 });
    assert.deepEqual(await api.storage.local.get('test'), { test: 2 });
});

test('fetch allowlist rejects lookalike hosts, insecure schemes and URL credentials', () => {
    for (const url of ['https://games.roblox.com/a', 'https://t0.rbxcdn.com/a', 'https://apis.rovalra.com/a']) assert.equal(allowedFetchUrl(url, 'moz-extension://test'), true);
    for (const url of ['https://roblox.com.evil.test/a', 'https://evilroblox.com/a', 'http://games.roblox.com/a', 'https://user:password@games.roblox.com/a', 'https://games.roblox.com:8443/a', 'file:///C:/secrets', 'https://127.0.0.1/a']) assert.equal(allowedFetchUrl(url, 'moz-extension://test'), false);
});

test('sender gate rejects external extensions and pages', () => {
    const runtime = { id: 'own-extension', getURL: () => 'moz-extension://own-extension/' };
    assert.equal(authorizedSender({ id: runtime.id, url: 'https://www.roblox.com/home', tab: { id: 1 } }, runtime), true);
    for (const sender of [
        { id: 'another-extension', url: 'https://www.roblox.com', tab: { id: 1 } },
        { id: runtime.id, url: 'https://roblox.com.evil.test', tab: { id: 1 } },
        { id: runtime.id, url: 'https://www.roblox.com' },
        { id: runtime.id, url: 'http://www.roblox.com', tab: { id: 1 } },
    ]) assert.equal(authorizedSender(sender, runtime), false);
});

test('response bodies and clones own their bytes and reject double consumption', async () => {
    const bytes = new TextEncoder().encode('{"answer":42}');
    const response = new ExtensionResponse({ bytes, status: 200, headers: [['content-type', 'application/json']] });
    bytes.fill(0);
    const copy = response.clone();
    assert.deepEqual(await response.json(), { answer: 42 });
    assert.deepEqual(await copy.json(), { answer: 42 });
    await assert.rejects(response.text(), /already used/);
    assert.throws(() => response.clone(), /already used/);
    const legacy = fromLegacyResponse({ body: new Uint8Array([1, 2, 3]).buffer, status: 200, headers: {} });
    assert.deepEqual([...new Uint8Array(await legacy.arrayBuffer())], [1, 2, 3]);
});

test('cross-origin redirects strip credentials and headers and remain allowlisted', async () => {
    const calls = [];
    const result = await fetchWithValidatedRedirects('https://assetdelivery.roblox.com/v1/asset?id=1', {
        method: 'GET', credentials: 'include', headers: { Authorization: 'test-only', 'x-csrf-token': 'test-only' },
    }, 'moz-extension://test', async (url, init) => {
        calls.push({ url, ...init });
        return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://t0.rbxcdn.com/asset' } }) : new Response('ok');
    });
    assert.equal(await result.text(), 'ok');
    assert.equal(calls[1].credentials, 'omit');
    assert.equal([...calls[1].headers].length, 0);
    let count = 0;
    await assert.rejects(fetchWithValidatedRedirects('https://assetdelivery.roblox.com/a', { method: 'GET' }, 'moz-extension://test', async () => {
        count++;
        return new Response(null, { status: 302, headers: { location: 'https://outside.test/a' } });
    }), /not allowed/);
    assert.equal(count, 1);
});

test('content fetch preserves page same-origin cookie behavior without leaking it to CDN', async () => {
    const priorBrowser = globalThis.browser;
    const priorLocation = globalThis.location;
    const requests = [];
    globalThis.location = { href: 'https://www.roblox.com/home', origin: 'https://www.roblox.com' };
    globalThis.browser = { runtime: { getURL: () => 'moz-extension://own-extension/', async sendMessage(message) {
        requests.push(message);
        return { bytes: new Uint8Array(), status: 200 };
    } } };
    try {
        await extensionFetch('/home');
        await extensionFetch('https://t0.rbxcdn.com/asset');
        await extensionFetch('https://users.roblox.com/v1/users/1', { credentials: 'include' });
        assert.deepEqual(requests.map((request) => request.init.credentials), ['include', 'omit', 'include']);
    } finally {
        globalThis.browser = priorBrowser;
        globalThis.location = priorLocation;
    }
});

test('typed launcher rejects JavaScript URLs and sends values as executeScript args', async () => {
    const prior = globalThis.browser;
    let injection;
    globalThis.browser = { scripting: { async executeScript(options) { injection = options; } } };
    try {
        await assert.rejects(launch({ launch: { method: 'openProtocolUrl', args: ['javascript:alert(1)'] } }, { tab: { id: 1 } }), /Invalid launch protocol/);
        await launch({ launch: { method: 'joinGameInstance', args: [123, "quoted'value"] } }, { tab: { id: 1 }, frameId: 0 });
        assert.equal(injection.world, 'MAIN');
        assert.equal(typeof injection.func, 'function');
        assert.deepEqual(injection.args, [{ method: 'joinGameInstance', args: [123, "quoted'value"] }]);
        assert.equal(injection.func.toString().includes('createElement'), false);
    } finally {
        globalThis.browser = prior;
    }
});

test('compatibility transforms fail closed when an anchor changes or duplicates', () => {
    assert.throws(() => replaceExactly('other', 'required', 'patched', 'test'), /anchor changed/);
    assert.throws(() => replaceExactly('required required', 'required', 'patched', 'test'), /anchor changed/);
});

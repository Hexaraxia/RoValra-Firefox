import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isolateFirefoxCompatibility } from '../scripts/compatibility.mjs';

const bridge = await readFile(new URL('./fixtures/upstream-firefox-proxy-2.6.15.txt', import.meta.url), 'utf8');
const importLine = "import './core/firefoxCompat.js';\n";
const index = importLine + 'initializeContent();\n';
const suffix = "        case 'fetchRobloxApi': return 'validated API';\n        default: return 'unknown';\n";
const background = 'switch (request.action) {\n' + bridge + suffix + '}';

test('the maintained Firefox build excludes the duplicate shim and its broad proxy handlers', () => {
    const result = isolateFirefoxCompatibility(index, background);
    assert.equal(result.index, 'initializeContent();\n');
    const dispatch = new Function('request', result.background);
    assert.equal(dispatch({ action: 'fetchRobloxApi' }), 'validated API');
    for (const action of ['proxyFetch', 'fetchImageAsDataUrl']) assert.equal(dispatch({ action, url: 'https://outside.test/' }), 'unknown');
});

test('older upstream versions with no Firefox shim remain supported', () => {
    assert.deepEqual(isolateFirefoxCompatibility('initializeContent();', suffix), { index: 'initializeContent();', background: suffix });
});

test('changed, partial, or duplicated upstream Firefox bridges require review', () => {
    assert.throws(() => isolateFirefoxCompatibility(index, background.replace("credentials: 'omit'", "credentials: 'include'")), /handlers changed/);
    assert.throws(() => isolateFirefoxCompatibility(index, suffix), /entry points changed/);
    assert.throws(() => isolateFirefoxCompatibility('initializeContent();', background), /entry points changed/);
    assert.throws(() => isolateFirefoxCompatibility(importLine + index, background), /anchor changed/);
    assert.throws(() => isolateFirefoxCompatibility(index, bridge + background), /handlers changed/);
});

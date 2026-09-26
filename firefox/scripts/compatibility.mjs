import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const templates = fileURLToPath(new URL('../compatibility/', import.meta.url));

export function replaceExactly(source, anchor, replacement, label, expected = 1) {
    const count = typeof anchor === 'string' ? source.split(anchor).length - 1 : [...source.matchAll(anchor)].length;
    if (count !== expected) throw new Error(`Firefox compatibility anchor changed (${label}): expected ${expected}, found ${count}`);
    return typeof anchor === 'string' ? source.split(anchor).join(replacement) : source.replace(anchor, replacement);
}

export function fixAuthenticatedUserDomReady(source) {
    return replaceExactly(source,
        "    await new Promise((resolve) => {\n        document.addEventListener('DOMContentLoaded', resolve, { once: true });\n    });",
        '    await waitForDom();',
        'authenticated user DOM readiness');
}

function replaceSection(source, start, end, replacement, label) {
    if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error(`Firefox compatibility section changed: ${label}`);
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (to < 0) throw new Error(`Firefox compatibility section order changed: ${label}`);
    return source.slice(0, from) + replacement + source.slice(to);
}

async function walk(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...await walk(filename));
        else if (/\.(js|ts)$/.test(entry.name)) result.push(filename);
    }
    return result;
}

export async function applyCompatibility(sourceDir, options = {}) {
    const root = path.resolve(sourceDir);
    if (['upstream', 'reference-firefox'].includes(path.basename(root))) throw new Error('Apply compatibility to a copied build source, never a cached original');
    const transforms = [];
    const edits = new Map();
    async function edit(relative, transform) {
        const filename = path.join(root, relative);
        const original = edits.get(filename) ?? (await readFile(filename, 'utf8')).replace(/\r\n/g, '\n');
        edits.set(filename, transform(original));
    }

    await edit('src/background/background.js', (source) => {
        source = `import { handleFirefoxMessage, verifySender, verifyFetchOptions, requestPermission } from '../firefox/background.js';\nimport { isRobloxHost } from '../firefox/policy.js';\n` + source;
        source = replaceExactly(source, 'const fetchOptions = { method, headers: { ...headers } };', "const fetchOptions = { method, headers: { ...headers }, credentials: isRobloxHost(new URL(url).hostname) ? 'include' : 'omit' };", 'background authenticated cookies');
        source = replaceExactly(source,
            'chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {\n    switch (request.action) {',
            `chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!verifySender(sender)) return false;
    if (handleFirefoxMessage(request, sender, sendResponse)) return true;
    switch (request.action) {`, 'background sender gate');
        source = replaceSection(source, "        case 'injectScript':", "        case 'toggleMemoryLeakFix':", '', 'remove inline launcher');
        source = replaceSection(source, "        case 'requestPermission':", "        case 'revokePermission':",
            `        case 'requestPermission':
            requestPermission(request.permission).then(sendResponse, () => sendResponse({ granted: false }));
            return true;

`, 'permission gesture');
        source = replaceExactly(source, "        case 'fetchRobloxApi':\n            callRobloxApiBackground(request.options)",
            `        case 'fetchRobloxApi':
            try { verifyFetchOptions(request.options); } catch (error) {
                sendResponse({ error: error.message });
                return false;
            }
            callRobloxApiBackground(request.options)`, 'existing proxy allowlist');
        return source;
    });
    transforms.push('sender-validated-background-messages', 'gesture-based-optional-permissions');
    await edit('src/background/settingsCompat.ts', (source) => replaceExactly(source,
        'chrome.tabs.sendMessage(tabs[0].id, { type: "settingsCompatResultData", replaced: replaced, deleted: deleted }, () => {});',
        'chrome.tabs.sendMessage(tabs[0].id, { type: "settingsCompatResultData", replaced: replaced, deleted: deleted }, () => { void chrome.runtime.lastError; });',
        'settings migration inactive-tab callback'));

    await edit('src/content/core/api.js', (source) => {
        source = `import { fromLegacyResponse } from '../../firefox/fetch.js';\nimport { headersToObject } from '../../firefox/headers.js';\n` + source;
        source = replaceExactly(source, 'Object.fromEntries(\n                                normalizedHeaders.entries(),\n                            )', 'headersToObject(normalizedHeaders)', 'API headers extension-owned entries');
        return replaceExactly(source, 'resolve(new Response(body, init));', 'resolve(fromLegacyResponse({ body, ...init }));', 'legacy background response realm');
    });
    await edit('src/content/features/developer/apiDocs.js', (source) => {
        source = `import { headersToObject } from '../../../firefox/headers.js';\n` + source;
        return replaceExactly(source, 'Object.fromEntries(nextHeaders.entries())', 'headersToObject(nextHeaders)', 'developer API headers extension-owned entries');
    });
    await edit('src/content/index.js', (source) => replaceExactly(source,
        '            requestIdleCallback(runSettingsMaintenance, { timeout: 5000 });',
        '            window.requestIdleCallback(runSettingsMaintenance, { timeout: 5000 });',
        'settings maintenance Window receiver'));
    await edit('src/content/features/sitewide/wideTilePlayerCounts.js', (source) => replaceExactly(source,
        '        window.requestIdleCallback || ((callback) => setTimeout(callback, 300));',
        '        (window.requestIdleCallback && ((callback, options) => window.requestIdleCallback(callback, options))) || ((callback) => setTimeout(callback, 300));',
        'player count idle Window receiver'));
    transforms.push('extension-owned-header-entries', 'bound-idle-callbacks');

    await edit('src/content/core/user.js', fixAuthenticatedUserDomReady);
    transforms.push('authenticated-user-dom-readiness');

    await edit('src/content/core/utils/launcher.js', (source) => {
        source = replaceExactly(source, "chrome.runtime.sendMessage({ action: 'injectScript', codeToInject });", "chrome.runtime.sendMessage({ action: 'firefoxLaunch', launch: codeToInject }).then((result) => { if (result?.error) console.error('RoValra launch failed:', result.error); });", 'typed launcher transport');
        source = replaceSection(source, 'export function launchGame(placeId, jobId = null) {', 'export function followUser(userId) {',
            `export function launchGame(placeId, jobId = null) {
    runLaunch(placeId, { method: 'joinGameInstance', args: jobId ? [Number(placeId), jobId] : [Number(placeId)] });
}

export function launchPrivateGame(placeId, accessCode, linkCode) {
    runLaunch(placeId, { method: 'joinPrivateGame', args: [Number(placeId), accessCode, linkCode] });
}

export function launchMultiplayerGame(placeId, launchData = {}) {
    window.__rovalra_skipNextLaunch = true;
    runLaunch(placeId, { method: 'joinMultiplayerGame', args: [Number(placeId), false, false, null, null, { launchData }] });
}

`, 'game launch variants');
        source = replaceSection(source, '    const placeLauncherUrl =', '    if (!followUserHook) {',
            "    const codeToInject = { method: 'followPlayerIntoGame', args: [uId] };\n\n", 'follow launch');
        source = replaceSection(source, 'export function openWebChat(userId) {', 'export async function launchStudioForGame(placeId) {',
            `export function openWebChat(userId) {
    const uId = parseInt(userId, 10);
    if (uId) executeLaunchScript({ method: 'navigateToDeepLink', args: ['roblox://navigation/chat?userId=' + uId] });
}

`, 'chat launch');
        source = replaceSection(source, '            const editFunction =', '            executeLaunchScript(codeToInject);',
            "            const codeToInject = { method: 'editGameInStudio', args: [Number(placeId), Number(universeId)] };\n", 'studio launch');
        source = replaceExactly(source, "const codeToInject = `window.location.href = '${uri}';`;", "const codeToInject = { method: 'openProtocolUrl', args: [uri] };", 'studio fallback');
        source = replaceExactly(source, /export function launchDeeplink\(url\) \{[\s\S]*?\n\}/g,
            `export function launchDeeplink(url) {
    executeLaunchScript({ method: 'openProtocolUrl', args: [url] });
}`, 'deep link launch');
        return source;
    });
    transforms.push('typed-main-world-launcher');

    for (const relative of ['src/content/features/profile/header/ProfileRender.js', 'src/content/features/catalog/ItemRender.ts']) {
        await edit(relative, (source) => {
            const depth = relative.includes('/profile/') ? '../../../../firefox/' : '../../../firefox/';
            source = replaceExactly(source, "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';", `import { GLTFLoader, CubeTextureLoader } from '${depth}resources.js';\nimport { transformSkyboxImage as transformFirefoxSkyboxImage } from '${depth}renderer.js';`, 'GLTF image and buffer transport');
            source = replaceExactly(source, 'new THREE.CubeTextureLoader()', 'new CubeTextureLoader()', 'skybox clean texture loader');
            if (relative.endsWith('ItemRender.ts')) {
                source = replaceSection(source, 'function transformSkyboxImage(url: string,', 'async function applyItemRenderSkybox(',
                    `const transformSkyboxImage = transformFirefoxSkyboxImage;\n\n`, 'item skybox transforms');
            } else {
                source = replaceSection(source, '                    const rotateSkyboxImage = (url, angle) => {', '                    try {\n                        const [up, dn]',
                    '                    const rotateSkyboxImage = (url, angle) => transformFirefoxSkyboxImage(url, { angle });\n\n', 'profile skybox transforms');
            }
            return source;
        });
    }
    transforms.push('gltf-extension-fetch-and-textures', 'origin-clean-skyboxes');

    await edit('src/content/core/utils/renderer.ts', (source) => replaceSection(source,
        'export function backgroundRendererRequests() {', '//get css color value from :root',
        `export function backgroundRendererRequests() {
    FLAGS.FETCH_FUNC = fetch;
}

`, 'renderer background transport'));

    await edit('build.js', (source) => replaceExactly(source,
        'const commonConfig = {',
        `const patchFirefoxRenderer = require('./src/firefox/renderer-transform.cjs');
const commonConfig = {
    plugins: [{
        name: 'firefox-renderer-compatibility',
        setup(build) {
            build.onLoad({ filter: /roavatar-renderer[\\\\/]dist[\\\\/]index\\.js$/ }, (args) => ({
                contents: patchFirefoxRenderer(fs.readFileSync(args.path, 'utf8').replace(/\\r\\n/g, '\\n')),
                loader: 'js',
                resolveDir: path.dirname(args.path),
            }));
        },
    }],`, 'reproducible renderer build plugin'));
    transforms.push('renderer-response-realms', 'renderer-origin-clean-textures');

    await edit('build.js', (source) => {
        source = replaceExactly(source, "const dracoSource = fs.readFileSync(dracoPath, 'utf8');", `const dracoSource = fs.readFileSync(dracoPath, 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/draco_decoder.js', bannerText + '\\n' + dracoSource);`, 'separate Draco decoder');
        return replaceExactly(source, "js: bannerText + '\\n' + dracoSource,", 'js: bannerText,', 'content banner Draco removal').replace(
            "outfile: 'dist/content.js',", "outfile: 'dist/content.js',\n        minify: true,\n        minifyWhitespace: true,\n        minifyIdentifiers: true,"
        );
    });
    transforms.push('separate-draco-decoder', 'minified-content-bundle');

    let apiCount = 0;
    let eventCount = 0;
    let fetchCount = 0;
    for (const filename of await walk(path.join(root, 'src'))) {
        if (filename.includes(`${path.sep}xhr${path.sep}intercept.js`)) continue;
        await edit(path.relative(root, filename), (source) => {
            source = source.replace(/(['"])contextMenus\1/g, "'menus'");
            const imports = [];
            const relative = (name) => {
                const value = path.relative(path.dirname(filename), path.join(root, 'src/firefox', name)).replace(/\\/g, '/');
                return value.startsWith('.') ? value : `./${value}`;
            };
            if (/\bchrome\./.test(source)) {
                imports.push(`import { chrome } from '${relative('api.js')}';`);
                apiCount++;
            }
            if (filename.includes(`${path.sep}content${path.sep}`)) {
                if (/new CustomEvent\(/.test(source)) {
                    imports.push(`import { CustomEvent } from '${relative('events.js')}';`);
                    eventCount++;
                }
                if (/(?<![.\w])fetch\s*\(/.test(source) || filename.endsWith(`${path.sep}utils${path.sep}renderer.ts`)) {
                    imports.push(`import { fetch } from '${relative('fetch.js')}';`);
                    fetchCount++;
                }
            }
            return imports.length ? imports.join('\n') + '\n' + source : source;
        });
    }
    if (!apiCount || !eventCount || !fetchCount) throw new Error('Expected Firefox adapter call sites are missing');
    transforms.push(`mixed-api-calling-conventions:${apiCount}`, `cross-compartment-events:${eventCount}`, `allowlisted-extension-fetch:${fetchCount}`);

    await mkdir(path.join(root, 'src/firefox'), { recursive: true });
    for (const name of ['api.js', 'events.js', 'policy.js', 'headers.js', 'fetch.js', 'renderer.js', 'resources.js', 'background.js', 'renderer-transform.cjs']) {
        await copyFile(path.join(templates, name), path.join(root, 'src/firefox', name));
    }
    for (const name of ['firefox-permissions.html', 'firefox-permissions.js']) {
        await copyFile(path.join(templates, name), path.join(root, 'public/Assets', name));
    }
    for (const [filename, source] of edits) await writeFile(filename, source);
    return transforms;
}

import { allowedFetchUrl, authorizedSender, isRobloxHost } from './policy.js';
import { headerEntries } from './headers.js';

const requests = new Map();
const permissionRequests = new Map();
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export function verifySender(sender) {
    return authorizedSender(sender, browser.runtime);
}

export function verifyFetchOptions(options = {}) {
    const value = options.fullUrl || `https://${options.subdomain || 'apis'}.roblox.com${options.endpoint || ''}`;
    if (!allowedFetchUrl(value, new URL(browser.runtime.getURL('/')).origin)) {
        throw new Error('Fetch destination is outside the Firefox compatibility allowlist');
    }
}

async function readResponse(response) {
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Response exceeds 64 MiB');
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error('Response exceeds 64 MiB');
            }
            chunks.push(value);
        }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return {
        bytes, status: response.status, statusText: response.statusText,
        headers: headerEntries(response.headers), url: response.url, redirected: response.redirected,
    };
}

export async function fetchWithValidatedRedirects(resource, init, extensionOrigin, fetchFunction = fetch) {
    let url = new URL(resource);
    let options = { method: 'GET', ...init, headers: new Headers(init.headers), redirect: 'manual' };
    for (let count = 0; count < 6; count++) {
        if (!allowedFetchUrl(url.href, extensionOrigin)) throw new Error('Redirect destination is not allowed');
        const response = await fetchFunction(url.href, options);
        if (response.type === 'opaqueredirect') throw new Error('Firefox did not expose a redirect for safe validation');
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect has no destination');
        const next = new URL(location, url.href);
        if (next.origin !== url.origin) {
            if (!['GET', 'HEAD'].includes(options.method)) throw new Error('Cross-origin redirect with a request body is not allowed');
            options = { ...options, credentials: 'omit', headers: new Headers() };
        }
        if (response.status === 303 && options.method !== 'HEAD' || [301, 302].includes(response.status) && options.method === 'POST') {
            options = { ...options, method: 'GET', body: undefined };
            options.headers.delete('content-type');
        }
        await response.body?.cancel();
        url = next;
    }
    throw new Error('Too many redirects');
}

async function backgroundFetch(message, sender) {
    const extensionOrigin = new URL(browser.runtime.getURL('/')).origin;
    if (!allowedFetchUrl(message.url, extensionOrigin)) throw new Error('Fetch destination is not allowed');
    const key = `${sender.tab?.id || 'extension'}:${sender.frameId || 0}:${message.requestId}`;
    const controller = new AbortController();
    requests.set(key, controller);
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        const init = message.init || {};
        const method = String(init.method || 'GET').toUpperCase();
        const url = new URL(message.url);
        if (!isRobloxHost(url.hostname) && url.hostname !== 'apis.rovalra.com' && !['GET', 'HEAD'].includes(method)) {
            throw new Error('Media fetch only supports GET and HEAD');
        }
        const response = await fetchWithValidatedRedirects(url.href, {
            method, headers: init.headers, body: ['GET', 'HEAD'].includes(method) ? undefined : init.body,
            credentials: isRobloxHost(url.hostname) ? init.credentials : 'omit',
            cache: init.cache, signal: controller.signal,
        }, extensionOrigin);
        return await readResponse(response);
    } finally {
        clearTimeout(timeout);
        requests.delete(key);
    }
}

export async function launch(message, sender) {
    const launch = message.launch;
    const methods = ['joinGameInstance', 'joinPrivateGame', 'joinMultiplayerGame', 'followPlayerIntoGame', 'editGameInStudio', 'navigateToDeepLink', 'openProtocolUrl'];
    if (!sender.tab?.id || !launch || !methods.includes(launch.method) || !Array.isArray(launch.args)) {
        throw new Error('Invalid Roblox launch request');
    }
    if (launch.method === 'openProtocolUrl' || launch.method === 'navigateToDeepLink') {
        if (!/^roblox(?:-player|-studio)?:/i.test(String(launch.args[0]))) throw new Error('Invalid launch protocol');
    } else if (!Number.isSafeInteger(Number(launch.args[0])) || Number(launch.args[0]) <= 0) {
        throw new Error('Invalid Roblox launch identifier');
    }
    await browser.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN',
        func: (command) => {
            const service = command.method === 'navigateToDeepLink' ? window.Roblox?.DeepLinkService : window.Roblox?.GameLauncher;
            if (typeof service?.[command.method] === 'function') {
                service[command.method](...command.args);
            } else if (command.method === 'openProtocolUrl') {
                window.location.href = command.args[0];
            } else if (command.method === 'followPlayerIntoGame') {
                const placeLauncherUrl = 'https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestFollowUser&userId=' + command.args[0] + '&is30=false';
                window.location.href = 'roblox-player:1+launchmode:play+placelauncherurl:' + encodeURIComponent(placeLauncherUrl);
            } else {
                throw new Error('Roblox launcher is not ready');
            }
        },
        args: [launch],
    });
    return { success: true };
}

export async function requestPermission(permission) {
    const permissions = [].concat(permission);
    const optional = browser.runtime.getManifest().optional_permissions || [];
    if (await browser.permissions.contains({ permissions })) return { granted: true };
    if (!permissions.length || permissions.some((item) => !optional.includes(item))) return { granted: false };
    const token = crypto.randomUUID();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            permissionRequests.delete(token);
            resolve({ granted: false });
        }, 120000);
        permissionRequests.set(token, { resolve, timer, permissions });
        const params = new URLSearchParams({ token, permissions: JSON.stringify(permissions) });
        browser.tabs.create({ url: browser.runtime.getURL(`public/Assets/firefox-permissions.html?${params}`) }).catch(() => {
            clearTimeout(timer);
            permissionRequests.delete(token);
            resolve({ granted: false });
        });
    });
}

export function handleFirefoxMessage(message, sender, sendResponse) {
    if (!message.action?.startsWith('firefox')) return false;
    if (!verifySender(sender)) {
        sendResponse({ error: 'Unauthorized extension message' });
        return true;
    }
    if (message.action === 'firefoxCancelFetch') {
        requests.get(`${sender.tab?.id || 'extension'}:${sender.frameId || 0}:${message.requestId}`)?.abort();
        sendResponse({ canceled: true });
    } else if (message.action === 'firefoxFetch') {
        backgroundFetch(message, sender).then(sendResponse, (error) => sendResponse({ error: error.message }));
    } else if (message.action === 'firefoxLaunch') {
        launch(message, sender).then(sendResponse, (error) => sendResponse({ error: error.message }));
    } else if (message.action === 'firefoxPermissionResult') {
        const expected = browser.runtime.getURL('public/Assets/firefox-permissions.html');
        const request = sender.url?.split('?')[0] === expected && permissionRequests.get(message.token);
        if (request) {
            clearTimeout(request.timer);
            permissionRequests.delete(message.token);
            browser.permissions.contains({ permissions: request.permissions }).then((granted) => request.resolve({ granted }));
        }
        sendResponse({ received: Boolean(request) });
    } else {
        sendResponse({ error: 'Unknown Firefox message' });
    }
    return true;
}

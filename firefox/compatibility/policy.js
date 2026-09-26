const readOnlyHosts = new Set(['apis.rovalra.com', 'status.rovalra.com', 'flagcdn.com']);

export function isRobloxHost(hostname) {
    return hostname === 'roblox.com' || hostname.endsWith('.roblox.com');
}

export function allowedFetchUrl(value, extensionOrigin) {
    try {
        const url = new URL(value);
        if (url.username || url.password || url.port) return false;
        if (url.origin === extensionOrigin && url.protocol === 'moz-extension:') return true;
        return url.protocol === 'https:' && (
            isRobloxHost(url.hostname) ||
            url.hostname === 'rbxcdn.com' || url.hostname.endsWith('.rbxcdn.com') ||
            readOnlyHosts.has(url.hostname)
        );
    } catch {
        return false;
    }
}

export function authorizedSender(sender, runtime) {
    if (sender.id !== runtime.id || !sender.url) return false;
    try {
        const url = new URL(sender.url);
        if (url.origin === new URL(runtime.getURL('/')).origin) return true;
        return Boolean(sender.tab) && url.protocol === 'https:' && isRobloxHost(url.hostname);
    } catch {
        return false;
    }
}

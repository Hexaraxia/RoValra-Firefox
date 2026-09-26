import { allowedFetchUrl } from './policy.js';
import { headerEntries } from './headers.js';

export class ExtensionResponse {
    constructor(result) {
        this.bytes = new Uint8Array(result.bytes || []);
        this.status = result.status;
        this.statusText = result.statusText || '';
        this.url = result.url || '';
        this.ok = this.status >= 200 && this.status < 300;
        this.redirected = Boolean(result.redirected);
        this.type = 'basic';
        this.bodyUsed = false;
        this.headerEntries = result.headers || [];
        const values = new Map(this.headerEntries.map(([key, value]) => [key.toLowerCase(), value]));
        this.headers = {
            get: (key) => values.get(String(key).toLowerCase()) ?? null,
            has: (key) => values.has(String(key).toLowerCase()),
            entries: () => values.entries(),
            keys: () => values.keys(),
            values: () => values.values(),
            forEach: (fn) => values.forEach((value, key) => fn(value, key, this.headers)),
            [Symbol.iterator]: () => values.entries(),
        };
    }
    clone() {
        if (this.bodyUsed) throw new TypeError('Response body already used');
        return new ExtensionResponse({ ...this, headers: this.headerEntries });
    }
    async arrayBuffer() {
        if (this.bodyUsed) throw new TypeError('Response body already used');
        this.bodyUsed = true;
        return this.bytes.slice().buffer;
    }
    async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
    async json() { return JSON.parse(await this.text()); }
    async blob() { return new Blob([await this.arrayBuffer()], { type: this.headers.get('content-type') || '' }); }
}

export async function fetch(resource, init = {}) {
    const runtime = globalThis.browser?.runtime;
    if (!runtime) return globalThis.fetch(resource, init);
    const url = new URL(typeof resource === 'string' ? resource : resource.url || String(resource), location.href);
    if (!allowedFetchUrl(url.href, new URL(runtime.getURL('/')).origin)) {
        return globalThis.fetch(resource, init);
    }
    if (typeof resource === 'object' && typeof resource.clone === 'function' && 'method' in resource) {
        init = { method: resource.method, headers: resource.headers, credentials: resource.credentials, cache: resource.cache, signal: resource.signal, ...init };
        if (init.body === undefined && !['GET', 'HEAD'].includes(init.method)) init.body = await resource.clone().arrayBuffer();
    }
    if (init.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const requestId = crypto.randomUUID();
    let body = init.body;
    const headers = headerEntries(init.headers);
    if (body instanceof FormData) {
        const encoded = new globalThis.Response(body);
        body = await encoded.arrayBuffer();
        headers.push(['content-type', encoded.headers.get('content-type')]);
    } else if (body instanceof Blob) {
        body = await body.arrayBuffer();
    } else if (body instanceof URLSearchParams) {
        body = body.toString();
        if (!headers.some(([key]) => key === 'content-type')) headers.push(['content-type', 'application/x-www-form-urlencoded;charset=UTF-8']);
    }
    if (init.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const requestedCredentials = init.credentials || 'same-origin';
    const credentials = requestedCredentials === 'same-origin' ? (url.origin === location.origin ? 'include' : 'omit') : requestedCredentials;
    let abort;
    const canceled = new Promise((_, reject) => {
        abort = () => {
            runtime.sendMessage({ action: 'firefoxCancelFetch', requestId }).catch(() => {});
            reject(new DOMException('Request aborted', 'AbortError'));
        };
        init.signal?.addEventListener('abort', abort, { once: true });
    });
    try {
        const result = await Promise.race([
            runtime.sendMessage({
                action: 'firefoxFetch', requestId, url: url.href,
                init: { method: init.method || 'GET', headers, body, credentials, cache: init.cache },
            }), canceled,
        ]);
        if (!result || result.error) throw new Error(result?.error || 'Firefox background fetch returned no response');
        return new ExtensionResponse(result);
    } finally {
        init.signal?.removeEventListener('abort', abort);
    }
}

export function fromLegacyResponse({ body, ...init }) {
    return new ExtensionResponse({
        ...init,
        bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body || []),
        headers: Object.entries(init.headers || {}),
    });
}

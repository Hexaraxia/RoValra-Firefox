export function createApi(chromeApi, browserApi) {
    if (!browserApi) return chromeApi;
    const namespaces = new Map();
    function wrap(chromeValue, browserValue, path = '') {
        if (namespaces.has(path)) return namespaces.get(path);
        const proxy = new Proxy({}, {
            get(_, key) {
                const c = chromeValue?.[key];
                const b = browserValue?.[key];
                if (typeof c === 'function' || typeof b === 'function') {
                    return (...args) => {
                        const useChrome = typeof args.at(-1) === 'function' && typeof c === 'function';
                        const owner = useChrome ? chromeValue : browserValue;
                        return Reflect.apply(useChrome ? c : b || c, owner || chromeValue, args);
                    };
                }
                if (c && typeof c === 'object' || b && typeof b === 'object') {
                    return wrap(c, b, `${path}.${String(key)}`);
                }
                return c ?? b;
            },
        });
        namespaces.set(path, proxy);
        return proxy;
    }
    return wrap(chromeApi, browserApi);
}

export const chrome = createApi(globalThis.chrome, globalThis.browser);

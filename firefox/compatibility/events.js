export function CustomEvent(type, init = {}) {
    const options = { ...init };
    if (options.detail !== undefined && typeof cloneInto === 'function') {
        options.detail = cloneInto(options.detail, window);
    }
    return new globalThis.CustomEvent(type, options);
}

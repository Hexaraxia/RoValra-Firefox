export function headerEntries(source) {
    const entries = [];
    if (!source) return entries;
    if (typeof source.forEach === 'function' && !Array.isArray(source)) {
        source.forEach((value, key) => entries.push([String(key).toLowerCase(), String(value)]));
        return entries;
    }
    const normalized = new globalThis.Headers();
    if (Array.isArray(source)) {
        for (let index = 0; index < source.length; index++) {
            normalized.append(source[index][0], source[index][1]);
        }
    } else {
        for (const key of Object.keys(source)) normalized.append(key, source[key]);
    }
    normalized.forEach((value, key) => entries.push([String(key), String(value)]));
    return entries;
}

export function headersToObject(source) {
    return Object.fromEntries(headerEntries(source));
}

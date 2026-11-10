// Dependency-free helpers shared by the client and the server (no imports on purpose, so Node can
// load this file directly): deterministic JSON and a fast non-cryptographic 53-bit hash (cyrb53).

/** JSON.stringify with object keys sorted, so equal data always serialises identically. */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
    const keys = Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** cyrb53 -> 14 hex chars. Good enough as a cache key; not for security. */
export function hashString(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return n.toString(16).padStart(14, '0');
}

export const hashObject = (value) => hashString(stableStringify(value));

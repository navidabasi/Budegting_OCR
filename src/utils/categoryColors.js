// One colour per category, light and dark variants (charts, dots). Custom categories use their own colour or a stable palette pick.
const PAIRS = {
    Groceries: ['#00573F', '#3FB68B'],
    Dining: ['#B45309', '#F0A040'],
    Fuel: ['#5C6B64', '#9AA6A0'],
    Transport: ['#2458D6', '#7FA2F5'],
    Housing: ['#6B4F2A', '#C9A36B'],
    Utilities: ['#0E7490', '#4FC3DC'],
    Subscriptions: ['#5B3A8C', '#B49AE0'],
    Shopping: ['#BE185D', '#F27AAE'],
    Health: ['#1B7F55', '#5FD3A0'],
    'Personal care': ['#A21CAF', '#E08AEA'],
    Entertainment: ['#C2410C', '#FF8A5C'],
    Travel: ['#1F4E79', '#6FA8DC'],
    Education: ['#4D7C0F', '#A3D55A'],
    Insurance: ['#475569', '#94A3B8'],
    Gifts: ['#B91C1C', '#F28B8B'],
    Fees: ['#78716C', '#B8B2AC'],
    Other: ['#6B7280', '#A0A7B4'],
    Income: ['#1B7F55', '#5FD3A0'],
    Transfer: ['#2458D6', '#7FA2F5'],
};
const FALLBACK = [
    ['#7C3AED', '#B79CF5'],
    ['#0D9488', '#5EEAD4'],
    ['#CA8A04', '#F5D061'],
    ['#DB2777', '#F59AC2'],
    ['#2563EB', '#8DB2F8'],
    ['#EA580C', '#FDA66A'],
];

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Colour for a category name. `custom` is the user's own colour (used when set and the name is not a default). */
export function categoryColor(name, dark = false, custom = null) {
    const pair = PAIRS[name];
    if (pair) return pair[dark ? 1 : 0];
    if (custom) return custom;
    return FALLBACK[hash(name) % FALLBACK.length][dark ? 1 : 0];
}

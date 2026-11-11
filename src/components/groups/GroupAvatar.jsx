/** Readable text on a hex colour: near-black on light colours, white on dark ones. */
export function inkOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const lin = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.35 ? '#10211B' : '#ffffff';
}

/** Rounded square in the group's colour with its initial (the group's "icon" in lists and headers). */
export function GroupAvatar({ group, size = 40 }) {
    const color = group?.color || '#6b7280';
    const initial = String(group?.name || '?').trim().charAt(0).toUpperCase() || '?';
    return (
        <span
            className="flex shrink-0 items-center justify-center rounded-[14px] font-display font-bold"
            style={{ backgroundColor: color, color: inkOn(color), width: size, height: size, fontSize: Math.round(size * 0.42) }}
            aria-hidden="true"
        >
            {initial}
        </span>
    );
}

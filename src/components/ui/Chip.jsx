/** Pill used for filters, categories, dates and accounts. 40 px tall (44 px hit area on touch via min-h). */
const TONES = {
    default: 'border-line-strong bg-surface text-ink',
    suggested: 'border-forest-ink bg-surface text-forest-ink',
    warn: 'border-warn-edge bg-surface text-warn-ink',
};

export default function Chip({ selected = false, tone = 'default', size = 'md', icon: Icon, children, className = '', ...rest }) {
    const sizing = size === 'sm' ? 'h-9 px-3 text-[13px]' : 'h-10 px-3.5 text-sm';
    const look = selected ? 'border-ink bg-ink text-ground' : TONES[tone] || TONES.default;
    return (
        <button
            type="button"
            aria-pressed={selected}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-ink active:opacity-80 ${sizing} ${look} ${className}`}
            {...rest}
        >
            {Icon ? <Icon size={size === 'sm' ? 14 : 15} aria-hidden="true" /> : null}
            {children}
        </button>
    );
}

/** Horizontally scrolling row of chips (no visible scrollbar). */
export function ChipRow({ children, className = '' }) {
    return <div className={`no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 ${className}`}>{children}</div>;
}

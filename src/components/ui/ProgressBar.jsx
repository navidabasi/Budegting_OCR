/**
 * Progress bar with an optional pace tick (0..1 = where "today" falls in the period).
 * status: ok | warn | over colours the fill.
 */
const FILL = { ok: 'bg-forest-ink', warn: 'bg-warn', over: 'bg-over', savings: 'bg-savings' };

export default function ProgressBar({ value = 0, max = 100, pace = null, status = 'ok', label, className = '' }) {
    const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.min(value, max)}
            className={`relative h-2.5 w-full rounded-full bg-line ${className}`}
        >
            {/* the fill is full width and scaled (transform only, no layout work); it animates when the value changes, i.e. on a new selection */}
            <div className={`h-full w-full origin-left rounded-full transition-transform duration-sheet ease-out rtl:origin-right ${FILL[status] || FILL.ok}`} style={{ transform: `scaleX(${ratio})` }} data-ratio={ratio.toFixed(3)} />
            {pace !== null && pace >= 0 && pace <= 1 ? (
                <span aria-hidden="true" className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink" style={{ insetInlineStart: `calc(${pace * 100}% - 1px)` }} />
            ) : null}
        </div>
    );
}

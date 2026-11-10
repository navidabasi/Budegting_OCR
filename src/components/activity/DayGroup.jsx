import Amount from '../ui/Amount';

/** Day header of the activity list: "Today · Mon 10 ········ 28,19" (spending of the day). */
export default function DayGroup({ label, total, currency }) {
    return (
        <div className="flex h-full items-end pb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted" role="presentation">
            <span className="whitespace-nowrap">{label}</span>
            <span className="lead" aria-hidden="true" />
            {total > 0 ? <Amount value={total} currency={currency} className="normal-case tracking-normal" /> : null}
        </div>
    );
}

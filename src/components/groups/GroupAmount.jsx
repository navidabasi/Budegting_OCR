import Amount from '../ui/Amount';

/** Money of a group for a period: what went out, or what came in for an income-only group ("+2.350,00"). */
export function GroupAmount({ totals, currency, className = '' }) {
    if (totals.out === 0 && totals.in > 0) return <Amount value={totals.in} currency={currency} sign tone="income" className={className} />;
    return <Amount value={totals.out} currency={currency} className={className} />;
}

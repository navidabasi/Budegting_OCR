/** Progress ring (savings blue on a soft track). pct 0-100. */
export default function GoalRing({ pct = 0, size = 34 }) {
    const r = 15;
    const c = 2 * Math.PI * r;
    return (
        <svg aria-hidden="true" width={size} height={size} viewBox="0 0 36 36" className="shrink-0">
            <circle cx="18" cy="18" r={r} fill="none" strokeWidth="5" className="stroke-savings-soft" />
            <circle cx="18" cy="18" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-savings" strokeDasharray={`${(Math.min(100, Math.max(0, pct)) / 100) * c} ${c}`} transform="rotate(-90 18 18)" />
        </svg>
    );
}

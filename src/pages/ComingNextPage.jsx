import { Sparkles, PieChart } from 'lucide-react';
import { useTranslation } from '../languages/useTranslation';

/** Placeholder for tabs that a later phase fills (Budgets, Insights). Not a dead link: it explains itself. */
export default function ComingNextPage({ kind = 'budgets' }) {
    const { t } = useTranslation();
    const Icon = kind === 'insights' ? Sparkles : PieChart;
    return (
        <main className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-8 pb-32 pt-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-mint text-forest-ink">
                <Icon size={26} aria-hidden="true" />
            </div>
            <h1 className="font-display text-2xl font-bold text-ink">{t(`comingNext.${kind}.title`)}</h1>
            <p className="max-w-xs text-sm text-ink-muted">{t(`comingNext.${kind}.body`)}</p>
        </main>
    );
}

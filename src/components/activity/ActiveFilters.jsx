import { X } from 'lucide-react';
import { useTranslation } from '../../languages/useTranslation';

/** The active filters as removable chips ("Groceries ×", "Debts ×") with "Clear all" at the end. Hidden when nothing is filtered. */
export default function ActiveFilters({ descriptors, labelOf, onRemove, onClearAll }) {
    const { t } = useTranslation();
    if (!descriptors.length) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5 pb-2" data-testid="active-filters" aria-label={t('filters.active')} role="group">
            {descriptors.map((d) => (
                <button
                    key={d.id}
                    type="button"
                    onClick={() => onRemove(d)}
                    aria-label={t('filters.remove', { filter: labelOf(d) })}
                    className="inline-flex h-11 max-w-full items-center gap-1 rounded-full bg-mint ps-3 pe-2 text-[13px] font-medium text-forest-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink"
                    data-testid="active-filter"
                >
                    <span className="truncate">{labelOf(d)}</span>
                    <X size={14} className="shrink-0" aria-hidden="true" />
                </button>
            ))}
            <button type="button" onClick={onClearAll} className="h-11 px-2 text-[13px] font-semibold text-ink-muted underline-offset-2 hover:underline" data-testid="clear-all">
                {t('filters.clearAll')}
            </button>
        </div>
    );
}

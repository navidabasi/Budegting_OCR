import { ChevronDown } from 'lucide-react';
import Amount from '../ui/Amount';
import { categoryVisual } from '../../utils/categoryVisual.jsx';
import { useTranslation } from '../../languages/useTranslation';

/**
 * Header of a Group / Category / Merchant section in the Activity list: tap to collapse or expand.
 * "● Debts · 3 ········ −99,80  +2.350,00"
 */
export default function SectionHeader({ section, color, onToggle, currency }) {
    const { t } = useTranslation();
    const { Icon, bg, fg } = section.by === 'category' ? categoryVisual(section.key, section.key === 'Income' ? 'income' : section.key === 'Transfer' ? 'transfer' : 'expense') : {};
    return (
        <button
            type="button"
            onClick={() => onToggle(section.key)}
            aria-expanded={!section.collapsed}
            className="flex h-full w-full items-end gap-2 pb-1.5 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest-ink"
            data-testid="section-header"
        >
            <span className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2">
                {Icon ? (
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${bg} ${fg}`}>
                        <Icon size={14} aria-hidden="true" />
                    </span>
                ) : section.by === 'group' ? (
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color || 'rgb(var(--c-line-strong))' }} aria-hidden="true" />
                ) : null}
                <span className="truncate text-[13px] font-semibold uppercase tracking-wider text-ink">{section.label}</span>
                <span className="shrink-0 text-xs text-ink-muted">{section.count}</span>
                <span className="lead text-ink-muted" aria-hidden="true" />
                <span className="flex shrink-0 items-baseline gap-2 text-[13px]">
                    {section.income > 0 ? <Amount value={section.income} currency={currency} sign tone="income" /> : null}
                    {section.expense > 0 || section.income === 0 ? <Amount value={-section.expense} currency={currency} className="text-ink" /> : null}
                </span>
                <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform duration-inline ease-out ${section.collapsed ? '-rotate-90 rtl:rotate-90' : ''}`} aria-hidden="true" />
                <span className="sr-only">{section.collapsed ? t('activity.expandSection') : t('activity.collapseSection')}</span>
            </span>
        </button>
    );
}

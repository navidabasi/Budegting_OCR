import { useCallback } from 'react';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';

/**
 * Label for one filter descriptor (describeFilters / emptyReason): "Groceries", "Debts", "Lidl", "#bnpl", "10 – 50 €", "Unpaid",
 * "“lidl”", "All time". ctx: { groupById, accountById, merchantLabel(key), periodLabel }.
 */
export function useFilterLabel({ groupById = new Map(), accountById = new Map(), merchantLabel = (m) => m, periodLabel = '' } = {}) {
    const { t, localizeCategory } = useTranslation();
    const { short } = useMoney();
    return useCallback(
        (d) => {
            switch (d.kind) {
                case 'type':
                    return t(`quickAdd.${d.value}`);
                case 'category':
                    return localizeCategory(d.value);
                case 'group':
                case 'trip':
                    return groupById.get(d.value)?.name || t('activity.group');
                case 'account':
                    return accountById.get(d.value) || t('activity.account');
                case 'merchant':
                    return merchantLabel(d.value);
                case 'tag':
                    return `#${d.value}`;
                case 'amount': {
                    const { min, max } = d.value;
                    if (min !== null && max !== null) return t('filters.amountBetween', { min: short(min), max: short(max) });
                    if (min !== null) return t('filters.amountAtLeast', { min: short(min) });
                    return t('filters.amountAtMost', { max: short(max) });
                }
                case 'tracking':
                    return d.value === 'open' ? t('filters.unpaid') : d.value === 'done' ? t('filters.paid') : t('filters.planned');
                case 'needsReview':
                    return t('filters.needsReview');
                case 'uncategorised':
                    return t('activity.uncategorised');
                case 'shared':
                    return t('filters.shared');
                case 'hasPhoto':
                    return t('filters.hasPhoto');
                case 'search':
                    return `“${d.value}”`;
                case 'period':
                    return periodLabel;
                default:
                    return String(d.value);
            }
        },
        [t, localizeCategory, short, groupById, accountById, merchantLabel, periodLabel]
    );
}

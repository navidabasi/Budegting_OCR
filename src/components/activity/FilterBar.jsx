import { useState } from 'react';
import { Chip, ChipRow } from '../ui';
import PickerSheet from './PickerSheet';
import { PeriodPickerSheet } from '../ui/PeriodSwitcher';
import { useTranslation } from '../../languages/useTranslation';

/**
 * Filter chips: month, type, category (multi), account, Unpaid, Uncategorised. Month/type/category/account open
 * a picker sheet; Unpaid and Uncategorised toggle. Counts ignore the month so the chips stay meaningful.
 */
export default function FilterBar({ filters, onChange, p, categoryNames, accounts, unpaidCount, uncategorisedCount }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const [picker, setPicker] = useState(null); // 'month' | 'type' | 'category' | 'account'
    const close = () => setPicker(null);

    const typeLabels = { expense: t('quickAdd.expense'), income: t('quickAdd.income'), transfer: t('quickAdd.transfer') };
    const accountName = accounts.find((a) => a.id === filters.accountId)?.name;
    const categoryText = filters.categories.length === 0 ? t('activity.category') : filters.categories.length === 1 ? localizeCategory(filters.categories[0]) : t('activity.categoriesCount', { count: filters.categories.length });

    return (
        <>
            <ChipRow className="py-1.5">
                <Chip size="sm" selected={filters.month !== 'all'} onClick={() => setPicker('month')}>
                    {filters.month === 'all' ? t('activity.allTime') : p.label}
                </Chip>
                <Chip size="sm" selected={!!filters.type} onClick={() => setPicker('type')}>
                    {filters.type ? typeLabels[filters.type] : t('activity.allTypes')}
                </Chip>
                <Chip size="sm" selected={filters.categories.length > 0} onClick={() => setPicker('category')}>
                    {categoryText}
                </Chip>
                {accounts.length > 0 ? (
                    <Chip size="sm" selected={!!filters.accountId} onClick={() => setPicker('account')}>
                        {accountName || t('activity.account')}
                    </Chip>
                ) : null}
                <Chip size="sm" tone="warn" selected={filters.tracking === 'open'} onClick={() => onChange({ tracking: filters.tracking === 'open' ? '' : 'open' })}>
                    {t('activity.unpaidCount', { count: unpaidCount })}
                </Chip>
                <Chip size="sm" selected={filters.uncategorised} onClick={() => onChange({ uncategorised: !filters.uncategorised })}>
                    {t('activity.uncategorisedCount', { count: uncategorisedCount })}
                </Chip>
            </ChipRow>

            <PeriodPickerSheet open={picker === 'month'} onClose={close} p={p} onAll={() => onChange({ month: 'all' })} allSelected={filters.month === 'all'} />
            <PickerSheet
                open={picker === 'type'}
                title={t('activity.pickType')}
                options={[{ value: '', label: t('activity.allTypes') }, ...Object.entries(typeLabels).map(([value, label]) => ({ value, label }))]}
                selected={filters.type}
                onPick={(v) => {
                    onChange({ type: v });
                    close();
                }}
                onClose={close}
            />
            <PickerSheet
                open={picker === 'category'}
                title={t('activity.pickCategory')}
                multi
                options={categoryNames.map((n) => ({ value: n, label: localizeCategory(n) }))}
                selected={filters.categories}
                onPick={(n) => onChange({ categories: filters.categories.includes(n) ? filters.categories.filter((c) => c !== n) : [...filters.categories, n] })}
                onClear={() => onChange({ categories: [] })}
                onClose={close}
            />
            <PickerSheet
                open={picker === 'account'}
                title={t('activity.pickAccount')}
                options={[{ value: '', label: t('activity.allAccounts') }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
                selected={filters.accountId}
                onPick={(v) => {
                    onChange({ accountId: v });
                    close();
                }}
                onClose={close}
            />
        </>
    );
}

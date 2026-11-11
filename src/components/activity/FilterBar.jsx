import { useState } from 'react';
import { Chip, ChipRow } from '../ui';
import PickerSheet from './PickerSheet';
import { PeriodPickerSheet } from '../ui/PeriodSwitcher';
import { useTranslation } from '../../languages/useTranslation';
import { categoryVisual } from '../../utils/categoryVisual.jsx';

/**
 * Quick filter chips: period, Group, type, category (multi), account (multi), Unpaid, Uncategorised. Period/group/type/category/account
 * open a picker sheet with counts and totals per option; Unpaid and Uncategorised toggle. `stats` holds { group, category, account }
 * Maps of value -> { count, total } computed without that filter so the counts stay meaningful.
 */
export default function FilterBar({ filters, onChange, p, categoryNames, accounts, groups = [], stats = {}, unpaidCount, uncategorisedCount, currency, picker: controlledPicker, onPicker, leading = null }) {
    const { t, localizeCategory } = useTranslation();
    const [ownPicker, setOwnPicker] = useState(null); // 'month' | 'group' | 'type' | 'category' | 'account'
    const picker = controlledPicker !== undefined ? controlledPicker : ownPicker;
    const setPicker = onPicker || setOwnPicker;
    const close = () => setPicker(null);

    const typeLabels = { expense: t('quickAdd.expense'), income: t('quickAdd.income'), transfer: t('quickAdd.transfer') };
    const categoryText = filters.categories.length === 0 ? t('activity.category') : filters.categories.length === 1 ? localizeCategory(filters.categories[0]) : t('activity.categoriesCount', { count: filters.categories.length });
    const accountText = filters.accountIds.length === 0 ? t('activity.account') : filters.accountIds.length === 1 ? accounts.find((a) => a.id === filters.accountIds[0])?.name || t('activity.account') : t('activity.accountsCount', { count: filters.accountIds.length });
    const selectedGroups = filters.groupIds.map((id) => groups.find((g) => g.id === id)).filter(Boolean);
    const groupText = filters.groupIds.length === 0 ? t('activity.group') : filters.groupIds.length === 1 ? selectedGroups[0]?.name || t('activity.group') : t('activity.groupsCount', { count: filters.groupIds.length });
    const toggleIn = (key, v) => onChange({ [key]: filters[key].includes(v) ? filters[key].filter((x) => x !== v) : [...filters[key], v] });
    const withStats = (map, value) => {
        const s = map?.get(value);
        return { count: s?.count || 0, total: s?.total || 0 };
    };

    return (
        <>
            <ChipRow className="py-1.5">
                {leading}
                <Chip size="sm" selected={filters.month !== 'all'} onClick={() => setPicker('month')} data-testid="chip-period">
                    {filters.month === 'all' ? t('activity.allTime') : p.label}
                </Chip>
                {groups.length > 0 ? (
                    <Chip size="sm" selected={filters.groupIds.length > 0} onClick={() => setPicker('group')} data-testid="chip-group">
                        {selectedGroups.length === 1 ? <span className="h-2.5 w-2.5 rounded-full ring-1 ring-ground" style={{ backgroundColor: selectedGroups[0].color }} aria-hidden="true" /> : null}
                        {groupText}
                    </Chip>
                ) : null}
                <Chip size="sm" selected={filters.categories.length > 0} onClick={() => setPicker('category')} data-testid="chip-category">
                    {categoryText}
                </Chip>
                <Chip size="sm" selected={!!filters.type} onClick={() => setPicker('type')}>
                    {filters.type ? typeLabels[filters.type] : t('activity.allTypes')}
                </Chip>
                {accounts.length > 0 ? (
                    <Chip size="sm" selected={filters.accountIds.length > 0} onClick={() => setPicker('account')}>
                        {accountText}
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
                open={picker === 'group'}
                title={t('activity.pickGroup')}
                multi
                currency={currency}
                options={groups.map((g) => ({ value: g.id, label: g.name, color: g.color, ...withStats(stats.group, g.id) }))}
                selected={filters.groupIds}
                onPick={(id) => toggleIn('groupIds', id)}
                onSelectAll={(ids) => onChange({ groupIds: [...new Set([...filters.groupIds, ...ids])] })}
                onClear={() => onChange({ groupIds: [] })}
                onClose={close}
            />
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
                currency={currency}
                options={categoryNames.map((n) => ({ value: n, label: localizeCategory(n), icon: categoryVisual(n).Icon, ...withStats(stats.category, n) }))}
                selected={filters.categories}
                onPick={(n) => toggleIn('categories', n)}
                onSelectAll={(names) => onChange({ categories: [...new Set([...filters.categories, ...names])] })}
                onClear={() => onChange({ categories: [] })}
                onClose={close}
            />
            <PickerSheet
                open={picker === 'account'}
                title={t('activity.pickAccount')}
                multi
                currency={currency}
                options={accounts.map((a) => ({ value: a.id, label: a.name, ...withStats(stats.account, a.id) }))}
                selected={filters.accountIds}
                onPick={(id) => toggleIn('accountIds', id)}
                onSelectAll={(ids) => onChange({ accountIds: [...new Set([...filters.accountIds, ...ids])] })}
                onClear={() => onChange({ accountIds: [] })}
                onClose={close}
            />
        </>
    );
}

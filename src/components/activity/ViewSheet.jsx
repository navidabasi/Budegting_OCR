import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { Sheet } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { GROUP_BYS, SORTS } from '../../utils/activityFilters';

/** "Sort & group": how the Activity list is grouped (Day / Group / Category / Merchant) and sorted (field + direction). Both remembered. */
export default function ViewSheet({ open, onClose, groupBy, onGroupBy, sort, dir, onSort }) {
    const { t } = useTranslation();
    const sortLabel = { date: t('activity.sortDate'), amount: t('activity.sortAmount'), merchant: t('activity.sortMerchant'), category: t('activity.sortCategory') };
    const dirLabel = (s, d) => t(`activity.dir.${s}.${d}`);
    return (
        <Sheet open={open} onClose={onClose} label={t('activity.view')}>
            <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-3">
                <h2 className="font-display text-lg font-bold text-ink">{t('activity.view')}</h2>
                <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('activity.groupBy')}</h3>
                    <div role="radiogroup" aria-label={t('activity.groupBy')} className="grid grid-cols-2 gap-2" data-testid="group-by">
                        {GROUP_BYS.map((v) => (
                            <button
                                key={v}
                                type="button"
                                role="radio"
                                aria-checked={groupBy === v}
                                onClick={() => onGroupBy(v)}
                                className={`flex h-12 items-center justify-center rounded-[14px] border px-3 text-sm transition-colors duration-press ease-out ${groupBy === v ? 'border-ink bg-ink font-semibold text-ground' : 'border-line-strong bg-surface font-medium text-ink'}`}
                            >
                                {t(`activity.by.${v}`)}
                            </button>
                        ))}
                    </div>
                </section>
                <section className="flex flex-col gap-1">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('activity.sortBy')}</h3>
                    <ul role="radiogroup" aria-label={t('activity.sortBy')} className="flex flex-col">
                        {SORTS.map((s) => (
                            <li key={s}>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={sort === s}
                                    onClick={() => onSort({ sort: s, dir: sort === s ? dir : s === 'merchant' || s === 'category' ? 'asc' : 'desc' })}
                                    className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-2 text-start text-[15px] text-ink active:bg-line"
                                >
                                    <span className={sort === s ? 'font-semibold' : ''}>{sortLabel[s]}</span>
                                    {sort === s ? <Check size={18} className="text-forest-ink" aria-hidden="true" /> : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button
                        type="button"
                        onClick={() => onSort({ sort, dir: dir === 'asc' ? 'desc' : 'asc' })}
                        className="flex h-12 items-center justify-center gap-2 rounded-[14px] border border-line-strong bg-surface text-sm font-semibold text-ink"
                        data-testid="sort-direction"
                    >
                        {dir === 'asc' ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
                        {dirLabel(sort, dir)}
                    </button>
                </section>
                <button type="button" onClick={onClose} className="h-12 w-full rounded-2xl bg-forest text-base font-semibold text-white">
                    {t('activity.done')}
                </button>
            </div>
        </Sheet>
    );
}

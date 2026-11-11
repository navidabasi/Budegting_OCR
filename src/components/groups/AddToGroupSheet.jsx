import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Sheet } from '../ui';
import Amount from '../ui/Amount';
import GroupBadge from './GroupBadge';
import { useTranslation } from '../../languages/useTranslation';
import { matchesSearch } from '../../utils/activityFilters';

const LIMIT = 80;

/** Pick transactions to put into a group: search, newest first, multi-select, "Add N". Shows each row's current group when it has one. */
export default function AddToGroupSheet({ open, onClose, group, transactions = [], groupById = new Map(), onAdd }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState(() => new Set());
    const candidates = useMemo(() => {
        const rows = transactions.filter((tx) => tx.groupId !== group?.id && matchesSearch(tx, query, { localizeCategory, groupById }));
        return rows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, LIMIT);
    }, [transactions, group, query, groupById]); // eslint-disable-line react-hooks/exhaustive-deps
    const toggle = (id) =>
        setPicked((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    const close = () => {
        setPicked(new Set());
        setQuery('');
        onClose();
    };
    const date = (d) => new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00`));
    return (
        <Sheet open={open} onClose={close} label={t('groups.addTitle', { name: group?.name || '' })} fullHeight>
            <div className="flex flex-col gap-2 px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{t('groups.addTitle', { name: group?.name || '' })}</h2>
                <label className="flex h-11 items-center gap-2 rounded-[14px] border border-line-strong bg-surface px-3 focus-within:ring-2 focus-within:ring-forest-ink">
                    <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('activity.search')} placeholder={t('activity.searchPlaceholder')} className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none" />
                </label>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-3" role="group" aria-label={t('groups.addTitle', { name: group?.name || '' })}>
                {candidates.map((tx) => {
                    const on = picked.has(tx.id);
                    const current = tx.groupId ? groupById.get(tx.groupId) : null;
                    return (
                        <li key={tx.id}>
                            <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(tx.id)} className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2 text-start active:bg-line" data-testid="add-candidate">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${on ? 'border-forest bg-forest text-white' : 'border-line-strong'}`} aria-hidden="true">
                                    {on ? <Check size={14} /> : null}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px] text-ink">{tx.merchant || t('dashboard.topMerchants.unknown')}</span>
                                    <span className="flex min-w-0 items-center gap-1 text-xs text-ink-muted">
                                        <span className="shrink-0">{date(tx.date)}</span>
                                        {current ? <GroupBadge group={current} className="before:me-0.5 before:content-['·']" /> : null}
                                    </span>
                                </span>
                                <Amount value={tx.total} sign={tx.transactionType === 'income'} tone={tx.transactionType === 'income' ? 'income' : 'default'} className="shrink-0 text-[15px]" />
                            </button>
                        </li>
                    );
                })}
                {candidates.length === 0 ? <li className="px-3 py-6 text-center text-sm text-ink-muted">{t('activity.noOptions')}</li> : null}
            </ul>
            <div className="px-5 pt-2">
                <button
                    type="button"
                    disabled={picked.size === 0}
                    onClick={async () => {
                        await onAdd([...picked]);
                        close();
                    }}
                    className="h-14 w-full rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40"
                    data-testid="add-confirm"
                >
                    {picked.size ? t('groups.addCount', { count: picked.size }) : t('groups.addPick')}
                </button>
            </div>
        </Sheet>
    );
}

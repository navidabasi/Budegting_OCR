import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Plane, Search, Trash2 } from 'lucide-react';
import { Chip, Sheet } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { categoryVisual } from '../../utils/categoryVisual.jsx';
import { AMOUNT_RANGES, applyFilters, clearedFilters, describeFilters, mergeFilters, parseAmount, summarize } from '../../utils/activityFilters';

const SHOWN_CATEGORIES = 10;
const SHOWN_MERCHANTS = 8;
const field = 'h-12 w-full min-w-0 rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const norm = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');

function Section({ title, children, aside = null }) {
    return (
        <section className="flex flex-col gap-2 border-b border-line pb-4 last:border-0">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h3>
                {aside}
            </div>
            {children}
        </section>
    );
}

/**
 * The full filter sheet: Period, Type, Category, Group, Trip, Account, Merchant, Amount range (two fields and quick ranges), Tags,
 * Status, and saved views. Changes are a draft until the primary button, which shows the live result: "Show 23 transactions ·
 * 412,30 €". `rows` are the transactions to count (the page's visible list), `ctx` the period and search context.
 */
export default function FilterSheet({ open, onClose, filters, onApply, rows, ctx, periodLabel, categoryNames, groups, trips, accounts, merchants, tags, savedViews = [], onSaveView, onDeleteView, onApplyView }) {
    const { t, localizeCategory } = useTranslation();
    const { money } = useMoney();
    const [draft, setDraft] = useState(() => mergeFilters(filters));
    const [allCats, setAllCats] = useState(false);
    const [merchantQuery, setMerchantQuery] = useState('');
    const [viewName, setViewName] = useState('');
    const [minText, setMinText] = useState('');
    const [maxText, setMaxText] = useState('');

    useEffect(() => {
        if (!open) return;
        const f = mergeFilters(filters);
        setDraft(f);
        setMinText(f.amountMin === '' ? '' : String(f.amountMin).replace('.', ','));
        setMaxText(f.amountMax === '' ? '' : String(f.amountMax).replace('.', ','));
        setMerchantQuery('');
        setViewName('');
        setAllCats(false);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const set = (patch) => setDraft((d) => mergeFilters(d, patch));
    const toggleIn = (key, v) => setDraft((d) => mergeFilters(d, { [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));
    const result = useMemo(() => summarize(applyFilters(rows, draft, ctx)), [rows, draft, ctx]);
    const activeCount = describeFilters(draft).length;

    const catCounts = useMemo(() => {
        const m = new Map();
        for (const tx of rows) m.set(tx.category, (m.get(tx.category) || 0) + 1);
        return m;
    }, [rows]);
    const cats = useMemo(() => [...categoryNames].sort((a, b) => (catCounts.get(b) || 0) - (catCounts.get(a) || 0)), [categoryNames, catCounts]);
    const shownCats = allCats ? cats : [...new Set([...draft.categories, ...cats.slice(0, SHOWN_CATEGORIES)])];
    const shownMerchants = useMemo(() => {
        const q = norm(merchantQuery).trim();
        const picked = merchants.filter((m) => draft.merchants.includes(m.value));
        const rest = merchants.filter((m) => !draft.merchants.includes(m.value) && (!q || norm(m.label).includes(q) || m.value.includes(q)));
        return [...picked, ...rest.slice(0, SHOWN_MERCHANTS)];
    }, [merchants, merchantQuery, draft.merchants]);

    const setAmount = (minT, maxT) => {
        setMinText(minT);
        setMaxText(maxT);
        set({ amountMin: parseAmount(minT), amountMax: parseAmount(maxT) });
    };
    const rangeOn = (r) => String(draft.amountMin) === String(r.min) && String(draft.amountMax) === String(r.max);
    const rangeLabel = (r) => (r.min === '' ? t('filters.amountAtMost', { max: money(r.max) }) : r.max === '' ? t('filters.amountAtLeast', { min: money(r.min) }) : t('filters.amountBetween', { min: money(r.min), max: money(r.max) }));
    const total = result.expense > 0 || result.income === 0 ? money(result.expense) : `+${money(result.income)}`;
    const STATUS = [
        ['tracking', t('filters.unpaid'), draft.tracking === 'open', () => set({ tracking: draft.tracking === 'open' ? '' : 'open' })],
        ['needsReview', t('filters.needsReview'), draft.needsReview, () => set({ needsReview: !draft.needsReview })],
        ['uncategorised', t('activity.uncategorised'), draft.uncategorised, () => set({ uncategorised: !draft.uncategorised })],
        ['shared', t('filters.shared'), draft.shared, () => set({ shared: !draft.shared })],
        ['hasPhoto', t('filters.hasPhoto'), draft.hasPhoto, () => set({ hasPhoto: !draft.hasPhoto })],
    ];

    return (
        <Sheet open={open} onClose={onClose} label={t('filters.title')} fullHeight>
            <div className="flex items-center justify-between px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{t('filters.title')}</h2>
                <button
                    type="button"
                    disabled={activeCount === 0}
                    onClick={() => {
                        setMinText('');
                        setMaxText('');
                        setDraft(clearedFilters(draft));
                    }} className="h-11 px-2 text-sm font-semibold text-forest-ink disabled:opacity-40" data-testid="sheet-clear">
                    {t('filters.clearAll')}
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4" data-testid="filter-sheet">
                {savedViews.length > 0 ? (
                    <Section title={t('filters.savedViews')}>
                        <ul className="flex flex-col">
                            {savedViews.map((v) => (
                                <li key={v.id} className="flex items-center gap-1">
                                    <button type="button" onClick={() => onApplyView(v)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-start text-[15px] text-ink">
                                        <Bookmark size={16} className="shrink-0 text-forest-ink" aria-hidden="true" />
                                        <span className="truncate">{v.name}</span>
                                    </button>
                                    <button type="button" onClick={() => onDeleteView(v)} aria-label={t('filters.deleteView', { name: v.name })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-over-ink" data-testid="delete-view">
                                        <Trash2 size={17} aria-hidden="true" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </Section>
                ) : null}

                <Section title={t('filters.period')}>
                    <div className="flex flex-wrap gap-2">
                        <Chip size="sm" selected={draft.month !== 'all'} onClick={() => set({ month: filters.month === 'all' ? ctx.defaultSpec : filters.month })}>
                            {filters.month === 'all' ? t('filters.thisPeriod') : periodLabel}
                        </Chip>
                        <Chip size="sm" selected={draft.month === 'all'} onClick={() => set({ month: 'all' })}>
                            {t('activity.allTime')}
                        </Chip>
                    </div>
                </Section>

                <Section title={t('activity.pickType')}>
                    <div className="flex flex-wrap gap-2">
                        {['', 'expense', 'income', 'transfer'].map((v) => (
                            <Chip key={v || 'all'} size="sm" selected={draft.type === v} onClick={() => set({ type: v })}>
                                {v ? t(`quickAdd.${v}`) : t('activity.allTypes')}
                            </Chip>
                        ))}
                    </div>
                </Section>

                <Section
                    title={t('activity.pickCategory')}
                    aside={
                        cats.length > SHOWN_CATEGORIES ? (
                            <button type="button" onClick={() => setAllCats((a) => !a)} className="h-11 px-1 text-[13px] font-semibold text-forest-ink">
                                {allCats ? t('filters.showFewer') : t('filters.showAll', { count: cats.length })}
                            </button>
                        ) : null
                    }
                >
                    <div className="flex flex-wrap gap-2">
                        {shownCats.map((c) => {
                            const { Icon } = categoryVisual(c);
                            return (
                                <Chip key={c} size="sm" icon={Icon} selected={draft.categories.includes(c)} onClick={() => toggleIn('categories', c)}>
                                    {localizeCategory(c)}
                                </Chip>
                            );
                        })}
                    </div>
                </Section>

                {groups.length > 0 ? (
                    <Section title={t('activity.pickGroup')}>
                        <div className="flex flex-wrap gap-2">
                            {groups.map((g) => (
                                <Chip key={g.id} size="sm" selected={draft.groupIds.includes(g.id)} onClick={() => toggleIn('groupIds', g.id)}>
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color || '#6b7280' }} aria-hidden="true" />
                                    {g.name}
                                </Chip>
                            ))}
                        </div>
                    </Section>
                ) : null}

                {trips.length > 0 ? (
                    <Section title={t('groups.sectionTrips')}>
                        <div className="flex flex-wrap gap-2">
                            {trips.map((trip) => (
                                <Chip key={trip.id} size="sm" icon={Plane} selected={draft.tripId === trip.id} onClick={() => set({ tripId: draft.tripId === trip.id ? '' : trip.id })}>
                                    {trip.name}
                                </Chip>
                            ))}
                        </div>
                    </Section>
                ) : null}

                {accounts.length > 0 ? (
                    <Section title={t('activity.pickAccount')}>
                        <div className="flex flex-wrap gap-2">
                            {accounts.map((a) => (
                                <Chip key={a.id} size="sm" selected={draft.accountIds.includes(a.id)} onClick={() => toggleIn('accountIds', a.id)}>
                                    {a.name}
                                </Chip>
                            ))}
                        </div>
                    </Section>
                ) : null}

                {merchants.length > 0 ? (
                    <Section title={t('filters.merchant')}>
                        <label className="flex h-11 items-center gap-2 rounded-[14px] border border-line-strong bg-surface px-3 focus-within:ring-2 focus-within:ring-forest-ink">
                            <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                            <input type="search" value={merchantQuery} onChange={(e) => setMerchantQuery(e.target.value)} aria-label={t('filters.searchMerchants')} placeholder={t('filters.searchMerchants')} className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none" />
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {shownMerchants.map((m) => (
                                <Chip key={m.value} size="sm" selected={draft.merchants.includes(m.value)} onClick={() => toggleIn('merchants', m.value)}>
                                    {m.label}
                                    <span className="text-[11px] opacity-70">{m.count}</span>
                                </Chip>
                            ))}
                        </div>
                    </Section>
                ) : null}

                <Section title={t('filters.amount')}>
                    <div className="flex items-center gap-2">
                        <input className={`${field} font-mono`} inputMode="decimal" dir="ltr" value={minText} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''), maxText)} placeholder={t('filters.min')} aria-label={t('filters.min')} data-testid="amount-min" />
                        <span className="shrink-0 text-ink-muted" aria-hidden="true">–</span>
                        <input className={`${field} font-mono`} inputMode="decimal" dir="ltr" value={maxText} onChange={(e) => setAmount(minText, e.target.value.replace(/[^\d.,]/g, ''))} placeholder={t('filters.max')} aria-label={t('filters.max')} data-testid="amount-max" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {AMOUNT_RANGES.map((r) => (
                            <Chip key={r.id} size="sm" selected={rangeOn(r)} onClick={() => (rangeOn(r) ? setAmount('', '') : setAmount(String(r.min), String(r.max)))}>
                                {rangeLabel(r)}
                            </Chip>
                        ))}
                    </div>
                </Section>

                {tags.length > 0 ? (
                    <Section title={t('quickAdd.tags')}>
                        <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => (
                                <Chip key={tag.value} size="sm" selected={draft.tags.includes(tag.value)} onClick={() => toggleIn('tags', tag.value)}>
                                    {tag.label}
                                </Chip>
                            ))}
                        </div>
                    </Section>
                ) : null}

                <Section title={t('filters.status')}>
                    <div className="flex flex-wrap gap-2">
                        {STATUS.map(([id, label, on, toggle]) => (
                            <Chip key={id} size="sm" selected={on} onClick={toggle} data-testid={`status-${id}`}>
                                {label}
                            </Chip>
                        ))}
                    </div>
                </Section>

                {onSaveView ? (
                    <Section title={t('filters.saveView')}>
                        <div className="flex gap-2">
                            <input className={field} value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder={t('filters.viewNamePlaceholder')} aria-label={t('filters.viewName')} data-testid="view-name" />
                            <button
                                type="button"
                                disabled={!viewName.trim() || activeCount === 0}
                                onClick={() => {
                                    onSaveView(viewName.trim(), draft);
                                    setViewName('');
                                }}
                                className="h-12 shrink-0 rounded-[14px] border border-line-strong bg-surface px-4 text-sm font-semibold text-ink disabled:opacity-40"
                                data-testid="save-view"
                            >
                                {t('groups.save')}
                            </button>
                        </div>
                        {activeCount === 0 ? <p className="text-xs text-ink-muted">{t('filters.saveHint')}</p> : null}
                    </Section>
                ) : null}
            </div>
            <div className="border-t border-line px-5 pt-3">
                <button type="button" onClick={() => onApply(draft)} disabled={result.count === 0} className="h-14 w-full rounded-[18px] bg-forest px-4 text-base font-semibold text-white disabled:opacity-50" data-testid="filter-apply">
                    {result.count === 0 ? t('filters.noResults') : t('filters.show', { count: result.count, total })}
                </button>
            </div>
        </Sheet>
    );
}

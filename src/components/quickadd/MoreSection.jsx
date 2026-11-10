import { useState } from 'react';
import { Plus, Trash2, Users, X } from 'lucide-react';
import RecurringManager from '../receipts/RecurringManager';
import { useTranslation } from '../../languages/useTranslation';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'CNY', 'INR', 'MXN', 'BRL', 'ZAR'];

const field = 'w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const label = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

/**
 * The "More" accordion body of Quick Add: items, notes, group, tags, split, recurring, planned, currency.
 * Pure controlled component; the sheet owns the state.
 */
export default function MoreSection({ value, onChange, groups, onCreateGroup, onOpenSplit, date }) {
    const { t } = useTranslation();
    const [newGroup, setNewGroup] = useState('');
    const [showNewGroup, setShowNewGroup] = useState(false);
    const set = (patch) => onChange({ ...value, ...patch });

    const setItem = (i, patch) => set({ items: value.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
    const addTag = (raw) => {
        const tag = raw.trim().replace(/^#/, '');
        if (tag && !value.tags.includes(tag)) set({ tags: [...value.tags, tag] });
    };

    return (
        <div className="flex flex-col gap-4 rounded-[18px] bg-surface p-4 dark:ring-1 dark:ring-line" data-testid="quickadd-more">
            <div className="flex flex-col gap-2">
                <span className={label}>{t('quickAdd.items')}</span>
                {value.items.map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <input
                            aria-label={t('quickAdd.itemName')}
                            className={`${field} h-11 min-w-0 flex-1`}
                            placeholder={t('quickAdd.itemName')}
                            value={it.name}
                            onChange={(e) => setItem(i, { name: e.target.value })}
                        />
                        <input
                            aria-label={t('quickAdd.itemPrice')}
                            inputMode="decimal"
                            dir="ltr"
                            className={`${field} h-11 w-24 font-mono`}
                            placeholder="0,00"
                            value={it.price}
                            onChange={(e) => setItem(i, { price: e.target.value })}
                        />
                        <button type="button" aria-label={t('common.actions.remove')} onClick={() => set({ items: value.items.filter((_, idx) => idx !== i) })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-over-ink">
                            <Trash2 size={18} aria-hidden="true" />
                        </button>
                    </div>
                ))}
                <button type="button" onClick={() => set({ items: [...value.items, { name: '', price: '' }] })} className="flex h-11 items-center gap-1.5 self-start rounded-xl px-2 text-sm font-semibold text-forest-ink">
                    <Plus size={16} aria-hidden="true" />
                    {t('quickAdd.addItem')}
                </button>
            </div>

            <label className="flex flex-col gap-1.5">
                <span className={label}>{t('quickAdd.notes')}</span>
                <textarea rows={2} className={`${field} py-2.5`} value={value.notes} onChange={(e) => set({ notes: e.target.value })} />
            </label>

            <div className="flex flex-col gap-1.5">
                <span className={label}>{t('quickAdd.group')}</span>
                <div className="flex gap-2">
                    <select
                        aria-label={t('quickAdd.group')}
                        className={`${field} h-12 flex-1`}
                        value={value.groupId || ''}
                        onChange={(e) => {
                            const g = groups.find((x) => String(x.id) === e.target.value);
                            set({ groupId: g?.id || null, groupName: g?.name || null });
                        }}
                    >
                        <option value="">{t('receipts.form.noGroup')}</option>
                        {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                                {g.name}
                            </option>
                        ))}
                    </select>
                    <button type="button" aria-label={t('quickAdd.newGroup')} aria-expanded={showNewGroup} onClick={() => setShowNewGroup(!showNewGroup)} className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-line-strong bg-surface text-ink">
                        <Plus size={18} aria-hidden="true" />
                    </button>
                </div>
                {showNewGroup ? (
                    <div className="flex gap-2">
                        <input className={`${field} h-11 flex-1`} placeholder={t('receipts.form.newGroupPlaceholder')} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
                        <button
                            type="button"
                            className="h-11 rounded-xl bg-forest px-4 text-sm font-semibold text-white disabled:opacity-40"
                            disabled={!newGroup.trim()}
                            onClick={async () => {
                                const g = await onCreateGroup(newGroup.trim());
                                if (g) set({ groupId: g.id, groupName: g.name });
                                setNewGroup('');
                                setShowNewGroup(false);
                            }}
                        >
                            {t('receipts.form.createAndSelect')}
                        </button>
                    </div>
                ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
                <span className={label}>{t('quickAdd.tags')}</span>
                <div className="flex flex-wrap gap-2">
                    {value.tags.map((tag) => (
                        <span key={tag} className="inline-flex h-9 items-center gap-1 rounded-full bg-mint ps-3 pe-1 text-sm text-forest-ink">
                            {tag}
                            <button type="button" aria-label={t('common.actions.remove')} onClick={() => set({ tags: value.tags.filter((x) => x !== tag) })} className="flex h-8 w-8 items-center justify-center rounded-full">
                                <X size={14} aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
                <input
                    className={`${field} h-11`}
                    placeholder={t('quickAdd.tagsPlaceholder')}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            addTag(e.currentTarget.value);
                            e.currentTarget.value = '';
                        }
                    }}
                    onBlur={(e) => {
                        addTag(e.currentTarget.value);
                        e.currentTarget.value = '';
                    }}
                />
            </div>

            <div className="flex items-center gap-3">
                <button type="button" onClick={onOpenSplit} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border border-line-strong bg-surface text-sm font-semibold text-ink">
                    <Users size={16} aria-hidden="true" />
                    {value.splitData
                        ? value.splitData.method === 'equal'
                            ? t('receipts.form.splitBetween', { people: value.splitData.people })
                            : t('receipts.form.splitCustomCount', { people: value.splitData.users?.length || 0 })
                        : t('receipts.form.addSplit')}
                </button>
                {value.splitData ? (
                    <button type="button" onClick={() => set({ splitData: null })} className="h-11 px-2 text-sm font-medium text-over-ink">
                        {t('common.actions.remove')}
                    </button>
                ) : null}
            </div>

            <RecurringManager recurringData={value.recurringData} onChange={(recurringData) => set({ recurringData })} receiptDate={date} />

            <label className="flex min-h-[44px] items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-[#00573F]" checked={value.planned} onChange={(e) => set({ planned: e.target.checked })} />
                <span>
                    <span className="block text-sm font-medium text-ink">{t('quickAdd.planned')}</span>
                    <span className="block text-xs text-ink-muted">{t('quickAdd.plannedHint')}</span>
                </span>
            </label>

            <label className="flex flex-col gap-1.5">
                <span className={label}>{t('quickAdd.currency')}</span>
                <select className={`${field} h-12`} value={value.currency} onChange={(e) => set({ currency: e.target.value })}>
                    {[...new Set([value.currency, ...CURRENCIES])].map((c) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    );
}

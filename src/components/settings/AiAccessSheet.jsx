import { useEffect, useMemo, useState } from 'react';
import { Check, Search, ShieldCheck, X } from 'lucide-react';
import Sheet from '../ui/Sheet';
import { useTranslation } from '../../languages/useTranslation';

const TABS = ['pending', 'approved', 'denied'];
const PAGE = 50;

/** "2 days ago" in the app language. */
function useRelative() {
    const { languageCode } = useTranslation();
    return (iso) => {
        if (!iso) return '';
        const rtf = new Intl.RelativeTimeFormat(`${languageCode}-u-nu-latn`, { numeric: 'auto' });
        const secs = (new Date(iso).getTime() - Date.now()) / 1000;
        const steps = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
        for (const [unit, size] of steps) if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
        return rtf.format(0, 'minute');
    };
}

/**
 * The admin's review of AI access (Settings > AI & scanning > Review requests). Built for many accounts: tabs by status with counts,
 * search by email, one compact row per account with its main action, multi-select with a sticky bar that applies one decision to
 * all selected accounts, and the list shown 50 at a time. The server enforces every decision (ai_access_decide).
 *   accounts: from fetchAccessList()     decide({ userIds, status }) -> { done, failed }
 */
export default function AiAccessSheet({ open, onClose, accounts = [], decide, busyIds = [], onResult }) {
    const { t } = useTranslation();
    const ago = useRelative();
    const counts = useMemo(() => Object.fromEntries(TABS.map((s) => [s, accounts.filter((a) => !a.isAdmin && a.status === s).length])), [accounts]);
    const [tab, setTab] = useState('pending');
    const [q, setQ] = useState('');
    const [selected, setSelected] = useState(() => new Set());
    const [limit, setLimit] = useState(PAGE);

    // open on the waiting tab when someone waits, else on approved
    useEffect(() => {
        if (!open) return;
        setTab(counts.pending > 0 ? 'pending' : 'approved');
        setQ('');
        setSelected(new Set());
        setLimit(PAGE);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        setSelected(new Set());
        setLimit(PAGE);
    }, [tab, q]);

    const needle = q.trim().toLowerCase();
    const rows = accounts.filter((a) => (tab === 'approved' ? a.status === 'approved' || a.isAdmin : !a.isAdmin && a.status === tab)).filter((a) => !needle || a.email.toLowerCase().includes(needle));
    const selectable = rows.filter((a) => !a.isAdmin);
    const shown = rows.slice(0, limit);
    const allSelected = selectable.length > 0 && selectable.every((a) => selected.has(a.userId));
    const busy = new Set(busyIds);

    const toggle = (id) =>
        setSelected((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    const run = async (userIds, status) => {
        const result = await decide({ userIds, status });
        setSelected(new Set());
        onResult?.(result, status);
    };

    // the main decision of a row in each tab, and the second one where it exists
    const primary = { pending: ['approved', 'aiAccess.approve', Check], approved: ['denied', 'aiAccess.revoke', X], denied: ['approved', 'aiAccess.approve', Check] }[tab];
    const secondary = tab === 'pending' ? ['denied', 'aiAccess.deny', X] : null;

    return (
        <Sheet open={open} onClose={onClose} label={t('aiAccess.sheetTitle')} fullHeight>
            <div className="flex min-h-0 flex-1 flex-col" data-testid="ai-access-sheet">
                <div className="flex flex-col gap-3 px-5 pb-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1">
                            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
                                <ShieldCheck size={18} className="text-forest-ink" aria-hidden="true" />
                                {t('aiAccess.sheetTitle')}
                            </h2>
                            <p className="text-[13px] leading-relaxed text-ink-muted">{t('aiAccess.sheetHint')}</p>
                        </div>
                        <button type="button" onClick={onClose} className="h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-forest-ink">
                            {t('aiAccess.close')}
                        </button>
                    </div>
                    <div role="tablist" aria-label={t('aiAccess.sheetTitle')} className="grid grid-cols-3 gap-1 rounded-2xl bg-tint p-1">
                        {TABS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                role="tab"
                                aria-selected={tab === s}
                                onClick={() => setTab(s)}
                                className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold ${tab === s ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,33,27,.08)] dark:ring-1 dark:ring-line' : 'text-ink-muted'}`}
                                data-testid={`ai-tab-${s}`}
                            >
                                {t(`aiAccess.state.${s}`)}
                                <span className={`min-w-[22px] rounded-full px-1.5 text-xs tabular-nums ${s === 'pending' && counts.pending > 0 ? 'bg-warn-soft text-warn-ink' : 'bg-surface/60 text-ink-muted'}`}>{counts[s] + (s === 'approved' ? accounts.filter((a) => a.isAdmin).length : 0)}</span>
                            </button>
                        ))}
                    </div>
                    {accounts.length > 6 ? (
                        <label className="flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3 focus-within:ring-2 focus-within:ring-forest-ink">
                            <Search size={16} className="shrink-0 text-ink-faint" aria-hidden="true" />
                            <span className="sr-only">{t('aiAccess.search')}</span>
                            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('aiAccess.search')} className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none" data-testid="ai-access-search" />
                        </label>
                    ) : null}
                    {selectable.length > 1 ? (
                        <div className="flex items-center justify-between text-[13px]">
                            <span className="text-ink-muted">{selected.size ? t('aiAccess.selected', { count: selected.size }) : t('aiAccess.accountsCount', { count: rows.length })}</span>
                            <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(selectable.map((a) => a.userId)))} className="min-h-[44px] font-semibold text-forest-ink" data-testid="ai-select-all">
                                {allSelected ? t('aiAccess.clearSelection') : t('aiAccess.selectAll')}
                            </button>
                        </div>
                    ) : null}
                </div>

                <ul className="min-h-0 flex-1 overflow-y-auto px-3" data-testid="ai-access-list">
                    {rows.length === 0 ? <li className="px-3 py-10 text-center text-sm text-ink-muted">{needle ? t('aiAccess.noMatch', { q: q.trim() }) : t(`aiAccess.empty.${tab}`)}</li> : null}
                    {shown.map((a) => {
                        const isBusy = busy.has(a.userId);
                        const checked = selected.has(a.userId);
                        return (
                            <li key={a.userId} className="border-b border-line last:border-0" data-testid="ai-access-row" data-status={a.isAdmin ? 'admin' : a.status}>
                                <div className="flex min-h-[64px] items-center gap-3 px-2 py-2">
                                    {a.isAdmin ? (
                                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-mint text-forest-ink" aria-hidden="true">
                                            <ShieldCheck size={18} />
                                        </span>
                                    ) : (
                                        <button type="button" role="checkbox" aria-checked={checked} aria-label={a.email || a.userId} onClick={() => toggle(a.userId)} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold uppercase ${checked ? 'bg-forest text-white' : 'border border-line-strong bg-surface text-ink-muted'}`}>
                                            {checked ? <Check size={18} aria-hidden="true" /> : (a.email || '?').slice(0, 1)}
                                        </button>
                                    )}
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-[15px] font-medium text-ink" dir="ltr">{a.email || a.userId}</span>
                                        <span className="truncate text-xs text-ink-muted">
                                            {a.isAdmin ? t('aiAccess.you') : [t(tab === 'pending' ? 'aiAccess.asked' : 'aiAccess.decidedAgo', { when: ago(tab === 'pending' ? a.requestedAt : a.decidedAt || a.requestedAt) }), a.callsToday ? t('aiAccess.callsToday', { count: a.callsToday }) : null].filter(Boolean).join(' · ')}
                                        </span>
                                    </div>
                                    {a.isAdmin || selected.size ? null : (
                                        <div className="flex shrink-0 items-center gap-1">
                                            {secondary ? (
                                                <button type="button" onClick={() => run([a.userId], secondary[0])} disabled={isBusy} aria-label={`${t(secondary[1])}: ${a.email}`} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted disabled:opacity-40" data-testid="ai-row-secondary">
                                                    <X size={18} aria-hidden="true" />
                                                </button>
                                            ) : null}
                                            <button type="button" onClick={() => run([a.userId], primary[0])} disabled={isBusy} className={`flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-40 ${primary[0] === 'approved' ? 'bg-mint text-forest-ink' : 'border border-line-strong text-ink'}`} data-testid="ai-row-primary">
                                                {t(primary[1])}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                    {rows.length > shown.length ? (
                        <li className="flex justify-center py-2">
                            <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="h-11 rounded-xl px-4 text-sm font-semibold text-forest-ink">
                                {t('aiAccess.showMore', { count: rows.length - shown.length })}
                            </button>
                        </li>
                    ) : null}
                </ul>

                {selected.size ? (
                    <div className="flex items-center gap-2 border-t border-line bg-surface px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-3" data-testid="ai-bulk-bar">
                        {secondary ? (
                            <button type="button" onClick={() => run([...selected], secondary[0])} disabled={busy.size > 0} className="h-12 flex-1 rounded-[18px] border border-line-strong bg-surface text-sm font-semibold text-ink disabled:opacity-50" data-testid="ai-bulk-secondary">
                                {t('aiAccess.denyN', { count: selected.size })}
                            </button>
                        ) : null}
                        <button type="button" onClick={() => run([...selected], primary[0])} disabled={busy.size > 0} className={`h-12 flex-[1.4] rounded-[18px] text-sm font-semibold disabled:opacity-50 ${primary[0] === 'approved' ? 'bg-forest text-white' : 'border border-line-strong bg-surface text-ink'}`} data-testid="ai-bulk-primary">
                            {t(primary[0] === 'approved' ? 'aiAccess.approveN' : 'aiAccess.revokeN', { count: selected.size })}
                        </button>
                    </div>
                ) : null}
            </div>
        </Sheet>
    );
}

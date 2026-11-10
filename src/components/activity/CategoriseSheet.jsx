import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { Sheet } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { AiError, applySuggestions, categorizeMerchants, uncategorisedMerchants } from '../../services/aiCategorize';
import { getAccessToken } from '../../services/accessToken';
import { useAppStore } from '../../store/appStore';
import { notifyDataChanged } from '../../data/queryClient';

/**
 * Review sheet for "Categorise with AI": merchant -> suggested category. Rows with confidence >= 0.8 start checked.
 * Props: transactions (all), categoryNames, userId.
 */
export default function CategoriseSheet({ open, onClose, transactions, categoryNames, userId, fetchImpl, initialSuggestions = null }) {
    const { t, localizeCategory } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const [phase, setPhase] = useState('loading'); // loading | review | error | empty
    const [errorKind, setErrorKind] = useState(null);
    const [rows, setRows] = useState([]);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [applying, setApplying] = useState(false);
    const [editing, setEditing] = useState(null); // merchant key whose category picker is open

    const merchants = useMemo(() => (open ? uncategorisedMerchants(transactions) : []), [open, transactions]);

    useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        setEditing(null);
        if (initialSuggestions) {
            setRows(initialSuggestions);
            setPhase('review');
            return undefined;
        }
        if (merchants.length === 0) {
            setPhase('empty');
            return undefined;
        }
        setPhase('loading');
        setErrorKind(null);
        setProgress({ done: 0, total: Math.ceil(merchants.length / 50) });
        categorizeMerchants({
            merchants,
            categories: categoryNames,
            getToken: getAccessToken,
            fetchImpl,
            onProgress: (done, total) => !cancelled && setProgress({ done, total }),
        })
            .then((res) => {
                if (cancelled) return;
                setRows(res);
                setPhase('review');
            })
            .catch((err) => {
                if (cancelled) return;
                setErrorKind(err instanceof AiError ? err.kind : 'server');
                setPhase('error');
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const selectedCount = rows.filter((r) => r.selected && r.category).length;
    const selectedTx = rows.filter((r) => r.selected && r.category).reduce((s, r) => s + r.count, 0);

    const toggle = (key) => setRows((rs) => rs.map((r) => (r.key === key && r.category ? { ...r, selected: !r.selected } : r)));
    const setCategory = (key, category) => {
        setRows((rs) => rs.map((r) => (r.key === key ? { ...r, category, selected: true, confidence: 1 } : r)));
        setEditing(null);
    };

    const apply = async () => {
        setApplying(true);
        try {
            const applied = await applySuggestions(userId, rows);
            notifyDataChanged();
            onClose();
            showToast(t('categorise.applied', { count: applied.count }), 'success', {
                action: { label: t('quickAdd.undo'), onClick: () => applied.undo().then(() => notifyDataChanged()) },
            });
        } catch {
            showToast(t('quickAdd.saveFailed'), 'error');
        } finally {
            setApplying(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} label={t('categorise.title')} fullHeight={phase === 'review'}>
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="px-5 pb-2">
                    <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
                        <Sparkles size={18} className="text-forest-ink" aria-hidden="true" />
                        {t('categorise.title')}
                    </h2>
                    {phase === 'review' ? <p className="pt-1 text-sm text-ink-muted">{t('categorise.hint')}</p> : null}
                </div>

                {phase === 'loading' ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="status">
                        <Loader2 size={26} className="animate-spin text-forest-ink" aria-hidden="true" />
                        <p className="text-sm text-ink-muted">{t('categorise.working', { done: progress.done, total: progress.total })}</p>
                    </div>
                ) : null}

                {phase === 'empty' ? <p className="px-6 py-8 text-center text-sm text-ink-muted">{t('categorise.nothing')}</p> : null}

                {phase === 'error' ? (
                    <div className="flex flex-col gap-3 px-5 pb-3" role="alert">
                        <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink" data-testid="categorise-error">
                            {t(`categorise.err.${errorKind}`)}
                        </p>
                        <button type="button" onClick={onClose} className="h-12 rounded-[18px] border border-line-strong bg-surface text-sm font-semibold text-ink">
                            {t('categorise.close')}
                        </button>
                    </div>
                ) : null}

                {phase === 'review' ? (
                    <>
                        <ul className="min-h-0 flex-1 overflow-y-auto px-3" data-testid="categorise-list">
                            {rows.map((r) => (
                                <li key={r.key} className="border-b border-line last:border-0">
                                    <div className="flex min-h-[56px] items-center gap-3 px-2 py-2">
                                        <button
                                            type="button"
                                            role="checkbox"
                                            aria-checked={!!r.selected}
                                            aria-label={r.name}
                                            disabled={!r.category}
                                            onClick={() => toggle(r.key)}
                                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${r.selected ? 'bg-forest text-white' : 'border border-line-strong bg-surface text-transparent'} disabled:opacity-40`}
                                        >
                                            <Check size={18} aria-hidden="true" />
                                        </button>
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-[15px] font-medium text-ink">{r.name}</span>
                                            <span className="text-xs text-ink-muted">{t('categorise.rowMeta', { count: r.count, pct: Math.round((r.confidence || 0) * 100) })}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setEditing(editing === r.key ? null : r.key)}
                                            aria-expanded={editing === r.key}
                                            className="flex h-11 max-w-[42%] shrink-0 items-center truncate rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-forest-ink"
                                        >
                                            {r.category ? localizeCategory(r.category) : t('categorise.pick')}
                                        </button>
                                    </div>
                                    {editing === r.key ? (
                                        <div className="flex flex-wrap gap-2 px-2 pb-3">
                                            {categoryNames.map((n) => (
                                                <button
                                                    key={n}
                                                    type="button"
                                                    onClick={() => setCategory(r.key, n)}
                                                    aria-pressed={r.category === n}
                                                    className={`h-10 rounded-full border px-3.5 text-sm font-medium ${r.category === n ? 'border-ink bg-ink text-ground' : 'border-line-strong bg-surface text-ink'}`}
                                                >
                                                    {localizeCategory(n)}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                        <div className="flex shrink-0 flex-col gap-2 px-5 pt-3">
                            <button type="button" onClick={apply} disabled={selectedCount === 0 || applying} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40" data-autofocus>
                                {t('categorise.apply', { count: selectedTx })}
                            </button>
                            <button type="button" onClick={onClose} className="h-11 text-sm font-semibold text-ink-muted">
                                {t('common.actions.cancel')}
                            </button>
                        </div>
                    </>
                ) : null}
            </div>
        </Sheet>
    );
}

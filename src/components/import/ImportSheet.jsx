import { useMemo, useReducer, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileUp, Sparkles } from 'lucide-react';
import { Chip, Sheet } from '../ui';
import CategoriseSheet from '../activity/CategoriseSheet';
import { useAppStore } from '../../store/appStore';
import { useAccounts, useCreateTransaction, useMerchantRules, useSettings, useTransactions, useTrips, useUpdateTransaction } from '../../data/hooks';
import { useCategories } from '../../hooks/useCategories';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { guessMapping } from '../../import/parsers/generic';
import { PROVIDERS, applyImport, buildPreview, csvHeaders, initialState, parseFor, reducer, summarize } from '../../import/importFlow';

const field = 'h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-forest-ink';
const lbl = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';
const MAX_ROWS = 300;

/** Import a bank CSV (Settings > Data, or from an account on Savings). Account -> provider -> file -> (mapper) -> preview -> import. */
export default function ImportSheet({ open, onClose, accountId = null }) {
    // the wizard state is rebuilt on every open (key) so a second import never sees the first one's file
    return open ? <Wizard key={String(open) + accountId} onClose={onClose} accountId={accountId} /> : null;
}

function Wizard({ onClose, accountId }) {
    const { t, localizeCategory } = useTranslation();
    const { num } = useMoney();
    const showToast = useAppStore((s) => s.showToast);
    const userId = useAppStore((s) => s.currentUser?.userId);
    const { accounts } = useAccounts();
    const { transactions } = useTransactions();
    const { trips } = useTrips();
    const { rules } = useMerchantRules();
    const { defaultCurrency } = useSettings();
    const categoryList = useCategories();
    const createTransaction = useCreateTransaction();
    const updateTransaction = useUpdateTransaction();
    const [state, dispatch] = useReducer(reducer, { accountId }, initialState);
    const [busy, setBusy] = useState(false);
    const [aiOpen, setAiOpen] = useState(false);
    const [mapping, setMapping] = useState(null);
    const fileRef = useRef(null);
    const names = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n !== 'Income' && n !== 'Transfer'), [categoryList]);
    const headers = useMemo(() => (state.text ? csvHeaders(state.text) : []), [state.text]);
    const account = accounts.find((a) => a.id === state.accountId);
    const summary = summarize(state.items);

    const preview = async (m, text = state.text) => {
        setBusy(true);
        try {
            const { rows, skipped } = await parseFor(state.provider, text, { mapping: m, currency: account?.currency || defaultCurrency });
            if (rows.length === 0) throw new Error('empty');
            dispatch({ type: 'PARSED', items: buildPreview({ rows, existing: transactions, trips, rules, names }), skipped });
        } catch (err) {
            dispatch({ type: 'ERROR', error: err?.message === 'empty' ? 'empty' : 'parse' });
        } finally {
            setBusy(false);
        }
    };

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const text = await file.text();
        dispatch({ type: 'FILE', text, name: file.name });
        if (state.provider === 'other') setMapping({ ...guessMapping(csvHeaders(text)), dateFormat: 'auto', decimal: 'auto', invertSign: false });
        else preview(undefined, text);
    };
    const run = async () => {
        setBusy(true);
        const result = await applyImport({ items: state.items, accountId: state.accountId, userId, createTransaction, updateTransaction });
        setBusy(false);
        dispatch({ type: 'DONE', result: { ...result, unknown: summary.unknown } });
        showToast(t('csvImport.imported', { count: result.created + result.merged }), 'success');
    };

    const titleKey = { account: 'csvImport.pickAccount', provider: 'csvImport.pickProvider', file: 'csvImport.pickFile', mapping: 'csvImport.mapColumns', preview: 'csvImport.previewTitle', done: 'csvImport.doneTitle' }[state.step];
    const canBack = ['provider', 'file', 'mapping', 'preview'].includes(state.step) && !(state.step === 'provider' && accountId);
    const select = (key, label, optional = false) => (
        <label className="flex flex-col gap-1.5" key={key}>
            <span className={lbl}>{label}</span>
            <select className={field} value={mapping?.[key] ?? ''} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value || null })}>
                {optional ? <option value="">—</option> : null}
                {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                ))}
            </select>
        </label>
    );
    const rowLabel = (item) => (item.duplicate ? (item.duplicate.reason === 'import_ref' ? t('csvImport.alreadyImported') : item.action === 'merge' ? t('csvImport.mergeInto', { name: item.duplicate.existing.merchant || '' }) : t('csvImport.addAnyway')) : null);

    return (
        <Sheet open onClose={onClose} label={t('csvImport.title')} fullHeight>
            <div className="flex items-center gap-1 px-3">
                {canBack ? (
                    <button type="button" onClick={() => dispatch({ type: 'BACK' })} aria-label={t('common.actions.back')} className="flex h-11 w-11 items-center justify-center rounded-full text-ink">
                        <ChevronLeft size={20} aria-hidden="true" className="rtl:rotate-180" />
                    </button>
                ) : <span className="w-2" />}
                <h2 className="font-display text-lg font-bold text-ink">{t(titleKey)}</h2>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2 pt-2">
                {state.error ? <p role="alert" className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t(`csvImport.error.${state.error}`)}</p> : null}

                {state.step === 'account' ? (
                    accounts.length === 0 ? <p className="text-sm text-ink-muted">{t('savings.noAccounts')}</p> : (
                        <ul className="flex flex-col">
                            {accounts.map((a) => (
                                <li key={a.id} className="border-b border-line last:border-0">
                                    <button type="button" onClick={() => dispatch({ type: 'ACCOUNT', accountId: a.id })} className="flex min-h-[56px] w-full items-center justify-between text-start text-[15px] font-medium text-ink">
                                        {a.name}
                                        <ChevronRight size={16} aria-hidden="true" className="text-ink-faint rtl:rotate-180" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )
                ) : null}

                {state.step === 'provider' ? (
                    <>
                        <p className="text-sm text-ink-muted">{t('csvImport.intoAccount', { name: account?.name || '' })}</p>
                        {PROVIDERS.map((p) => (
                            <button key={p} type="button" onClick={() => dispatch({ type: 'PROVIDER', provider: p })} className="flex min-h-[64px] items-center justify-between rounded-[18px] bg-surface px-4 text-start shadow-[0_1px_2px_rgba(16,33,27,.06)] dark:shadow-none dark:ring-1 dark:ring-line">
                                <span className="flex flex-col">
                                    <span className="text-[15px] font-semibold text-ink">{t(`csvImport.provider.${p}`)}</span>
                                    <span className="text-xs text-ink-muted">{t(`csvImport.providerHint.${p}`)}</span>
                                </span>
                                <ChevronRight size={16} aria-hidden="true" className="text-ink-faint rtl:rotate-180" />
                            </button>
                        ))}
                    </>
                ) : null}

                {state.step === 'file' ? (
                    <>
                        <p className="text-sm text-ink-muted">{t(`csvImport.fileHint.${state.provider}`)}</p>
                        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-forest text-base font-semibold text-white disabled:opacity-40">
                            <FileUp size={20} aria-hidden="true" />
                            {busy ? t('csvImport.reading') : t('csvImport.chooseFile')}
                        </button>
                    </>
                ) : null}
                <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} data-testid="csv-input" />

                {state.step === 'mapping' && mapping ? (
                    <>
                        <p className="text-sm text-ink-muted">{state.fileName}</p>
                        {select('date', t('csvImport.col.date'))}
                        {select('description', t('csvImport.col.description'))}
                        {select('amount', t('csvImport.col.amount'), true)}
                        <div className="flex gap-3">
                            <div className="min-w-0 flex-1">{select('debit', t('csvImport.col.debit'), true)}</div>
                            <div className="min-w-0 flex-1">{select('credit', t('csvImport.col.credit'), true)}</div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className={lbl}>{t('csvImport.dateFormat')}</span>
                            <div className="flex flex-wrap gap-2">
                                {['auto', 'dmy', 'mdy', 'ymd'].map((f) => <Chip key={f} selected={mapping.dateFormat === f} onClick={() => setMapping({ ...mapping, dateFormat: f })}>{f === 'auto' ? t('csvImport.auto') : f.toUpperCase()}</Chip>)}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className={lbl}>{t('csvImport.decimal')}</span>
                            <div className="flex flex-wrap gap-2">
                                {['auto', ',', '.'].map((f) => <Chip key={f} selected={mapping.decimal === f} onClick={() => setMapping({ ...mapping, decimal: f })}>{f === 'auto' ? t('csvImport.auto') : `1${f}5`}</Chip>)}
                            </div>
                        </div>
                        <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink">
                            {t('csvImport.invertSign')}
                            <input type="checkbox" role="switch" className="h-6 w-6 accent-[#00573F]" checked={!!mapping.invertSign} onChange={(e) => setMapping({ ...mapping, invertSign: e.target.checked })} />
                        </label>
                    </>
                ) : null}

                {state.step === 'preview' ? (
                    <>
                        <div className="overflow-x-auto rounded-[14px] bg-surface dark:ring-1 dark:ring-line">
                            <table className="w-full text-start text-sm" data-testid="import-preview">
                                <thead>
                                    <tr className="text-xs uppercase tracking-wide text-ink-muted">
                                        <th className="px-3 py-2 text-start font-semibold">{t('csvImport.col.date')}</th>
                                        <th className="px-1 py-2 text-start font-semibold">{t('csvImport.col.description')}</th>
                                        <th className="px-3 py-2 text-end font-semibold">{t('csvImport.col.amount')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {state.items.slice(0, MAX_ROWS).map((item) => {
                                        const dupLabel = rowLabel(item);
                                        const skipped = item.action === 'skip';
                                        return (
                                            <tr key={item.index} className={`border-t border-line align-top ${skipped ? 'opacity-50' : ''}`}>
                                                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-muted">{item.row.date.slice(5)}</td>
                                                <td className="px-1 py-2.5">
                                                    <span className="block truncate text-ink" style={{ maxWidth: 170 }}>{item.row.description}</span>
                                                    <span className="block text-xs text-ink-muted">
                                                        {item.row.transactionType === 'transfer' ? t('quickAdd.transfer') : item.row.transactionType === 'income' ? t('quickAdd.income') : localizeCategory(item.category)}
                                                        {item.tripName ? ` · ${item.tripName}` : ''}
                                                    </span>
                                                    {dupLabel ? (
                                                        item.duplicate.reason === 'import_ref' ? (
                                                            <span className="mt-1 inline-flex rounded-md bg-tint px-2 py-0.5 text-xs font-semibold text-ink-muted">{dupLabel}</span>
                                                        ) : (
                                                            <button type="button" onClick={() => dispatch({ type: 'SET_ACTION', index: item.index, action: item.action === 'merge' ? 'import' : 'merge' })} className="mt-1 inline-flex min-h-[44px] items-center rounded-md bg-warn-soft px-2 text-xs font-semibold text-warn-ink">
                                                                {dupLabel}
                                                            </button>
                                                        )
                                                    ) : (
                                                        <button type="button" onClick={() => dispatch({ type: 'SET_ACTION', index: item.index, action: skipped ? 'import' : 'skip' })} className="inline-flex min-h-[44px] items-center text-xs font-semibold text-forest-ink">
                                                            {skipped ? t('csvImport.include') : t('csvImport.skip')}
                                                        </button>
                                                    )}
                                                </td>
                                                <td className={`whitespace-nowrap px-3 py-2.5 text-end font-mono text-sm ${item.row.direction === 'in' ? 'text-income' : 'text-ink'}`}>{item.row.direction === 'in' ? '+' : '−'}{num(item.row.amount, item.row.currency)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {state.items.length > MAX_ROWS ? <p className="text-xs text-ink-muted">{t('csvImport.more', { shown: MAX_ROWS, total: state.items.length })}</p> : null}
                    </>
                ) : null}

                {state.step === 'done' ? (
                    <div className="flex flex-col gap-3" data-testid="import-done">
                        <p className="text-[15px] text-ink">{t('csvImport.result', { created: state.result.created, merged: state.result.merged, skipped: state.result.skipped })}</p>
                        {state.result.failed ? <p className="text-sm text-over-ink">{t('csvImport.failed', { count: state.result.failed })}</p> : null}
                        {state.result.unknown > 0 ? (
                            <button type="button" onClick={() => setAiOpen(true)} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-forest-ink bg-surface text-sm font-semibold text-forest-ink">
                                <Sparkles size={16} aria-hidden="true" />
                                {t('csvImport.categoriseAi', { count: state.result.unknown })}
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <div className="flex flex-col gap-2 px-5 pt-2">
                {state.step === 'mapping' ? (
                    <button type="button" disabled={busy || !mapping?.date || (!mapping?.amount && !(mapping?.debit && mapping?.credit))} onClick={() => preview(mapping)} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                        {t('csvImport.preview')}
                    </button>
                ) : null}
                {state.step === 'preview' ? (
                    <>
                        <p className="text-center text-xs text-ink-muted">{t('csvImport.summary', { create: summary.import, merge: summary.merge, skip: summary.skip })}</p>
                        <button type="button" disabled={busy || summary.import + summary.merge === 0} onClick={run} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                            {busy ? t('csvImport.importing') : t('csvImport.import', { count: summary.import + summary.merge })}
                        </button>
                    </>
                ) : null}
                {state.step === 'done' ? (
                    <button type="button" onClick={onClose} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white">
                        {t('activity.done')}
                    </button>
                ) : null}
            </div>
            <CategoriseSheet open={aiOpen} onClose={() => setAiOpen(false)} transactions={transactions} categoryNames={names} userId={userId} />
        </Sheet>
    );
}

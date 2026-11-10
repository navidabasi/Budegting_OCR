import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Camera, CloudOff, FileText, Loader2, X } from 'lucide-react';
import ReviewScreen from '../components/scan/ReviewScreen';
import { useAppStore } from '../store/appStore';
import { useAccounts, useCreateGroup, useCreateTransaction, useDeleteTransaction, useGroupsData, useSettings, useTransactions } from '../data/hooks';
import { useCategories } from '../hooks/useCategories';
import { useTranslation } from '../languages/useTranslation';
import { buildHints, extractReceipt, initialScanState, ScanError, scanReducer } from '../services/receiptScan';
import { createPendingScan } from '../services/pendingScans';
import { queueImage, requestImageFlush } from '../data/images';
import { optimizeImage } from '../utils/imageOptimize';
import { isPdf, renderPdfFirstPage } from '../utils/pdfRender';
import { decimalSeparator, formatMoney, localeFor } from '../utils/format';
import { getLastAccountId, setLastAccountId } from '../utils/quickAdd';
import { suggestCategory } from '../services/categorizer';
import { merchantKey } from '../utils/merchant';
import { resolveCategory } from '../utils/quickAdd';
import { takeSharedFiles } from '../services/sharedFiles';

async function getAccessToken() {
    const { supabase } = await import('../services/supabaseService');
    const { data } = (await supabase?.auth.getSession()) || {};
    return data?.session?.access_token || null;
}

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function formFromResult(result, { defaultCurrency, sep, accountId, names }) {
    const r = result.receipt;
    const category = resolveCategory(r.category, names) || resolveCategory(suggestCategory({ merchant: r.merchant, items: r.items }).category, names) || '';
    return {
        suggested: category,
        merchant: r.merchant || '',
        date: r.date || new Date().toISOString().slice(0, 10),
        total: r.total === null ? '' : String(r.total).replace('.', sep),
        currency: r.currency || defaultCurrency,
        category,
        items: r.items.map((it) => ({ name: it.name, price: it.price === null ? '' : String(it.price).replace('.', sep), quantity: it.quantity || 1, category: it.category })),
        accountId,
        edited: {},
        more: { notes: '', groupId: null, groupName: null, tags: [], splitData: null },
    };
}

/** Scan flow: capture or pick -> optimise (PDF -> image) -> /api/extract-receipt -> review -> save. */
export default function ScanPage() {
    const { t, languageCode } = useTranslation();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const currentUser = useAppStore((s) => s.currentUser);
    const showToast = useAppStore((s) => s.showToast);
    const openQuickAdd = useAppStore((s) => s.openQuickAdd);
    const { defaultCurrency } = useSettings();
    const { transactions } = useTransactions();
    const { accounts } = useAccounts();
    const { groups } = useGroupsData();
    const categoryList = useCategories();
    const createTransaction = useCreateTransaction();
    const deleteTransaction = useDeleteTransaction();
    const createGroup = useCreateGroup();
    const [state, dispatch] = useReducer(scanReducer, initialScanState);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const cameraRef = useRef(null);
    const galleryRef = useRef(null);
    const startedRef = useRef(false);

    const categoryNames = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n !== 'Income' && n !== 'Transfer'), [categoryList]);
    const locale = localeFor(languageCode, defaultCurrency);
    const sep = decimalSeparator(locale);

    const previewUrl = useMemo(() => (state.file ? URL.createObjectURL(state.file) : state.original && !isPdf(state.original) ? URL.createObjectURL(state.original) : null), [state.file, state.original]);
    useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

    const hintsRef = useRef(null);
    hintsRef.current = () => buildHints({ languageCode, defaultCurrency, categories: categoryNames, transactions, accounts });

    const handlePick = useCallback(
        async (file) => {
            if (!file) return;
            dispatch({ type: 'PICK', file });
            setForm(null);
            try {
                const image = isPdf(file) ? await renderPdfFirstPage(file) : file;
                const { file: prepared } = await optimizeImage(image);
                dispatch({ type: 'PREPARED', file: prepared });
            } catch (err) {
                console.error('[Scan] prepare failed', err);
                dispatch({ type: 'FAILED', kind: 'invalid' });
            }
        },
        []
    );

    // Run the extraction whenever a prepared image is waiting
    useEffect(() => {
        if (state.phase !== 'extracting' || !state.file) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const result = await extractReceipt({ file: state.file, mime: state.file.type, hints: hintsRef.current(), getToken: getAccessToken });
                if (cancelled) return;
                const last = getLastAccountId();
                const accountId = (accounts.find((a) => a.id === last) || accounts[0])?.id || null;
                setForm(formFromResult(result, { defaultCurrency, sep, accountId, names: categoryNames }));
                dispatch({ type: 'EXTRACTED', result });
            } catch (err) {
                if (cancelled) return;
                if (err instanceof ScanError && err.kind === 'offline') {
                    try {
                        await createPendingScan({ userId: currentUser.userId, file: state.file, label: t('scan.pendingMerchant'), accountId: accounts[0]?.id || null, currency: defaultCurrency });
                        dispatch({ type: 'QUEUED' });
                        return;
                    } catch (queueErr) {
                        console.error('[Scan] could not queue offline scan', queueErr);
                    }
                }
                dispatch({ type: 'FAILED', kind: err?.kind || 'server' });
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.phase, state.file]);

    // Entry points: ?source=camera|gallery open the picker; ?shared=1 picks up a file shared into the app
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        if (params.get('shared')) {
            takeSharedFiles().then((files) => files[0] && handlePick(files[0]));
        } else if (params.get('source') === 'camera') cameraRef.current?.click();
        else if (params.get('source') === 'gallery') galleryRef.current?.click();
    }, [params, handlePick]);

    const onInput = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) handlePick(file);
    };

    const openManual = (withForm) => {
        const initial = withForm
            ? { merchant: form.merchant, total: parseFloat(String(form.total).replace(',', '.')) || 0, date: form.date, category: form.category, currency: form.currency, accountId: form.accountId }
            : {};
        openQuickAdd({ initial, image: state.file || null });
        navigate(-1);
    };

    const save = async () => {
        if (!form || !currentUser || saving) return;
        const total = parseFloat(String(form.total).replace(',', '.')) || 0;
        if (total <= 0) return;
        setSaving(true);
        try {
            const id = newId();
            const r = state.result.receipt;
            const imagePath = state.file ? await queueImage({ userId: currentUser.userId, transactionId: id, blob: state.file }) : null;
            const lineItems = form.items
                .filter((it) => it.name.trim() && it.price !== '')
                .map((it) => ({ name: it.name.trim(), quantity: it.quantity || 1, price: parseFloat(String(it.price).replace(',', '.')) || 0, category: it.category || form.category }));
            await createTransaction({
                id,
                userId: currentUser.userId,
                merchant: form.merchant.trim(),
                merchantKey: form.merchant.trim() ? merchantKey(form.merchant) : null,
                date: form.date,
                total,
                currency: form.currency,
                category: form.category || categoryNames.find((n) => n === 'Other') || 'Other',
                lineItems,
                notes: form.more.notes,
                transactionType: 'expense',
                accountId: form.accountId,
                groupId: form.more.groupId,
                groupName: form.more.groupName,
                groupTags: form.more.tags,
                splitData: form.more.splitData,
                imagePath,
                extraction: { ...state.result.extraction, confidence: r.confidence, paymentMethod: r.paymentMethod, time: r.time, merchantRaw: r.merchantRaw, tax: r.tax },
            });
            if (form.accountId) setLastAccountId(form.accountId);
            requestImageFlush(currentUser.userId);
            const money = formatMoney(total, form.currency, locale);
            showToast(form.merchant.trim() ? t('quickAdd.addedAt', { amount: money, merchant: form.merchant.trim() }) : t('quickAdd.added', { amount: money }), 'success', {
                action: { label: t('quickAdd.undo'), onClick: () => deleteTransaction(id).then(() => showToast(t('quickAdd.removed'), 'info')) },
            });
            navigate('/', { replace: true });
        } catch (err) {
            console.error('[Scan] save failed', err);
            showToast(t('quickAdd.saveFailed'), 'error');
            setSaving(false);
        }
    };

    const inputs = (
        <>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onInput} data-testid="scan-camera-input" aria-hidden="true" tabIndex={-1} />
            <input ref={galleryRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onInput} data-testid="scan-file-input" aria-hidden="true" tabIndex={-1} />
        </>
    );

    if (state.phase === 'review' && form) {
        return (
            <>
                {inputs}
                <ReviewScreen
                    result={state.result}
                    form={form}
                    onChange={setForm}
                    imageUrl={previewUrl}
                    accounts={accounts}
                    groups={groups}
                    categoryNames={categoryNames}
                    transactions={transactions}
                    onCreateGroup={(name) => createGroup({ name, color: '#3b82f6', isPinned: false })}
                    onSave={save}
                    onManual={() => openManual(true)}
                    onRescan={() => {
                        dispatch({ type: 'RESCAN' });
                        setForm(null);
                    }}
                    onBack={() => navigate(-1)}
                    saving={saving}
                />
            </>
        );
    }

    const shell = (icon, title, body, actions) => (
        <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 pb-16 text-center" aria-live="polite">
            {inputs}
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-mint text-forest-ink">{icon}</div>
            <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
            {body ? <p className="max-w-sm text-sm text-ink-muted">{body}</p> : null}
            <div className="mt-2 flex w-full max-w-sm flex-col gap-2.5">{actions}</div>
        </main>
    );
    const primary = (label, onClick, icon) => (
        <button type="button" onClick={onClick} className="flex h-14 items-center justify-center gap-2 rounded-[18px] bg-forest text-base font-semibold text-white active:scale-[0.98]">
            {icon}
            {label}
        </button>
    );
    const secondary = (label, onClick) => (
        <button type="button" onClick={onClick} className="flex h-12 items-center justify-center rounded-[18px] border border-line-strong bg-surface text-sm font-semibold text-ink">
            {label}
        </button>
    );

    if (state.phase === 'preparing' || state.phase === 'extracting') {
        return shell(
            <Loader2 size={26} className="animate-spin" aria-hidden="true" />,
            state.phase === 'preparing' ? t('scan.preparing') : t('scan.reading'),
            t('scan.readingHint'),
            secondary(t('common.actions.cancel'), () => navigate(-1))
        );
    }

    if (state.phase === 'queued') {
        return shell(<CloudOff size={26} aria-hidden="true" />, t('scan.queuedTitle'), t('scan.offlineQueued'), primary(t('scan.done'), () => navigate('/', { replace: true })));
    }

    if (state.phase === 'error') {
        const kind = state.error;
        return shell(
            <AlertTriangle size={26} aria-hidden="true" />,
            t('scan.errorTitle'),
            t(`scan.err.${kind}`),
            <>
                {state.file && kind !== 'invalid' ? primary(t('scan.tryAgain'), () => dispatch({ type: 'RETRY' })) : null}
                {primary(t('scan.enterManuallyPhoto'), () => openManual(false), <FileText size={18} aria-hidden="true" />)}
                {secondary(t('scan.chooseAnother'), () => dispatch({ type: 'RESCAN' }))}
            </>
        );
    }

    return shell(
        <Camera size={26} aria-hidden="true" />,
        t('scan.title'),
        t('scan.intro'),
        <>
            {primary(t('scan.takePhoto'), () => cameraRef.current?.click(), <Camera size={20} aria-hidden="true" />)}
            {secondary(t('scan.chooseFile'), () => galleryRef.current?.click())}
            <button type="button" onClick={() => navigate(-1)} className="flex h-11 items-center justify-center gap-1 text-sm font-semibold text-ink-muted">
                <X size={14} aria-hidden="true" />
                {t('common.actions.cancel')}
            </button>
        </>
    );
}

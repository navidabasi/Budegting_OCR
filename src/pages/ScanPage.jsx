import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Camera, CloudOff, FileText, Loader2, X } from 'lucide-react';
import ReviewScreen from '../components/scan/ReviewScreen';
import { useAppStore } from '../store/appStore';
import { useMerchantRules, useAccounts, useCreateGroup, useCreateTransaction, useDeleteTransaction, useGroupsData, useTrips, useSettings, useTransactions } from '../data/hooks';
import { resolveGroup, tripForDate } from '../utils/tripMath';
import { useCategories } from '../hooks/useCategories';
import { useTranslation } from '../languages/useTranslation';
import { buildHints, extractReceipt, initialScanState, ScanError, scanReducer } from '../services/receiptScan';
import { createPendingScan } from '../services/pendingScans';
import { queueImage, requestImageFlush } from '../data/images';
import { optimizeImage } from '../utils/imageOptimize';
import { isPdf, renderPdfFirstPage } from '../utils/pdfRender';
import { decimalSeparator, formatMoney, localeFor } from '../utils/format';
import { getLastAccountId, setLastAccountId } from '../utils/quickAdd';
import { suggestForMerchant } from '../services/categorizer';
import { merchantKey } from '../utils/merchant';
import { normalizeCategoryName } from '../utils/categoryNames';
import { getScanPrefs } from '../utils/scanPrefs';
import { takeSharedFiles } from '../services/sharedFiles';
import { deleteDraft, getDraft, saveDraft } from '../data/drafts';
import { useDraft } from '../data/syncHooks';
import { isStorageFullError } from '../data/repo';
import { findManualMatches } from '../utils/scanMatch';
import { attachScanToTransaction } from '../services/scanAttach';
import { applyItemRules } from '../utils/itemRules';
import { itemsFromExtraction, serializeItems } from '../utils/receiptItems';
import { useUserPrefs } from '../hooks/useUserPrefs';

async function getAccessToken() {
    const { supabase } = await import('../services/supabaseService');
    const { data } = (await supabase?.auth.getSession()) || {};
    return data?.session?.access_token || null;
}

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function formFromResult(result, { defaultCurrency, sep, accountId, names, rules, transactions }) {
    const r = result.receipt;
    const pick = (c) => {
        const n = normalizeCategoryName(c);
        return n && names.includes(n) ? n : null;
    };
    // A learned rule (the user's own correction) beats the model's guess; otherwise the model's category, then history/seeds
    const ruleHit = rules.find((x) => x.merchantKey && x.merchantKey === merchantKey(r.merchant));
    const category = pick(ruleHit?.category) || pick(r.category) || suggestForMerchant({ merchant: r.merchant, items: r.items, rules, transactions, names }) || '';
    return {
        suggested: category,
        categoryTouched: false,
        merchant: r.merchant || '',
        date: r.date || new Date().toISOString().slice(0, 10),
        total: r.total === null ? '' : String(r.total).replace('.', sep),
        currency: r.currency || defaultCurrency,
        category,
        items: applyItemRules(itemsFromExtraction(r.items, { category, confidence: r.confidence?.items }), rules),
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
    const { rules } = useMerchantRules();
    const { accounts } = useAccounts();
    const { groups } = useGroupsData();
    const { trips } = useTrips();
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
    const savingRef = useRef(false); // synchronous duplicate-submit guard
    const txIdRef = useRef(newId()); // the id of the transaction this scan becomes: a repeated save is the same record
    const scanDraft = useDraft('scan');
    const { prefs, setPrefs } = useUserPrefs();
    const userId = currentUser?.userId;

    const categoryNames = useMemo(() => categoryList.map((c) => (typeof c === 'string' ? c : c.name)).filter((n) => n !== 'Income' && n !== 'Transfer'), [categoryList]);
    const locale = localeFor(languageCode, defaultCurrency);
    const sep = decimalSeparator(locale);

    const previewUrl = useMemo(() => (state.file ? URL.createObjectURL(state.file) : state.original && !isPdf(state.original) ? URL.createObjectURL(state.original) : null), [state.file, state.original]);
    useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

    const rulesRef = useRef(rules);
    rulesRef.current = rules;
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
                // The photo is stored on the device before the (cloud) reading starts: closing the app now loses nothing
                txIdRef.current = newId();
                await saveDraft({ userId, kind: 'scan', data: { stage: 'extracting', txId: txIdRef.current }, blob: prepared });
                dispatch({ type: 'PREPARED', file: prepared });
            } catch (err) {
                console.error('[Scan] prepare failed', err);
                dispatch({ type: 'FAILED', kind: 'invalid' });
            }
        },
        [userId]
    );

    // Keep the review form in the draft while it is being corrected
    useEffect(() => {
        if (state.phase !== 'review' || !form || !state.file || !userId) return undefined;
        const timer = setTimeout(() => saveDraft({ userId, kind: 'scan', data: { stage: 'review', result: state.result, form, txId: txIdRef.current }, blob: state.file }), 400);
        return () => clearTimeout(timer);
    }, [state.phase, state.file, state.result, form, userId]);

    const resumeScan = useCallback(async () => {
        const d = await getDraft(userId, 'scan');
        if (!d?.blob) return false;
        const file = d.blob instanceof Blob ? d.blob : new Blob([d.blob], { type: 'image/jpeg' });
        if (d.data?.txId) txIdRef.current = d.data.txId;
        if (d.data?.stage === 'review' && d.data.result && d.data.form) {
            setForm(d.data.form);
            dispatch({ type: 'RESTORE', file, result: d.data.result });
        } else {
            dispatch({ type: 'RESTORE', file });
        }
        return true;
    }, [userId]);

    const discardScan = useCallback(async () => {
        await deleteDraft(userId, 'scan');
    }, [userId]);

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
                setForm(formFromResult(result, { defaultCurrency, sep, accountId, names: categoryNames, rules: rulesRef.current, transactions }));
                dispatch({ type: 'EXTRACTED', result });
            } catch (err) {
                if (cancelled) return;
                if (err instanceof ScanError && err.kind === 'offline') {
                    try {
                        await createPendingScan({ userId: currentUser.userId, file: state.file, label: t('scan.pendingMerchant'), accountId: accounts[0]?.id || null, currency: defaultCurrency });
                        await discardScan();
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
        if (params.get('resume')) {
            resumeScan();
        } else if (params.get('shared')) {
            takeSharedFiles().then((files) => files[0] && handlePick(files[0]));
        } else if (params.get('source') === 'camera') cameraRef.current?.click();
        else if (params.get('source') === 'gallery') galleryRef.current?.click();
    }, [params, handlePick, resumeScan]);

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

    // Items are saved as read: lines that are still uncertain stay flagged (needs_review) so they can be finished later
    const buildLineItems = (prefs) => serializeItems((prefs.readItems ? form.items : []).filter((it) => String(it.name || '').trim() || it.amount !== null));

    // A manual entry for the same purchase already exists: offer to attach the photo and items to it instead of saving twice
    const formTotal = form ? parseFloat(String(form.total).replace(',', '.')) || 0 : 0;
    const matches = useMemo(
        () => (form ? findManualMatches(transactions, { total: formTotal, date: form.date, merchant: form.merchant, currency: form.currency }) : []),
        [transactions, form?.date, form?.merchant, form?.currency, formTotal] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const attach = async (tx) => {
        if (!form || !currentUser || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
            const prefs = getScanPrefs();
            await attachScanToTransaction({ transactionId: tx.id, userId, file: prefs.saveImages ? state.file : null, result: state.result, items: buildLineItems(prefs) });
            await discardScan();
            showToast(t('capture.attached'), 'success');
            navigate('/', { replace: true });
        } catch (err) {
            console.error('[Scan] attach failed', err);
            showToast(isStorageFullError(err) ? t('storage.full') : t('quickAdd.saveFailed'), 'error');
            savingRef.current = false;
            setSaving(false);
        }
    };

    const save = async () => {
        if (!form || !currentUser || savingRef.current) return;
        const total = parseFloat(String(form.total).replace(',', '.')) || 0;
        if (total <= 0) return;
        savingRef.current = true;
        setSaving(true);
        try {
            const id = txIdRef.current;
            const tripGroup = resolveGroup(form.more, tripForDate(trips, form.date), form.tripDetached);
            const r = state.result.receipt;
            const prefs = getScanPrefs();
            const imagePath = state.file && prefs.saveImages ? await queueImage({ userId: currentUser.userId, transactionId: id, blob: state.file }) : null;
            const lineItems = buildLineItems(prefs);
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
                groupId: tripGroup.groupId,
                groupName: tripGroup.groupName,
                groupTags: form.more.tags,
                splitData: form.more.splitData,
                imagePath,
                extraction: { ...state.result.extraction, confidence: r.confidence, paymentMethod: r.paymentMethod, time: r.time, merchantRaw: r.merchantRaw, tax: r.tax },
            });
            if (form.accountId) setLastAccountId(form.accountId);
            await discardScan();
            requestImageFlush(currentUser.userId);
            const money = formatMoney(total, form.currency, locale);
            showToast(form.merchant.trim() ? t('quickAdd.addedAt', { amount: money, merchant: form.merchant.trim() }) : t('quickAdd.added', { amount: money }), 'success', {
                action: { label: t('quickAdd.undo'), onClick: () => deleteTransaction(id).then(() => showToast(t('quickAdd.removed'), 'info')) },
            });
            navigate('/', { replace: true });
        } catch (err) {
            console.error('[Scan] save failed', err);
            showToast(isStorageFullError(err) ? t('storage.full') : t('quickAdd.saveFailed'), 'error');
            savingRef.current = false;
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
                    trips={trips}
                    categoryNames={categoryNames}
                    transactions={transactions}
                    rules={rules}
                    onCreateGroup={(name) => createGroup({ name, color: '#3b82f6', isPinned: false })}
                    onSave={save}
                    onManual={() => openManual(true)}
                    onRescan={() => {
                        dispatch({ type: 'RESCAN' });
                        setForm(null);
                    }}
                    onBack={() => navigate(-1)}
                    saving={saving}
                    matches={matches}
                    onAttach={attach}
                    customSubcategories={prefs.subcategories || {}}
                    onAddSubcategory={(category, label) => setPrefs({ subcategories: { ...(prefs.subcategories || {}), [category]: [...new Set([...((prefs.subcategories || {})[category] || []), label])] } })}
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
            secondary(t('common.actions.cancel'), async () => {
                await discardScan();
                navigate(-1);
            })
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
            {scanDraft?.blob ? (
                <div className="flex flex-col gap-2 rounded-[18px] bg-mint px-4 py-3 text-start" data-testid="scan-draft-card">
                    <p className="text-sm font-semibold text-forest-ink">{t('draft.scanTitle')}</p>
                    <p className="text-sm text-forest-ink">{t('draft.scanBody')}</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={resumeScan} className="h-11 flex-1 rounded-[12px] bg-forest px-3 text-sm font-semibold text-white">
                            {t('draft.scanResume')}
                        </button>
                        <button type="button" onClick={discardScan} className="h-11 flex-1 rounded-[12px] border border-line-strong bg-surface px-3 text-sm font-semibold text-ink">
                            {t('draft.discard')}
                        </button>
                    </div>
                </div>
            ) : null}
            {primary(t('scan.takePhoto'), () => cameraRef.current?.click(), <Camera size={20} aria-hidden="true" />)}
            {secondary(t('scan.chooseFile'), () => galleryRef.current?.click())}
            <button type="button" onClick={() => navigate(-1)} className="flex h-11 items-center justify-center gap-1 text-sm font-semibold text-ink-muted">
                <X size={14} aria-hidden="true" />
                {t('common.actions.cancel')}
            </button>
        </>
    );
}

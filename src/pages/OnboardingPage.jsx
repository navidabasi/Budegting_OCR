import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chip } from '../components/ui';
import { useRowMutations, useSaveSettings, useSettings } from '../data/hooks';
import { useAppStore } from '../store/appStore';
import { LANGUAGE_OPTIONS } from '../languages';
import { useTranslation } from '../languages/useTranslation';
import { CURRENCIES } from '../utils/constants';
import { dateKey } from '../utils/quickAdd';
import { decimalSeparator, localeFor } from '../utils/format';

export const onboardedKey = (userId) => `wmw.onboarded.${userId}`;
export const markOnboarded = (userId) => {
    try {
        localStorage.setItem(onboardedKey(userId), '1');
    } catch {
        /* storage blocked: the gate may show once more */
    }
};

const PRESET_ACCOUNTS = [
    { name: 'Revolut', kind: 'spending' },
    { name: 'PostePay', kind: 'spending' },
    { name: 'Cash', kind: 'cash' },
];

const field = 'h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';

/** First-run setup: currency + language, accounts (Revolut / PostePay / Cash preselected), optional monthly budget. */
export default function OnboardingPage() {
    const { t, languageCode } = useTranslation();
    const navigate = useNavigate();
    const userId = useAppStore((s) => s.currentUser?.userId);
    const setLanguageCode = useAppStore((s) => s.setLanguageCode);
    const showToast = useAppStore((s) => s.showToast);
    const { defaultCurrency } = useSettings();
    const saveSettings = useSaveSettings();
    const accountsApi = useRowMutations('accounts');
    const budgetsApi = useRowMutations('budgets');

    const [step, setStep] = useState(0);
    const [currency, setCurrency] = useState(defaultCurrency || 'EUR');
    const [accounts, setAccounts] = useState(PRESET_ACCOUNTS.map((a) => ({ ...a, on: true })));
    const [extra, setExtra] = useState('');
    const [budget, setBudget] = useState('');
    const [busy, setBusy] = useState(false);
    const sep = decimalSeparator(localeFor(languageCode, currency));

    const addExtra = () => {
        const name = extra.trim();
        if (!name || accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
        setAccounts([...accounts, { name, kind: 'spending', on: true }]);
        setExtra('');
    };

    const skip = () => {
        markOnboarded(userId);
        navigate('/', { replace: true });
    };

    const finish = async () => {
        setBusy(true);
        try {
            await saveSettings({ defaultCurrency: currency, languageCode });
            const chosen = accounts.filter((a) => a.on);
            for (let i = 0; i < chosen.length; i++) {
                await accountsApi.create({ name: chosen[i].name, kind: chosen[i].kind, currency, openingBalance: 0, openingDate: dateKey(0), isArchived: false, sortOrder: i });
            }
            const amount = parseFloat(String(budget).replace(',', '.'));
            if (amount > 0) {
                const first = `${dateKey(0).slice(0, 8)}01`;
                await budgetsApi.create({ category: '*', amount, currency, startsOn: first, endsOn: null });
            }
            markOnboarded(userId);
            navigate('/', { replace: true });
        } catch (err) {
            console.error('[Onboarding] failed', err);
            showToast(t('quickAdd.saveFailed'), 'error');
            setBusy(false);
        }
    };

    const titles = [t('onboarding.step1.title'), t('onboarding.step2.title'), t('onboarding.step3.title')];
    const bodies = [t('onboarding.step1.body'), t('onboarding.step2.body'), t('onboarding.step3.body')];

    return (
        <main className="mx-auto flex min-h-[100dvh] max-w-xl flex-col px-5 pt-[max(env(safe-area-inset-top),24px)]">
            <div className="flex items-center justify-between pb-6 pt-3">
                <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label={t('onboarding.progress', { step: step + 1, total: 3 })}>
                    {[0, 1, 2].map((i) => (
                        <span key={i} className={`h-1.5 w-8 rounded-full ${i <= step ? 'bg-forest-ink' : 'bg-line'}`} />
                    ))}
                </div>
                <button type="button" onClick={skip} className="h-11 px-2 text-sm font-semibold text-ink-muted">
                    {t('onboarding.skip')}
                </button>
            </div>

            <h1 className="font-display text-[30px] font-bold leading-tight tracking-tight text-ink">{titles[step]}</h1>
            <p className="mt-2 text-[15px] text-ink-muted">{bodies[step]}</p>

            <div className="mt-6 flex flex-1 flex-col gap-5">
                {step === 0 ? (
                    <>
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('onboarding.currency')}</span>
                            <div className="flex flex-wrap gap-2">
                                {CURRENCIES.map((c) => (
                                    <Chip key={c.code} selected={currency === c.code} onClick={() => setCurrency(c.code)}>
                                        {c.code} {c.symbol}
                                    </Chip>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('onboarding.language')}</span>
                            <div className="flex flex-wrap gap-2">
                                {LANGUAGE_OPTIONS.map((l) => (
                                    <Chip key={l.code} selected={languageCode === l.code} onClick={() => setLanguageCode(l.code)}>
                                        {l.nativeLabel}
                                    </Chip>
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}

                {step === 1 ? (
                    <>
                        <div className="flex flex-wrap gap-2">
                            {accounts.map((a, i) => (
                                <Chip key={a.name} selected={a.on} onClick={() => setAccounts(accounts.map((x, idx) => (idx === i ? { ...x, on: !x.on } : x)))}>
                                    {a.name}
                                </Chip>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input className={field} value={extra} placeholder={t('onboarding.addAccountPlaceholder')} aria-label={t('accounts.name')} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExtra()} />
                            <button type="button" onClick={addExtra} disabled={!extra.trim()} className="h-12 shrink-0 rounded-[14px] border border-line-strong bg-surface px-4 text-sm font-semibold text-forest-ink disabled:opacity-40">
                                {t('onboarding.add')}
                            </button>
                        </div>
                        <p className="text-xs text-ink-muted">{t('onboarding.accountsHint')}</p>
                    </>
                ) : null}

                {step === 2 ? (
                    <label className="flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('onboarding.budgetLabel')}</span>
                        <div className="flex items-baseline gap-2" dir="ltr">
                            <input className={`${field} font-mono text-2xl`} inputMode="decimal" value={budget} placeholder={`1000${sep}00`} onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ''))} />
                            <span className="font-mono text-xl text-ink-muted">{CURRENCIES.find((c) => c.code === currency)?.symbol || currency}</span>
                        </div>
                    </label>
                ) : null}
            </div>

            <div className="flex flex-col gap-2 pt-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}>
                {step < 2 ? (
                    <button type="button" onClick={() => setStep(step + 1)} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white active:scale-[0.98]">
                        {t('onboarding.next')}
                    </button>
                ) : (
                    <>
                        <button type="button" onClick={finish} disabled={busy} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-50">
                            {budget ? t('onboarding.finish') : t('onboarding.finishNoBudget')}
                        </button>
                    </>
                )}
                {step > 0 ? (
                    <button type="button" onClick={() => setStep(step - 1)} className="h-11 text-sm font-semibold text-ink-muted">
                        {t('common.actions.back')}
                    </button>
                ) : null}
            </div>
        </main>
    );
}

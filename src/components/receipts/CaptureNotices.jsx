import { useState } from 'react';
import { useTranslation } from '../../languages/useTranslation';
import { useAppStore } from '../../store/appStore';
import { formatMoney, localeFor } from '../../utils/format';

const box = 'flex flex-col gap-2.5 rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink';
const primary = 'h-11 min-w-[44px] flex-1 rounded-[14px] bg-forest px-3.5 text-sm font-semibold text-white disabled:opacity-50';
const secondary = 'h-11 min-w-[44px] flex-1 rounded-[14px] border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink disabled:opacity-50';

/**
 * While a photo waits to be read the amount can already be confirmed by hand. The confirmed total counts straight away and
 * the later reading never overwrites it (extractionMerge); a different reading is offered as a suggestion instead.
 */
export function PendingTotalCard({ receipt, onSave }) {
    const { t } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const [value, setValue] = useState(Number(receipt.total) > 0 ? String(receipt.total).replace('.', ',') : '');
    const [busy, setBusy] = useState(false);
    const amount = parseFloat(String(value).replace(',', '.'));
    const valid = Number.isFinite(amount) && amount > 0;
    const submit = async () => {
        if (!valid || busy) return;
        setBusy(true);
        try {
            await onSave(Math.round(amount * 100) / 100);
            showToast(t('capture.totalSaved'), 'success');
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className={box} data-testid="pending-total">
            <p>{t('detail.pendingRead')}</p>
            <div>
                <label htmlFor="pending-total-input" className="text-xs font-semibold uppercase tracking-wider">
                    {t('capture.confirmTotal')}
                </label>
                <p className="mt-0.5 text-xs">{t('capture.confirmTotalHint')}</p>
            </div>
            <div className="flex gap-2">
                <input
                    id="pending-total-input"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                    dir="ltr"
                    className="h-11 min-w-0 flex-1 rounded-[14px] border border-warn-edge bg-surface px-3.5 font-mono text-base text-ink focus:outline-none focus:ring-2 focus:ring-forest-ink"
                />
                <button type="button" className={primary} disabled={!valid || busy} onClick={submit}>
                    {t('capture.saveTotal')}
                </button>
            </div>
        </section>
    );
}

/** The reading disagrees with the amount the user confirmed: show both, let the user pick. */
export function SuggestedTotalCard({ receipt, onUse, onKeep }) {
    const { t, languageCode } = useTranslation();
    const suggested = receipt.extraction?.suggested?.total;
    if (!(Number(suggested) > 0) || Math.abs(Number(suggested) - Number(receipt.total)) < 0.005) return null;
    const money = formatMoney(Number(suggested), receipt.currency, localeFor(languageCode, receipt.currency));
    return (
        <section className={box} data-testid="suggested-total">
            <p>{t('capture.suggested', { amount: money })}</p>
            <div className="flex gap-2">
                <button type="button" className={primary} onClick={() => onUse(Number(suggested))}>
                    {t('capture.useSuggested', { amount: money })}
                </button>
                <button type="button" className={secondary} onClick={onKeep}>
                    {t('capture.keepMine')}
                </button>
            </div>
        </section>
    );
}

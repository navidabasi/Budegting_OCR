import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet } from '../ui';
import { useTranslation } from '../../languages/useTranslation';
import { useMoney } from '../../hooks/useMoney';
import { useAppStore } from '../../store/appStore';
import { confirmedPatch, estimatedPatch, fxInfo } from '../../utils/fx';
import { getRateInfo, todayKey } from '../../services/exchangeRateService';

const field = 'h-12 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-forest-ink';
const toNumber = (v) => {
    const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Original amount, base-currency amount, rate, rate date and source, with its status (confirmed / estimated / waiting for a rate)
 * for a foreign-currency record. "Edit conversion" opens a sheet to type the amount the bank charged (confirmed) or a rate (estimated).
 */
export default function ConversionCard({ receipt, onSave }) {
    const { t, languageCode } = useTranslation();
    const { money, currency: base } = useMoney();
    const showToast = useAppStore((s) => s.showToast);
    const [open, setOpen] = useState(false);
    const info = fxInfo(receipt, base);
    const [amount, setAmount] = useState('');
    const [rate, setRate] = useState('');
    const [edited, setEdited] = useState(null); // 'amount' | 'rate'
    const [busy, setBusy] = useState(false);
    const [noRate, setNoRate] = useState(false);
    if (!info) return null;
    const total = Number(receipt.total) || 0;
    const fmtRate = (r) => (r === null || r === undefined ? '' : String(Math.round(r * 1e6) / 1e6));
    const rateLine = fmtRate(info.rate);
    const sourceText = info.source ? t(`fx.source.${info.source}`) : '';
    const dateText = info.date ? new Intl.DateTimeFormat(`${languageCode}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${info.date}T00:00:00`)) : '';

    const openSheet = () => {
        setAmount(info.baseAmount !== null ? String(info.baseAmount) : '');
        setRate(fmtRate(info.rate));
        setEdited(null);
        setNoRate(false);
        setOpen(true);
    };
    const onAmount = (v) => {
        setAmount(v);
        setEdited('amount');
        const n = toNumber(v);
        setRate(n && total ? fmtRate(n / total) : '');
    };
    const onRate = (v) => {
        setRate(v);
        setEdited('rate');
        const n = toNumber(v);
        setAmount(n && total ? String(round2(n * total)) : '');
    };
    const latest = async () => {
        setBusy(true);
        setNoRate(false);
        const r = await getRateInfo(receipt.currency, base);
        setBusy(false);
        if (!r) return setNoRate(true);
        onRate(String(r.rate));
    };
    const save = async () => {
        if (busy || !edited) return;
        const ctx = { total: receipt.total, currency: receipt.currency, extraction: receipt.extraction };
        const patch = edited === 'amount' ? confirmedPatch(ctx, { baseCurrency: base, charged: toNumber(amount), date: todayKey(), source: 'charged' }) : estimatedPatch(ctx, { baseCurrency: base, rate: toNumber(rate), date: todayKey(), source: 'manual' });
        if (!patch || patch.amountBase === null) return setNoRate(true);
        setBusy(true);
        try {
            await onSave(patch);
            showToast(t('fx.saved'), 'success');
            setOpen(false);
        } catch {
            showToast(t('fx.failed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const tone = info.status === 'pending' ? 'bg-warn-soft text-warn-ink' : info.status === 'confirmed' ? 'bg-mint text-forest-ink' : 'bg-tint text-ink-muted';
    return (
        <section className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface px-4 py-3" data-testid="conversion-card" data-status={info.status}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('fx.title')}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`} data-testid="fx-status">{t(`fx.status.${info.status}`)}</span>
            </div>
            <p className="text-sm leading-snug text-ink">
                {t(`fx.line.${info.status}`, { original: money(info.originalAmount, info.originalCurrency), base: info.baseAmount !== null ? money(info.baseAmount, base) : '', rate: rateLine, currency: base })}
            </p>
            {info.status !== 'pending' ? (
                <p className="text-xs text-ink-muted">
                    {[sourceText, info.status === 'estimated' && dateText ? t('fx.rateDate', { date: dateText }) : ''].filter(Boolean).join(' · ')}
                </p>
            ) : null}
            <button type="button" onClick={openSheet} className="flex h-11 w-fit items-center rounded-xl border border-line-strong px-3.5 text-sm font-semibold text-forest-ink" data-testid="fx-edit">
                {info.status === 'pending' ? t('fx.setAmount', { currency: base }) : t('fx.edit')}
            </button>

            <Sheet open={open} onClose={() => setOpen(false)} label={t('fx.title')}>
                <div className="flex flex-col gap-3 px-5 pb-5" data-testid="fx-sheet">
                    <h2 className="font-display text-xl font-bold text-ink">{t('fx.title')}</h2>
                    <p className="text-sm text-ink-muted">{t('fx.sheetIntro')}</p>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('fx.amountLabel', { currency: base })}</span>
                        <input className={field} inputMode="decimal" value={amount} onChange={(e) => onAmount(e.target.value)} data-testid="fx-amount" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('fx.rateLabel', { from: receipt.currency, to: base })}</span>
                        <input className={field} inputMode="decimal" value={rate} onChange={(e) => onRate(e.target.value)} data-testid="fx-rate" />
                    </label>
                    <button type="button" onClick={latest} disabled={busy} className="flex h-11 w-fit items-center gap-2 rounded-xl px-2 text-sm font-semibold text-forest-ink">
                        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                        {t('fx.useLatest')}
                    </button>
                    {noRate ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-ink" role="alert">{t('fx.noRate')}</p> : null}
                    <button type="button" onClick={save} disabled={busy || !edited} className="flex h-14 items-center justify-center rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-50" data-testid="fx-save">
                        {t('fx.save')}
                    </button>
                </div>
            </Sheet>
        </section>
    );
}

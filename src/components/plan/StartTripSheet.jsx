import { useEffect, useState } from 'react';
import { Chip, Sheet } from '../ui';
import { useAppStore } from '../../store/appStore';
import { useCreateTrip, useSettings, useUpdateGroup } from '../../data/hooks';
import { useTranslation } from '../../languages/useTranslation';
import { CURRENCIES } from '../../utils/constants';
import { dateKey } from '../../utils/monthMath';
import { parseLocalNumber } from '../../utils/helpers';

const field = 'h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const lbl = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';

/** Start (or edit) a trip: name, dates, budget, currency, companions, kept-out-of-budgets switch. */
export default function StartTripSheet({ open, onClose, trip = null, onSaved }) {
    const { t } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const { defaultCurrency } = useSettings();
    const createTrip = useCreateTrip();
    const updateGroup = useUpdateGroup();
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setSaving(false);
        setForm(
            trip
                ? { name: trip.name || '', startsOn: trip.startsOn ? dateKey(trip.startsOn) : '', endsOn: trip.endsOn ? dateKey(trip.endsOn) : '', budget: trip.budgetAmount ? String(trip.budgetAmount).replace('.', ',') : '', currency: trip.currency || defaultCurrency, companions: (trip.companions || []).join(', '), exclude: trip.excludeFromBudgets !== false }
                : { name: '', startsOn: dateKey(new Date()), endsOn: '', budget: '', currency: defaultCurrency, companions: '', exclude: true }
        );
    }, [open, trip, defaultCurrency]);

    if (!form) return null;
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const badDates = form.startsOn && form.endsOn && form.endsOn < form.startsOn;
    const canSave = form.name.trim() && form.startsOn && !badDates && !saving;

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        const budget = parseLocalNumber(form.budget);
        const values = {
            name: form.name.trim(),
            startsOn: form.startsOn,
            endsOn: form.endsOn || null,
            budgetAmount: budget > 0 ? Math.round(budget * 100) / 100 : null,
            currency: form.currency,
            companions: form.companions.split(',').map((c) => c.trim()).filter(Boolean),
            excludeFromBudgets: form.exclude,
        };
        try {
            let saved;
            if (trip) {
                await updateGroup(trip.id, values);
                saved = { ...trip, ...values };
            } else {
                saved = await createTrip(values);
            }
            showToast(t(trip ? 'trips.sheet.saved' : 'trips.sheet.started', { name: values.name }), 'success');
            onSaved?.(saved);
            onClose();
        } catch {
            showToast(t('trips.sheet.failed'), 'error');
            setSaving(false);
        }
    };

    const title = trip ? t('trips.sheet.titleEdit') : t('trips.sheet.titleStart');
    const currencies = CURRENCIES.some((c) => c.code === form.currency) ? CURRENCIES : [{ code: form.currency }, ...CURRENCIES];
    return (
        <Sheet open={open} onClose={onClose} label={title}>
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
                <label className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('trips.sheet.name')}</span>
                    <input className={field} value={form.name} placeholder={t('trips.sheet.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} data-autofocus />
                </label>
                <div className="flex gap-3">
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className={lbl}>{t('trips.sheet.from')}</span>
                        <input type="date" className={field} value={form.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className={lbl}>{t('trips.sheet.to')}</span>
                        <input type="date" className={field} value={form.endsOn} min={form.startsOn || undefined} onChange={(e) => set({ endsOn: e.target.value })} />
                    </label>
                </div>
                <p className={`text-xs ${badDates ? 'text-over-ink' : 'text-ink-muted'}`}>{badDates ? t('trips.sheet.badDates') : t('trips.sheet.datesHint')}</p>
                <label className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('trips.sheet.budget')}</span>
                    <input className={`${field} font-mono`} inputMode="decimal" dir="ltr" value={form.budget} placeholder="0" onChange={(e) => set({ budget: e.target.value.replace(/[^\d.,]/g, '') })} />
                </label>
                <div className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('trips.sheet.currency')}</span>
                    <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
                        {currencies.map((c) => (
                            <Chip key={c.code} selected={form.currency === c.code} onClick={() => set({ currency: c.code })}>
                                {c.code}
                            </Chip>
                        ))}
                    </div>
                </div>
                <label className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('trips.sheet.companions')}</span>
                    <input className={field} value={form.companions} placeholder={t('trips.sheet.companionsPlaceholder')} onChange={(e) => set({ companions: e.target.value })} />
                </label>
                <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-[14px] bg-surface px-3.5 py-2 text-sm text-ink">
                    <span className="flex flex-col">
                        <span className="font-medium">{t('trips.sheet.exclude')}</span>
                        <span className="text-xs text-ink-muted">{t('trips.sheet.excludeHint')}</span>
                    </span>
                    <input type="checkbox" role="switch" className="h-6 w-6 shrink-0 accent-[#00573F]" checked={form.exclude} onChange={(e) => set({ exclude: e.target.checked })} />
                </label>
            </div>
            <div className="px-5 pt-3">
                <button type="button" onClick={save} disabled={!canSave} className="h-14 w-full rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                    {trip ? t('trips.sheet.save') : t('trips.sheet.start')}
                </button>
            </div>
        </Sheet>
    );
}

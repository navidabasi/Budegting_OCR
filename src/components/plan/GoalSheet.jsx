import { useEffect, useState } from 'react';
import { Chip, Sheet } from '../ui';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';
import { parseLocalNumber } from '../../utils/helpers';
import DateField from '../ui/DateField';

const field = 'h-12 w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-forest-ink';
const lbl = 'text-xs font-semibold uppercase tracking-wider text-ink-muted';
const toText = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));

/**
 * Add / edit a savings goal. `initial` prefills (chat add_goal action opens this sheet, never saves by itself).
 * Props: open, onClose, goal (existing or null), initial ({ name, targetAmount, targetDate }), accounts, currency, onSave(data), onDelete(goal)
 */
export default function GoalSheet({ open, onClose, goal = null, initial = null, accounts = [], currency = 'EUR', onSave, onDelete }) {
    const { t } = useTranslation();
    const showToast = useAppStore((s) => s.showToast);
    const [form, setForm] = useState({ name: '', target: '', date: '', accountId: null, starting: '' });
    const [confirm, setConfirm] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        const src = goal || initial || {};
        setForm({ name: src.name || '', target: toText(src.targetAmount), date: src.targetDate ? String(src.targetDate).slice(0, 10) : '', accountId: src.accountId || null, starting: toText(src.startingAmount) });
        setConfirm(false);
        setSaving(false);
    }, [open, goal, initial]);

    const target = parseLocalNumber(form.target);
    const canSave = form.name.trim() && target > 0 && !saving;
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await onSave({
                name: form.name.trim(),
                targetAmount: Math.round(target * 100) / 100,
                targetDate: form.date || null,
                accountId: form.accountId || null,
                startingAmount: Math.round(parseLocalNumber(form.starting) * 100) / 100,
                currency: goal?.currency || currency,
                isArchived: false,
            });
            showToast(t('savings.goalSheet.saved'), 'success');
            onClose();
        } catch {
            showToast(t('savings.goalSheet.failed'), 'error');
            setSaving(false);
        }
    };
    const remove = async () => {
        setSaving(true);
        try {
            await onDelete(goal);
            showToast(t('savings.goalSheet.deleted'), 'info');
            onClose();
        } catch {
            showToast(t('savings.goalSheet.failed'), 'error');
            setSaving(false);
        }
    };

    const title = goal ? t('savings.goalSheet.titleEdit') : t('savings.goalSheet.titleAdd');
    return (
        <Sheet open={open} onClose={onClose} label={title}>
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-2">
                <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
                <label className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('savings.goalSheet.name')}</span>
                    <input className={field} value={form.name} placeholder={t('savings.goalSheet.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} data-autofocus />
                </label>
                <div className="flex gap-3">
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className={lbl}>{t('savings.goalSheet.target')}</span>
                        <input className={`${field} font-mono`} inputMode="decimal" dir="ltr" value={form.target} placeholder="0" onChange={(e) => set({ target: e.target.value.replace(/[^\d.,]/g, '') })} />
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className={lbl}>{t('savings.goalSheet.date')}</span>
                        <DateField value={form.date} onChange={(v) => set({ date: v })} label={t('savings.goalSheet.date')} />
                    </label>
                </div>
                <label className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('savings.goalSheet.starting')}</span>
                    <input className={`${field} font-mono`} inputMode="decimal" dir="ltr" value={form.starting} placeholder="0" onChange={(e) => set({ starting: e.target.value.replace(/[^\d.,]/g, '') })} />
                </label>
                <div className="flex flex-col gap-1.5">
                    <span className={lbl}>{t('savings.goalSheet.account')}</span>
                    <div className="flex flex-wrap gap-2">
                        <Chip selected={!form.accountId} onClick={() => set({ accountId: null })}>
                            {t('savings.goalSheet.noAccount')}
                        </Chip>
                        {accounts.map((a) => (
                            <Chip key={a.id} selected={form.accountId === a.id} onClick={() => set({ accountId: a.id })}>
                                {a.name}
                            </Chip>
                        ))}
                    </div>
                    <span className="text-xs text-ink-muted">{t('savings.goalSheet.accountHint')}</span>
                </div>
                {confirm ? <p className="rounded-[14px] bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">{t('savings.goalSheet.deleteNote')}</p> : null}
            </div>
            <div className="flex flex-col gap-2 px-5 pt-3">
                {confirm ? (
                    <button type="button" onClick={remove} disabled={saving} className="h-14 rounded-[18px] bg-over text-base font-semibold text-white disabled:opacity-40">
                        {t('savings.goalSheet.deleteConfirm')}
                    </button>
                ) : (
                    <button type="button" onClick={save} disabled={!canSave} className="h-14 rounded-[18px] bg-forest text-base font-semibold text-white disabled:opacity-40">
                        {t('savings.goalSheet.save')}
                    </button>
                )}
                {goal && !confirm ? (
                    <button type="button" onClick={() => setConfirm(true)} className="h-12 rounded-[18px] text-sm font-semibold text-over-ink">
                        {t('savings.goalSheet.delete')}
                    </button>
                ) : null}
            </div>
        </Sheet>
    );
}
